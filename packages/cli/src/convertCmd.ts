import { existsSync, statSync } from 'node:fs';
import { glob, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { convert, parsePreset, PresetError } from '@pixel3d/core';
import type { Preset, Report } from '@pixel3d/core';
import { setPath } from './args';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** A usage or preset problem: printed as-is, exit code 2. */
class UsageError extends Error {}

/** statSync that treats an unreadable or vanished path as "neither a file nor a directory". */
const kind = (p: string): 'file' | 'dir' | 'none' => {
  try {
    const st = statSync(p);
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'none';
  } catch {
    return 'none';
  }
};

/** Files, directories (non-recursive, images only) and globs, as a sorted list without duplicates. */
async function resolveInputs(args: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const a of args) {
    if (kind(a) === 'dir') {
      for (const f of await readdir(a)) if (IMAGE_EXT.has(extname(f).toLowerCase()) && kind(join(a, f)) === 'file') found.add(join(a, f));
    } else if (existsSync(a)) {
      found.add(a);
    } else if (/[*?[\]{}]/.test(a)) {
      // PowerShell passes dir\*.png literally; glob() wants forward slashes
      let any = false;
      for await (const f of glob(a.replaceAll('\\', '/'))) {
        if (kind(f) === 'file') { found.add(f); any = true; }
      }
      if (!any) throw new UsageError(`No files match ${a}`);
    } else {
      throw new UsageError(`No such file or directory: ${a}`);
    }
  }
  return [...found].sort();
}

/** Read the preset (if any), apply `--set` and `--format`, and validate. Throws `UsageError` with the printed message. */
async function loadPreset(file: string | undefined, sets: string[], format: string | undefined): Promise<Preset> {
  const label = file ? `Preset ${basename(file)}` : 'Preset';
  let raw: unknown = { version: 1, settings: {}, colourRules: [] };
  if (file) {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      throw new UsageError(`Preset ${basename(file)} could not be read: ${(e as Error).message}`);
    }
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new UsageError(`${label} is not valid JSON: ${(e as Error).message}`);
    }
  }
  const doc = raw as Record<string, unknown> | null;
  const settings = doc && typeof doc === 'object' ? doc.settings ?? (doc.settings = {}) : undefined;
  if ((sets.length || format) && settings && typeof settings === 'object' && !Array.isArray(settings)) {
    try {
      for (const s of sets) setPath(settings as Record<string, unknown>, s);
      if (format) setPath(settings as Record<string, unknown>, `export.format=${JSON.stringify(format)}`);
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
  }
  try {
    return parsePreset(raw);
  } catch (e) {
    if (e instanceof PresetError) throw new UsageError(`${label}: ${e.message}`);
    throw e;
  }
}

const mm = (n: number) => n.toFixed(1);

/** A failed-image report. Core has no empty-report constructor, so this mirrors the shape of `Report` in core's convert.ts. */
function failed(name: string, error: string, detail?: string): Report {
  return { name, palette: [], applied: [], dropped: [], size: { x: 0, y: 0, z: 0 }, pieces: 0, warnings: [], files: [], grid: { w: 0, h: 0 }, error, ...(detail ? { detail } : {}) };
}

/** `px3d convert`: resolves to the exit code. */
export async function convertCmd(argv: string[]): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          preset: { type: 'string' },
          out: { type: 'string' },
          format: { type: 'string' },
          set: { type: 'string', multiple: true },
        },
      });
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
    const { preset: presetFile, out, format } = parsed.values;
    if (!out) throw new UsageError('Missing --out <dir>.');
    if (format !== undefined && format !== 'stl' && format !== '3mf') throw new UsageError(`--format must be stl or 3mf, not "${format}".`);
    if (!parsed.positionals.length) throw new UsageError('Give at least one image, glob or folder to convert.');

    const preset = await loadPreset(presetFile, parsed.values.set ?? [], format);
    const inputs = await resolveInputs(parsed.positionals);
    if (!inputs.length) throw new UsageError('No images found (looking for .png .jpg .jpeg .gif .webp).');
    try {
      await mkdir(out, { recursive: true });
    } catch (e) {
      throw new UsageError(`Cannot use --out ${out}: ${(e as Error).message}`);
    }

    const reports: Report[] = [];
    const used = new Set<string>();
    let failures = 0;
    try {
      for (const input of inputs) {
        const file = basename(input);
        // two inputs with the same stem (a/x.png, b/x.png) must not overwrite each other's outputs
        const base = basename(input, extname(input));
        let stem = base;
        for (let i = 2; used.has(stem.toLowerCase()); i++) stem = `${base}-${i}`;
        used.add(stem.toLowerCase());

        let result;
        try {
          result = await convert(new Uint8Array(await readFile(input)), preset, stem);
        } catch (e) {
          result = { files: [], report: failed(stem, 'The file could not be read.', (e as Error).message) };
        }
        let { report } = result;
        if (!report.error) {
          const written: string[] = [];
          try {
            for (const f of result.files) {
              written.push(join(out, f.name));
              await writeFile(join(out, f.name), f.bytes);
            }
          } catch (e) {
            // one image's write failure must not stop the batch: drop its partial outputs and report it
            await Promise.all(written.map((w) => rm(w, { force: true }).catch(() => undefined)));
            const failedFile = basename(written[written.length - 1]!);
            report = failed(report.name, `Could not write ${failedFile}: ${(e as Error).message}`, (e as Error).stack?.split('\n').slice(0, 6).join('\n'));
          }
        }
        reports.push(report);
        if (report.error) {
          failures++;
          console.error(`✗ ${file}: ${report.error}`);
        } else {
          const { x, y, z } = report.size;
          console.error(`✓ ${file} → ${report.files.join(', ')} (${mm(x)} × ${mm(y)} × ${mm(z)} mm)`);
        }
        for (const w of report.warnings) console.error(`    warning: ${w}`);
      }
    } finally {
      await writeFile(join(out, 'report.json'), JSON.stringify(reports, null, 2) + '\n');
    }
    return failures ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}

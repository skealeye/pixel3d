import { existsSync, statSync } from 'node:fs';
import { glob, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { convert, emptyReport, parsePreset, PresetError, safeName, settingsSchema } from '@pixel3d/core';
import type { Preset, Report } from '@pixel3d/core';
import { CONVERT_OPTIONS, setPath } from './args';
import { emptyPresetDoc, parsePresetJson, PresetJsonError } from './presetLoad';

/** `px3d convert --help`. */
export const CONVERT_USAGE = `Usage: px3d convert <files|globs|dirs...> --out|-o <dir> [--preset p.json] [--format stl|3mf|obj|fbx] [--set key=value ...]

Convert images (.png .jpg .jpeg .gif .webp) to models. Writes the models and report.json into <dir>.
  --out, -o <dir>     Output folder (created if missing).
  --preset <file>     A preset JSON file saved from the app (default: the app's defaults).
  --format <f>        Overrides the preset's export format: stl, 3mf, obj or fbx.
  --set key=value     Sets a settings value by dotted path, e.g. --set base.height=3 (JSON values allowed). Repeatable.
  --help, -h          Shows this help.
Exit code: 0 all converted, 1 some image failed, 2 usage or preset error.`;

/** Export formats, as the settings schema lists them. */
export const FORMATS = settingsSchema.shape.export.shape.format.options;
export type Format = (typeof FORMATS)[number];

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** A usage or preset problem: printed as-is, exit code 2. */
export class UsageError extends Error {}

/** statSync that treats an unreadable or vanished path as "neither a file nor a directory". */
const kind = (p: string): 'file' | 'dir' | 'none' => {
  try {
    const st = statSync(p);
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'none';
  } catch {
    return 'none';
  }
};

/**
 * A glob as `glob()` wants it. On Windows, PowerShell passes `dir\*.png` literally and glob() wants forward slashes;
 * elsewhere a backslash escapes a glob character (`\[`), so it is left alone.
 */
export const globPattern = (a: string, platform: string = process.platform) => (platform === 'win32' ? a.replaceAll('\\', '/') : a);

/** Output-name key: two stems collide when their sanitized names match, ignoring case (Windows and macOS file systems). */
export const outputKey = (stem: string) => safeName(stem).toLowerCase();

/** Files, directories (non-recursive, images only) and globs, as a sorted list without duplicates. */
export async function resolveInputs(args: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const a of args) {
    if (kind(a) === 'dir') {
      for (const f of await readdir(a)) if (IMAGE_EXT.has(extname(f).toLowerCase()) && kind(join(a, f)) === 'file') found.add(join(a, f));
    } else if (existsSync(a)) {
      found.add(a);
    } else if (/[*?[\]{}]/.test(a)) {
      let any = false;
      for await (const f of glob(globPattern(a))) {
        if (kind(f) === 'file') { found.add(f); any = true; }
      }
      if (!any) throw new UsageError(`No files match ${a}`);
    } else {
      throw new UsageError(`No such file or directory: ${a}`);
    }
  }
  return [...found].sort();
}

/** Read a preset file, or take an inline preset document, apply `sets` and `format`, and validate. Throws `UsageError` with the printed message. */
export async function loadPreset(source: { file?: string; inline?: unknown }, sets: string[], format: string | undefined): Promise<Preset> {
  const { file } = source;
  const label = file ? `Preset ${basename(file)}` : 'Preset';
  let raw: unknown = source.inline ?? emptyPresetDoc();
  if (file) {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      throw new UsageError(`Preset ${basename(file)} could not be read: ${(e as Error).message}`);
    }
    try {
      raw = parsePresetJson(text);
    } catch (e) {
      if (e instanceof PresetJsonError) throw new UsageError(`${label} ${e.message}`);
      throw e;
    }
  } else if (source.inline !== undefined) {
    raw = structuredClone(source.inline); // setPath below must not mutate the caller's object
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

/** A failed-image report: core's empty report plus the error. */
export function failed(name: string, error: string, detail?: string): Report {
  return { ...emptyReport(name), error, ...(detail ? { detail } : {}) };
}

export interface ConvertRequest {
  /** Files, directories (non-recursive) and globs. */
  inputs: string[];
  /** A preset JSON file, or an inline preset document (not both). */
  presetPath?: string;
  preset?: unknown;
  out: string;
  format?: Format;
  /** `key=value` settings overrides by dotted path. */
  sets?: string[];
}

/**
 * The batch behind `px3d convert` and the MCP tools: expand inputs, convert each, write models and report.json into `out`.
 * Throws `UsageError` for bad inputs or presets; a failing image is reported in `reports`, never thrown.
 */
export async function runConvert(req: ConvertRequest): Promise<{ reports: Report[]; failures: number }> {
  const { out, format } = req;
  if (req.presetPath !== undefined && req.preset !== undefined) throw new UsageError('Give either preset or presetPath, not both.');
  const preset = await loadPreset({ file: req.presetPath, inline: req.preset }, req.sets ?? [], format);
  const inputs = await resolveInputs(req.inputs);
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
      for (let i = 2; used.has(outputKey(stem)); i++) stem = `${base}-${i}`;
      used.add(outputKey(stem));

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
  return { reports, failures };
}

/** `px3d convert`: resolves to the exit code. */
export async function convertCmd(argv: string[]): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: CONVERT_OPTIONS,
      });
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
    if (parsed.values.help) {
      console.log(CONVERT_USAGE);
      return 0;
    }
    const { preset: presetFile, out, format } = parsed.values;
    if (!out) throw new UsageError('Missing --out <dir> (or -o <dir>).');
    if (format !== undefined && !FORMATS.includes(format as Format)) throw new UsageError(`--format must be stl, 3mf, obj or fbx, not "${format}".`);
    if (!parsed.positionals.length) throw new UsageError('Give at least one image, glob or folder to convert.');

    const { failures } = await runConvert({ inputs: parsed.positionals, presetPath: presetFile, out, format: format as Format | undefined, sets: parsed.values.set ?? [] });
    return failures ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}

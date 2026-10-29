/**
 * THIRD_PARTY_LICENSES.txt: name, version, license and full license text (plus any NOTICE file) of every npm
 * package that ends up in a pixel3d bundle. The web build (a Vite plugin in packages/web/vite.config.ts) and the
 * CLI build (`npm run build:cli`, from esbuild's metafile) each work out their own list from what they bundled,
 * write the file next to their output, and refresh the repo-root copy, which lists both.
 *
 *   tsx scripts/third-party-licenses.ts cli <esbuild metafile> <out file>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT_FILE = join(ROOT, 'THIRD_PARTY_LICENSES.txt');
export type Bundle = 'web' | 'cli';
const LABEL: Record<Bundle, string> = { web: 'Web app bundle', cli: 'px3d CLI bundle' };

/** The npm package names in a list of bundled module paths (ids outside node_modules are pixel3d's own). */
export function packagesIn(ids: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const id of ids) {
    const p = id.replace(/\\/g, '/');
    const at = p.lastIndexOf('node_modules/');
    if (at < 0) continue;
    const parts = p.slice(at + 'node_modules/'.length).split('/');
    const name = parts[0]!.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
    if (name && !name.startsWith('.')) names.add(name);
  }
  return [...names].sort();
}

interface Pkg { name: string; version: string; license?: string; homepage?: string; repository?: string | { url?: string } }

/** No license file (omggif): the license header comment of the package's main file, up to the first blank comment line after it. */
function headerLicense(dir: string, pkg: Pkg & { main?: string }): string {
  const main = join(dir, pkg.main ?? 'index.js');
  const lines = existsSync(main) ? readFileSync(main, 'utf8').replace(/\r\n/g, '\n').split('\n') : [];
  const comment: string[] = [];
  for (const l of lines) {
    if (!l.startsWith('//')) break;
    comment.push(l.replace(/^\/\/ ?/, ''));
  }
  const text = comment.join('\n');
  const end = text.indexOf('IN THE SOFTWARE.');
  if (!/Permission is hereby granted/.test(text) || end < 0) throw new Error(`${pkg.name}: no license file or license header found`);
  return `--- license header of ${pkg.main} ---\n\n${text.slice(0, end + 'IN THE SOFTWARE.'.length).trim()}`;
}

/** One package's section: header, then its LICENSE / COPYING / NOTICE files in full. */
function section(name: string): string {
  const dir = join(ROOT, 'node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg;
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(f)).sort();
  const head = [
    `${pkg.name} ${pkg.version}`,
    `License: ${pkg.license ?? 'see below'}`,
    ...(pkg.homepage || repo ? [`Source: ${pkg.homepage ?? repo}`] : []),
  ];
  const body = files.length
    ? files.map((f) => `--- ${f} ---\n\n${readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim()}`).join('\n\n')
    : headerLicense(dir, pkg);
  return `${'='.repeat(78)}\n${head.join('\n')}\n\n${body}\n`;
}

/** The notices file for the given bundles. */
export function noticesText(lists: Partial<Record<Bundle, string[]>>): string {
  const all = [...new Set(Object.values(lists).flat())].sort();
  const intro = [
    'pixel3d: third-party software notices',
    '',
    'pixel3d is Copyright 2026 seankealey (https://ko-fi.com/seankealey) and licensed under the PolyForm',
    'Noncommercial License 1.0.0. It includes the open-source packages below, each under its own license,',
    'reproduced here in full.',
    '',
    ...(Object.keys(LABEL) as Bundle[]).filter((b) => lists[b]).map((b) => `${LABEL[b]}: ${lists[b]!.join(', ')}`),
    '',
  ];
  return `${intro.join('\n')}\n${all.map(section).join('\n')}`;
}

/** The bundle lists the repo-root copy currently records. */
export function rootLists(): Partial<Record<Bundle, string[]>> {
  const out: Partial<Record<Bundle, string[]>> = {};
  if (!existsSync(ROOT_FILE)) return out;
  const text = readFileSync(ROOT_FILE, 'utf8');
  for (const b of Object.keys(LABEL) as Bundle[]) {
    const m = new RegExp(`^${LABEL[b]}: (.*)$`, 'm').exec(text);
    if (m) out[b] = m[1]!.split(', ').filter(Boolean);
  }
  return out;
}

/** Write `bundle`'s own notices to `outFile` and refresh the repo-root copy with its list. Returns the text written. */
export function writeNotices(bundle: Bundle, names: string[], outFile?: string): string {
  const own = noticesText({ [bundle]: names });
  if (outFile) writeFileSync(outFile, own);
  const merged = noticesText({ ...rootLists(), [bundle]: names });
  if (!existsSync(ROOT_FILE) || readFileSync(ROOT_FILE, 'utf8') !== merged) writeFileSync(ROOT_FILE, merged);
  return own;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/third-party-licenses.ts') && process.argv[2] === 'cli') {
  const [, , , meta, out] = process.argv;
  const inputs = Object.keys((JSON.parse(readFileSync(meta!, 'utf8')) as { inputs: Record<string, unknown> }).inputs);
  const names = packagesIn(inputs);
  writeNotices('cli', names, out);
  console.log(`third-party notices: ${names.length} packages in the CLI bundle -> ${out}`);
}

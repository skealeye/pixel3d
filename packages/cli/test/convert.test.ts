import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convert, parsePreset, VERSION } from '@pixel3d/core';
import type { Report } from '@pixel3d/core';
import { globPattern } from '../src/convertCmd';

const root = join(import.meta.dirname, '..', '..', '..');
const fixture = (n: string) => join(root, 'packages', 'core', 'test', 'fixtures', n);
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const bundle = join(root, 'packages', 'cli', 'dist', 'px3d.mjs');

const run = (args: string[], entry: string[] = ['--import', 'tsx', main]) =>
  spawnSync(process.execPath, [...entry, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000, env: { ...process.env, TSX_TSCONFIG_PATH: join(root, 'packages', 'cli', 'tsconfig.json') } });

let tmp: string;
let n = 0;
/** A fresh empty directory under the temp dir. */
const fresh = (name: string) => {
  const d = join(tmp, `${++n}-${name}`);
  mkdirSync(d, { recursive: true });
  return d;
};
const reportOf = (out: string) => JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as Report[];

beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'px3d-cli-')); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// each test runs the CLI in child processes (spawnSync); Vitest fails a sync test that outlasts its timeout, so allow for slow starts
describe('px3d convert', { timeout: 300_000 }, () => {
  it('converts a folder: two models plus report.json, the corrupt file errors, exit 1', () => {
    const inDir = fresh('in');
    copyFileSync(fixture('potion.png'), join(inDir, 'potion.png'));
    copyFileSync(fixture('eye-on-white.png'), join(inDir, 'eye.PNG'));
    writeFileSync(join(inDir, 'bad.png'), 'this is not an image');
    writeFileSync(join(inDir, 'notes.txt'), 'ignored');
    const out = fresh('out');
    const r = run(['convert', inDir, '--out', out]);
    expect(r.status).toBe(1);
    expect(readdirSync(out).sort()).toEqual(['eye.3mf', 'potion.3mf', 'report.json']);
    const reports = reportOf(out);
    expect(reports.map((x) => x.name)).toEqual(['bad', 'eye', 'potion']);
    expect(reports[0]!.error).toMatch(/could not be read/);
    expect(reports[0]!.detail).toBeTruthy();
    expect(reports[2]!.files).toEqual(['potion.3mf']);
    expect(r.stderr).toMatch(/✓ potion\.png → potion\.3mf \(40\.0 × [\d.]+ × [\d.]+ mm\)/);
    expect(r.stderr).toMatch(/✗ bad\.png: The file could not be read/);
    expect(r.stderr).not.toMatch(/notes/);
  }, 120_000);

  it('writes the same bytes as convert() called directly', async () => {
    const out = fresh('out');
    const r = run(['convert', fixture('potion.png'), '--out', out]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/✗/);
    const direct = await convert(new Uint8Array(readFileSync(fixture('potion.png'))), parsePreset({ version: 1, settings: {}, colorRules: [] }), 'potion');
    expect(direct.files.length).toBe(1);
    expect(readFileSync(join(out, 'potion.3mf')).equals(direct.files[0]!.bytes)).toBe(true);
  }, 120_000);

  it('--set overrides the preset; --format overrides the format; the out dir is created', async () => {
    const p = join(fresh('p'), 'p.json');
    writeFileSync(p, JSON.stringify({ version: 1, settings: { base: { height: 1 } }, colorRules: [] }));
    const out = join(fresh('o'), 'new', 'deeper');
    const r = run(['convert', fixture('potion.png'), '--preset', p, '--set', 'base.height=3', '--set', 'export.mono=true', '--set', 'sides.mode=halves', '--format', 'stl', '--out', out]);
    expect(r.status).toBe(0);
    const files = readdirSync(out).filter((f) => f.endsWith('.stl'));
    expect(files.length).toBeGreaterThan(0);
    const direct = await convert(new Uint8Array(readFileSync(fixture('potion.png'))),
      parsePreset({ version: 1, settings: { base: { height: 3 }, sides: { mode: 'halves' }, export: { format: 'stl', mono: true } }, colorRules: [] }), 'potion');
    expect(files.sort()).toEqual(direct.files.map((f) => f.name).sort());
    expect(files).toEqual(expect.arrayContaining(['potion_front.stl', 'potion_back.stl']));
    for (const f of direct.files) expect(readFileSync(join(out, f.name)).equals(f.bytes), f.name).toBe(true);
    expect(reportOf(out)[0]!.size.z).toBeCloseTo(direct.report.size.z, 6);
  }, 120_000);

  it('--set export.printer picks the Bambu printer preset the 3MF names', () => {
    const out = fresh('printer');
    const r = run(['convert', fixture('potion.png'), '--set', 'export.printer=Bambu Lab P1S', '--out', out]);
    expect(r.status).toBe(0);
    const project = JSON.parse(strFromU8(unzipSync(readFileSync(join(out, 'potion.3mf')))['Metadata/project_settings.config']!)) as Record<string, unknown>;
    expect(project.printer_settings_id).toBe('Bambu Lab P1S 0.4 nozzle');
    expect(project.printer_model).toBe('Bambu Lab P1S');
  }, 120_000);

  it('--format obj writes the OBJ and its MTL; --format fbx one binary FBX', () => {
    const out = fresh('mesh');
    expect(run(['convert', fixture('potion.png'), '--format', 'obj', '--out', out]).status).toBe(0);
    expect(reportOf(out)[0]!.files).toEqual(['potion.obj', 'potion.mtl']);
    expect(readFileSync(join(out, 'potion.obj'), 'utf8')).toMatch(/^# pixel3d OBJ, mm, Z up\nmtllib potion\.mtl\n/);
    const out2 = fresh('fbx');
    expect(run(['convert', fixture('potion.png'), '--format', 'fbx', '--out', out2]).status).toBe(0);
    expect(readFileSync(join(out2, 'potion.fbx')).subarray(0, 18).toString()).toBe('Kaydara FBX Binary');
  }, 120_000);

  it('accepts globs (including Windows backslash patterns) and files together, sorted', () => {
    const inDir = fresh('in');
    copyFileSync(fixture('potion.png'), join(inDir, 'b.png'));
    copyFileSync(fixture('potion.png'), join(inDir, 'a.png'));
    copyFileSync(fixture('eye-on-white.png'), join(inDir, 'c.png'));
    const out = fresh('out');
    const r = run(['convert', join(inDir, '[ab].png'), join(inDir, 'c.png'), '--out', out]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/ExperimentalWarning/);
    expect(reportOf(out).map((x) => x.name)).toEqual(['a', 'b', 'c']);
  }, 120_000);

  it('stems that sanitize to the same name get -2 instead of overwriting each other', () => {
    const inDir = fresh('in');
    copyFileSync(fixture('potion.png'), join(inDir, 'ab.png'));
    copyFileSync(fixture('potion.png'), join(inDir, 'ab .png')); // safeName trims the trailing space: "ab"
    const out = fresh('out');
    const r = run(['convert', inDir, '--out', out]);
    expect(r.status, r.stderr).toBe(0);
    expect(reportOf(out).map((x) => x.name).sort()).toEqual(['ab', 'ab-2']);
    expect(readdirSync(out).sort()).toEqual(['ab-2.3mf', 'ab.3mf', 'report.json']);
  }, 120_000);

  it('rewrites backslashes in globs only on Windows (elsewhere they escape glob characters)', () => {
    expect(globPattern('dir\\*.png', 'win32')).toBe('dir/*.png');
    expect(globPattern('dir/\\[a\\].png', 'linux')).toBe('dir/\\[a\\].png');
    expect(globPattern('dir/\\[a\\].png', 'darwin')).toBe('dir/\\[a\\].png');
  });

  it('--out pointing at an existing file is a usage error', () => {
    const f = join(fresh('f'), 'afile');
    writeFileSync(f, 'x');
    const r = run(['convert', fixture('potion.png'), '--out', f]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Cannot use --out/);
  }, 120_000);

  it('a write failure on one image fails only that image; report.json still lists everything', () => {
    const inDir = fresh('in');
    copyFileSync(fixture('potion.png'), join(inDir, 'a.png'));
    copyFileSync(fixture('eye-on-white.png'), join(inDir, 'b.png'));
    const out = fresh('out');
    mkdirSync(join(out, 'a.3mf')); // a directory where a.3mf must go
    const r = run(['convert', inDir, '--out', out]);
    expect(r.status).toBe(1);
    const reports = reportOf(out);
    expect(reports.map((x) => x.name)).toEqual(['a', 'b']);
    expect(reports[0]!.error).toMatch(/^Could not write a\.3mf: /);
    expect(reports[0]!.detail).toBeTruthy();
    expect(reports[1]!.error).toBeUndefined();
    expect(readFileSync(join(out, 'b.3mf')).length).toBeGreaterThan(0);
    expect(r.stderr).toMatch(/✗ a\.png: Could not write a\.3mf/);
    expect(r.stderr).toMatch(/✓ b\.png/);
  }, 120_000);

  it('warns about a color rule that matched no color', () => {
    const p = join(fresh('p'), 'p.json');
    writeFileSync(p, JSON.stringify({ version: 1, settings: {}, colorRules: [{ match: '#00ff01', tolPct: 0, height: 3 }] }));
    const out = fresh('out');
    const r = run(['convert', fixture('potion.png'), '--preset', p, '--out', out]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/Color rule #00ff01 matched no color\./);
    expect(reportOf(out)[0]!.warnings).toContain('Color rule #00ff01 matched no color.');
  }, 120_000);

  describe('usage and preset errors exit 2 before any image is processed', () => {
    const noOutput = (out: string) => expect(existsSync(out)).toBe(false);

    it('an invalid preset names the field', () => {
      const p = join(fresh('p'), 'p.json');
      writeFileSync(p, JSON.stringify({ version: 1, settings: { base: { height: 'tall' } }, colorRules: [] }));
      const out = join(fresh('o'), 'out');
      const r = run(['convert', fixture('potion.png'), '--preset', p, '--out', out]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^Preset p\.json: settings\.base\.height: /m);
      expect(r.stderr).not.toMatch(/✓|✗/);
      noOutput(out);
    });

    it('a preset that is not JSON', () => {
      const p = join(fresh('p'), 'p.json');
      writeFileSync(p, '{ nope');
      const out = join(fresh('o'), 'out');
      const r = run(['convert', fixture('potion.png'), '--preset', p, '--out', out]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^Preset p\.json is not valid JSON: .+/m);
      noOutput(out);
    });

    it('a bad --set gets the same error path', () => {
      const out = join(fresh('o'), 'out');
      const r = run(['convert', fixture('potion.png'), '--set', 'base.height=oops', '--out', out]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/settings\.base\.height: /);
      noOutput(out);
    });

    it('bad format, missing out, no inputs, missing file, unknown command', () => {
      const out = join(fresh('o'), 'out');
      const bad = run(['convert', fixture('potion.png'), '--format', 'gltf', '--out', out]);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toMatch(/stl, 3mf, obj or fbx/);
      expect(run(['convert', fixture('potion.png')]).stderr).toMatch(/--out/);
      expect(run(['convert', '--out', out]).status).toBe(2);
      const missing = run(['convert', join(tmp, 'nope.png'), '--out', out]);
      expect(missing.status).toBe(2);
      expect(missing.stderr).toMatch(/nope\.png/);
      expect(run(['convert', join(tmp, '*.nomatch'), '--out', out]).status).toBe(2);
      expect(run(['frobnicate']).status).toBe(2);
      noOutput(out);
    });
  });
});

describe('px3d --version and --help', { timeout: 300_000 }, () => {
  it('--version prints the root package version', () => {
    const r = run(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
    expect(VERSION).toBe(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  });

  it('--help lists convert, serve and mcp', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/px3d convert/);
    expect(r.stdout).toMatch(/px3d serve \[--port/);
    expect(r.stdout).not.toMatch(/px3d serve[^\n]*later version/);
    expect(r.stdout).toMatch(/px3d mcp/);
    expect(r.stdout).not.toMatch(/px3d mcp[^\n]*later version/);
  });

  it('convert --help (and -h) prints the convert options and exits 0', () => {
    for (const flag of ['--help', '-h']) {
      const r = run(['convert', flag]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^Usage: px3d convert/);
      expect(r.stdout).toMatch(/--set key=value/);
    }
  });

  it('the built bundle runs --version', () => {
    const b = spawnSync('npm run build:cli', { cwd: root, encoding: 'utf8', shell: true, timeout: 120_000 });
    expect(b.status, b.stdout + b.stderr).toBe(0);
    const r = run(['--version'], [bundle]);
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe(VERSION);
    // a real conversion proves the external manifold-3d and @jsquash/webp resolve at runtime
    const out = fresh('bundle-out');
    const c = run(['convert', fixture('potion.png'), '--out', out], [bundle]);
    expect(c.stderr).toMatch(/✓ potion\.png/);
    expect(c.status).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['potion.3mf', 'report.json']);
  }, 180_000);
});

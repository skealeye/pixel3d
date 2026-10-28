import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convert, parsePreset } from '@pixel3d/core';
import { API_PORT, batchSnippets, presetBase } from '../../web/src/snippets';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const env = { ...process.env, TSX_TSCONFIG_PATH: join(root, 'packages', 'cli', 'tsconfig.json') };
const potion = join(root, 'packages', 'core', 'test', 'fixtures', 'potion.png');
const presetDoc = { version: 1, settings: { base: { height: 3 }, rotation: [1, 0, 0] }, colourRules: [] };

/** The snippet's command lines, each split into words (the snippets use no quoting). */
const commands = batchSnippets('potion').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
const find = (first: string, second?: string) => commands.find((c) => c[0] === first && (!second || c[1] === second))!;
/** `px3d …` run from source, as `npm run dev:cli -- …` does. */
const tsx = pathToFileURL(join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href; // run from a temp dir, so not the bare name
const px3d = (args: string[]) => [process.execPath, ['--import', tsx, main, ...args]] as const;
const has = (cmd: string, args: string[]) => { try { return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0; } catch { return false; } };

let dir: string;
let expected: Uint8Array;
/** The HTTP examples post ghost.png, so the model inside is named ghost. */
let ghost: Uint8Array;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'px3d-snippets-'));
  mkdirSync(join(dir, 'sprites'));
  copyFileSync(potion, join(dir, 'sprites', 'potion.png'));
  copyFileSync(potion, join(dir, 'ghost.png'));
  writeFileSync(join(dir, 'potion.json'), JSON.stringify(presetDoc));
  const conv = async (name: string) => (await convert(new Uint8Array(readFileSync(potion)), parsePreset(presetDoc), name)).files[0]!.bytes;
  expected = await conv('potion');
  ghost = await conv('ghost');
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const same = (file: string, bytes: Uint8Array) => Buffer.from(readFileSync(file)).equals(Buffer.from(bytes));

describe('the Batch dialog snippets run', () => {
  it('names the preset so the commands need no quoting in any shell', () => {
    expect(presetBase('my potion (2)')).toBe('my_potion_2');
    expect(presetBase('ghost')).toBe('ghost');
    expect(presetBase('..')).toBe('preset');
    // a leading '-' would read as an option
    expect(presetBase('-rf potion')).toBe('rf_potion');
    expect(presetBase('--help')).toBe('help');
    expect(batchSnippets('my potion')).toContain('--preset my_potion.json');
    expect(batchSnippets('my potion')).not.toMatch(/my potion/);
  });

  it('shows a CLI, an HTTP and a Python command', () => {
    expect(find('px3d', 'convert')).toEqual(['px3d', 'convert', './sprites', '--out', './models', '--preset', 'potion.json']);
    expect(find('px3d', 'serve')).toEqual(['px3d', 'serve', '--port', String(API_PORT)]);
    expect(find('curl')).toBeDefined();
    expect(find('python')).toBeDefined();
  });

  it('CLI: px3d convert writes convert()\'s file', () => {
    const [cmd, args] = px3d(find('px3d', 'convert').slice(1));
    const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8', timeout: 120_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(same(join(dir, 'models', 'potion.3mf'), expected)).toBe(true);
  }, 120_000);

  describe('HTTP: px3d serve, then curl and Python', () => {
    let child: ReturnType<typeof spawn>;
    let url: string;
    beforeAll(async () => {
      // the snippet's port may be taken on this machine: let the OS pick one, and point the clients at it
      const [cmd, args] = px3d(find('px3d', 'serve').slice(1).map((a) => (a === String(API_PORT) ? '0' : a)));
      child = spawn(cmd, args, { cwd: dir, env });
      url = await new Promise<string>((resolve, reject) => {
        let err = '';
        const t = setTimeout(() => reject(new Error(`no listening line: ${err}`)), 60_000);
        child.stderr!.on('data', (d) => {
          err += d;
          const m = /listening on (http:\/\/\S+)/.exec(err);
          if (m) { clearTimeout(t); resolve(m[1]!); }
        });
        child.on('exit', () => reject(new Error(`exited early: ${err}`)));
      });
    }, 90_000);
    afterAll(async () => {
      if (!child || child.exitCode !== null) return;
      const gone = new Promise((r) => child.once('exit', r));
      child.kill();
      await gone; // the temp dir is its cwd: Windows won't remove it while the server runs
    });

    it.skipIf(!has('curl', ['--version']))('curl POST /convert saves convert()\'s file', () => {
      const args = find('curl').slice(1).map((a) => a.replace(`http://127.0.0.1:${API_PORT}`, url));
      const r = spawnSync('curl', ['-sS', '--fail', ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(same(join(dir, 'ghost.3mf'), ghost)).toBe(true);
    }, 120_000);

    it.skipIf(!has('python', ['-c', 'import requests']))('python examples/python/convert.py saves convert()\'s file', () => {
      const args = find('python').slice(1).map((a) => (a === 'examples/python/convert.py' ? join(root, a) : a));
      rmSync(join(dir, 'models', 'ghost.3mf'), { force: true });
      const r = spawnSync('python', [...args, '--url', url], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(existsSync(join(dir, 'models', 'ghost.3mf'))).toBe(true);
      expect(same(join(dir, 'models', 'ghost.3mf'), ghost)).toBe(true);
    }, 120_000);
  });
});

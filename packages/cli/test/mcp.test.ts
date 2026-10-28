import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpServer } from '../src/mcp';

const root = join(import.meta.dirname, '..', '..', '..');
const fixture = (n: string) => join(root, 'packages', 'core', 'test', 'fixtures', n);
const emptyPreset = { version: 1, settings: {}, colourRules: [] };

let tmp: string;
let n = 0;
const fresh = (name: string) => {
  const d = join(tmp, `${++n}-${name}`);
  mkdirSync(d, { recursive: true });
  return d;
};
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'px3d-mcp-')); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function connect() {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(st);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(ct);
  return client;
}
type Content = { type: string; text?: string }[];
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as Content).map((c) => c.text ?? '').join('\n');
  return { isError: r.isError === true, text };
};
/** Parse the first JSON value (object or array) in a tool's text output. */
const jsonPart = (text: string) => JSON.parse(text.slice(text.search(/[[{]/)));

describe('px3d mcp (in-process)', () => {
  it('lists the 4 tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['convert_folder', 'convert_image', 'inspect_image', 'list_presets']);
    expect(tools.find((t) => t.name === 'inspect_image')!.description).toMatch(/color rules/);
  });

  it('inspect_image returns 7 colors for potion', async () => {
    const client = await connect();
    const r = await call(client, 'inspect_image', { path: fixture('potion.png') });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text).colourCount).toBe(7);
  });

  it('inspect_image reports an undecodable or missing file plainly', async () => {
    const client = await connect();
    const bad = join(fresh('bad'), 'bad.png');
    writeFileSync(bad, 'nope');
    const r = await call(client, 'inspect_image', { path: bad });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/\n\s+at /);
    const missing = await call(client, 'inspect_image', { path: join(tmp, 'missing.png') });
    expect(missing.isError).toBe(true);
  });

  it('convert_image writes a .3mf and returns a clean report', async () => {
    const client = await connect();
    const out = fresh('out');
    const r = await call(client, 'convert_image', { path: fixture('potion.png'), out });
    expect(r.isError).toBe(false);
    expect(readdirSync(out)).toContain('potion.3mf');
    const report = jsonPart(r.text.slice(r.text.indexOf('\n')));
    expect(report.error).toBeUndefined();
    expect(report.files).toEqual(['potion.3mf']);
  }, 60_000);

  it('convert_image accepts an inline preset and a format', async () => {
    const client = await connect();
    const out = fresh('out');
    const r = await call(client, 'convert_image', { path: fixture('potion.png'), out, preset: emptyPreset, format: 'stl' });
    expect(r.isError).toBe(false);
    expect(readdirSync(out).some((f) => f.endsWith('.stl'))).toBe(true);
  }, 60_000);

  it('convert_image with both preset and presetPath is an error', async () => {
    const client = await connect();
    const presetPath = join(fresh('p'), 'a.json');
    writeFileSync(presetPath, JSON.stringify(emptyPreset));
    const r = await call(client, 'convert_image', { path: fixture('potion.png'), out: fresh('out'), preset: emptyPreset, presetPath });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not both/i);
  });

  it('convert_image marks a failed image isError', async () => {
    const client = await connect();
    const bad = join(fresh('bad'), 'bad.png');
    writeFileSync(bad, 'nope');
    const r = await call(client, 'convert_image', { path: bad, out: fresh('out') });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/could not be read/);
  });

  it('convert_folder: 2 converted, 1 failed, report.json written', async () => {
    const client = await connect();
    const dir = fresh('in');
    copyFileSync(fixture('potion.png'), join(dir, 'potion.png'));
    copyFileSync(fixture('eye-on-white.png'), join(dir, 'eye.png'));
    writeFileSync(join(dir, 'bad.png'), 'nope');
    const out = fresh('out');
    const r = await call(client, 'convert_folder', { dir, out });
    expect(r.text).toContain('2 converted, 1 failed');
    expect(existsSync(join(out, 'report.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))).toHaveLength(3);
  }, 120_000);

  it('list_presets lists a valid and an invalid preset', async () => {
    const client = await connect();
    const dir = fresh('presets');
    writeFileSync(join(dir, 'good.json'), JSON.stringify({
      version: 1,
      settings: { base: { height: 2 }, sides: { mode: 'halves' }, keychain: { type: 'loop' } },
      colourRules: [
        { match: '#ff0000', tolPct: 5, delete: true },
        { match: '#00ff00', tolPct: 5, delete: true },
        { match: '#0000ff', tolPct: 5, delete: true },
      ],
    }));
    writeFileSync(join(dir, 'broken.json'), '{ nope');
    writeFileSync(join(dir, 'readme.txt'), 'x');
    const r = await call(client, 'list_presets', { dir });
    expect(r.isError).toBe(false);
    const list = JSON.parse(r.text) as { name: string; path: string; summary?: string; error?: string }[];
    expect(list.map((p) => p.name)).toEqual(['broken', 'good']);
    expect(list[0]!.error).toBeTruthy();
    expect(list[0]!.summary).toBeUndefined();
    expect(list[1]!.summary).toBe('base 2 mm, halves, loop, 3 color rules');
    expect(list[1]!.error).toBeUndefined();
  });
});

describe('px3d mcp (stdio)', () => {
  it('real process: lists tools over a clean stdout', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', join(root, 'packages', 'cli', 'src', 'main.ts'), 'mcp'],
      cwd: root,
      env: { ...(process.env as Record<string, string>), TSX_TSCONFIG_PATH: join(root, 'packages', 'cli', 'tsconfig.json') },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(4);
    await client.close();
  }, 60_000);
});

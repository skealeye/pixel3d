import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convert, parsePreset, VERSION } from '@pixel3d/core';
import type { Report } from '@pixel3d/core';
import { createApp, startServer } from '../src/serve';
import openapi from '../openapi.json';

const root = join(import.meta.dirname, '..', '..', '..');
const fixtureBytes = (n: string) => new Uint8Array(readFileSync(join(root, 'packages', 'core', 'test', 'fixtures', n)));
const emptyPreset = { version: 1, settings: {}, colourRules: [] };
const halvesPreset = { version: 1, settings: { sides: { mode: 'halves' }, export: { format: 'stl' } }, colourRules: [] };

const png = (n: string) => new File([fixtureBytes(n)], n, { type: 'image/png' });
const form = (fields: Record<string, string | File | File[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

let server: Awaited<ReturnType<typeof startServer>>;
let debugServer: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer({ port: 0 });
  debugServer = await startServer({ port: 0, debug: true });
});
afterAll(async () => {
  await server.close();
  await debugServer.close();
});

const post = (base: string, path: string, body: FormData) => fetch(base + path, { method: 'POST', body });

describe('px3d serve', () => {
  it('GET /health returns the version', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: VERSION });
  });

  it('listens on 127.0.0.1 by default', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.address.address).toBe('127.0.0.1');
  });

  it('POST /convert returns the same bytes as convert(), with a report header', async () => {
    const res = await post(server.url, '/convert', form({ image: png('potion.png'), preset: JSON.stringify(emptyPreset) }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/3mf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="potion.3mf"');
    const report = JSON.parse(Buffer.from(res.headers.get('x-pixel3d-report')!, 'base64').toString('utf8')) as Report;
    expect(report.files).toEqual(['potion.3mf']);
    const direct = await convert(fixtureBytes('potion.png'), parsePreset(emptyPreset), 'potion');
    expect(Buffer.from(await res.arrayBuffer()).equals(direct.files[0]!.bytes)).toBe(true);
  }, 60_000);

  it('accepts the preset as a file, and works without one', async () => {
    const file = new File([JSON.stringify(emptyPreset)], 'p.json', { type: 'application/json' });
    expect((await post(server.url, '/convert', form({ image: png('potion.png'), preset: file }))).status).toBe(200);
    expect((await post(server.url, '/convert', form({ image: png('potion.png') }))).status).toBe(200);
  }, 60_000);

  it('a halves preset returns a zip with both files and report.json', async () => {
    const res = await post(server.url, '/convert', form({ image: png('potion.png'), preset: JSON.stringify(halvesPreset) }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const entries = Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer())));
    expect(entries).toHaveLength(3);
    expect(entries).toContain('report.json');
  }, 60_000);

  it('a bad preset returns 400 with the field path', async () => {
    const bad = { version: 1, settings: { base: { height: 'tall' } }, colourRules: [] };
    const res = await post(server.url, '/convert', form({ image: png('potion.png'), preset: JSON.stringify(bad) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; path: string };
    expect(body.error).toBeTruthy();
    expect(body.path).toMatch(/base/);
  });

  it('an invalid JSON preset returns 400 with a null path', async () => {
    const res = await post(server.url, '/convert', form({ image: png('potion.png'), preset: '{nope' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; path: unknown };
    expect(body.error).toMatch(/^Preset is not valid JSON: /);
    expect(body.path).toBeNull();
  });

  it('a missing image returns 400', async () => {
    const res = await post(server.url, '/convert', form({ preset: JSON.stringify(emptyPreset) }));
    expect(res.status).toBe(400);
  });

  it('a corrupt image returns 422 without detail (and with it under --debug)', async () => {
    const bad = () => form({ image: new File(['this is not an image'], 'bad.png', { type: 'image/png' }) });
    const res = await post(server.url, '/convert', bad());
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; report: Report };
    expect(body.error).toBeTruthy();
    expect(body.report.error).toBe(body.error);
    expect('detail' in body.report).toBe(false);
    const dbg = (await (await post(debugServer.url, '/convert', bad())).json()) as { report: Report };
    expect(dbg.report.detail).toBeTruthy();
  });

  it('an oversized upload returns 413', async () => {
    const big = new File([new Uint8Array(51 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    const res = await fetch(server.url + '/convert', { method: 'POST', body: form({ image: big }) });
    expect(res.status).toBe(413);
  }, 60_000);

  it('a batch of 3 images reaches done and downloads as a zip', async () => {
    const images = ['potion.png', 'eye-on-white.png', 'corner-touch.png'].map(png);
    const res = await post(server.url, '/batch', form({ images, preset: JSON.stringify(emptyPreset) }));
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    let job!: { status: string; total: number; completed: number; report: Report[]; downloadUrl?: string };
    for (let i = 0; ; i++) {
      job = (await (await fetch(`${server.url}/jobs/${jobId}`)).json()) as typeof job;
      if (job.status === 'done' || i > 200) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(job.status).toBe('done');
    expect(job.total).toBe(3);
    expect(job.completed).toBe(3);
    expect(job.report).toHaveLength(3);
    expect(job.downloadUrl).toBe(`/jobs/${jobId}/download`);
    const dl = await fetch(server.url + job.downloadUrl!);
    expect(dl.headers.get('content-type')).toBe('application/zip');
    const entries = Object.keys(unzipSync(new Uint8Array(await dl.arrayBuffer()))).sort();
    expect(entries).toEqual(['corner-touch.3mf', 'eye-on-white.3mf', 'potion.3mf', 'report.json']);
  }, 120_000);

  it('unknown job ids return 404', async () => {
    const app = createApp();
    expect((await app.request('/jobs/nope')).status).toBe(404);
    expect((await app.request('/jobs/nope/download')).status).toBe(404);
  });

  it('a batch without images returns 400', async () => {
    expect((await post(server.url, '/batch', form({ preset: '{}' }))).status).toBe(400);
  });

  it('openapi.json documents every registered route', async () => {
    const res = await createApp().request('/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as typeof openapi;
    expect(doc.openapi).toMatch(/^3\.1/);
    const documented = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`));
    const registered = createApp().routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`);
    expect(registered.length).toBeGreaterThanOrEqual(6);
    expect(documented.sort()).toEqual([...new Set(registered)].sort());
  });

  it('the real `px3d serve` process answers /health', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'packages', 'cli', 'src', 'main.ts'), 'serve', '--port', '0'], {
      cwd: root,
      env: { ...process.env, TSX_TSCONFIG_PATH: join(root, 'packages', 'cli', 'tsconfig.json') },
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let err = '';
        const t = setTimeout(() => reject(new Error(`no listening line: ${err}`)), 30_000);
        child.stderr.on('data', (d) => {
          err += d;
          const m = /listening on (http:\/\/\S+)/.exec(err);
          if (m) { clearTimeout(t); resolve(m[1]!); }
        });
        child.on('exit', () => reject(new Error(`exited early: ${err}`)));
      });
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true, version: VERSION });
    } finally {
      child.kill();
    }
  }, 60_000);
});

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import { serve } from '@hono/node-server';
import { zipSync } from 'fflate';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { convert, parsePreset, PresetError, VERSION } from '@pixel3d/core';
import type { Preset, Report } from '@pixel3d/core';
import openapi from '../openapi.json';
import { JobStore } from './jobs';
import type { Job } from './jobs';
import { emptyPresetDoc, parsePresetJson, PresetJsonError } from './presetLoad';

export const MAX_UPLOAD = 50 * 1024 * 1024;
export const DEFAULT_PORT = 7300;
export const DEFAULT_HOST = '127.0.0.1';

export interface AppOptions {
  /** Include error stack excerpts (`detail`) in responses. */
  debug?: boolean;
}

/** A request problem answered with this status and JSON body. */
class HttpError extends Error {
  constructor(readonly status: 400 | 422, readonly body: Record<string, unknown>) { super(String(body.error)); }
}

const enc = new TextEncoder();
const json = (v: unknown) => enc.encode(JSON.stringify(v, null, 2) + '\n');
const isFile = (v: unknown): v is File => typeof v === 'object' && v !== null && typeof (v as File).arrayBuffer === 'function';
const stemOf = (filename: string) => filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || 'image';

/** The preset form field: absent (defaults), a JSON string, or a file holding JSON. */
async function presetFrom(field: unknown): Promise<Preset> {
  let raw: unknown = emptyPresetDoc();
  const text = isFile(field) ? await field.text() : typeof field === 'string' && field.trim() !== '' ? field : undefined;
  try {
    if (text !== undefined) raw = parsePresetJson(text);
    return parsePreset(raw);
  } catch (e) {
    if (e instanceof PresetJsonError) throw new HttpError(400, { error: `Preset ${e.message}`, path: null });
    if (e instanceof PresetError) throw new HttpError(400, { error: e.message, path: e.path });
    throw e;
  }
}

async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw new HttpError(400, { error: 'Send the request as multipart/form-data.' });
  }
}

/** The report as shown over HTTP: no stack excerpt unless debugging. */
const shown = (r: Report, debug: boolean): Report => {
  if (debug || !('detail' in r)) return r;
  const { detail: _detail, ...rest } = r;
  return rest;
};

/** Zip the outputs of finished conversions plus report.json. */
const zipOf = (files: { name: string; bytes: Uint8Array }[], reports: Report[]) =>
  zipSync({ ...Object.fromEntries(files.map((f) => [f.name, f.bytes])), 'report.json': json(reports) });

/** Read and discard up to `max` bytes of a request body. */
async function drain(body: ReadableStream<Uint8Array> | null, max: number): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  try {
    for (let seen = 0; seen < max;) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const asBody = (b: Uint8Array) => b as unknown as ArrayBuffer;
const reportHeader = (r: Report) => Buffer.from(JSON.stringify(r)).toString('base64');

export function createApp(opts: AppOptions = {}): Hono {
  const debug = opts.debug === true;
  const jobs = new JobStore();
  const app = new Hono();
  const limit = bodyLimit({ maxSize: MAX_UPLOAD, onError: (c) => c.json({ error: 'Upload is larger than 50 MB.' }, 413) });
  // Replying before the client has finished sending makes it see a reset socket instead of the 413,
  // so swallow (a bounded amount of) the oversized body first.
  const tooBig: MiddlewareHandler = async (c, next) => {
    if (Number(c.req.header('content-length')) > MAX_UPLOAD) {
      await drain(c.req.raw.body, 2 * MAX_UPLOAD);
      return c.json({ error: 'Upload is larger than 50 MB.' }, 413);
    }
    return limit(c, next);
  };

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json(e.body, e.status);
    return c.json({ error: 'Internal error.', ...(debug ? { detail: e.stack } : {}) }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/openapi.json', (c) => c.json(openapi));

  app.post('/convert', tooBig, async (c) => {
    const form = await readForm(c.req.raw);
    const image = form.get('image');
    if (!isFile(image)) throw new HttpError(400, { error: 'Missing "image" file field.' });
    const preset = await presetFrom(form.get('preset'));
    const { files, report: full } = await convert(new Uint8Array(await image.arrayBuffer()), preset, stemOf(image.name));
    const report = shown(full, debug);
    if (full.error) return c.json({ error: full.error, report }, 422);
    if (files.length === 1) {
      const f = files[0]!;
      return c.body(asBody(f.bytes), 200, {
        'Content-Type': f.name.endsWith('.stl') ? 'model/stl' : 'model/3mf',
        'Content-Disposition': `attachment; filename="${f.name}"`,
        'X-Pixel3d-Report': reportHeader(report),
      });
    }
    return c.body(asBody(zipOf(files, [report])), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${full.name}.zip"`,
      'X-Pixel3d-Report': reportHeader(report),
    });
  });

  async function runJob(job: Job, inputs: { stem: string; bytes: Uint8Array }[], preset: Preset): Promise<void> {
    const used = new Set<string>();
    for (const input of inputs) {
      // images with the same name must not overwrite each other's outputs
      let stem = input.stem;
      for (let i = 2; used.has(stem.toLowerCase()); i++) stem = `${input.stem}-${i}`;
      used.add(stem.toLowerCase());
      const { files, report } = await convert(input.bytes, preset, stem);
      job.report.push(shown(report, debug));
      if (!report.error) job.files.push(...files);
      job.completed++;
    }
    job.status = 'done';
  }

  app.post('/batch', tooBig, async (c) => {
    const form = await readForm(c.req.raw);
    const images = form.getAll('images').filter(isFile) as File[];
    if (!images.length) throw new HttpError(400, { error: 'Missing "images" file fields.' });
    const preset = await presetFrom(form.get('preset'));
    // read the uploads now: the request body is gone once we respond
    const inputs = await Promise.all(images.map(async (f) => ({ stem: stemOf(f.name), bytes: new Uint8Array(await f.arrayBuffer()) })));
    const job = jobs.create(inputs.length);
    void runJob(job, inputs, preset);
    return c.json({ jobId: job.id }, 202);
  });

  app.get('/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'No such job.' }, 404);
    const { status, total, completed, report } = job;
    return c.json({ status, total, completed, report, ...(status === 'done' ? { downloadUrl: `/jobs/${job.id}/download` } : {}) });
  });

  app.get('/jobs/:id/download', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'No such job.' }, 404);
    if (job.status !== 'done') return c.json({ error: 'Job is still running.' }, 409);
    return c.body(asBody(zipOf(job.files, job.report)), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="pixel3d-${job.id}.zip"`,
    });
  });

  return app;
}

export interface ServerOptions extends AppOptions {
  port?: number;
  host?: string;
}

export interface RunningServer {
  url: string;
  address: AddressInfo;
  close(): Promise<void>;
}

/** Start listening (port 0 picks a free one). */
export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? DEFAULT_HOST;
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: createApp(opts).fetch, port: opts.port ?? DEFAULT_PORT, hostname: host });
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address() as AddressInfo;
      resolve({
        address,
        url: `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`,
        close: () => new Promise<void>((res, rej) => {
          server.close((e) => (e ? rej(e) : res()));
          (server as unknown as Server).closeAllConnections();
        }),
      });
    });
  });
}

/** `px3d serve`: runs until SIGINT, then resolves to the exit code. */
export async function serveCmd(argv: string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { port: { type: 'string' }, host: { type: 'string' }, debug: { type: 'boolean' } } }));
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`--port must be a number from 0 to 65535, not "${values.port}".`);
    return 2;
  }
  let server: RunningServer;
  try {
    server = await startServer({ port, host: values.host, debug: values.debug });
  } catch (e) {
    console.error(`Could not listen: ${(e as Error).message}`);
    return 1;
  }
  console.error(`pixel3d ${VERSION} listening on ${server.url}`);
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await server.close();
  return 0;
}

import { zipSync } from 'fflate';
import { mimeOf } from '@pixel3d/core';
import type { ExportJob, ExportReply, ExportRequest, OutFile } from './export.worker';

/** Same as core's 3MF: a fixed time, so a zip of the same files is the same bytes. */
const MTIME = new Date('2026-01-01T00:00:00Z');

let worker: Worker | null = null;
let seq = 0;
let failNext = false;

/** Make the next export job fail (test hook). */
export function failNextExport() {
  failNext = true;
}
const waiting = new Map<number, { resolve: (f: OutFile[]) => void; reject: (e: Error) => void }>();

function failAll(message: string) {
  for (const w of waiting.values()) w.reject(new Error(message));
  waiting.clear();
  worker?.terminate();
  worker = null;
}

/** The export worker, started on first use: building for export (manifold booleans) must not freeze the page. */
function get(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<ExportReply>) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    if ('error' in e.data) p.reject(new Error(e.data.error));
    else p.resolve(e.data.files);
  };
  w.onmessageerror = () => failAll('the export worker sent a message that could not be read');
  w.onerror = (e) => { e.preventDefault(); failAll(e.message || 'the export worker failed to start'); };
  return (worker = w);
}

/** Run an export job in the worker. */
export function runExport(job: ExportJob): Promise<OutFile[]> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    const req: ExportRequest = { id, job };
    if (failNext) { req.fail = true; failNext = false; }
    get().postMessage(req);
  });
}

/** Save bytes as a download. */
export function download(name: string, bytes: Uint8Array | string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One file as itself; several (halves, a clicker's cap and body, the fit test, an OBJ and its MTL) as one zip named `zipName`. */
export function downloadFiles(files: OutFile[], zipName: string) {
  if (files.length === 1) {
    const f = files[0]!;
    download(f.name, f.bytes, mimeOf(f.name));
    return;
  }
  download(zipName, zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])), { level: 6, mtime: MTIME }), 'application/zip');
}

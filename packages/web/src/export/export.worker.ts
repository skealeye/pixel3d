/// <reference lib="webworker" />
import { buildModel, exportModel, fitTest, type Grid, type Settings } from '@pixel3d/core';

/**
 * `model`: the grid built fresh with the real settings (rotation included) and written as core `convert` writes it.
 * `fitTest`: the clicker fit-test coupons in one color, written in the Export format: a 3MF (one object per coupon, the
 * slicer's 0.4 mm nozzle profile for Bambu), one STL each, an OBJ and its MTL, or an FBX.
 */
export type ExportJob = { kind: 'model'; grid: Grid; settings: Settings; name: string } | { kind: 'fitTest'; settings: Settings };
/** `fail` makes this job throw (the e2e test hook's `failNextExport`). */
export interface ExportRequest { id: number; job: ExportJob; fail?: boolean }
export interface OutFile { name: string; bytes: Uint8Array }
export type ExportReply = { id: number; files: OutFile[] } | { id: number; error: string };

const post = (msg: ExportReply, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

async function run(job: ExportJob): Promise<OutFile[]> {
  if (job.kind === 'fitTest') return exportModel(await fitTest(job.settings), { ...job.settings, export: { ...job.settings.export, mono: true } }, 'fit_test');
  return exportModel(await buildModel(job.grid, job.settings), job.settings, job.name);
}

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, job, fail } = e.data;
  try {
    if (fail) throw new Error('forced failure (test)');
    const files = await run(job);
    post({ id, files }, files.map((f) => f.bytes.buffer as ArrayBuffer));
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

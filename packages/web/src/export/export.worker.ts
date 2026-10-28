/// <reference lib="webworker" />
import { buildModel, exportModel, fitTest, toSTL, type Grid, type Settings } from '@pixel3d/core';

/**
 * `model`: the grid built fresh with the real settings (rotation included) and written as core `convert` writes it.
 * `fitTest`: the clicker fit-test coupons, one STL each.
 */
export type ExportJob = { kind: 'model'; grid: Grid; settings: Settings; name: string } | { kind: 'fitTest'; settings: Settings };
export interface ExportRequest { id: number; job: ExportJob }
export interface OutFile { name: string; bytes: Uint8Array }
export type ExportReply = { id: number; files: OutFile[] } | { id: number; error: string };

const post = (msg: ExportReply, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

async function run(job: ExportJob): Promise<OutFile[]> {
  if (job.kind === 'fitTest') return toSTL(await fitTest(job.settings), { mono: true, name: 'fit_test' });
  return exportModel(await buildModel(job.grid, job.settings), job.settings, job.name);
}

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, job } = e.data;
  try {
    const files = await run(job);
    post({ id, files }, files.map((f) => f.bytes.buffer as ArrayBuffer));
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

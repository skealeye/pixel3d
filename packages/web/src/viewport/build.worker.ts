/// <reference lib="webworker" />
import { buildModel, type Grid, type Model, type Settings } from '@pixel3d/core';

/** `fail` makes this build throw (the e2e test hook's `failNextBuild`). */
export interface BuildRequest { id: number; grid: Grid; settings: Settings; fail?: boolean }
export type BuildReply = { id: number; model: Model } | { id: number; error: string };

const post = (msg: BuildReply, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const { id, grid, settings, fail } = e.data;
  try {
    if (fail) throw new Error('forced failure (test)');
    const model = await buildModel(grid, settings);
    post({ id, model }, model.parts.flatMap((p) => [p.mesh.vertProperties.buffer, p.mesh.triVerts.buffer]));
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

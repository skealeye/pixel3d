/// <reference lib="webworker" />
import { buildModel, type Grid, type Model, type Settings } from '@pixel3d/core';

export interface BuildRequest { id: number; grid: Grid; settings: Settings }
export type BuildReply = { id: number; model: Model } | { id: number; error: string };

const post = (msg: BuildReply, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const { id, grid, settings } = e.data;
  try {
    const model = await buildModel(grid, settings);
    post({ id, model }, model.parts.flatMap((p) => [p.mesh.vertProperties.buffer, p.mesh.triVerts.buffer]));
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

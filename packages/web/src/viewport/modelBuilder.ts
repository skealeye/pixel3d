import type { Grid, Model, Settings } from '@pixel3d/core';
import type { BuildReply, BuildRequest } from './build.worker';

/** Wait after the last change before building, ms (Ruling R10). */
export const BUILD_DELAY = 250;

/**
 * Builds the core model (manifold booleans, ~180 ms at 128²) in a Web Worker, debounced, so edits stay on the fast
 * preview path. Only the newest request's result is delivered.
 */
export class ModelBuilder {
  private worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(onModel: (model: Model) => void, onError: (message: string) => void) {
    this.worker.onmessage = (e: MessageEvent<BuildReply>) => {
      if (e.data.id !== this.seq) return;
      if ('error' in e.data) onError(e.data.error);
      else onModel(e.data.model);
    };
  }

  schedule(grid: Grid, settings: Settings) {
    clearTimeout(this.timer);
    const id = ++this.seq;
    this.timer = setTimeout(() => this.worker.postMessage({ id, grid, settings } satisfies BuildRequest), BUILD_DELAY);
  }

  cancel() {
    clearTimeout(this.timer);
    this.seq++;
  }

  dispose() {
    this.cancel();
    this.worker.terminate();
  }
}

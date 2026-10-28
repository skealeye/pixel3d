import type { Grid, Model, Settings } from '@pixel3d/core';
import type { BuildReply, BuildRequest } from './build.worker';

/** Wait after the last change before building, ms (Ruling R10). */
export const BUILD_DELAY = 250;

/**
 * Builds the core model (manifold booleans, ~180 ms at 128²) in a Web Worker, debounced, so edits stay on the fast
 * preview path. One build runs at a time; while it runs only the newest request waits, and only the newest result
 * is delivered.
 */
export class ModelBuilder {
  private worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private queued: BuildRequest | null = null;
  private failNext = false;

  constructor(private onModel: (model: Model) => void, private onError: (message: string) => void) {
    this.worker.onmessage = (e: MessageEvent<BuildReply>) => {
      this.done();
      if (e.data.id !== this.seq) return;
      if ('error' in e.data) this.onError(e.data.error);
      else this.onModel(e.data.model);
    };
    this.worker.onmessageerror = () => { this.done(); this.onError('the worker sent a message that could not be read'); };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.done();
      this.onError(e.message || 'the model worker failed to start');
    };
  }

  schedule(grid: Grid, settings: Settings) {
    clearTimeout(this.timer);
    const id = ++this.seq;
    this.timer = setTimeout(() => {
      const req: BuildRequest = { id, grid, settings };
      if (this.failNext) { req.fail = true; this.failNext = false; }
      if (this.running) this.queued = req;
      else this.post(req);
    }, BUILD_DELAY);
  }

  /** Make the next build fail (test hook). */
  failNextBuild() {
    this.failNext = true;
  }

  cancel() {
    clearTimeout(this.timer);
    this.queued = null;
    this.seq++;
  }

  dispose() {
    this.cancel();
    this.worker.terminate();
  }

  private post(req: BuildRequest) {
    this.running = true;
    this.worker.postMessage(req);
  }

  private done() {
    this.running = false;
    const next = this.queued;
    this.queued = null;
    if (next) this.post(next);
  }
}

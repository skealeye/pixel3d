import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

export type { ManifoldToplevel };

let ready: Promise<ManifoldToplevel> | undefined;

/**
 * Load the manifold-3d WASM once. The browser (Vite) fetches it next to the module;
 * Node has no fetch for file URLs, so hand it the bytes, as decode.ts does for WebP.
 */
export function initManifold(): Promise<ManifoldToplevel> {
  ready ??= (async () => {
    let wasmBinary: Uint8Array | undefined;
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('node:fs/promises');
      const { createRequire } = await import('node:module');
      wasmBinary = await readFile(createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm'));
    }
    const wasm = await (Module as unknown as (o?: { wasmBinary?: Uint8Array }) => Promise<ManifoldToplevel>)(wasmBinary ? { wasmBinary } : undefined);
    wasm.setup();
    return wasm;
  })();
  return ready;
}

import type { Grid } from '@pixel3d/core';

/** One RGBA pixel per cell: opaque cells in their palette color, empty cells fully transparent. */
export function gridRgba(g: Grid): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.w * g.h * 4);
  g.cells.forEach((v, i) => {
    if (v < 0) return;
    const n = parseInt(g.palette[v]!.hex.slice(1), 16);
    out.set([n >> 16, (n >> 8) & 255, n & 255, 255], i * 4);
  });
  return out;
}

/** Download the drawing as `pixel-art.png`, one image pixel per cell. */
export async function savePng(): Promise<void> {
  // loaded here so gridRgba stays importable by plain vitest (state.svelte.ts needs the Svelte compiler)
  const { app } = await import('./state.svelte');
  const g = app.grid;
  if (!g) return;
  const canvas = document.createElement('canvas');
  canvas.width = g.w;
  canvas.height = g.h;
  canvas.getContext('2d')!.putImageData(new ImageData(gridRgba(g) as ImageDataArray, g.w, g.h), 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pixel-art.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

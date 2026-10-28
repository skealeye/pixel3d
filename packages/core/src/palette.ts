import type { Img } from './image';
import { type Grid, DEFAULT_HEIGHT, cloneGrid, mergeInto } from './grid';

export const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export const hexToRgb = (hex: string): [number, number, number] =>
  [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** Squared RGB distance between two #rrggbb colours. */
export function hexDist2(a: string, b: string): number {
  const p = hexToRgb(a), q = hexToRgb(b);
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
}

/** Index of the palette entry nearest to `hex`, skipping `skip`; -1 if none. */
export function nearestIndex(palette: { hex: string }[], hex: string, skip = -1): number {
  let best = -1, bd = Infinity;
  palette.forEach((p, j) => {
    if (j === skip) return;
    const d = hexDist2(p.hex, hex);
    if (d < bd) { bd = d; best = j; }
  });
  return best;
}

/** Exact colours by pixel count; colours beyond `maxColours` merge into the nearest kept colour. Alpha 0 -> -1. */
export function toGrid(img: Img, maxColours: number): Grid {
  const { width: w, height: h, data } = img;
  const counts = new Map<string, number>();
  const hexes: (string | null)[] = new Array(w * h);
  for (let k = 0; k < w * h; k++) {
    if (data[k * 4 + 3] === 0) { hexes[k] = null; continue; }
    const hex = toHex(data[k * 4]!, data[k * 4 + 1]!, data[k * 4 + 2]!);
    hexes[k] = hex;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  // Map keeps first-seen order and sort is stable, so ties resolve by first appearance.
  const kept = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(1, maxColours)).map(([hex]) => hex);
  const palette = kept.map((hex) => ({ hex, height: DEFAULT_HEIGHT }));
  const index = new Map(kept.map((hex, i) => [hex, i]));
  const cells = new Int16Array(w * h);
  for (let k = 0; k < w * h; k++) {
    const hex = hexes[k];
    if (hex === null) { cells[k] = -1; continue; }
    let i = index.get(hex!);
    if (i === undefined) { i = nearestIndex(palette, hex!); index.set(hex!, i); }
    cells[k] = i;
  }
  return { w, h, cells, palette };
}

/** Merge the closest pair of colours repeatedly until at most `n` remain. Returns a new grid. */
export function reducePalette(g: Grid, n: number): Grid {
  const out = cloneGrid(g);
  const target = Math.max(1, n);
  while (out.palette.length > target) {
    const counts = new Array<number>(out.palette.length).fill(0);
    for (const v of out.cells) if (v >= 0) counts[v]!++;
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < out.palette.length; i++) {
      for (let j = i + 1; j < out.palette.length; j++) {
        const d = hexDist2(out.palette[i]!.hex, out.palette[j]!.hex);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    // Drop the entry with fewer pixels (ties drop the later one); the kept entry brings its colour and height.
    if (counts[bi]! >= counts[bj]!) mergeInto(out, bj, bi); else mergeInto(out, bi, bj);
  }
  return out;
}

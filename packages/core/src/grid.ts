export interface PaletteEntry { hex: string; height: number }

/** A pixel grid: `cells` hold palette indices (-1 = empty), row 0 is the top row. */
export interface Grid {
  w: number;
  h: number;
  cells: Int16Array;
  palette: PaletteEntry[];
}

export const MIN_HEIGHT = 0.2;
export const MAX_HEIGHT = 20;
export const DEFAULT_HEIGHT = 1;

export const clampHeight = (h: number): number => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h));
export const round1 = (n: number): number => Math.round(n * 10) / 10;

export const cloneGrid = (g: Grid): Grid => ({
  w: g.w, h: g.h, cells: g.cells.slice(), palette: g.palette.map((p) => ({ ...p })),
});

/** Drop palette entries no cell uses, renumbering the cells. Mutates `g`. */
export function pruneUnused(g: Grid): void {
  const used = new Uint8Array(g.palette.length);
  for (let k = 0; k < g.cells.length; k++) { const v = g.cells[k]!; if (v >= 0) used[v] = 1; }
  if (used.every(Boolean)) return;
  const to = new Int16Array(g.palette.length);
  let n = 0;
  for (let i = 0; i < used.length; i++) to[i] = used[i] ? n++ : -1;
  for (let k = 0; k < g.cells.length; k++) { const v = g.cells[k]!; if (v >= 0) g.cells[k] = to[v]!; }
  g.palette = g.palette.filter((_, i) => used[i]);
}

/** Remove palette entry `i`, sending its pixels to entry `to` (which must differ from `i`). Mutates `g`. */
export function mergeInto(g: Grid, i: number, to: number): void {
  const t = to > i ? to - 1 : to;
  for (let k = 0; k < g.cells.length; k++) {
    const v = g.cells[k]!;
    g.cells[k] = v === i ? t : v > i ? v - 1 : v;
  }
  g.palette.splice(i, 1);
}

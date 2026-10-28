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

/** Remove palette entry `i`, sending its pixels to entry `to` (which must differ from `i`). Mutates `g`. */
export function mergeInto(g: Grid, i: number, to: number): void {
  const t = to > i ? to - 1 : to;
  for (let k = 0; k < g.cells.length; k++) {
    const v = g.cells[k]!;
    g.cells[k] = v === i ? t : v > i ? v - 1 : v;
  }
  g.palette.splice(i, 1);
}

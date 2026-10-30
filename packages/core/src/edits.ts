import { type Grid, DEFAULT_HEIGHT, clampHeight, cloneGrid, mergeInto, pruneUnused } from './grid';
import { nearestIndex } from './palette';

export type Edit =
  | { kind: 'recolor'; from: string; to: string }
  | { kind: 'delete'; hex: string }
  | { kind: 'height'; hex: string; h: number }
  | { kind: 'paint'; x: number; y: number; hex: string | null }
  | { kind: 'add'; hex: string };

/**
 * Apply edits in order to a copy of `g`; a color no pixel uses at the end is dropped from the palette. A color that
 * `paint` brings in takes the first color's height, or `newHeight` when the palette is empty. Edits that can no longer apply (missing color, out of bounds) are returned in `dropped`. */
export function applyEdits(g: Grid, edits: Edit[], newHeight?: number): { grid: Grid; dropped: Edit[] } {
  const grid = cloneGrid(g);
  const dropped: Edit[] = [];
  const find = (hex: string) => grid.palette.findIndex((p) => p.hex === hex);

  for (const e of edits) {
    switch (e.kind) {
      case 'recolor': {
        // a color whose last pixel went earlier is gone, as it is after each batch applied on its own
        pruneUnused(grid);
        const from = find(e.from);
        const to = e.to.toLowerCase();
        if (from < 0) { dropped.push(e); break; }
        const twin = find(to);
        if (twin === from) break;
        if (twin >= 0) mergeInto(grid, from, twin);
        else grid.palette[from]!.hex = to;
        break;
      }
      case 'delete': {
        pruneUnused(grid);
        const i = find(e.hex);
        if (i < 0 || grid.palette.length < 2) { dropped.push(e); break; }
        mergeInto(grid, i, nearestIndex(grid.palette, e.hex, i));
        break;
      }
      case 'height': {
        const i = find(e.hex);
        if (i < 0) dropped.push(e);
        else grid.palette[i]!.height = clampHeight(e.h);
        break;
      }
      case 'paint': {
        if (!Number.isInteger(e.x) || !Number.isInteger(e.y) || e.x < 0 || e.y < 0 || e.x >= grid.w || e.y >= grid.h) { dropped.push(e); break; }
        const k = e.y * grid.w + e.x;
        if (e.hex === null) { grid.cells[k] = -1; break; }
        const hex = e.hex.toLowerCase();
        let i = find(hex);
        if (i < 0) { grid.palette.push({ hex, height: grid.palette[0]?.height ?? newHeight ?? DEFAULT_HEIGHT }); i = grid.palette.length - 1; }
        grid.cells[k] = i;
        break;
      }
      case 'add': {
        const hex = e.hex.toLowerCase();
        if (find(hex) < 0) grid.palette.push({ hex, height: DEFAULT_HEIGHT });
        break;
      }
    }
  }
  pruneUnused(grid);
  return { grid, dropped };
}

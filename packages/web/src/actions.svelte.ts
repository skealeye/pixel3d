import { DEFAULTS, pieces, type Edit } from '@pixel3d/core';
import { cellsToCrop, computeGrid } from './pipeline';
import { addEdits, app, change, toast, ui } from './state.svelte';

// Edits from the palette panel and the source preview. Each one is a core `Edit`, replayed on top of the image (spec §4.10).

/** The colour Paint uses: the selected one, or the first while it is gone. */
function paintHex(): string | null {
  const p = app.grid?.palette;
  if (!p?.length) return null;
  return p.some((c) => c.hex === ui.sel) ? ui.sel : p[0]!.hex;
}

/** One colour's height. Repeats on the same colour replace the last height edit rather than piling up. */
export function setHeight(hex: string, h: number, push: boolean) {
  const before = app.edits, last = before.at(-1);
  if (!addEdits([{ kind: 'height', hex, h }], push)) return;
  if (last?.kind === 'height' && last.hex === hex) app.edits = [...before.slice(0, -1), app.edits.at(-1)!];
}

export function recolour(from: string, to: string) {
  to = to.toLowerCase();
  if (from === to || !app.grid) return;
  const merge = app.grid.palette.some((p) => p.hex === to);
  if (!addEdits([{ kind: 'recolour', from, to }])) return;
  if (ui.sel === from) ui.sel = to;
  if (merge) toast('Merged into the matching colour.');
}

export function deleteColour(hex: string) {
  if ((app.grid?.palette.length ?? 0) < 2) return;
  if (addEdits([{ kind: 'delete', hex }])) toast('Colour deleted. Its pixels now use the nearest colour.');
}

/** The mockup's new colour, at the current pixel height; then paint with it. */
export function addColour() {
  const hex = '#e0715c', h = app.settings.heights.h;
  if (!app.grid?.palette.some((p) => p.hex === hex)) {
    const edits: Edit[] = [{ kind: 'add', hex }];
    if (h !== 1) edits.push({ kind: 'height', hex, h });
    if (!addEdits(edits)) return;
  }
  ui.sel = hex;
  ui.tool = 'paint';
}

/**
 * Paint cells with the selected colour, or empty them with Erase. Cells already that colour are skipped, so a click
 * on one adds no undo step. Returns how many changed.
 */
export function paintCells(cells: { x: number; y: number }[], push: boolean): number {
  const g = app.grid;
  if (!g) return 0;
  const hex = ui.tool === 'erase' ? null : paintHex();
  const v = hex === null ? -1 : g.palette.findIndex((p) => p.hex === hex);
  const edits: Edit[] = cells
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < g.w && y < g.h && ((v < 0 && hex !== null) || g.cells[y * g.w + x] !== v))
    .map(({ x, y }) => ({ kind: 'paint', x, y, hex }));
  return addEdits(edits, push);
}

/** Keep the largest piece and erase the rest, as one undo step. */
export function removeStrays() {
  const g = app.grid;
  if (!g) return;
  const edits: Edit[] = pieces(g).slice(1).flat().sort((a, b) => a - b)
    .map((k) => ({ kind: 'paint', x: k % g.w, y: Math.floor(k / g.w), hex: null }));
  if (addEdits(edits)) toast('Stray pixels removed. Press Ctrl+Z to undo.');
}

/** Bring back deleted, recoloured and merged colours; heights set for colours that still exist are kept. */
export function restoreColours() {
  if (!app.source) return;
  const ok = change(() => {
    app.edits = app.edits.filter((e) => e.kind !== 'recolour' && e.kind !== 'delete');
    app.settings.colours.max = DEFAULTS.colours.max;
  });
  if (ok) toast('Original colours restored. Your heights were kept.');
}

/** Back to the original image: no crop, no edits, default heights and colour count. Undoable. */
export function reloadImage() {
  if (!app.source) { toast('Open an image first.'); return; }
  const src = app.source;
  const ok = change(() => {
    app.edits = [];
    app.source = { ...src, crop: null };
    app.settings.heights = structuredClone(DEFAULTS.heights);
    app.settings.colours.max = DEFAULTS.colours.max;
  });
  if (ok) toast('Image reloaded. Press Ctrl+Z to undo.');
}

/** Crop to grid cells [c0, c1) × [r0, r1). Painted pixels move with the image; those outside the crop are dropped. */
export function cropTo(c0: number, r0: number, c1: number, r1: number) {
  const g = app.grid, src = app.source, meta = app.meta;
  if (!g || !src || !meta) return;
  const next = { ...src, crop: cellsToCrop(meta, g.w, g.h, c0, r0, c1, r1) };
  // the cropped grid's size: the same cells for pixel art, resampled when pixelating
  const r = computeGrid(next, $state.snapshot(app.settings), []);
  const kx = 'error' in r ? 1 : r.grid.w / (c1 - c0), ky = 'error' in r ? 1 : r.grid.h / (r1 - r0);
  let lost = 0;
  const edits = app.edits.flatMap((e): Edit[] => {
    if (e.kind !== 'paint') return [e];
    if (e.x < c0 || e.y < r0 || e.x >= c1 || e.y >= r1) { lost++; return []; }
    return [{ ...e, x: Math.floor((e.x - c0 + 0.5) * kx), y: Math.floor((e.y - r0 + 0.5) * ky) }];
  });
  ui.cropping = false;
  if (change(() => { app.source = next; app.edits = edits; }) && lost) toast('Painted pixels outside the crop were removed.');
}

/** Pieces in what is shown: the core model's count once it matches the grid, the grid's own until then. */
export function pieceCount(): number {
  const g = app.grid;
  if (!g) return 0;
  return app.built?.grid === g ? app.built.pieces : pieces(g).length;
}

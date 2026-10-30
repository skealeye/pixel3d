import { DEFAULTS, type Edit } from '@pixel3d/core';
import { PALETTE_MAX } from './brush';
import { cellsToCrop, computeGrid } from './pipeline';
import { addEdits, app, change, stopPicking, toast, ui } from './state.svelte';

// Edits from the palette panel and the source preview. Each one is a core `Edit`, replayed on top of the image (spec §4.10).

const HEX = /^#[0-9a-f]{6}$/;

/** The color Paint uses: the brush color, which need not be in the image yet, or the first color when none is chosen. */
function paintHex(): string | null {
  if (ui.sel && HEX.test(ui.sel)) return ui.sel;
  return app.grid?.palette[0]?.hex ?? null;
}

/** One color's height. Repeats on the same color replace the last height edit rather than piling up. */
export function setHeight(hex: string, h: number, push: boolean) {
  const before = app.edits, last = before.at(-1);
  if (!addEdits([{ kind: 'height', hex, h }], push)) return;
  if (last?.kind === 'height' && last.hex === hex) app.edits = [...before.slice(0, -1), app.edits.at(-1)!];
}

export function recolor(from: string, to: string) {
  to = to.toLowerCase();
  if (from === to || !app.grid) return;
  const merge = app.grid.palette.some((p) => p.hex === to);
  if (!addEdits([{ kind: 'recolor', from, to }])) return;
  if (ui.sel === from) ui.sel = to;
  if (merge) toast('Merged into the matching color.');
}

export function deleteColor(hex: string) {
  if ((app.grid?.palette.length ?? 0) < 2) return;
  if (addEdits([{ kind: 'delete', hex }])) toast('Color deleted. Its pixels now use the nearest color.');
}

/** Choose the brush color. It joins the image with the first pixel painted in it, not before. */
export function setBrush(hex: string) {
  ui.sel = hex.toLowerCase();
}

/** Open the Pixel Editor: Paint is on and the picture starts unzoomed. */
export function openEditor() {
  if (!app.grid) { toast('Open an image first.'); return; }
  stopPicking();
  ui.cropping = false;
  ui.editor = true;
  ui.tool = 'paint';
  ui.zoom = 1;
  // a brush color to start with: the last one chosen, else the image's first, else black (a blank canvas)
  if (!ui.sel || !HEX.test(ui.sel)) ui.sel = app.grid?.palette[0]?.hex ?? '#000000';
}

/** Back to the viewer, whose tool is always Select (drag pans, a click picks a color). */
export function closeEditor() {
  ui.editor = false;
  // the brush color is not a highlight: the viewer starts with nothing selected
  ui.sel = null;
  ui.tool = 'select';
  ui.zoom = 1;
}

/**
 * Paint cells with the selected color, or empty them with Erase. Cells already that color are skipped, so a click
 * on one adds no undo step. Returns how many changed.
 */
export function paintCells(cells: { x: number; y: number }[], push: boolean): number {
  const g = app.grid;
  if (!g) return 0;
  const hex = ui.tool === 'erase' ? null : paintHex();
  const v = hex === null ? -1 : g.palette.findIndex((p) => p.hex === hex);
  const isNew = hex !== null && v < 0;
  if (isNew && g.palette.length >= PALETTE_MAX) { toast(`An image holds at most ${PALETTE_MAX} colors.`); return 0; }
  const edits: Edit[] = cells
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < g.w && y < g.h && (isNew || g.cells[y * g.w + x] !== v))
    .map(({ x, y }) => ({ kind: 'paint', x, y, hex }));
  // a color new to the image comes in at the current pixel height, in the same undo step as its first pixels
  if (isNew && edits.length) edits.push({ kind: 'height', hex: hex!, h: app.settings.heights.h });
  return addEdits(edits, push);
}

/** Keep the largest piece and erase the rest, as one undo step. */
export function removeStrays() {
  const g = app.grid;
  if (!g) return;
  const edits: Edit[] = app.parts.slice(1).flat().sort((a, b) => a - b)
    .map((k) => ({ kind: 'paint', x: k % g.w, y: Math.floor(k / g.w), hex: null }));
  if (addEdits(edits)) toast('Stray pixels removed. Press Ctrl+Z to undo.');
}

/** Bring back deleted, recolored and merged colors; heights set for colors that still exist are kept. */
export function restoreColors() {
  if (!app.source) return;
  const ok = change(() => {
    app.edits = app.edits.filter((e) => e.kind !== 'recolor' && e.kind !== 'delete');
    app.settings.colors.max = DEFAULTS.colors.max;
  });
  if (ok) toast('Original colors restored. Your heights were kept.');
}

/** Back to the original image: no crop, no edits, the full color count. The height mode stays and is applied again. Undoable. */
export function reloadImage() {
  if (!app.source) { toast('Open an image first.'); return; }
  const src = app.source;
  const ok = change(() => {
    app.edits = [];
    app.source = { ...src, crop: null };
    app.settings.colors.max = DEFAULTS.colors.max;
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
  const inside = (e: Edit) => e.kind !== 'paint' || (e.x >= c0 && e.y >= r0 && e.x < c1 && e.y < r1);
  const kept = app.edits.filter(inside), lost = app.edits.length - kept.length;
  const edits = scalePaint(kept, c0, r0, kx, ky);
  ui.cropping = false;
  if (change(() => { app.source = next; app.edits = edits; }) && lost) toast('Painted pixels outside the crop were removed.');
}

/**
 * Pieces in what is shown: the core model's count once it matches the grid, the grid's own until then. A clicker's
 * backing bridges islands, and an outline ring or a smoothed base can join them on a flat model, so the grid's count
 * means nothing there: until the model arrives the last such model's count stands (one before there is any).
 */
export function pieceCount(): number {
  const g = app.grid, b = app.built, s = app.settings;
  if (!g) return 0;
  if (s.make === 'clicker') return b?.make === 'clicker' ? b.pieces : 1;
  if (b?.grid === g && b.make === 'model') return b.pieces;
  if (s.outline.on || (s.smooth && s.base.enabled)) return b?.make === 'model' ? b.pieces : 1;
  return app.parts.length;
}

/** What is split, in plain words, or null for one piece: `3 separate pieces`, or on a clicker `cap in 3 pieces`. */
export function piecesNote(): string | null {
  const n = pieceCount();
  if (n < 2) return null;
  const counts = app.settings.make === 'clicker' && app.built?.make === 'clicker' ? app.built.counts : null;
  if (!counts) return `${n} separate pieces`;
  return (['cap', 'body'] as const).filter((k) => counts[k] > 1).map((k) => `${k} in ${counts[k]} pieces`).join(', ');
}

/** Painted cells moved onto a resampled grid: old cell (x, y), offset by (x0, y0), scaled by (kx, ky). */
export function scalePaint(edits: Edit[], x0: number, y0: number, kx: number, ky: number): Edit[] {
  return edits.map((e) => (e.kind !== 'paint' ? e : { ...e, x: Math.floor((e.x - x0 + 0.5) * kx), y: Math.floor((e.y - y0 + 0.5) * ky) }));
}

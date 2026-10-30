import { type Edit, type Settings } from '@pixel3d/core';
import { PALETTE_MAX } from './brush';
import { CANVAS_MAX, CANVAS_MIN, blankSource, cellsToCrop, computeGrid, type Source } from './pipeline';
import { addEdits, app, change, stopPicking, toast, ui } from './state.svelte';

// Edits from the palette panel and the source preview. Each one is a core `Edit`, replayed on top of the image (spec §4.10).

const HEX = /^#[0-9a-f]{6}$/;

/** The most colors the image may have: the Colors setting (Pixelate's own Colors while pixelating). */
export function maxColors(): number {
  return app.meta?.pixelated ? app.settings.pixelate.colors : app.settings.colors.max;
}

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
  ui.newColor = false;
}

const side = (n: number) => Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, Math.round(Number.isFinite(n) ? n : CANVAS_MIN)));

/**
 * Start a blank canvas to draw on, `w` × `h` pixels (4–128 each) with at most `colors` colors (2–16). The model's pixel
 * size is set now, about 40 mm across. Undoable.
 */
export function newCanvas(w: number, h: number, colors: number = PALETTE_MAX) {
  w = side(w);
  h = side(h);
  colors = Math.min(PALETTE_MAX, Math.max(2, Math.round(Number.isFinite(colors) ? colors : PALETTE_MAX)));
  const mm = app.settings.size.width / Math.max(w, h);
  ui.picking = ui.cropping = false;
  change(() => {
    app.source = blankSource(w, h);
    app.edits = [];
    app.settings.pixelMm = { x: mm, y: mm };
    app.settings.background.enabled = false;
    app.settings.pixelate.enabled = 'auto';
    app.settings.colors.max = colors;
  });
}

/** Make a blank canvas `w` × `h` pixels, keeping the drawing from the top-left; what no longer fits is dropped. Undoable. */
export function resizeCanvas(w: number, h: number) {
  const src = app.source;
  if (!src?.blank) return;
  w = side(w);
  h = side(h);
  if (w === src.img.width && h === src.img.height) return;
  change(() => {
    app.source = { ...blankSource(w, h), name: src.name };
    app.edits = app.edits.filter((e) => e.kind !== 'paint' || (e.x < w && e.y < h));
  });
}

/** Open the Pixel Editor: Paint is on and the picture starts unzoomed. With no image it offers a blank canvas. */
export function openEditor() {
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
  ui.newColor = false;
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
  if (isNew && g.palette.length >= maxColors()) { toast(`An image holds at most ${maxColors()} colors.`); return 0; }
  const edits: Edit[] = cells
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < g.w && y < g.h && (isNew || g.cells[y * g.w + x] !== v))
    .map(({ x, y }) => ({ kind: 'paint', x, y, hex }));
  // a color new to the image comes in at the current pixel height, in the same undo step as its first pixels
  // (a drawn canvas takes the height mode's height instead)
  if (isNew && edits.length && !app.source?.blank) edits.push({ kind: 'height', hex: hex!, h: app.settings.heights.h });
  if (isNew && edits.length) ui.newColor = false;
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

/**
 * The Colors limit a loaded image starts with: how many colors it has once its background is gone, at least 2 and at
 * most 16 (the most an image holds, as the settings and the filament count allow). A pixelated photo has its own
 * Colors setting, so it gets the full 16 here; a drawn canvas keeps the limit it was made with.
 */
export function foundColors(src: Source, removeBg = app.settings.background.enabled): number {
  if (src.blank) return app.settings.colors.max;
  const s = $state.snapshot(app.settings) as Settings;
  s.colors.max = PALETTE_MAX;
  s.background.enabled = removeBg;
  const r = computeGrid(src, s, []);
  return 'error' in r || r.meta.pixelated ? PALETTE_MAX : Math.min(PALETTE_MAX, Math.max(2, r.meta.colors));
}

/** Bring back deleted, recolored and merged colors; heights set for colors that still exist are kept. */
export function restoreColors() {
  if (!app.source) return;
  const found = foundColors(app.source);
  const ok = change(() => {
    app.edits = app.edits.filter((e) => e.kind !== 'recolor' && e.kind !== 'delete');
    app.settings.colors.max = found;
  });
  if (ok) toast('Original colors restored. Your heights were kept.');
}

/** Back to the original image: no crop, no edits, all the colors it has. The height mode stays and is applied again. Undoable. */
export function reloadImage() {
  if (!app.source) { toast('Open an image first.'); return; }
  const src = { ...app.source, crop: null };
  const found = foundColors(src);
  const ok = change(() => {
    app.edits = [];
    app.source = src;
    app.settings.colors.max = found;
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

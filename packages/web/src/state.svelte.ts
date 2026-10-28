import { DEFAULTS, applyEdits, opaqueBox, pieces, placeRelative, type Anchor, type Edit, type Grid, type Settings } from '@pixel3d/core';
import { computeGrid, type Meta, type Source } from './pipeline';

/** One undo step: everything a load or an edit can change. Grids and sources are never mutated, so they are shared. */
export interface Snapshot { source: Source | null; grid: Grid | null; meta: Meta | null; settings: Settings; edits: Edit[] }

/** Undo history depth (spec §4.3). */
export const UNDO_LIMIT = 50;

const fresh = (): Settings => structuredClone(DEFAULTS);

class AppState {
  source = $state.raw<Source | null>(null);
  /** The grid the model is built from: palette reduced, heights set and edits applied. */
  grid = $state.raw<Grid | null>(null);
  meta = $state.raw<Meta | null>(null);
  settings = $state<Settings>(fresh());
  edits = $state.raw<Edit[]>([]);
  undo = $state.raw<Snapshot[]>([]);
  redo = $state.raw<Snapshot[]>([]);
  /** Piece count of the last core model and the grid it was built from (view-only, never undone). */
  built = $state.raw<{ grid: Grid; pieces: number } | null>(null);
  /** The grid's 4-connected pieces, largest first: worked out once per grid and shared by every reader. */
  parts = $derived(this.grid ? pieces(this.grid) : []);
}

export const app = new AppState();

/** View-only state: none of it is undone or saved. */
export const ui = $state({
  popover: null as null | 'grid' | 'export',
  /** The Batch and API dialog is open. */
  batch: false,
  /** The Export panel's file name (no extension); set from the image name when one loads. */
  exportName: 'model',
  /** The 3D view's size readout as plain text, e.g. `40.0 × 53.3 × 3.0 mm one piece` (the Export summary repeats it). */
  dims: '',
  /** Pick mode: the background shows and the next click in the preview picks its color. */
  picking: false,
  cropping: false,
  /** Magnet placement mode: the next click on the model drops a magnet. Esc cancels. */
  placing: false,
  cut: false,
  /** How a clicker is shown: Assembled (default, with the press preview) or Apart (as printed). A view, not a setting. */
  clkView: 'assembled' as 'assembled' | 'apart',
  /** Cut view switches on by itself only the first time Shell or Hollow is picked (spec §4.5). */
  cutAuto: false,
  grid: { on: true, color: '#8a7446', opacity: 0.7 },
  /** Image panel width, px. */
  left: 330,
  wide: false,
  /** Source preview zoom, 1–16. */
  zoom: 1,
  /** Source preview tool: Select pans and picks a color, Paint and Erase draw. */
  tool: 'select' as 'select' | 'paint' | 'erase',
  /** The color Paint uses (falls back to the first color when it is gone). */
  sel: null as string | null,
  toast: { text: '', n: 0 },
});

export function toast(text: string) {
  ui.toast = { text, n: ui.toast.n + 1 };
}

/**
 * The current state as an undo step. A grid shown with its background (while picking) is never stored: the step gets
 * the grid its settings make, so undoing back to it shows the background removed again.
 */
function snapshot(): Snapshot {
  const settings = $state.snapshot(app.settings);
  let { grid, meta } = app;
  if (meta?.showBg && app.source) {
    const r = computeGrid(app.source, settings, app.edits);
    if (!('error' in r)) ({ grid, meta } = r);
  }
  return { source: app.source, grid, meta, settings, edits: app.edits };
}

function restore(s: Snapshot) {
  app.source = s.source;
  app.grid = s.grid;
  app.meta = s.meta;
  app.settings = structuredClone(s.settings);
  app.edits = s.edits;
  ui.picking = ui.cropping = false;
  anchorBase = null;
  // the restored grid is what these settings make: the next change compares against it (background included)
  last = s.source && s.grid
    ? { src: s.source, edits: s.edits, picking: false, key: gridKey(s.settings), grid: s.grid, bg: bgKey(s.source, s.settings), art: s.grid }
    : null;
}

/** Record the current state before a change. Keeps the last 50 steps and clears redo. */
export function pushUndo() {
  app.undo = [...app.undo, snapshot()].slice(-UNDO_LIMIT);
  app.redo = [];
}

export function undo() {
  const prev = app.undo.at(-1);
  if (!prev) return;
  app.redo = [...app.redo, snapshot()];
  app.undo = app.undo.slice(0, -1);
  restore(prev);
}

export function redo() {
  const next = app.redo.at(-1);
  if (!next) return;
  app.undo = [...app.undo, snapshot()].slice(-UNDO_LIMIT);
  app.redo = app.redo.slice(0, -1);
  restore(next);
}

/**
 * Re-run the pipeline after a source or settings change. On failure keeps the last grid and returns the reason,
 * shown as a toast unless `notify` is false.
 */
export function recompute(notify = true): string | null {
  const src = app.source;
  if (!src) { app.grid = null; app.meta = null; return null; }
  const settings = $state.snapshot(app.settings) as Settings;
  // a model setting (base, keychain, rotation...) leaves the grid as it is: skip the pipeline, which takes tens of
  // milliseconds on a large image, and keep the grid object so nothing downstream redraws
  const key = gridKey(settings);
  if (last && last.src === src && last.edits === app.edits && last.picking === ui.picking && last.key === key && last.grid === app.grid) {
    if (!app.meta?.showBg) fitSize(last.grid);
    return null;
  }
  const r = computeGrid(src, settings, app.edits, ui.picking);
  if ('error' in r) { if (notify) toast(r.error); return r.error; }
  // a background change keeps the pixel size (spec §4.2, R29): Width and Height follow the new box in fitSize, and the
  // hole and magnets stay on the same spot of the art, in the same undo step
  const bg = bgKey(src, settings);
  if (!ui.picking && !r.meta.showBg && last?.art && last.src.img === src.img && last.bg !== bg) keepAnchors(last.art, r.grid);
  else if (!r.meta.showBg) anchorBase = null;
  app.grid = r.grid;
  app.meta = r.meta;
  // edits that no longer apply are dropped, with a notice (spec §4.10)
  if (r.dropped.length) {
    app.edits = app.edits.filter((e) => !r.dropped.includes(e));
    toast('Edits that no longer apply were removed.');
  }
  if (!r.meta.showBg) fitSize(r.grid);
  last = { src, edits: app.edits, picking: ui.picking, key, grid: r.grid, bg: ui.picking ? (last?.bg ?? bg) : bg, art: r.meta.showBg ? (last?.art ?? null) : r.grid };
  return null;
}

/** The settings `computeGrid` reads. */
const gridKey = (s: Settings) => JSON.stringify([s.background, s.pixelate, s.colors, s.heights]);
/** What the last pipeline run was made from, and the grid it gave. */
let last: { src: Source; edits: Edit[]; picking: boolean; key: string; grid: Grid; bg: string; art: Grid | null } | null = null;
/** What decides which pixels are background. */
const bgKey = (src: Source, s: Settings) => JSON.stringify([s.background, src.pick]);

/**
 * Where the hole and magnets were on the art before a run of background changes: the grid and the anchors then, and
 * the anchors the last re-anchoring wrote. A Tolerance drag re-anchors every frame; working from this base each time,
 * never from the previous frame, keeps the hole from drifting (snapping off the art would compound). Cleared by any
 * other grid change, undo/redo and loads; ignored once anything else has moved the anchors.
 */
let anchorBase: { art: Grid; hole: Anchor; magnets: Anchor[]; wrote: string } | null = null;
const anchorsKey = (s: Settings) => JSON.stringify([s.keychain.hole.at, s.magnets.at]);

/**
 * Re-anchor the hole and magnets after a background change moved the opaque box from `prev`'s to `neu`'s, so each
 * stays on the same spot of the art. Anchors are fractions of the box, so without this they would slide with it.
 */
function keepAnchors(prev: Grid, neu: Grid) {
  const s = app.settings;
  if (!anchorBase || anchorBase.wrote !== anchorsKey(s) || anchorBase.art.w !== prev.w || anchorBase.art.h !== prev.h) {
    anchorBase = { art: prev, hole: $state.snapshot(s.keychain.hole.at) as Anchor, magnets: $state.snapshot(s.magnets.at) as Anchor[], wrote: '' };
  }
  const base = anchorBase;
  if (base.art.w !== neu.w || base.art.h !== neu.h) { anchorBase = null; return; }
  const a = opaqueBox(base.art), b = opaqueBox(neu);
  if (!a || !b) return;
  const same = a.x0 === b.x0 && a.y0 === b.y0 && a.w === b.w && a.h === b.h;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const moved = (at: Anchor): Anchor => {
    if (same) return structuredClone(at);
    const p = placeRelative(at, base.art); // u right, v up, in cells
    return { fx: clamp((p.u - b.x0) / b.w), fy: clamp((b.y0 + b.h - p.v) / b.h) };
  };
  s.keychain.hole.at = moved(base.hole);
  s.magnets.at = base.magnets.map(moved);
  base.wrote = anchorsKey(s);
}

/**
 * Pixel size stays fixed while editing (spec §4.5): the first model sets it from Width and Height, then painting
 * outside the outline or changing the background grows the model and Width and Height follow. Deleting
 * `settings.pixelMm` (a size slider, a new image, Pixels across) sets it again. Width and Height are stored unrounded
 * (the panel rounds them for display), so a saved preset gives `convert()` this exact pixel size (R29).
 */
function fitSize(g: Grid) {
  const box = opaqueBox(g);
  if (!box) return;
  const s = app.settings;
  const keep = s.size.keepAspect;
  s.pixelMm ??= { x: s.size.width / box.w, y: keep ? s.size.width / box.w : s.size.height / box.h };
  const w = box.w * s.pixelMm.x, h = box.h * s.pixelMm.y;
  if (s.size.width !== w) s.size.width = w;
  if (s.size.height !== h) s.size.height = h;
}

/**
 * Append edits by applying them to the current grid, which equals replaying the whole list but skips the pipeline:
 * the fast path for paint strokes and height sliders. Edits that can't apply are skipped. With `push` this is a new
 * undo step. Returns how many applied.
 */
export function addEdits(edits: Edit[], push = true): number {
  const g = app.grid;
  if (!g || !edits.length) return 0;
  const r = applyEdits(g, edits);
  const applied = edits.filter((e) => !r.dropped.includes(e));
  if (!applied.length) return 0;
  if (push) pushUndo();
  anchorBase = null;
  app.grid = r.grid;
  app.edits = [...app.edits, ...applied];
  if (!app.meta?.showBg) fitSize(r.grid);
  return applied.length;
}

/**
 * Slider changes: one undo step per drag, at most one pipeline run per frame (pixelating a large image is slow).
 * A value that leaves nothing to print goes back to the last one that worked, with one toast per drag.
 */
export function live(get: () => number, put: (v: number) => void, when: () => boolean = () => true) {
  let good = 0, frame = 0, failed = false;
  const loaded = () => !!app.source;
  const run = () => {
    frame = 0;
    const err = recompute(false);
    if (err === null) { good = get(); return; }
    put(good);
    if (!failed) { failed = true; toast(err); }
  };
  return {
    begin: () => { good = get(); failed = false; if (loaded() && when()) pushUndo(); },
    set: (v: number) => { put(v); if (loaded() && when() && !frame) frame = requestAnimationFrame(run); },
  };
}

/** Leave Pick mode, showing the grid without its background again. */
export function stopPicking() {
  if (!ui.picking) return;
  ui.picking = false;
  recompute();
}

/** A settings change from a panel: undoable once an image is open, applied directly before that. */
export function setting(apply: () => void): boolean {
  if (!app.source) { apply(); return true; }
  return change(apply);
}

/** Undoable change: push, apply, recompute. When the pipeline fails, the state and the whole history are put back. */
export function change(apply: () => void): boolean {
  const history = { undo: app.undo, redo: app.redo };
  pushUndo();
  const before = app.undo.at(-1)!;
  apply();
  if (recompute() === null) return true;
  restore(before);
  app.undo = history.undo;
  app.redo = history.redo;
  return false;
}

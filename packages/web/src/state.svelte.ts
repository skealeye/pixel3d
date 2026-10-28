import { DEFAULTS, type Edit, type Grid, type Settings } from '@pixel3d/core';
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
}

export const app = new AppState();

/** View-only state: none of it is undone or saved. */
export const ui = $state({
  popover: null as null | 'grid',
  /** Pick mode: the background shows and the next click in the preview picks its colour. */
  picking: false,
  cropping: false,
  cut: false,
  grid: { on: true, colour: '#8a7446', opacity: 0.7 },
  /** Image panel width, px. */
  left: 330,
  wide: false,
  /** Source preview zoom, 1–16. */
  zoom: 1,
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
  const r = computeGrid(src, $state.snapshot(app.settings), app.edits, ui.picking);
  if ('error' in r) { if (notify) toast(r.error); return r.error; }
  app.grid = r.grid;
  app.meta = r.meta;
  return null;
}

/** Leave Pick mode, showing the grid without its background again. */
export function stopPicking() {
  if (!ui.picking) return;
  ui.picking = false;
  recompute();
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

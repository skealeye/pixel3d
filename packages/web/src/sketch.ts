import type { Edit } from '@pixel3d/core';

/** The phone sketch kept in the browser's storage, so a reload or a closed tab doesn't lose the drawing. */
export interface Sketch { v: 1; w: number; h: number; colors: number; edits: Edit[] }

const KEY = 'pixel3d.sketch';
const KINDS = new Set(['recolor', 'delete', 'height', 'paint', 'add']);

export function saveSketch(s: Sketch): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the drawing just isn't kept */ }
}

/** The saved sketch, or null when there is none or it doesn't look right. */
export function loadSketch(): Sketch | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Sketch> | null;
    if (!s || s.v !== 1 || !Number.isInteger(s.w) || !Number.isInteger(s.h) || !Number.isInteger(s.colors) || !Array.isArray(s.edits)) return null;
    if (!s.edits.every((e) => e && typeof e === 'object' && KINDS.has((e as Edit).kind))) return null;
    return s as Sketch;
  } catch { return null; }
}

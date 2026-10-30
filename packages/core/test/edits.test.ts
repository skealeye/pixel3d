import { describe, expect, it } from 'vitest';
import { applyEdits } from '../src/index';
import type { Grid } from '../src/index';

const base = (): Grid => ({
  w: 3, h: 2,
  cells: Int16Array.from([0, 1, 2, 0, 1, -1]),
  palette: [{ hex: '#ff0000', height: 1 }, { hex: '#fe0000', height: 5 }, { hex: '#0000ff', height: 2 }],
});

describe('applyEdits', () => {
  it('recolor onto an existing color merges and keeps the target height', () => {
    const { grid, dropped } = applyEdits(base(), [{ kind: 'recolor', from: '#ff0000', to: '#fe0000' }]);
    expect(dropped).toEqual([]);
    expect(grid.palette).toEqual([{ hex: '#fe0000', height: 5 }, { hex: '#0000ff', height: 2 }]);
    expect(Array.from(grid.cells)).toEqual([0, 0, 1, 0, 0, -1]);
  });

  it('recolor to a new color just renames it', () => {
    const { grid } = applyEdits(base(), [{ kind: 'recolor', from: '#0000ff', to: '#00FF00' }]);
    expect(grid.palette[2]).toEqual({ hex: '#00ff00', height: 2 });
  });

  it('delete moves pixels to the nearest remaining color and they take its height', () => {
    const { grid } = applyEdits(base(), [{ kind: 'delete', hex: '#ff0000' }]);
    expect(grid.palette.map((p) => p.hex)).toEqual(['#fe0000', '#0000ff']);
    expect(Array.from(grid.cells)).toEqual([0, 0, 1, 0, 0, -1]);
    expect(grid.palette[grid.cells[0]!]!.height).toBe(5);
  });

  it('height edits set and clamp; a missing color is dropped', () => {
    const e = { kind: 'height', hex: '#abcdef', h: 3 } as const;
    const r = applyEdits(base(), [{ kind: 'height', hex: '#0000ff', h: 99 }, { kind: 'height', hex: '#ff0000', h: 0 }, e]);
    expect(r.grid.palette.map((p) => p.height)).toEqual([0.2, 5, 20]);
    expect(r.dropped).toEqual([e]);
  });

  it('paint outside the outline extends the opaque set; null erases', () => {
    const r = applyEdits(base(), [{ kind: 'paint', x: 2, y: 1, hex: '#0000ff' }, { kind: 'paint', x: 0, y: 0, hex: null }]);
    expect(r.grid.cells[5]).toBe(2);
    expect(r.grid.cells[0]).toBe(-1);
    expect(r.dropped).toEqual([]);
  });

  it('paint with an unknown hex adds it at the first entry height; out of bounds is dropped', () => {
    const oob = { kind: 'paint', x: 9, y: 0, hex: '#ff0000' } as const;
    const r = applyEdits(base(), [{ kind: 'paint', x: 2, y: 1, hex: '#00ff00' }, oob]);
    expect(r.grid.palette[3]).toEqual({ hex: '#00ff00', height: 1 });
    expect(r.grid.cells[5]).toBe(3);
    expect(r.dropped).toEqual([oob]);
  });

  it('add appends at 1 mm unless it exists, and a color nothing uses does not stay', () => {
    const dup = { kind: 'add', hex: '#0000ff' } as const;
    const r = applyEdits(base(), [{ kind: 'add', hex: '#112233' }, dup]);
    expect(r.grid.palette.length).toBe(3);
    // used within the same batch it stays, at its own height
    const used = applyEdits(base(), [{ kind: 'add', hex: '#112233' }, { kind: 'height', hex: '#112233', h: 3 }, { kind: 'paint', x: 2, y: 1, hex: '#112233' }]);
    expect(used.grid.palette[3]).toEqual({ hex: '#112233', height: 3 });
    expect(used.dropped).toEqual([]);
  });

  it('a color leaves the palette with its last pixel, and the cells are renumbered', () => {
    // #fe0000 (index 1) has pixels at 1 and 4
    const gone = applyEdits(base(), [{ kind: 'paint', x: 1, y: 0, hex: '#ff0000' }, { kind: 'paint', x: 1, y: 1, hex: null }]);
    expect(gone.grid.palette.map((p) => p.hex)).toEqual(['#ff0000', '#0000ff']);
    expect(Array.from(gone.grid.cells)).toEqual([0, 0, 1, 0, -1, -1]);
  });

  it('a color with pixels is kept; an empty grid has an empty palette', () => {
    const kept = applyEdits(base(), [{ kind: 'paint', x: 0, y: 0, hex: null }]);
    expect(kept.grid.palette.length).toBe(3);
    const all = base();
    const edits = Array.from({ length: 6 }, (_, k) => ({ kind: 'paint', x: k % 3, y: Math.floor(k / 3), hex: null }) as const);
    expect(applyEdits(all, edits).grid.palette).toEqual([]);
  });

  it('never mutates its input', () => {
    const g = base();
    const snap = JSON.stringify({ c: Array.from(g.cells), p: g.palette });
    applyEdits(g, [{ kind: 'delete', hex: '#ff0000' }, { kind: 'paint', x: 0, y: 0, hex: null }, { kind: 'height', hex: '#0000ff', h: 9 }]);
    expect(JSON.stringify({ c: Array.from(g.cells), p: g.palette })).toBe(snap);
  });

  it('drops edits that name a missing color', () => {
    const d = { kind: 'delete', hex: '#123456' } as const;
    const r = applyEdits(base(), [d, { kind: 'recolor', from: '#123456', to: '#000000' }]);
    expect(r.dropped.length).toBe(2);
    expect(r.grid.palette.length).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { applyEdits } from '../src/index';
import type { Grid } from '../src/index';

const base = (): Grid => ({
  w: 3, h: 2,
  cells: Int16Array.from([0, 1, 2, 0, 1, -1]),
  palette: [{ hex: '#ff0000', height: 1 }, { hex: '#fe0000', height: 5 }, { hex: '#0000ff', height: 2 }],
});

describe('applyEdits', () => {
  it('recolour onto an existing colour merges and keeps the target height', () => {
    const { grid, dropped } = applyEdits(base(), [{ kind: 'recolour', from: '#ff0000', to: '#fe0000' }]);
    expect(dropped).toEqual([]);
    expect(grid.palette).toEqual([{ hex: '#fe0000', height: 5 }, { hex: '#0000ff', height: 2 }]);
    expect(Array.from(grid.cells)).toEqual([0, 0, 1, 0, 0, -1]);
  });

  it('recolour to a new colour just renames it', () => {
    const { grid } = applyEdits(base(), [{ kind: 'recolour', from: '#0000ff', to: '#00FF00' }]);
    expect(grid.palette[2]).toEqual({ hex: '#00ff00', height: 2 });
  });

  it('delete moves pixels to the nearest remaining colour and they take its height', () => {
    const { grid } = applyEdits(base(), [{ kind: 'delete', hex: '#ff0000' }]);
    expect(grid.palette.map((p) => p.hex)).toEqual(['#fe0000', '#0000ff']);
    expect(Array.from(grid.cells)).toEqual([0, 0, 1, 0, 0, -1]);
    expect(grid.palette[grid.cells[0]!]!.height).toBe(5);
  });

  it('height edits set and clamp; a missing colour is dropped', () => {
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

  it('add appends at 1 mm unless it exists', () => {
    const dup = { kind: 'add', hex: '#0000ff' } as const;
    const r = applyEdits(base(), [{ kind: 'add', hex: '#112233' }, dup]);
    expect(r.grid.palette.length).toBe(4);
    expect(r.grid.palette[3]).toEqual({ hex: '#112233', height: 1 });
  });

  it('never mutates its input', () => {
    const g = base();
    const snap = JSON.stringify({ c: Array.from(g.cells), p: g.palette });
    applyEdits(g, [{ kind: 'delete', hex: '#ff0000' }, { kind: 'paint', x: 0, y: 0, hex: null }, { kind: 'height', hex: '#0000ff', h: 9 }]);
    expect(JSON.stringify({ c: Array.from(g.cells), p: g.palette })).toBe(snap);
  });

  it('drops edits that name a missing colour', () => {
    const d = { kind: 'delete', hex: '#123456' } as const;
    const r = applyEdits(base(), [d, { kind: 'recolour', from: '#123456', to: '#000000' }]);
    expect(r.dropped.length).toBe(2);
    expect(r.grid.palette.length).toBe(3);
  });
});

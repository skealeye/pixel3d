import { describe, expect, it } from 'vitest';
import { COMMON_COLORS, PALETTE_MAX, floodCells, footprint } from '../src/brush';

describe('footprint', () => {
  it('size 1 is the cell itself', () => {
    expect(footprint(3, 4, 1)).toEqual([{ x: 3, y: 4 }]);
  });
  it('size 2 extends right and down from the cell', () => {
    const f = footprint(3, 4, 2);
    expect(f).toHaveLength(4);
    expect(f.map((c) => c.x).sort()).toEqual([3, 3, 4, 4]);
    expect(f.map((c) => c.y).sort()).toEqual([4, 4, 5, 5]);
  });
  it('odd sizes are centred on the cell', () => {
    expect(footprint(5, 5, 3).map((c) => c.x).sort()).toEqual([4, 4, 4, 5, 5, 5, 6, 6, 6]);
    expect(Math.min(...footprint(5, 5, 5).map((c) => c.y))).toBe(3);
  });
  it('size 5 covers 25 distinct cells', () => {
    expect(new Set(footprint(0, 0, 5).map((c) => `${c.x},${c.y}`)).size).toBe(25);
  });
});

describe('palette constants', () => {
  it('has 16 unique common colors in #rrggbb', () => {
    expect(new Set(COMMON_COLORS).size).toBe(16);
    for (const c of COMMON_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('caps an image at 16 colors', () => expect(PALETTE_MAX).toBe(16));
});

describe('floodCells', () => {
  // 3 x 3: a wall of 1s down the middle column, empty (-1) either side
  const cells = [-1, 1, -1, -1, 1, -1, -1, 1, -1];
  it('covers the joined cells of the same value and stops at the wall', () => {
    expect(floodCells(cells, 3, 3, 0, 0).map((c) => `${c.x},${c.y}`).sort()).toEqual(['0,0', '0,1', '0,2']);
  });
  it('fills the wall itself when clicked on it', () => {
    expect(floodCells(cells, 3, 3, 1, 1)).toHaveLength(3);
  });
  it('is empty outside the grid', () => {
    expect(floodCells(cells, 3, 3, 3, 0)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { COMMON_COLORS, PALETTE_MAX, footprint } from '../src/brush';

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

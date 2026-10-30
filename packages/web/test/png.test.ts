import { describe, expect, it } from 'vitest';
import type { Grid } from '@pixel3d/core';
import { gridRgba } from '../src/png';

const grid = (w: number, h: number, cells: number[], hexes: string[]): Grid =>
  ({ w, h, cells: Int16Array.from(cells), palette: hexes.map((hex) => ({ hex, height: 1 })) }) as Grid;

describe('gridRgba', () => {
  it('gives opaque cells their palette color and empty cells alpha 0', () => {
    expect([...gridRgba(grid(2, 1, [0, -1], ['#ff0000']))]).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });
  it('an all-empty grid is all zeros', () => {
    expect([...gridRgba(grid(3, 2, [-1, -1, -1, -1, -1, -1], []))]).toEqual(new Array(24).fill(0));
  });
});

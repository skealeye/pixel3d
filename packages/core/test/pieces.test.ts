import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cornerTouches, decodeImage, detectScale, downsampleNearest, pieces, toGrid } from '../src/index';
import type { Grid } from '../src/index';

const potion = async (): Promise<Grid> => {
  const img = await decodeImage(new Uint8Array(readFileSync(new URL('./fixtures/potion.png', import.meta.url))));
  return toGrid(downsampleNearest(img, detectScale(img)), 16);
};
const grid = (w: number, h: number, on: [number, number][]): Grid => {
  const cells = new Int16Array(w * h).fill(-1);
  for (const [x, y] of on) cells[y * w + x] = 0;
  return { w, h, cells, palette: [{ hex: '#ffffff', height: 1 }] };
};

describe('pieces', () => {
  it('potion is 1 piece', async () => {
    const g = await potion();
    const p = pieces(g);
    expect(p.length).toBe(1);
    expect(p[0]!.length).toBe(Array.from(g.cells).filter((v) => v >= 0).length);
  });

  it('potion plus an isolated pixel is 2, largest first', async () => {
    const g = await potion();
    const i = 15 * 16 + 15;
    expect(g.cells[i]).toBe(-1);
    g.cells[i] = 0;
    const p = pieces(g);
    expect(p.length).toBe(2);
    expect(p[1]).toEqual([i]);
    expect(p[0]!.length).toBeGreaterThan(1);
  });

  it('diagonal pixels are 2 pieces with one corner touch', () => {
    const g = grid(3, 3, [[0, 0], [1, 1]]);
    expect(pieces(g).length).toBe(2);
    expect(cornerTouches(g)).toBe(1);
  });

  it('edge-adjacent pixels have no corner touch; the anti-diagonal counts too', () => {
    expect(cornerTouches(grid(3, 3, [[0, 0], [1, 0]]))).toBe(0);
    expect(cornerTouches(grid(3, 3, [[1, 0], [0, 1]]))).toBe(1);
    expect(cornerTouches(grid(2, 2, [[0, 0], [1, 1], [1, 0]]))).toBe(0);
  });

  it('does not join pieces across a row wrap', () => {
    expect(pieces(grid(3, 2, [[2, 0], [0, 1]])).length).toBe(2);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeImage, detectScale, downsampleNearest, reducePalette, toGrid } from '../src/index';
import type { Img } from '../src/index';

const potion = async () => {
  const img = await decodeImage(new Uint8Array(readFileSync(new URL('./fixtures/potion.png', import.meta.url))));
  return downsampleNearest(img, detectScale(img));
};

/** Build an Img from rows of colours; null = transparent. */
const mk = (rows: (string | null)[][]): Img => {
  const h = rows.length, w = rows[0]!.length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((r, y) => r.forEach((c, x) => {
    if (c) data.set([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255], (y * w + x) * 4);
  }));
  return { width: w, height: h, data };
};

describe('toGrid', () => {
  it('maps transparent to -1, row 0 is the top, palette ordered by count with lowercase hex', () => {
    const g = toGrid(mk([['#FF0000', '#ff0000'], [null, '#00ff00']]), 8);
    expect([g.w, g.h]).toEqual([2, 2]);
    expect(g.palette.map((p) => p.hex)).toEqual(['#ff0000', '#00ff00']);
    expect(Array.from(g.cells)).toEqual([0, 0, -1, 1]);
    expect(g.palette.every((p) => p.height === 1)).toBe(true);
  });

  it('merges extra colours into the nearest kept colour', () => {
    const g = toGrid(mk([['#ff0000', '#ff0000', '#fe0000'], ['#0000ff', '#0000ff', '#0000fd']]), 2);
    expect(g.palette.map((p) => p.hex).sort()).toEqual(['#0000ff', '#ff0000']);
    expect(Array.from(g.cells)).toEqual([0, 0, 0, 1, 1, 1].map((v) => (g.palette[0]!.hex === '#ff0000' ? v : 1 - v)));
  });

  it('reads the potion', async () => {
    const g = toGrid(await potion(), 16);
    expect([g.w, g.h]).toEqual([16, 16]);
    expect(g.cells[0]).toBe(-1);
    expect(g.palette.length).toBeGreaterThan(1);
  });
});

describe('reducePalette', () => {
  it('merges the closest pair, keeping the colour with more pixels', () => {
    const g = toGrid(mk([['#ff0000', '#ff0000', '#fa0000', '#0000ff']]), 8);
    const r = reducePalette(g, 2);
    expect(r.palette.map((p) => p.hex).sort()).toEqual(['#0000ff', '#ff0000']);
    expect(r.cells[2]).toBe(r.palette.findIndex((p) => p.hex === '#ff0000'));
  });

  it('takes the height from the kept entry and does not mutate its input', () => {
    const g = toGrid(mk([['#ff0000', '#ff0000', '#fa0000']]), 8);
    g.palette[0]!.height = 3; g.palette[1]!.height = 7;
    const r = reducePalette(g, 1);
    expect(r.palette).toEqual([{ hex: '#ff0000', height: 3 }]);
    expect(g.palette.length).toBe(2);
  });

  it('is a no-op when already at or under n', () => {
    const g = toGrid(mk([['#ff0000', '#0000ff']]), 8);
    expect(reducePalette(g, 5).palette.length).toBe(2);
  });
});

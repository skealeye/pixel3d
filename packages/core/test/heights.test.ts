import { describe, expect, it } from 'vitest';
import { applyHeightMode } from '../src/index';
import type { Grid } from '../src/index';

const g = (): Grid => ({
  w: 3, h: 1, cells: Int16Array.from([0, 1, 2]),
  palette: [{ hex: '#000000', height: 1 }, { hex: '#ffffff', height: 1 }, { hex: '#ff0000', height: 1 }],
});

describe('applyHeightMode', () => {
  it('uniform sets every height (clamped)', () => {
    expect(applyHeightMode(g(), { mode: 'uniform', h: 2.5 }).palette.map((p) => p.height)).toEqual([2.5, 2.5, 2.5]);
    expect(applyHeightMode(g(), { mode: 'uniform', h: 50 }).palette[0]!.height).toBe(20);
  });

  it('random with seed 42 is stable, within range, rounded to 0.1', () => {
    const m = { mode: 'random', min: 1, max: 5, seed: 42 } as const;
    const a = applyHeightMode(g(), m).palette.map((p) => p.height);
    expect(applyHeightMode(g(), m).palette.map((p) => p.height)).toEqual(a);
    for (const h of a) {
      expect(h).toBeGreaterThanOrEqual(1);
      expect(h).toBeLessThanOrEqual(5);
      expect(Math.round(h * 10) / 10).toBe(h);
    }
    expect(applyHeightMode(g(), { ...m, seed: 7 }).palette.map((p) => p.height)).not.toEqual(a);
  });

  it('brightness with darkHigh puts the darkest at max', () => {
    const p = applyHeightMode(g(), { mode: 'brightness', min: 1, max: 4, darkHigh: true }).palette;
    expect(p[0]!.height).toBe(4);
    expect(p[1]!.height).toBe(1);
    const q = applyHeightMode(g(), { mode: 'brightness', min: 1, max: 4, darkHigh: false }).palette;
    expect([q[0]!.height, q[1]!.height]).toEqual([1, 4]);
    expect(q[2]!.height).toBeGreaterThan(1);
    expect(q[2]!.height).toBeLessThan(2); // red is dim (0.2126)
  });

  it('does not mutate the input', () => {
    const x = g();
    applyHeightMode(x, { mode: 'uniform', h: 9 });
    expect(x.palette[0]!.height).toBe(1);
  });
});

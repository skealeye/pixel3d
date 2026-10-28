import { type Grid, clampHeight, cloneGrid, round1 } from './grid';
import { hexToRgb } from './palette';
import { mulberry32 } from './pixelate';

export type HeightMode =
  | { mode: 'uniform'; h: number }
  | { mode: 'random'; min: number; max: number; seed: number }
  | { mode: 'brightness'; min: number; max: number; darkHigh: boolean };

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Set every colour's height from a mode. Returns a new grid. */
export function applyHeightMode(g: Grid, m: HeightMode): Grid {
  const out = cloneGrid(g);
  if (m.mode === 'uniform') {
    for (const p of out.palette) p.height = clampHeight(m.h);
  } else if (m.mode === 'random') {
    const rnd = mulberry32(m.seed);
    for (const p of out.palette) p.height = clampHeight(round1(m.min + rnd() * (m.max - m.min)));
  } else {
    for (const p of out.palette) {
      const l = luminance(p.hex);
      p.height = clampHeight(round1(m.min + (m.darkHigh ? 1 - l : l) * (m.max - m.min)));
    }
  }
  return out;
}

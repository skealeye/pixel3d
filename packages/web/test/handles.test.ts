import { describe, expect, it } from 'vitest';
import { DEFAULTS, type Grid, type Settings } from '@pixel3d/core';
import { anchorToModel, modelToAnchor } from '../src/viewport/handles';

/** A 5 × 3 cell grid, all opaque, at 2 mm a pixel: the art is 10 × 6 mm and its center falls mid-cell. */
const g: Grid = { w: 5, h: 3, cells: new Int16Array(15), palette: [{ hex: '#ff0000', height: 1 }] as Grid['palette'] };
const s: Settings = { ...structuredClone(DEFAULTS), pixelMm: { x: 2, y: 2 } };
/** Anchors are stored to 6 decimals. */
const near = (a: unknown, fx: number, fy: number) => {
  const { fx: x, fy: y } = a as { fx: number; fy: number };
  expect(x).toBeCloseTo(fx, 6);
  expect(y).toBeCloseTo(fy, 6);
};

describe('modelToAnchor', () => {
  it('follows the pointer exactly without snap', () => {
    near(modelToAnchor(5.3, 3.2, g, s), 0.53, 1 - 3.2 / 6);
  });

  it('Shift snaps to the half-pixel grid, which lands on the exact center', () => {
    const a = modelToAnchor(5.3, 3.2, g, s, true)!;
    near(a, 0.5, 0.5);
    expect(anchorToModel(a, g, s)).toEqual({ x: 5, y: 3 });
  });

  it('snaps to pixel corners and centers alike', () => {
    near(modelToAnchor(1.9, 0.6, g, s, true), 0.2, 1 - 1 / 6);
    near(modelToAnchor(1.4, 0.4, g, s, true), 0.1, 1);
  });
});

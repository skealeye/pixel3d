import { describe, expect, it } from 'vitest';
import { pinchView } from '../src/pinch';

const start = { a: { x: -10, y: 0 }, b: { x: 10, y: 0 }, zoom: 1, pan: { x: 0, y: 0 } };

describe('pinchView', () => {
  it('fingers that have not moved keep the view', () => {
    const s = { ...start, zoom: 3, pan: { x: 5, y: -7 } };
    expect(pinchView(s, s.a, s.b, 16)).toEqual({ zoom: 3, pan: { x: 5, y: -7 } });
  });
  it('zoom follows the finger distance, about the midpoint', () => {
    const s = { a: { x: 20, y: 30 }, b: { x: 40, y: 30 }, zoom: 1, pan: { x: 0, y: 0 } };
    const v = pinchView(s, { x: 10, y: 30 }, { x: 50, y: 30 }, 16);
    expect(v.zoom).toBe(2);
    // the content under the midpoint (30, 30) stays under it
    expect(v.pan).toEqual({ x: -30, y: -30 });
  });
  it('moving both fingers moves the canvas with them', () => {
    const s = { ...start, zoom: 2, pan: { x: 1, y: 2 } };
    expect(pinchView(s, { x: 0, y: 15 }, { x: 20, y: 15 }, 16)).toEqual({ zoom: 2, pan: { x: 11, y: 17 } });
  });
  it('zoom stops at 1 and at the maximum; back at 1 the pan is reset', () => {
    expect(pinchView(start, { x: -1000, y: 0 }, { x: 1000, y: 0 }, 16).zoom).toBe(16);
    const s = { ...start, zoom: 2, pan: { x: 30, y: 40 } };
    expect(pinchView(s, { x: -2, y: 5 }, { x: 2, y: 5 }, 16)).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
  });
});

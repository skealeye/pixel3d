import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex } from '../src/color';

describe('hsv and hex', () => {
  it('known colors', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(0, 0, 0)).toBe('#000000');
    expect(hsvToHex(0, 0, 1)).toBe('#ffffff');
    expect(hexToHsv('#00ff00').h).toBe(120);
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 1, v: 1 });
  });

  it('round-trips colors to within one unit per channel', () => {
    for (const hex of ['#000000', '#ffffff', '#e0715c', '#12ab34', '#7a4fd6', '#2b2135']) {
      const { h, s, v } = hexToHsv(hex), back = hsvToHex(h, s, v);
      for (const i of [1, 3, 5]) expect(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16))).toBeLessThanOrEqual(1);
    }
  });

  it('wraps hue and clamps saturation and value', () => {
    expect(hsvToHex(360, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(-120, 1, 1)).toBe(hsvToHex(240, 1, 1));
    expect(hsvToHex(0, 2, 2)).toBe('#ff0000');
  });
});

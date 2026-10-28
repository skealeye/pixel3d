import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeImage, pixelate, removeBackground } from '../src/index';
import type { Img } from '../src/index';

const load = async (n: string) => decodeImage(new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url))));
const colours = (img: Img) => {
  const s = new Set<string>();
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]! >= 128) s.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
  return s;
};

describe('pixelate', () => {
  it('gradient at across 20 / 5 colours is 20x20, <= 5 colours, deterministic, no pale fringe', async () => {
    const src = await load('gradient-photo.png');
    const a = pixelate(src, { across: 20, colours: 5 });
    const b = pixelate(src, { across: 20, colours: 5 });
    expect([a.width, a.height]).toEqual([20, 20]);
    expect(colours(a).size).toBeLessThanOrEqual(5);
    expect(colours(a).size).toBeGreaterThan(1);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    for (let i = 0; i < a.data.length; i += 4) {
      expect(a.data[i + 3]).toBe(255);
      expect(Math.hypot(255 - a.data[i]!, 255 - a.data[i + 1]!, 255 - a.data[i + 2]!)).toBeGreaterThan(40);
    }
  });

  it('keeps aspect ratio and never upsizes', () => {
    const img: Img = { width: 8, height: 4, data: new Uint8ClampedArray(8 * 4 * 4).fill(200) };
    const r = pixelate(img, { across: 100, colours: 2 });
    expect([r.width, r.height]).toEqual([8, 4]);
    const s = pixelate(img, { across: 4, colours: 2 });
    expect([s.width, s.height]).toEqual([4, 2]);
  });

  it('transparent areas stay transparent and clearing first leaves no white fringe', async () => {
    const src = await load('eye-on-white.png');
    const cleared = removeBackground(src, { enabled: true, tolPct: 9 }).img;
    const r = pixelate(cleared, { across: 10, colours: 3 });
    expect([r.width, r.height]).toEqual([10, 6]);
    expect(r.data[3]).toBe(0);
    // the only pale opaque cells are the enclosed eye (cells 3,2 / 4,2 / 3,3); no fringe around the body
    const pale: string[] = [];
    for (let i = 0; i < r.data.length; i += 4) {
      if (r.data[i + 3] === 0) continue;
      if (Math.hypot(255 - r.data[i]!, 255 - r.data[i + 1]!, 255 - r.data[i + 2]!) <= 40) pale.push(`${(i / 4) % 10},${Math.floor(i / 40)}`);
    }
    expect(pale.sort()).toEqual(['3,2', '3,3', '4,2']);
  });

  it('colours caps at the number of opaque pixels', () => {
    const img: Img = { width: 2, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255, 200, 20, 30, 255]) };
    const r = pixelate(img, { across: 2, colours: 9 });
    expect(colours(r).size).toBe(2);
  });
});

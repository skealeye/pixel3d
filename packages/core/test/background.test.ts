import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeImage, detectScale, findCornerBg, looksLikePixelArt, removeBackground } from '../src/index';

const load = async (n: string) => decodeImage(new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url))));
const alphaAt = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
const isWhite = (img: { data: Uint8ClampedArray }, i: number) => img.data[i * 4] === 255 && img.data[i * 4 + 1] === 255 && img.data[i * 4 + 2] === 255;

describe('removeBackground', () => {
  it('clears edge-connected white and keeps the enclosed eye', async () => {
    const img = await load('eye-on-white.png');
    const total = img.width * img.height;
    let whites = 0, eye = 0;
    for (let i = 0; i < total; i++) if (isWhite(img, i)) whites++;
    // the eye is three 4x4 cells (two on one row, one below), enclosed by body
    eye = 3 * 16;
    const r = removeBackground(img, { enabled: true, tolPct: 9 });
    expect(r.how).toBe('corners');
    expect(r.bg).toBe('#ffffff');
    expect(r.cleared).toBe(whites - eye);
    // eye centre (cell 3,2 => px 12..15, 8..11) stays opaque
    expect(alphaAt(r.img, 13, 9)).toBe(255);
    expect(alphaAt(r.img, 0, 0)).toBe(0);
    // input untouched
    expect(alphaAt(img, 0, 0)).toBe(255);
    for (let i = 0; i < total; i++) {
      const a = r.img.data[i * 4 + 3];
      if (isWhite(img, i) && a === 0) continue;
      expect(a).toBe(255);
    }
  });

  it('tolerance 0 and 50 clear different amounts on the anti-aliased fixture', async () => {
    const img = await load('antialiased.png');
    const a = removeBackground(img, { enabled: true, tolPct: 0 });
    const b = removeBackground(img, { enabled: true, tolPct: 50 });
    expect(a.cleared).toBeGreaterThan(0);
    expect(b.cleared).toBeGreaterThan(a.cleared);
    // the dark body survives even at 50 %
    expect(alphaAt(b.img, 19, 14)).toBe(255);
  });

  it('a picked colour reports picked', async () => {
    const r = removeBackground(await load('eye-on-white.png'), { enabled: true, tolPct: 9, pick: '#ffffff' });
    expect(r.how).toBe('picked');
    expect(r.bg).toBe('#ffffff');
    expect(r.cleared).toBeGreaterThan(0);
  });

  it('disabled leaves everything alone', async () => {
    const img = await load('eye-on-white.png');
    const r = removeBackground(img, { enabled: false, tolPct: 9 });
    expect(r.how).toBe('none');
    expect(r.cleared).toBe(0);
    expect(Array.from(r.img.data)).toEqual(Array.from(img.data));
  });

  it('an already transparent image reports transparent', async () => {
    const r = removeBackground(await load('potion.png'), { enabled: true, tolPct: 9 });
    expect(r.how).toBe('transparent');
    expect(r.cleared).toBe(0);
  });

  it('no uniform corners and no pick reports none', async () => {
    const r = removeBackground(await load('gradient-photo.png'), { enabled: true, tolPct: 9 });
    expect(r.how).toBe('none');
    expect(r.bg).toBeNull();
  });
});

describe('findCornerBg', () => {
  it('finds white, and null when corners differ', async () => {
    expect(findCornerBg(await load('eye-on-white.png'), 9)).toEqual([255, 255, 255]);
    expect(findCornerBg(await load('corner-touch.png'), 9)).toEqual([200, 30, 30]);
    expect(findCornerBg(await load('gradient-photo.png'), 9)).toBeNull();
  });
});

describe('looksLikePixelArt', () => {
  it('true for a few colours at small size', async () => {
    const img = await load('potion.png');
    expect(looksLikePixelArt(img, detectScale(img))).toBe(true);
  });
  it('false for a smooth gradient', async () => {
    const img = await load('gradient-photo.png');
    expect(looksLikePixelArt(img, detectScale(img))).toBe(false);
  });
  it('false when larger than 512 px after scale', () => {
    const img = { width: 600, height: 4, data: new Uint8ClampedArray(600 * 4 * 4).fill(255) };
    expect(looksLikePixelArt(img, { sx: 1, sy: 1, ox: 0, oy: 0 })).toBe(false);
    expect(looksLikePixelArt(img, { sx: 2, sy: 1, ox: 0, oy: 0 })).toBe(true);
  });
});

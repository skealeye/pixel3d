import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeImage, detectScale, downsampleNearest } from '../src/index';

const load = async (n: string) => decodeImage(new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url))));

describe('detectScale', () => {
  it('potion is a 4x upscale with no offset', async () => {
    expect(detectScale(await load('potion.png'))).toEqual({ sx: 4, sy: 4, ox: 0, oy: 0 });
  });

  it('offset-grid is 3x2 with a 1px offset', async () => {
    expect(detectScale(await load('offset-grid.png'))).toEqual({ sx: 3, sy: 2, ox: 1, oy: 1 });
  });

  it('a smooth gradient is not an upscale', async () => {
    const s = detectScale(await load('gradient-photo.png'));
    expect(s.sx).toBe(1);
    expect(s.sy).toBe(1);
  });
});

describe('downsampleNearest', () => {
  it('potion goes back to 16x16', async () => {
    const out = downsampleNearest(await load('potion.png'), { sx: 4, sy: 4, ox: 0, oy: 0 });
    expect([out.width, out.height]).toEqual([16, 16]);
    expect(Array.from(out.data.slice(6 * 4, 6 * 4 + 4))).toEqual([0x2b, 0x21, 0x35, 255]);
  });

  it('offset-grid drops the partial edge cells', async () => {
    const img = await load('offset-grid.png');
    const out = downsampleNearest(img, detectScale(img));
    expect([out.width, out.height]).toEqual([6, 5]);
  });

  it('scale 1 returns the same pixels', async () => {
    const img = await load('gradient-photo.png');
    const out = downsampleNearest(img, { sx: 1, sy: 1, ox: 0, oy: 0 });
    expect(out.data).toEqual(img.data);
  });
});

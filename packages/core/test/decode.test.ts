import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeImage, VERSION } from '../src/index';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));

describe('decodeImage', () => {
  it('decodes potion.png to 64x64 with transparent corners', async () => {
    const img = await decodeImage(fx('potion.png'));
    expect([img.width, img.height]).toEqual([64, 64]);
    expect(img.data.length).toBe(64 * 64 * 4);
    expect(img.data[3]).toBe(0);
  });

  it('decodes a GIF (first frame)', async () => {
    const img = await decodeImage(fx('checker.gif'));
    expect([img.width, img.height]).toEqual([8, 8]);
    expect(Array.from(img.data.slice(0, 4))).toEqual([40, 40, 200, 255]);
  });

  it('decodes a JPEG', async () => {
    const img = await decodeImage(fx('checker.jpg'));
    expect([img.width, img.height]).toEqual([8, 8]);
    expect(img.data[3]).toBe(255);
  });

  it('snaps alpha below 128 to fully transparent and keeps the rest', async () => {
    const UPNG = (await import('upng-js')).default;
    const px = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < 256; i++) px.set([i, 20 + (i % 50), 30, i === 0 ? 127 : 255 - (i === 1 ? 127 : 0)], i * 4);
    const bytes = new Uint8Array(UPNG.encode([px.buffer as ArrayBuffer], 16, 16, 0));
    const img = await decodeImage(bytes);
    expect(Array.from(img.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(img.data.slice(4, 8))).toEqual([1, 21, 30, 255]);
  });

  it('rejects unknown bytes', async () => {
    await expect(decodeImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow('Unsupported image format');
  });

  it('decodes WebP', async () => {
    const img = await decodeImage(fx('checker.webp'));
    expect([img.width, img.height]).toEqual([8, 8]);
    expect(Array.from(img.data.slice(0, 4))).toEqual([40, 40, 200, 255]);
  });

  it('reads VERSION from the root package.json', () => {
    expect(VERSION).toBe('0.2.2');
  });
});

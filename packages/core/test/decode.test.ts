import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeImage, VERSION } from '../src/index';
import pkg from '../../../package.json' with { type: 'json' };

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
    expect(VERSION).toBe(pkg.version);
  });
});

/** Headers that declare a huge image; the pixel data after them is missing or junk, so only a header check is fast. */
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
function pngHeader(w: number, h: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0, ...new Array(64).fill(0)]);
}
function gifHeader(w: number, h: number): Uint8Array {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(w), ...le16(h), 0, 0, 0, ...new Array(64).fill(0)]);
}
function jpegHeader(w: number, h: number): Uint8Array {
  // SOI, an APP0 segment, then SOF0 with height and width
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 1, 1, 0x11, 0, ...new Array(64).fill(0)]);
}
const riff = (chunk: number[]) => new Uint8Array([0x52, 0x49, 0x46, 0x46, ...le16(chunk.length + 4), 0, 0, 0x57, 0x45, 0x42, 0x50, ...chunk, ...new Array(64).fill(0)]);
const webpX = (w: number, h: number) => riff([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const webpL = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return riff([0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]);
};
const webpLossy = (w: number, h: number) => riff([0x56, 0x50, 0x38, 0x20, 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]);

describe('decodeImage size cap (8192 px a side, 40 MP)', () => {
  const cases: [string, Uint8Array][] = [
    ['PNG', pngHeader(20000, 20000)],
    ['GIF', gifHeader(20000, 20000)],
    ['JPEG', jpegHeader(20000, 20000)],
    ['WebP VP8X', webpX(20000, 20000)],
    ['WebP VP8L', webpL(16000, 16000)],
    ['WebP VP8', webpLossy(16000, 16000)],
  ];
  for (const [fmt, bytes] of cases) {
    it(`refuses an oversized ${fmt} from its header, fast`, async () => {
      const t = performance.now();
      await expect(decodeImage(bytes)).rejects.toThrow(/The image is too large \(\d+ × \d+ px\)\. The limit is 8192 px per side and 40 megapixels/);
      expect(performance.now() - t).toBeLessThan(200);
    });
  }

  it('refuses an image within the side limit but over 40 MP', async () => {
    await expect(decodeImage(pngHeader(8000, 8000))).rejects.toThrow('The image is too large (8000 × 8000 px)');
  });

  it('refuses a header-level oversize as a ConvertError sentence in convert()', async () => {
    const { convert } = await import('../src/index');
    const { report } = await convert(pngHeader(20000, 20000), { version: 1, settings: {}, colorRules: [] } as never, 'big');
    expect(report.error).toMatch(/^The image is too large \(20000 × 20000 px\)/);
  });

  it('still decodes images under the cap', async () => {
    const img = await decodeImage(fx('potion.png'));
    expect(img.width).toBe(64);
  });
});

/** A GIF whose 16×16 screen hides a W×H first frame at (x, y): only the frame descriptor says how big it is. */
function gifFrameBomb(w: number, h: number, x = 0, y = 0): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(16), ...le16(16), 0x80, 0, 0, // screen 16×16, 2-color table
    0, 0, 0, 255, 255, 255,
    0x2c, ...le16(x), ...le16(y), ...le16(w), ...le16(h), 0, // image descriptor
    2, 2, 0x4c, 0x01, 0, 0x3b,
  ]);
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: number[] | Uint8Array): number[] {
  const td = new Uint8Array([...[...type].map((ch) => ch.charCodeAt(0)), ...data]);
  return [...be32(data.length), ...td, ...be32(crc32(td))];
}
/**
 * An APNG: a W×H RGBA default image (IDAT, also frame 0) plus `n` more frames whose fdAT data is `frameData`.
 * The pixel data is all transparent-black zeros except one opaque pixel, so it compresses to almost nothing.
 */
async function apng(w: number, h: number, n: number, frameData?: Uint8Array): Promise<Uint8Array> {
  const { zlibSync } = await import('fflate');
  const raw = new Uint8Array(h * (1 + w * 4));
  raw.set([200, 30, 30, 255], 1); // pixel (0, 0) opaque red
  const z = zlibSync(raw, { level: 9 });
  const fctl = (seq: number) => chunk('fcTL', [...be32(seq), ...be32(w), ...be32(h), ...be32(0), ...be32(0), 0, 100, 0, 100, 0, 0]);
  const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(w), ...be32(h), 8, 6, 0, 0, 0]),
    ...chunk('acTL', [...be32(n + 1), ...be32(0)]),
    ...fctl(0), ...chunk('IDAT', z)];
  let seq = 1;
  for (let i = 0; i < n; i++) { out.push(...fctl(seq++)); out.push(...chunk('fdAT', [...be32(seq++), ...(frameData ?? z)])); }
  out.push(...chunk('IEND', []));
  return new Uint8Array(out);
}

describe('decodeImage: frames hidden behind the header', () => {
  it('refuses a GIF whose first frame is over the cap though its screen is 16 × 16, fast', async () => {
    const t = performance.now();
    await expect(decodeImage(gifFrameBomb(20000, 20000))).rejects.toThrow('The image is too large (20000 × 20000 px)');
    await expect(decodeImage(gifFrameBomb(65535, 65535))).rejects.toThrow('The image is too large (65535 × 65535 px)');
    expect(performance.now() - t).toBeLessThan(200);
  });

  it('refuses a GIF whose first frame reaches outside its screen', async () => {
    await expect(decodeImage(gifFrameBomb(32, 32))).rejects.toThrow(/outside/);
    await expect(decodeImage(gifFrameBomb(8, 8, 12, 0))).rejects.toThrow(/outside/);
  });

  it('decodes only the first APNG frame: later frames are never inflated', async () => {
    // later frames hold data that is not even zlib: inflating them would throw
    const img = await decodeImage(await apng(16, 16, 3, new Uint8Array([1, 2, 3, 4, 5])));
    expect([img.width, img.height]).toEqual([16, 16]);
    expect(Array.from(img.data.slice(0, 4))).toEqual([200, 30, 30, 255]);
  });

  it('an APNG with 40 frames of 1000 × 1000 costs one frame, fast', async () => {
    const bytes = await apng(1000, 1000, 40);
    const t = performance.now();
    const img = await decodeImage(bytes);
    expect(img.width).toBe(1000);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

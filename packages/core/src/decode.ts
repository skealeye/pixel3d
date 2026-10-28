import UPNG from 'upng-js';
import jpeg from 'jpeg-js';
import { GifReader } from 'omggif';
import type { Img } from './image';

type Format = 'png' | 'jpeg' | 'gif' | 'webp';

function sniff(b: Uint8Array): Format | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

/**
 * Largest image decoded: 8192 px a side and 40 megapixels. Decoding holds the RGBA frame (4 bytes a pixel) plus the
 * decoder's own buffers, so 40 MP is ~160 MB of pixels and a few hundred MB peak: fine on a phone or a small server.
 * Anything over 512 px is pixelated down to at most 128 cells anyway (spec §4.1), so larger inputs add nothing, and
 * this still admits 4K/5K screenshots and most phone photos (12–24 MP). Without it a 389 KB PNG claiming 20000²
 * took 2.5 GB and 9 s (final review, finding 1).
 */
export const MAX_SIDE = 8192;
export const MAX_MEGAPIXELS = 40;

/** Thrown before decoding when the header declares an image over the cap; its message is a sentence for the user. */
export class ImageTooLargeError extends Error {
  constructor(readonly width: number, readonly height: number) {
    super(`The image is too large (${width} × ${height} px). The limit is ${MAX_SIDE} px per side and ${MAX_MEGAPIXELS} megapixels.`);
    this.name = 'ImageTooLargeError';
  }
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);

/** JPEG: walk the marker segments to the first SOFn (not DHT C4, JPG C8 or DAC CC). */
function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16be(b, i + 5), w: u16be(b, i + 7) };
    if (m === 0xd9 || m === 0xda) return null;
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

/** WebP: the first chunk is VP8X (canvas size), VP8L (14-bit sizes) or VP8 (key-frame header). */
function webpSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 30) return null;
  const tag = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (tag === 'VP8X') return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  if (tag === 'VP8L' && b[20] === 0x2f) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (tag === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  return null;
}

/** The size the header declares, read without decoding; null when the header can't be read (the decoder then reports it). */
function headerSize(b: Uint8Array, fmt: Format): { w: number; h: number } | null {
  switch (fmt) {
    case 'png': return b.length >= 24 ? { w: u32be(b, 16), h: u32be(b, 20) } : null;
    case 'gif': return b.length >= 10 ? { w: u16le(b, 6), h: u16le(b, 8) } : null;
    case 'jpeg': return jpegSize(b);
    case 'webp': return webpSize(b);
  }
}

function checkSize(w: number, h: number): void {
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_MEGAPIXELS * 1e6) throw new ImageTooLargeError(w, h);
}

/** Chunks that make a PNG animated (APNG): frame control, frame data and the animation header. */
const APNG_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT']);

/**
 * The PNG without its APNG chunks, so only the default image (IDAT) is decoded. upng inflates every frame while
 * parsing and converts every frame to RGBA, so 40 frames of 4000² from 11.7 KB took 2.77 GB. The default image is what
 * viewers without APNG support show, and it is frame 0 when the first fcTL comes before IDAT. A plain PNG is returned as is.
 */
function firstFrameOnly(b: Uint8Array): Uint8Array {
  const keep: [number, number][] = [];
  let animated = false;
  for (let i = 8; i + 8 <= b.length;) {
    const len = u32be(b, i), type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = Math.min(b.length, i + 12 + len);
    if (APNG_CHUNKS.has(type)) animated = true;
    else keep.push([i, end]);
    i = end;
    if (type === 'IEND') break;
  }
  if (!animated) return b;
  const out = new Uint8Array(8 + keep.reduce((n, [a, z]) => n + z - a, 0));
  out.set(b.subarray(0, 8));
  let o = 8;
  for (const [a, z] of keep) { out.set(b.subarray(a, z), o); o += z - a; }
  return out;
}

function decodePng(input: Uint8Array): Img {
  const bytes = firstFrameOnly(input);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const png = UPNG.decode(buf);
  const frame = UPNG.toRGBA8(png)[0]!;
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(frame) };
}

function decodeJpeg(bytes: Uint8Array): Img {
  // jpeg-js's own limits back up the header check (e.g. a SOF hidden behind a malformed segment)
  const r = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_MEGAPIXELS, maxMemoryUsageInMB: 512 });
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

function decodeGif(bytes: Uint8Array): Img {
  const reader = new GifReader(bytes as unknown as Buffer);
  // the frame descriptor has its own size, and omggif allocates by it: check it, and keep it inside the screen,
  // so nothing bigger than the (already checked) screen is ever allocated
  const f = reader.frameInfo(0);
  checkSize(f.width, f.height);
  if (f.x + f.width > reader.width || f.y + f.height > reader.height) {
    throw new Error(`The first frame (${f.width} × ${f.height} px at ${f.x}, ${f.y}) reaches outside the ${reader.width} × ${reader.height} px image`);
  }
  const data = new Uint8ClampedArray(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(0, data as unknown as Uint8Array);
  return { width: reader.width, height: reader.height, data };
}

let webpReady: Promise<(buf: ArrayBuffer) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>> | undefined;

/** WebP via @jsquash/webp. The browser loads its wasm normally; Node has no fetch for file URLs, so hand it the bytes. */
function webpDecoder() {
  webpReady ??= (async () => {
    const mod = await import('@jsquash/webp/decode.js');
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('node:fs/promises');
      const { fileURLToPath, pathToFileURL } = await import('node:url');
      const { createRequire } = await import('node:module');
      const wasm = new URL('./codec/dec/webp_dec.wasm', pathToFileURL(createRequire(import.meta.url).resolve('@jsquash/webp/decode.js')));
      await mod.init(await (globalThis as unknown as { WebAssembly: { compile(b: Uint8Array): Promise<never> } }).WebAssembly.compile(await readFile(fileURLToPath(wasm))));
    }
    return mod.default;
  })();
  return webpReady;
}

async function decodeWebp(bytes: Uint8Array): Promise<Img> {
  const decode = await webpDecoder();
  const r = await decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

/**
 * Decode PNG/JPEG/GIF (first frame)/WebP by magic bytes. Alpha below 128 becomes fully transparent (RGB zeroed).
 * Throws `ImageTooLargeError` before decoding when the header declares more than `MAX_SIDE` / `MAX_MEGAPIXELS`.
 */
export async function decodeImage(bytes: Uint8Array): Promise<Img> {
  const fmt = sniff(bytes);
  if (!fmt) throw new Error('Unsupported image format');
  const size = headerSize(bytes, fmt);
  if (size) checkSize(size.w, size.h);
  const img =
    fmt === 'png' ? decodePng(bytes) :
    fmt === 'jpeg' ? decodeJpeg(bytes) :
    fmt === 'gif' ? decodeGif(bytes) :
    await decodeWebp(bytes);
  checkSize(img.width, img.height);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i]! < 128) { d[i - 3] = 0; d[i - 2] = 0; d[i - 1] = 0; d[i] = 0; }
    else d[i] = 255;
  }
  return img;
}

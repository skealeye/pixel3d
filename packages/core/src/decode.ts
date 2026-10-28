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

function decodePng(bytes: Uint8Array): Img {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const png = UPNG.decode(buf);
  const frame = UPNG.toRGBA8(png)[0]!;
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(frame) };
}

function decodeJpeg(bytes: Uint8Array): Img {
  const r = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

function decodeGif(bytes: Uint8Array): Img {
  const reader = new GifReader(bytes as unknown as Buffer);
  const data = new Uint8ClampedArray(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(0, data as unknown as Uint8Array);
  return { width: reader.width, height: reader.height, data };
}


// @jsquash/webp fetches its wasm by URL and cannot load under Node/Vitest; wired up in the web package later.
function unsupportedWebp(): never {
  throw new Error('Unsupported image format: webp (decoder unavailable)');
}

/** Decode PNG/JPEG/GIF (first frame)/WebP by magic bytes. Alpha below 128 becomes fully transparent (RGB zeroed). */
export async function decodeImage(bytes: Uint8Array): Promise<Img> {
  const fmt = sniff(bytes);
  if (!fmt) throw new Error('Unsupported image format');
  const img =
    fmt === 'png' ? decodePng(bytes) :
    fmt === 'jpeg' ? decodeJpeg(bytes) :
    fmt === 'gif' ? decodeGif(bytes) :
    unsupportedWebp();
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i]! < 128) { d[i - 3] = 0; d[i - 2] = 0; d[i - 1] = 0; d[i] = 0; }
    else d[i] = 255;
  }
  return img;
}

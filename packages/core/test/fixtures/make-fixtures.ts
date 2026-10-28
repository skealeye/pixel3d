// Deterministic fixture generator. Run from the repo root: npm run fixtures
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import UPNG from 'upng-js';
import jpeg from 'jpeg-js';
import { GifWriter } from 'omggif';

const dir = dirname(fileURLToPath(import.meta.url));

// The mockup's 16x16 sample sprite (docs/mockups/app-mockup.html)
const SPRITE = [
  '......KKKK......',
  '.....KCCCCK.....',
  '.....KCCCCK.....',
  '......KWWK......',
  '......KWWK......',
  '.....KWWWWK.....',
  '....KWWWWWWK....',
  '...KWPPPPPPGK...',
  '..KPLPPPPPPPGK..',
  '..KPLLPPPPPPPK..',
  '..KPLPPPPPPPPK..',
  '..KPPPPPPPPDPK..',
  '..KDPPPPPPPDDK..',
  '...KDDPPPPDDK...',
  '....KKDDDDKK....',
  '......KKKK......',
];
const LEGEND: Record<string, string> = { K: '#2b2135', C: '#9c6b3e', W: '#bfd9e6', G: '#f4fbff', P: '#7a4fd6', L: '#b394f2', D: '#4e2f9e' };

type Rgba = [number, number, number, number];
const hex = (h: string): Rgba => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

/** Rasterize a pixel grid. Cell of output pixel x is floor((x + sx - ox) / sx), so a leading partial cell of ox pixels appears when ox > 0. */
function raster(w: number, h: number, sx: number, sy: number, ox: number, oy: number, at: (cx: number, cy: number) => Rgba) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(Math.floor((x + sx - ox) / sx), Math.floor((y + sy - oy) / sy));
    data.set(c, (y * w + x) * 4);
  }
  return { w, h, data };
}

const png = (name: string, img: { w: number; h: number; data: Uint8Array }) =>
  writeFileSync(join(dir, name), new Uint8Array(UPNG.encode([img.data.buffer as ArrayBuffer], img.w, img.h, 0)));

const CLEAR: Rgba = [0, 0, 0, 0];
const WHITE: Rgba = [255, 255, 255, 255];

// potion: 16x16 sprite at 4x on transparent
png('potion.png', raster(64, 64, 4, 4, 0, 0, (cx, cy) => {
  const ch = SPRITE[cy - 1]?.[cx - 1];
  return !ch || ch === '.' ? CLEAR : hex(LEGEND[ch]!);
}));

// eye-on-white: 10x6 at 4x; dark body with an enclosed white eye
const EYE = [
  '..........',
  '..DDDDDD..',
  '.DDWWDDDD.',
  '.DDWDDDDD.',
  '..DDDDDD..',
  '..........',
];
png('eye-on-white.png', raster(40, 24, 4, 4, 0, 0, (cx, cy) => {
  const ch = EYE[cy - 1]?.[cx - 1];
  return ch === 'D' ? [60, 40, 120, 255] : WHITE;
}));

// antialiased: 40x30 white with a dark rectangle ringed by blended grays (soft edge: 1px of 150, then 1px of 225)
png('antialiased.png', raster(40, 30, 1, 1, 0, 0, (x, y) => {
  const edge = Math.max(Math.abs(x - 19.5) - 10, Math.abs(y - 14.5) - 6);
  return edge < 0 ? [60, 40, 120, 255] : edge < 1 ? [150, 140, 170, 255] : edge < 2 ? [225, 222, 235, 255] : WHITE;
}));

// corner-touch: 8x6 at 4x; art in all four corners of the frame, on white
png('corner-touch.png', raster(32, 24, 4, 4, 0, 0, (cx, cy) => {
  const x = cx - 1, y = cy - 1;
  const corner = (x === 0 || x === 7) && (y === 0 || y === 5);
  const body = x >= 2 && x <= 5 && y >= 1 && y <= 4;
  return corner ? [200, 30, 30, 255] : body ? [30, 30, 200, 255] : WHITE;
}));

// gradient-photo: 200x200, every neighboring pixel differs
{
  const w = 200, h = 200, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    data.set([x, y, (x + y) >> 1, 255], (y * w + x) * 4);
  png('gradient-photo.png', { w, h, data });
}

// offset-grid: 3x2 upscale (sx=3, sy=2) with a 1px offset (ox=1, oy=1); 6x5 cells plus the partial lead/trail cells
png('offset-grid.png', raster(1 + 3 * 6 + 2, 1 + 2 * 5 + 1, 3, 2, 1, 1, (cx, cy) => [(cx * 40) % 256, (cy * 60) % 256, (cx * 17 + cy * 29) % 256, 255]));

// decoder fixtures: potion-like 8x8 in GIF and JPEG
{
  const w = 8, h = 8;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    px.set((x + y) % 2 ? [200, 40, 40, 255] : [40, 40, 200, 255], (y * w + x) * 4);
  const jpg = jpeg.encode({ data: px, width: w, height: h }, 95);
  writeFileSync(join(dir, 'checker.jpg'), jpg.data);

  const buf = new Uint8Array(1024);
  const gw = new GifWriter(buf as unknown as number[], w, h, { palette: [0xc82828, 0x2828c8] });
  const idx: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) idx.push((x + y) % 2 ? 0 : 1);
  gw.addFrame(0, 0, w, h, idx);
  writeFileSync(join(dir, 'checker.gif'), buf.subarray(0, gw.end()));
}
// checker.webp: 8x8 lossless checker (Node needs the encoder wasm handed over)
{
  const enc = await import('@jsquash/webp/encode.js');
  const { readFile } = await import('node:fs/promises');
  const wasm = new URL('./codec/enc/webp_enc.wasm', pathToFileURL(createRequire(import.meta.url).resolve('@jsquash/webp/encode.js')));
  await enc.init(await (globalThis as unknown as { WebAssembly: { compile(b: Uint8Array): Promise<never> } }).WebAssembly.compile(await readFile(fileURLToPath(wasm))));
  const w = 8, h = 8, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    px.set((x + y) % 2 ? [200, 40, 40, 255] : [40, 40, 200, 255], (y * w + x) * 4);
  const out = await enc.default({ data: px, width: w, height: h, colorSpace: 'srgb' } as never, { lossless: 1 });
  writeFileSync(join(dir, 'checker.webp'), new Uint8Array(out));
}
console.log('fixtures written to', dir);

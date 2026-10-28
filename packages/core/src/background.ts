import type { Img } from './image';
import type { Scale } from './scale';

/** RGB distance of black to white. A percentage tolerance is a share of this. */
const MAX_DIST = 441.7;
const OPAQUE = 128;

export type BgHow = 'corners' | 'picked' | 'none' | 'transparent';
export interface BgOptions { enabled: boolean; tolPct: number; pick?: string }
export interface BgResult { img: Img; bg: string | null; how: BgHow; cleared: number }

const toHex = (c: readonly number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const tolOf = (pct: number) => (pct / 100) * MAX_DIST;

function corners(img: Img): number[][] {
  const { width: w, height: h, data: d } = img;
  return [0, w - 1, (h - 1) * w, h * w - 1].map((i) => [d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!, d[i * 4 + 3]!]);
}

/** The color all four corners share (within tolerance), or null if a corner is transparent or they disagree. */
export function findCornerBg(img: Img, tolPct: number): [number, number, number] | null {
  const cs = corners(img);
  if (cs.some((c) => c[3]! < OPAQUE)) return null;
  const tol = Math.max(tolOf(tolPct), 1);
  const c0 = cs[0]!;
  return cs.every((c) => Math.hypot(c[0]! - c0[0]!, c[1]! - c0[1]!, c[2]! - c0[2]!) <= tol) ? [c0[0]!, c0[1]!, c0[2]!] : null;
}

/** Edge flood fill: clears only background connected to the image border, so the same color inside the art stays. Returns the count of opaque pixels cleared. */
function floodClear(d: Uint8ClampedArray, w: number, h: number, col: readonly number[], tol: number): number {
  const seen = new Uint8Array(w * h), q = new Int32Array(w * h);
  let qh = 0, qt = 0, cleared = 0;
  const ok = (i: number) => d[i * 4 + 3]! < OPAQUE || Math.hypot(d[i * 4]! - col[0]!, d[i * 4 + 1]! - col[1]!, d[i * 4 + 2]! - col[2]!) <= tol;
  const push = (i: number) => { if (!seen[i] && ok(i)) { seen[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (qh < qt) {
    const i = q[qh++]!, x = i % w;
    if (d[i * 4 + 3]! >= OPAQUE) cleared++;
    d[i * 4 + 3] = 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < (h - 1) * w) push(i + w);
  }
  return cleared;
}

/** Returns a new image; the input is not modified. */
export function removeBackground(img: Img, opts: BgOptions): BgResult {
  const out: Img = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  if (!opts.enabled) return { img: out, bg: null, how: 'none', cleared: 0 };
  const col = opts.pick ? fromHex(opts.pick) : findCornerBg(img, opts.tolPct);
  if (!col) {
    const how: BgHow = corners(img).some((c) => c[3]! < OPAQUE) ? 'transparent' : 'none';
    return { img: out, bg: null, how, cleared: 0 };
  }
  const cleared = floodClear(out.data, out.width, out.height, col, tolOf(opts.tolPct));
  return { img: out, bg: toHex(col), how: opts.pick ? 'picked' : 'corners', cleared };
}

/** True when the image has at most 64 distinct opaque colors and its longest side after dividing by the scale is at most 512 px. */
export function looksLikePixelArt(img: Img, scale: Scale): boolean {
  if (Math.max(Math.round(img.width / scale.sx), Math.round(img.height / scale.sy)) > 512) return false;
  const seen = new Set<number>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < OPAQUE) continue;
    seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    if (seen.size > 64) return false;
  }
  return true;
}

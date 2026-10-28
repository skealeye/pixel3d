import type { Img } from './image';

export interface PixelateOptions { across: number; colours: number; seed?: number }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Area-average downsample: each output cell averages the RGB it covers, weighted by alpha and covered area. Opaque when coverage is at least 50 %. */
function areaAverage(img: Img, w: number, h: number): { rgb: Float64Array; solid: Uint8Array } {
  const { width: sw, height: sh, data: d } = img;
  const rgb = new Float64Array(w * h * 3), solid = new Uint8Array(w * h);
  const kx = sw / w, ky = sh / h;
  for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) {
    const x0 = ox * kx, x1 = x0 + kx, y0 = oy * ky, y1 = y0 + ky;
    let r = 0, g = 0, b = 0, wt = 0;
    for (let y = Math.floor(y0); y < Math.min(sh, Math.ceil(y1)); y++) {
      const wy = Math.min(y + 1, y1) - Math.max(y, y0);
      for (let x = Math.floor(x0); x < Math.min(sw, Math.ceil(x1)); x++) {
        const i = (y * sw + x) * 4;
        const a = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy * (d[i + 3]! / 255);
        r += d[i]! * a; g += d[i + 1]! * a; b += d[i + 2]! * a; wt += a;
      }
    }
    const o = oy * w + ox;
    if (wt > 0 && wt / (kx * ky) >= 0.5) {
      solid[o] = 1;
      rgb[o * 3] = r / wt; rgb[o * 3 + 1] = g / wt; rgb[o * 3 + 2] = b / wt;
    }
  }
  return { rgb, solid };
}

/** k-means in RGB (k-means++ seeding, 12 iterations), so the same input and seed always give the same palette. Returns a centroid index per point. */
function kmeans(px: Float64Array, n: number, k: number, seed: number): { cent: number[][]; lab: Int32Array } {
  const rnd = mulberry32(seed);
  const p = (i: number) => [px[i * 3]!, px[i * 3 + 1]!, px[i * 3 + 2]!];
  const dist2 = (i: number, c: number[]) => (px[i * 3]! - c[0]!) ** 2 + (px[i * 3 + 1]! - c[1]!) ** 2 + (px[i * 3 + 2]! - c[2]!) ** 2;
  const cent = [p(Math.floor(rnd() * n))];
  const d2 = new Float64Array(n).fill(Infinity);
  while (cent.length < k) {
    const last = cent[cent.length - 1]!;
    let total = 0;
    for (let i = 0; i < n; i++) { d2[i] = Math.min(d2[i]!, dist2(i, last)); total += d2[i]!; }
    if (total === 0) break;
    let t = rnd() * total, i = 0;
    while (i < n - 1 && (t -= d2[i]!) > 0) i++;
    cent.push(p(i));
  }
  const lab = new Int32Array(n);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < cent.length; j++) { const dd = dist2(i, cent[j]!); if (dd < bd) { bd = dd; best = j; } }
      lab[i] = best;
    }
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const s = sum[lab[i]!]!; s[0]! += px[i * 3]!; s[1]! += px[i * 3 + 1]!; s[2]! += px[i * 3 + 2]!; s[3]!++; }
    sum.forEach((s, j) => { if (s[3]) cent[j] = [s[0]! / s[3], s[1]! / s[3], s[2]! / s[3]]; });
  }
  return { cent, lab };
}

/**
 * Shrinks to `across` pixels wide (never larger than the source, aspect kept) by area averaging, then snaps to `colours` k-means colours.
 * Remove the background at full resolution first (removeBackground) so edge pixels do not average into a pale fringe.
 */
export function pixelate(img: Img, opts: PixelateOptions): Img {
  const w = Math.max(1, Math.min(Math.round(opts.across), img.width));
  const h = Math.max(1, Math.round((w * img.height) / img.width));
  const { rgb, solid } = areaAverage(img, w, h);
  const idx: number[] = [];
  for (let i = 0; i < w * h; i++) if (solid[i]) idx.push(i);
  const out: Img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  if (!idx.length) return out;
  const px = new Float64Array(idx.length * 3);
  idx.forEach((o, i) => { px[i * 3] = rgb[o * 3]!; px[i * 3 + 1] = rgb[o * 3 + 1]!; px[i * 3 + 2] = rgb[o * 3 + 2]!; });
  const { cent, lab } = kmeans(px, idx.length, Math.max(1, Math.min(Math.round(opts.colours), idx.length)), opts.seed ?? 7);
  idx.forEach((o, i) => {
    const c = cent[lab[i]!]!;
    out.data.set([Math.round(c[0]!), Math.round(c[1]!), Math.round(c[2]!), 255], o * 4);
  });
  return out;
}

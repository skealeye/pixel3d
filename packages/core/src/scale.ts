import type { Img } from './image';

export interface Scale { sx: number; sy: number; ox: number; oy: number }

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * One axis. `len` = line length, `step` = distance between pixels along the line,
 * `lines` = number of lines, `stride` = distance between lines.
 * The first and last run of a line may be cut by the crop, so the scale is the gcd of the interior runs
 * (all runs if no line has an interior). The offset is the first run modulo the scale.
 */
function axis(d: Uint8ClampedArray, len: number, step: number, lines: number, stride: number): { s: number; o: number } {
  const same = (a: number, b: number) => d[a] === d[b] && d[a + 1] === d[b + 1] && d[a + 2] === d[b + 2] && d[a + 3] === d[b + 3];
  const runsOf = (line: number): number[] => {
    const runs: number[] = [];
    let run = 1;
    for (let i = 1; i <= len; i++) {
      if (i < len && same(line * stride + i * step, line * stride + (i - 1) * step)) run++;
      else { runs.push(run); run = 1; }
    }
    return runs;
  };
  let gInner = 0, gAll = 0;
  const all: number[][] = [];
  for (let l = 0; l < lines; l++) {
    const runs = runsOf(l);
    all.push(runs);
    for (let i = 0; i < runs.length; i++) {
      gAll = gcd(gAll, runs[i]!);
      if (i > 0 && i < runs.length - 1) gInner = gcd(gInner, runs[i]!);
    }
  }
  const s = Math.max(1, gInner || gAll);
  if (s === 1) return { s: 1, o: 0 };
  // The offset is the most common first-run remainder
  const votes = new Map<number, number>();
  for (const runs of all) {
    const r = runs[0]! % s;
    votes.set(r, (votes.get(r) ?? 0) + 1);
  }
  let o = 0, best = -1;
  for (const [r, n] of votes) if (n > best) { best = n; o = r; }
  return { s, o };
}

/** Detect an integer nearest-neighbor upscale per axis, plus the grid offset left by a crop. */
export function detectScale(img: Img): Scale {
  const { width: w, height: h, data } = img;
  const x = axis(data, w, 4, h, w * 4);
  const y = axis(data, h, w * 4, w, 4);
  return { sx: x.s, sy: y.s, ox: x.o, oy: y.o };
}

/** Sample one pixel per grid cell. Partial cells cut by the offset or the far edge are dropped. */
export function downsampleNearest(img: Img, s: Scale): Img {
  const width = Math.max(1, Math.floor((img.width - s.ox) / s.sx));
  const height = Math.max(1, Math.floor((img.height - s.oy) / s.sy));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++) {
    const sy = Math.min(img.height - 1, s.oy + j * s.sy + (s.sy >> 1));
    for (let i = 0; i < width; i++) {
      const sx = Math.min(img.width - 1, s.ox + i * s.sx + (s.sx >> 1));
      const src = (sy * img.width + sx) * 4;
      data.set(img.data.subarray(src, src + 4), (j * width + i) * 4);
    }
  }
  return { width, height, data };
}

import type { Grid } from './grid';
import type { Settings } from './settings';
import type { ManifoldToplevel } from './manifold';
import { traceLoops } from './outline';

type CrossSection = InstanceType<ManifoldToplevel['CrossSection']>;
type Keep = <T extends { delete(): void }>(o: T) => T;
type Wasm = ManifoldToplevel;

/** Segments per full turn for rounded edges: smooth to the eye at these radii, and few vertices. */
const SEG = 32;
/** The widest gap between islands that the clicker backing bridges, mm (a close of up to this radius). */
export const BRIDGE_MAX = 3;
const BRIDGE_STEP = 0.25;

/** The smoothing radius for `smooth`: half a pixel, mm. */
export const smoothRadius = (px: { x: number; y: number }) => 0.5 * Math.min(px.x, px.y);

const signedArea = (poly: readonly (readonly [number, number])[] | { length: number; [i: number]: [number, number] }) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  return a / 2;
};

/** `cs` with its interior holes filled: its outer loops only. */
export function fillHoles(wasm: Wasm, cs: CrossSection, keep: Keep): CrossSection {
  return keep(wasm.CrossSection.ofPolygons(cs.toPolygons().filter((p) => signedArea(p) > 0), 'NonZero'));
}

/** Disconnected regions of `cs`. */
export function regionCount(cs: CrossSection): number {
  const parts = cs.decompose();
  const n = parts.filter((p) => p.area() > 1e-9).length;
  for (const p of parts) p.delete();
  return n;
}

/**
 * `cs` grown by `d` mm. Pixel-shaped (`smooth` off): a miter offset, which keeps the square corners. Smooth: grown with
 * round joins by `d + r`, then shrunk by `r`, which rounds convex corners to `d` and fills each concave step with an
 * `r` fillet (a close at `r` of `cs` grown by `d`). Either way the result contains `cs` grown by `d`, so its edge is at
 * least `d` from `cs` everywhere and `cs` never overhangs it.
 */
export function grow(cs: CrossSection, d: number, smooth: boolean, r: number, keep: Keep): CrossSection {
  if (!smooth) return d > 0 ? keep(cs.offset(d, 'Miter', 2)) : cs;
  const out = keep(keep(cs.offset(d + r, 'Round', 2, SEG)).offset(-r, 'Round', 2, SEG));
  // drop near-straight vertices; far less than d, so the edge stays outside `cs`
  return keep(out.simplify(Math.min(0.01, d / 20)));
}

/**
 * Join separate islands of `cs` (holes filled) with a morphological close (grow by r, shrink by r, round joins): the
 * smallest r, in 0.25 mm steps up to `BRIDGE_MAX`, that leaves one region. `regions` is what is left after the largest
 * close (more than 1 when even that can't join them). `cs` is never cut into: the close only adds.
 */
export function bridge(wasm: Wasm, cs: CrossSection, keep: Keep): { cs: CrossSection; regions: number; r: number } {
  let best = fillHoles(wasm, cs, keep);
  let n = regionCount(best);
  if (n <= 1) return { cs: best, regions: n, r: 0 };
  for (let r = BRIDGE_STEP; r <= BRIDGE_MAX + 1e-9; r += BRIDGE_STEP) {
    const closed = keep(keep(keep(cs.offset(r, 'Round', 2, SEG)).offset(-r, 'Round', 2, SEG)).simplify(0.005));
    best = fillHoles(wasm, keep(wasm.CrossSection.union([closed, cs])), keep);
    n = regionCount(best);
    if (n <= 1) return { cs: best, regions: 1, r };
  }
  return { cs: best, regions: n, r: BRIDGE_MAX };
}

/** Cells where `pick` holds as a cross-section in mm, the opaque box corner (x0, y0) at the origin; null when none. */
export function regionMm(wasm: Wasm, g: Grid, pick: (v: number) => boolean, x0: number, y0: number, px: { x: number; y: number }, keep: Keep): CrossSection | null {
  const on = new Uint8Array(g.cells.length);
  let any = false;
  for (let k = 0; k < on.length; k++) if (pick(g.cells[k]!)) { on[k] = 1; any = true; }
  if (!any) return null;
  const cs = keep(new wasm.CrossSection(traceLoops(on, g.w, g.h), 'Positive'));
  return keep(keep(cs.translate([-x0, -y0])).scale([px.x, px.y]));
}

/** The lowest height among the colors that have pixels, mm. */
export function lowestUsed(g: Grid): number {
  const used = new Set<number>();
  for (const v of g.cells) if (v >= 0) used.add(v);
  let h = Infinity;
  used.forEach((i) => { h = Math.min(h, g.palette[i]!.height); });
  return Number.isFinite(h) ? h : 1;
}

/**
 * The flat model's 2D shapes in mm (opaque box corner at the origin), shared by `buildModel` and the web preview:
 * - `art`: the art's footprint, holes and all;
 * - `tall`: where material stands at least as tall as the lowest color (the art, and the outline ring);
 * - `base`: the base's outline: the art, rounded by `smooth`, plus the ring (the art's holes stay open);
 * - `ring`: the outline ring round the art's outer silhouette (holes filled), or null when it is off;
 * - `margin`: how far the base reaches past the art's pixel edge, mm (a keychain loop moves out by this much).
 * Every returned section belongs to `keep`.
 */
export function flatShapes(wasm: Wasm, g: Grid, s: Settings, x0: number, y0: number, px: { x: number; y: number }, keep: Keep) {
  const art = regionMm(wasm, g, (v) => v >= 0, x0, y0, px, keep)!;
  const r = smoothRadius(px);
  const ringOn = s.outline.on;
  let ring: CrossSection | null = null, ringOuter: CrossSection | null = null;
  if (ringOn) {
    const filled = fillHoles(wasm, art, keep);
    ringOuter = grow(filled, s.outline.width, s.smooth, r, keep);
    ring = keep(ringOuter.subtract(filled));
  }
  // the ring joins on outside the silhouette only: the art's own holes stay open in the base and in `tall`
  let base = s.smooth ? grow(art, r, true, r, keep) : art;
  if (ring) base = keep(wasm.CrossSection.union([base, ring]));
  const tall = ring ? keep(wasm.CrossSection.union([art, ring])) : art;
  const margin = Math.max(ringOn ? s.outline.width : 0, s.smooth && s.base.enabled ? r : 0);
  return { art, tall, base, ring, margin };
}

/** Polygons of a cross-section as plain arrays (for the preview, which builds its own meshes). */
export function polygonsOf(cs: CrossSection | null): [number, number][][] {
  return cs ? cs.toPolygons().map((p) => p.map(([x, y]) => [x, y] as [number, number])) : [];
}

/**
 * For each cell of a grid padded by `pad` cells on every side, the palette index of the nearest opaque cell (centers,
 * Euclidean, by a two-pass chamfer with the source carried along). Opaque cells are their own. `w` and `h` are the
 * padded size; cell (x, row) of `g` is (x + pad, row + pad) here.
 */
export function nearestColors(g: Grid, pad: number): { w: number; h: number; cells: Int16Array } {
  const w = g.w + 2 * pad, h = g.h + 2 * pad, n = w * h;
  const src = new Int32Array(n).fill(-1), d = new Float64Array(n).fill(Infinity);
  for (let row = 0; row < g.h; row++) for (let x = 0; x < g.w; x++) {
    if (g.cells[row * g.w + x]! < 0) continue;
    const k = (row + pad) * w + x + pad;
    src[k] = row * g.w + x;
    d[k] = 0;
  }
  const dist = (k: number, s: number) => {
    const sx = (s % g.w) + pad, sr = Math.floor(s / g.w) + pad;
    return Math.hypot((k % w) - sx, Math.floor(k / w) - sr);
  };
  const relax = (k: number, j: number) => {
    const s = src[j]!;
    if (s < 0) return;
    const dd = dist(k, s);
    if (dd < d[k]!) { d[k] = dd; src[k] = s; }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) {
      const k = r * w + x;
      if (x > 0) relax(k, k - 1);
      if (r > 0) { relax(k, k - w); if (x > 0) relax(k, k - w - 1); if (x < w - 1) relax(k, k - w + 1); }
    }
    for (let r = h - 1; r >= 0; r--) for (let x = w - 1; x >= 0; x--) {
      const k = r * w + x;
      if (x < w - 1) relax(k, k + 1);
      if (r < h - 1) { relax(k, k + w); if (x < w - 1) relax(k, k + w + 1); if (x > 0) relax(k, k + w - 1); }
    }
  }
  const cells = new Int16Array(n);
  for (let k = 0; k < n; k++) cells[k] = src[k]! < 0 ? -1 : g.cells[src[k]!]!;
  return { w, h, cells };
}

/**
 * The flat model's base and outline ring (`flatShapes`) as plain polygons in mm, opaque box corner at the origin, or
 * null when nothing is opaque. For the web preview, which extrudes them itself; `wasm` must already be loaded.
 */
export function flatOutlines(wasm: Wasm, g: Grid, s: Settings, x0: number, y0: number, px: { x: number; y: number }):
  { base: [number, number][][]; ring: [number, number][][] } {
  const trash: { delete(): void }[] = [];
  const keep: Keep = (o) => { trash.push(o); return o; };
  try {
    const sh = flatShapes(wasm, g, s, x0, y0, px, keep);
    return { base: polygonsOf(sh.base), ring: polygonsOf(sh.ring) };
  } finally {
    for (const o of trash) o.delete();
  }
}

import type { Grid } from './grid';
import type { Settings } from './settings';
import type { ManifoldToplevel } from './manifold';
import { placeRelative } from './preset';

type Manifold = InstanceType<ManifoldToplevel['Manifold']>;
type CrossSection = InstanceType<ManifoldToplevel['CrossSection']>;
type Wasm = ManifoldToplevel;

/** Pixel units to mm: `px` mm per pixel, with the opaque box corner (x0, y0) (y up, in cells) at the origin. */
export interface Frame { px: { x: number; y: number }; x0: number; y0: number }
/** A boundary edge midpoint in pixel units (v up from the grid bottom) and its outward normal. */
export interface Edge { u: number; v: number; nx: number; ny: number }
/** What one printed body is: one side, double sided, or one of two halves; `baseT` is its own base thickness. */
export interface Side { kind: 'single' | 'solid' | 'half'; baseT: number }
export interface Solid { name: string; hex: string; m: Manifold }

/** Segments for round cutters and loops: keeps a circle's area within 0.2 %. */
const SEG = 64;
/** Cutters reach this far above and below z = 0, past any model (heights are at most 20 mm per layer). */
const REACH = 100;
const TOO_THIN = 'Too thin to hollow out. Make the base thicker or the wall thinner.';
const HOLLOW_AS_SHELL = 'Double sided has no open bottom, so Hollow is built as Shell.';

const toMm = (f: Frame, u: number, v: number): [number, number] => [(u - f.x0) * f.px.x, (v - f.y0) * f.px.y];
const minTop = (g: Grid) => Math.min(...g.palette.map((p) => p.height));
/** A loop needs a hole smaller than its outside. */
const hasLoop = (s: Settings) => s.keychain.type === 'loop' && s.keychain.loop.outer > s.keychain.loop.inner;

/** Run `fn` with a scratch list; every object pushed to it is freed afterwards, the result is the caller's. */
function scratch<T>(fn: (k: <O extends { delete(): void }>(o: O) => O) => T): T {
  const bin: { delete(): void }[] = [];
  try { return fn((o) => { bin.push(o); return o; }); } finally { for (const o of bin) o.delete(); }
}

/**
 * Where the loop attaches: walk out from the opaque centroid at `deg` (0° up, clockwise) to the last
 * opaque pixel, then take the nearest outward-facing pixel edge there (as the mockup's edgeAtAngle).
 */
export function edgeAtAngle(g: Grid, deg: number): Edge {
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.cells[(g.h - 1 - y) * g.w + x]! >= 0;
  let su = 0, sv = 0, n = 0;
  const all: Edge[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!opaque(x, y)) continue;
    su += x + 0.5; sv += y + 0.5; n++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!opaque(x + dx, y + dy)) all.push({ u: x + 0.5 + dx * 0.5, v: y + 0.5 + dy * 0.5, nx: dx, ny: dy });
    }
  }
  const c = { u: su / n, v: sv / n }, a = (deg * Math.PI) / 180, d = { u: Math.sin(a), v: Math.cos(a) };
  let last = 0;
  for (let i = 0, end = Math.max(g.w, g.h) * 1.5; i * 0.05 < end; i++) {
    const t = i * 0.05;
    if (opaque(Math.floor(c.u + d.u * t), Math.floor(c.v + d.v * t))) last = t;
  }
  const q = { u: c.u + d.u * (last + 0.05), v: c.v + d.v * (last + 0.05) };
  const facing = all.filter((e) => e.nx * d.u + e.ny * d.v > 0.3);
  let best = all[0]!, bd = Infinity;
  for (const e of facing.length ? facing : all) {
    const dd = Math.hypot(e.u - q.u, e.v - q.v);
    if (dd < bd) { bd = dd; best = e; }
  }
  return best;
}

/**
 * The keychain loop, z 0..thickness, centered `R = (inner + outer) / 4` mm out from `edge`.
 * Rounded: a torus (revolved circle) squashed to the thickness. Pixel: a square frame of exactly outer / inner mm.
 */
export function loopSolid(wasm: Wasm, edge: Edge, s: Settings, thickness: number, f: Frame): Manifold {
  const { style, inner, outer } = s.keychain.loop;
  const ro = outer / 2, ri = inner / 2, R = (ro + ri) / 2, r = (ro - ri) / 2;
  const [ex, ey] = toMm(f, edge.u, edge.v);
  const cx = ex + edge.nx * R, cy = ey + edge.ny * R;
  return scratch((k) => {
    if (style === 'pixel') {
      const frame = k(k(wasm.CrossSection.square([2 * ro, 2 * ro], true)).subtract(k(wasm.CrossSection.square([2 * ri, 2 * ri], true))));
      return k(frame.extrude(thickness)).translate([cx, cy, 0]);
    }
    const torus = k(k(k(wasm.CrossSection.circle(r, SEG)).translate([R, 0])).revolve(SEG));
    return k(torus.scale([1, 1, thickness / (2 * r)])).translate([cx, cy, thickness / 2]);
  });
}

/** The hole's footprint in mm, or null when the keychain is not a hole. */
function holeShape(wasm: Wasm, g: Grid, s: Settings, f: Frame): CrossSection | null {
  if (s.keychain.type !== 'hole') return null;
  const { style, size, at } = s.keychain.hole;
  const p = placeRelative(at, g);
  return scratch((k) => {
    const cs = k(style === 'round' ? wasm.CrossSection.circle(size / 2, SEG) : wasm.CrossSection.square([size, size], true));
    return cs.translate(toMm(f, p.u, p.v));
  });
}

/** The keychain hole as a prism through every layer (all z), or null when the keychain is not a hole. */
export function holeCutter(wasm: Wasm, g: Grid, s: Settings, f: Frame): Manifold | null {
  return scratch((k) => {
    const cs = holeShape(wasm, g, s, f);
    return cs ? k(k(cs).extrude(2 * REACH)).translate([0, 0, -REACH]) : null;
  });
}

const MAGNETS = { '8x3': { d: 8, h: 3 }, '6x2': { d: 6, h: 2 }, '10x3': { d: 10, h: 3 } } as const;
const magnetSize = (s: Settings) => (typeof s.magnets.size === 'string' ? MAGNETS[s.magnets.size] : s.magnets.size);

/** Each magnet's disc footprint in mm. */
function magnetShapes(wasm: Wasm, g: Grid, s: Settings, f: Frame): CrossSection[] {
  const { d } = magnetSize(s);
  return s.magnets.at.map((a) => {
    const p = placeRelative(a, g);
    return scratch((k) => k(wasm.CrossSection.circle(d / 2, SEG)).translate(toMm(f, p.u, p.v)));
  });
}

/**
 * Magnet pockets for one body. Bottom: open on the bed (z = 0). Sealed (single 'center', and always for double
 * sided): centered in the base, with `pauseZ` the top of the pocket. Halves: open on each half's glue face (z = 0).
 * `warning` when the material there is under h + 0.6 mm (open) or h + 1.2 mm (sealed).
 */
export function magnetCutters(wasm: Wasm, g: Grid, s: Settings, f: Frame, side: Side): { cutters: Manifold[]; pauseZ: number | null; warning: string | null } {
  if (!s.magnets.at.length) return { cutters: [], pauseZ: null, warning: null };
  const { d, h } = magnetSize(s);
  const sealed = side.kind === 'solid' || (side.kind === 'single' && s.magnets.position === 'centre');
  const z0 = !sealed ? -1 : side.kind === 'solid' ? (side.baseT - h) / 2 : Math.max(0, (side.baseT - h) / 2);
  const z1 = sealed ? z0 + h : h;
  const cutters = magnetShapes(wasm, g, s, f).map((cs) => scratch((k) => k(k(cs).extrude(z1 - z0)).translate([0, 0, z0])));
  const have = side.kind === 'half' ? side.baseT + minTop(g) : side.baseT;
  const need = h + (sealed ? 1.2 : 0.6);
  const warning = have < need - 1e-9
    ? `A ${d} × ${h} mm magnet needs about ${need.toFixed(1)} mm here. Make the base thicker or pick a smaller magnet.`
    : null;
  // a sealed pocket clamped onto the bed (base thinner than the magnet) is open, so there is nothing to pause for
  return { cutters, pauseZ: sealed && z0 > 0 ? z1 : null, warning };
}

/**
 * The Inside cavity: the outline (pixel units) less the hole and magnet footprints, eroded by the wall.
 * Shell keeps a floor of `wall`; hollow opens the bottom; the top is the lowest color top less `wall`.
 * Halves stay solid; double sided builds hollow as shell. Too thin gives a warning and no cavity.
 */
export function insideCutter(wasm: Wasm, g: Grid, s: Settings, f: Frame, outline: CrossSection, side: Side): { cutter: Manifold | null; warnings: string[] } {
  let mode = s.inside.mode;
  if (mode === 'solid' || side.kind === 'half') return { cutter: null, warnings: [] };
  const warnings: string[] = [];
  if (side.kind === 'solid' && mode === 'hollow') { mode = 'shell'; warnings.push(HOLLOW_AS_SHELL); }
  const w = s.inside.wall, low = minTop(g);
  const under = s.sides.heightsOn === 'both' ? low : s.heights.h;
  const top = side.baseT + low - w;
  const bottom = side.kind === 'solid' ? -under + w : mode === 'shell' ? w : -1;
  return scratch((k) => {
    let area = k(k(outline.translate([-f.x0, -f.y0])).scale([f.px.x, f.px.y]));
    const holes = [holeShape(wasm, g, s, f), ...magnetShapes(wasm, g, s, f)].filter((c): c is CrossSection => c !== null).map(k);
    if (holes.length) area = k(area.subtract(k(wasm.CrossSection.union(holes))));
    area = k(area.offset(-w, 'Miter'));
    if (top - Math.max(bottom, 0) < 0.4 || area.isEmpty()) return { cutter: null, warnings: [...warnings, TOO_THIN] };
    return { cutter: k(area.extrude(top - bottom)).translate([0, 0, bottom]), warnings };
  });
}

type Keep = <O extends { delete(): void }>(o: O) => O;

/** The outline (pixel units) in mm. The caller owns the result. */
const outlineMm = (outline: CrossSection, f: Frame): CrossSection =>
  scratch((k) => k(outline.translate([-f.x0, -f.y0])).scale([f.px.x, f.px.y]));

/** The loop for one body: as thick as its base, else the lowest color (halved for halves). The caller owns it. */
const bodyLoop = (wasm: Wasm, g: Grid, s: Settings, f: Frame, side: Side, hasBase: boolean): Manifold =>
  loopSolid(wasm, edgeAtAngle(g, s.keychain.loop.angle), s, hasBase ? side.baseT : minTop(g) * (side.kind === 'half' ? 0.5 : 1), f);

/**
 * Join the keychain loop to one body's solids (unmirrored): into the base, or, with no base, as its own
 * 'loop' part in the loop color that meets the outline flush.
 */
export function addLoop(wasm: Wasm, g: Grid, s: Settings, f: Frame, outline: CrossSection, solids: Solid[], side: Side, keep: Keep): Solid[] {
  if (!hasLoop(s)) return solids;
  const base = solids.find((x) => x.name === 'base');
  const loop = keep(bodyLoop(wasm, g, s, f, side, !!base));
  if (base) return solids.map((x) => (x === base ? { ...x, m: keep(x.m.add(loop)) } : x));
  const prism = keep(keep(keep(outlineMm(outline, f)).extrude(2 * REACH)).translate([0, 0, -REACH]));
  return [...solids, { name: 'loop', hex: s.keychain.loop.colour, m: keep(loop.subtract(prism)) }];
}

/**
 * Cut the hole, magnet pockets and Inside cavity from one body's solids. Cutters are built unmirrored and
 * moved with `place` (the back half's mirror). Parts cut away entirely are dropped. `pause` is a sealed
 * pocket, placed, for the caller to turn into a pause height after rotation. `pieces` is null when neither
 * a loop nor a cut changed the body (its pieces are then the art's).
 */
export function cutBody(wasm: Wasm, g: Grid, s: Settings, f: Frame, outline: CrossSection, solids: Solid[], side: Side,
  place: (m: Manifold) => Manifold, keep: Keep): { solids: Solid[]; warnings: string[]; pause: Manifold | null; pieces: number | null } {
  const mags = magnetCutters(wasm, g, s, f, side);
  const inside = insideCutter(wasm, g, s, f, outline, side);
  const cutters = [holeCutter(wasm, g, s, f), ...mags.cutters, inside.cutter].filter((c): c is Manifold => c !== null).map(keep);
  const warnings = [...(mags.warning ? [mags.warning] : []), ...inside.warnings];
  const placed = cutters.map(place);
  const pieces = cutters.length || hasLoop(s) ? bodyPieces(wasm, g, s, f, outline, solids, side, placed, place) : null;
  if (!cutters.length) return { solids, warnings, pause: null, pieces };
  const all = keep(wasm.Manifold.union(placed));
  const cut = solids.map((x) => ({ ...x, m: keep(x.m.subtract(all)) })).filter((x) => !x.m.isEmpty());
  return { solids: cut, warnings, pause: mags.pauseZ !== null ? place(mags.cutters[0]!) : null, pieces };
}

/**
 * Disconnected pieces of one body after its loop and cuts. `solids` (uncut) and `cutters` are placed; `place`
 * moves unmirrored geometry the same way. A 3D union of every color layer takes seconds on busy art, so this
 * counts a stand-in: the outline through the body's thinnest stack, plus the loop. Where a cutter reaches past
 * that stack (a pocket at least as deep as base + lowest color), the stand-in has no material left there, so
 * each color's own geometry inside the cutter's footprint is added back: a taller color island standing over
 * the pocket then shows as its own piece. Each cutter is then subtracted. It can still over-count where a pocket
 * severs the thinnest stack but taller colors bridge it. A sealed void is its own negative-volume component and
 * is not counted.
 */
function bodyPieces(wasm: Wasm, g: Grid, s: Settings, f: Frame, outline: CrossSection, solids: Solid[], side: Side,
  cutters: Manifold[], place: (m: Manifold) => Manifold): number {
  return scratch((k) => {
    let lo = -Infinity, hi = Infinity, zMin = Infinity, zMax = -Infinity;
    const colours = solids.filter((x) => x.name !== 'base' && x.name !== 'loop');
    for (const x of solids) {
      const b = x.m.boundingBox();
      zMin = Math.min(zMin, b.min[2]!); zMax = Math.max(zMax, b.max[2]!);
      if (colours.includes(x)) { lo = Math.max(lo, b.min[2]!); hi = Math.min(hi, b.max[2]!); }
    }
    lo = Math.min(lo, 0); hi = Math.max(hi, side.baseT);
    let proxy = k(k(k(outlineMm(outline, f)).extrude(hi - lo)).translate([0, 0, lo]));
    if (hasLoop(s)) proxy = k(proxy.add(k(bodyLoop(wasm, g, s, f, side, solids.some((x) => x.name === 'base')))));
    let body = place(proxy); // for the front this is `proxy` itself, which `k` already frees
    for (const c of cutters) {
      const b = c.boundingBox();
      const through = b.max[2]! >= hi - 1e-9 || b.min[2]! <= lo + 1e-9;
      if (!through || (b.max[2]! >= zMax && b.min[2]! <= zMin)) continue; // the hole removes everything in its footprint
      const column = k(k(k(c.project()).extrude(zMax - zMin + 2)).translate([0, 0, zMin - 1]));
      for (const x of colours) body = k(body.add(k(x.m.intersect(column))));
    }
    for (const c of cutters) body = k(body.subtract(c));
    return body.decompose().map(k).filter((c) => c.volume() > 0).length;
  });
}

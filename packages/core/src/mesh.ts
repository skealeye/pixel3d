import type { Grid } from './grid';
import type { Settings } from './settings';
import { initManifold } from './manifold';
import type { ManifoldToplevel } from './manifold';
import { traceLoops } from './outline';
import { addLoop, cutBody } from './features';
import type { Frame, Side, Solid } from './features';
import { pieces } from './pieces';
import { buildClicker } from './clicker';

type Manifold = InstanceType<ManifoldToplevel['Manifold']>;
type CrossSection = InstanceType<ManifoldToplevel['CrossSection']>;

export interface Part {
  name: string;
  hex: string;
  /** Printed object: one file / 3MF object each. `stem` and `socket_<gap>` are the clicker fit-test coupons. */
  object: 'main' | 'front' | 'back' | 'cap' | 'body' | 'stem' | `socket_${string}`;
  mesh: { vertProperties: Float32Array; triVerts: Uint32Array };
}

export interface Model {
  parts: Part[];
  /** Overall bounding box, mm. */
  size: { x: number; y: number; z: number };
  /**
   * The uncut solids' box where the parts are placed (rotated, min Z on the bed), mm. The hole, pockets and cavity
   * never change it, so a viewer that places the model by it never sees the model move when a cut does.
   */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Disconnected pieces of the printed result (the most in any one body), after the hole and other cuts. */
  pieces: number;
  /** Filled by later stages (booleans, checks). */
  warnings: string[];
  /** Filament-change heights, mm; filled by later stages. */
  pauseZ: number[];
  /**
   * Clicker only: how to assemble the as-printed parts. Move every `cap` part by (capShift, restZ) to seat it on the
   * switch at rest in the body's frame, or by (capShift, pressedZ) fully pressed. `rimZ` is the body's rim height.
   */
  clicker?: { capShift: [number, number]; restZ: number; pressedZ: number; rimZ: number };
}

/** Gap between the two halves, mm. */
const HALVES_GAP = 8;

/** Opaque bounding box in y-up cell coordinates, or null when nothing is opaque. */
export function opaqueBox(g: Grid) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < g.cells.length; k++) {
    if (g.cells[k]! < 0) continue;
    const x = k % g.w, y = g.h - 1 - (k - x) / g.w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 > x1 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** mm per pixel: explicit `pixelMm`, else the requested size over the opaque bounding box (R1). */
export function pixelSize(s: Settings, box: { w: number; h: number }) {
  if (s.pixelMm) return s.pixelMm;
  const x = s.size.width / box.w;
  return { x, y: s.size.keepAspect ? x : s.size.height / box.h };
}

/**
 * Turn a palette grid into watertight solids, one part per color plus the base, in mm.
 * Model +Y is up in the image, +Z is up off the bed. The keychain, magnets and Inside cavity (features.ts)
 * are applied before rotation; size and placement come from the solids before any cut, so cuts never move the model.
 */
export async function buildModel(g: Grid, s: Settings): Promise<Model> {
  if (s.make === 'clicker') return buildClicker(g, s);
  const wasm = await initManifold();
  const box = opaqueBox(g);
  if (!box) return { parts: [], size: { x: 0, y: 0, z: 0 }, bounds: { min: [0, 0, 0], max: [0, 0, 0] }, pieces: 0, warnings: [], pauseZ: [] };
  const px = pixelSize(s, box);
  const frame: Frame = { px, x0: box.x0, y0: box.y0 };

  // every wasm object made here is freed before returning
  const trash: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(o: T): T => { trash.push(o); return o; };
  try {
    // one cross-section per region, in pixel units: the whole outline, then each color's cells
    const region = (pick: (v: number) => boolean): CrossSection | null => {
      const on = new Uint8Array(g.cells.length);
      let any = false;
      for (let k = 0; k < on.length; k++) if (pick(g.cells[k]!)) { on[k] = 1; any = true; }
      return any ? keep(new wasm.CrossSection(traceLoops(on, g.w, g.h), 'Positive')) : null;
    };
    const outline = region((v) => v >= 0)!;
    const colours = g.palette.map((_, i) => region((v) => v === i));

    // a slab of `cs` from z0 to z0 + h, in mm with the opaque box at the origin
    const slab = (cs: CrossSection, z0: number, h: number): Manifold =>
      keep(keep(keep(cs.extrude(h)).translate([-box.x0, -box.y0, z0])).scale([px.x, px.y, 1]));

    const uniform = s.heights.h;
    // one side's layers: base 0..bt, each color bt..bt + h (and, double sided, -h'..0 underneath)
    const layers = (bt: number, vary: boolean, under: false | 'vary' | 'uniform'): Solid[] => {
      const out: Solid[] = [];
      if (s.base.enabled) out.push({ name: 'base', hex: s.base.colour, m: slab(outline, 0, bt) });
      g.palette.forEach((p, i) => {
        const cs = colours[i];
        if (!cs) return;
        let m = slab(cs, bt, vary ? p.height : uniform);
        if (under) {
          const hu = under === 'vary' ? p.height : uniform;
          m = keep(wasm.Manifold.compose([m, slab(cs, -hu, hu)]));
        }
        out.push({ name: p.hex, hex: p.hex, m });
      });
      return out;
    };
    // one body's layers with the keychain loop joined on (before any mirroring)
    const body = (side: Side, vary: boolean, under: false | 'vary' | 'uniform') =>
      addLoop(wasm, g, s, frame, outline, layers(side.baseT, vary, under), side, keep);

    const baseT = s.base.enabled ? s.base.height : 0;
    const top = s.sides.heightsOn === 'both';
    const same = (m: Manifold) => m;
    let objects: { object: Part['object']; side: Side; solids: Solid[]; place: (m: Manifold) => Manifold }[];
    if (s.sides.mode === 'single') {
      const side: Side = { kind: 'single', baseT };
      objects = [{ object: 'main', side, solids: body(side, true, false), place: same }];
    } else if (s.sides.mode === 'solid') {
      const side: Side = { kind: 'solid', baseT };
      objects = [{ object: 'main', side, solids: body(side, true, top ? 'vary' : 'uniform'), place: same }];
    } else {
      // two halves: each a single-sided model on half the base; the back mirrored in X, 8 mm beyond the front
      const side: Side = { kind: 'half', baseT: baseT / 2 };
      const front = body(side, true, false);
      const shift = 2 * bounds(front.map((x) => x.m)).max[0]! + HALVES_GAP;
      const mirror = (m: Manifold) => keep(keep(m.mirror([1, 0, 0])).translate([shift, 0, 0]));
      const back = body(side, top, false).map((b) => ({ ...b, m: mirror(b.m) }));
      objects = [{ object: 'front', side, solids: front, place: same }, { object: 'back', side, solids: back, place: mirror }];
    }

    // size and placement from the uncut solids, so the hole, pockets and cavity never move the model
    const bb = bounds(objects.flatMap((o) => o.solids.map((x) => x.m)));
    const warnings = new Set<string>();
    const pauses: Manifold[] = [];
    let pieceCount: number | null = null;
    for (const o of objects) {
      const r = cutBody(wasm, g, s, frame, outline, o.solids, o.side, o.place, keep);
      o.solids = r.solids;
      r.warnings.forEach((w) => warnings.add(w));
      if (r.pause) pauses.push(r.pause);
      if (r.pieces !== null) pieceCount = Math.max(pieceCount ?? 0, r.pieces);
    }

    // rotation last, about the model center (quarter turns X, then Y, then Z); then seat min Z on the bed
    const c = [0, 1, 2].map((a) => (bb.min[a]! + bb.max[a]!) / 2) as [number, number, number];
    const [rx, ry, rz] = s.rotation;
    const turn = (m: Manifold) => keep(keep(keep(m.translate([-c[0], -c[1], -c[2]])).rotate([rx * 90, ry * 90, rz * 90])).translate(c));
    const extent = bb.max.map((v, a) => v - bb.min[a]!) as [number, number, number];
    const rb = turn(keep(keep(wasm.Manifold.cube(extent)).translate(bb.min as [number, number, number]))).boundingBox();
    const placeOnBed = (m: Manifold) => keep(turn(m).translate([0, 0, -rb.min[2]!]));

    const parts: Part[] = [];
    for (const o of objects) {
      const placed = o.solids.map((x) => placeOnBed(x.m));
      o.solids.forEach((x, i) => {
        const mesh = placed[i]!.getMesh();
        parts.push({ name: x.name, hex: x.hex, object: o.object, mesh: { vertProperties: mesh.vertProperties, triVerts: mesh.triVerts } });
      });
    }
    // a sealed pocket's closing layer, only while the pocket still stands upright after rotation
    const pauseZ = new Set<number>();
    for (const p of pauses) {
      const before = p.boundingBox(), after = placeOnBed(p).boundingBox();
      if (Math.abs((after.max[2]! - after.min[2]!) - (before.max[2]! - before.min[2]!)) < 1e-6) pauseZ.add(Math.round(after.max[2]! * 1e4) / 1e4);
    }
    return {
      parts,
      size: { x: rb.max[0]! - rb.min[0]!, y: rb.max[1]! - rb.min[1]!, z: rb.max[2]! - rb.min[2]! },
      bounds: { min: [rb.min[0]!, rb.min[1]!, 0], max: [rb.max[0]!, rb.max[1]!, rb.max[2]! - rb.min[2]!] },
      // untouched layers follow the art exactly, so its 4-connected pieces count them
      pieces: pieceCount ?? pieces(g).length,
      warnings: [...warnings],
      pauseZ: [...pauseZ].sort((a, b) => a - b),
    };
  } finally {
    for (const o of trash) o.delete();
  }
}

export function bounds(ms: Manifold[]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of ms) {
    const b = m.boundingBox();
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, b.min[a]!); max[a] = Math.max(max[a]!, b.max[a]!); }
  }
  return { min, max };
}

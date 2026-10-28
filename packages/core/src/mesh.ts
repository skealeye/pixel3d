import type { Grid } from './grid';
import type { Settings } from './settings';
import { initManifold } from './manifold';
import type { ManifoldToplevel } from './manifold';
import { traceLoops } from './outline';
import { pieces } from './pieces';

type Manifold = InstanceType<ManifoldToplevel['Manifold']>;
type CrossSection = InstanceType<ManifoldToplevel['CrossSection']>;

export interface Part {
  name: string;
  hex: string;
  object: 'main' | 'front' | 'back' | 'cap' | 'body';
  mesh: { vertProperties: Float32Array; triVerts: Uint32Array };
}

export interface Model {
  parts: Part[];
  /** Overall bounding box, mm. */
  size: { x: number; y: number; z: number };
  /** 4-connected pieces of the art. */
  pieces: number;
  /** Filled by later stages (booleans, checks). */
  warnings: string[];
  /** Filament-change heights, mm; filled by later stages. */
  pauseZ: number[];
}

/** Gap between the two halves, mm. */
const HALVES_GAP = 8;

/** Opaque bounding box in y-up cell coordinates, or null when nothing is opaque. */
function opaqueBox(g: Grid) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < g.cells.length; k++) {
    if (g.cells[k]! < 0) continue;
    const x = k % g.w, y = g.h - 1 - (k - x) / g.w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 > x1 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** mm per pixel: explicit `pixelMm`, else the requested size over the opaque bounding box (R1). */
function pixelSize(s: Settings, box: { w: number; h: number }) {
  if (s.pixelMm) return s.pixelMm;
  const x = s.size.width / box.w;
  return { x, y: s.size.keepAspect ? x : s.size.height / box.h };
}

/**
 * Turn a palette grid into watertight solids, one part per colour plus the base, in mm.
 * Model +Y is up in the image, +Z is up off the bed. No booleans happen here (Task 6 adds them).
 */
export async function buildModel(g: Grid, s: Settings): Promise<Model> {
  const wasm = await initManifold();
  const box = opaqueBox(g);
  if (!box) return { parts: [], size: { x: 0, y: 0, z: 0 }, pieces: 0, warnings: [], pauseZ: [] };
  const px = pixelSize(s, box);

  // every wasm object made here is freed before returning
  const trash: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(o: T): T => { trash.push(o); return o; };
  try {
    // one cross-section per region, in pixel units: the whole outline, then each colour's cells
    const region = (pick: (v: number) => boolean): CrossSection | null => {
      const on = new Uint8Array(g.cells.length);
      let any = false;
      for (let k = 0; k < on.length; k++) if (pick(g.cells[k]!)) { on[k] = 1; any = true; }
      return any ? keep(new wasm.CrossSection(traceLoops(on, g.w, g.h), 'Positive')) : null;
    };
    const outline = region((v) => v >= 0);
    const colours = g.palette.map((_, i) => region((v) => v === i));

    // a slab of `cs` from z0 to z0 + h, in mm with the opaque box at the origin
    const slab = (cs: CrossSection, z0: number, h: number): Manifold =>
      keep(keep(keep(cs.extrude(h)).translate([-box.x0, -box.y0, z0])).scale([px.x, px.y, 1]));

    type Solid = { name: string; hex: string; m: Manifold };
    const uniform = s.heights.h;
    // one side's layers: base 0..bt, each colour bt..bt + h (and, double sided, -h'..0 underneath)
    const side = (bt: number, vary: boolean, under: false | 'vary' | 'uniform'): Solid[] => {
      const out: Solid[] = [];
      if (s.base.enabled && outline) out.push({ name: 'base', hex: s.base.colour, m: slab(outline, 0, bt) });
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

    const baseT = s.base.enabled ? s.base.height : 0;
    const top = s.sides.heightsOn === 'both';
    let objects: { object: Part['object']; solids: Solid[] }[];
    if (s.sides.mode === 'single') objects = [{ object: 'main', solids: side(baseT, true, false) }];
    else if (s.sides.mode === 'solid') objects = [{ object: 'main', solids: side(baseT, true, top ? 'vary' : 'uniform') }];
    else {
      // two halves: each a single-sided model on half the base; the back mirrored in X beyond the front
      const front = side(baseT / 2, true, false);
      const shift = 2 * box.w * px.x + HALVES_GAP;
      const back = side(baseT / 2, top, false).map((b) => ({ ...b, m: keep(keep(b.m.mirror([1, 0, 0])).translate([shift, 0, 0])) }));
      objects = [{ object: 'front', solids: front }, { object: 'back', solids: back }];
    }

    // rotation last, about the model centre (quarter turns X, then Y, then Z); then seat min Z on the bed
    const all = objects.flatMap((o) => o.solids);
    const bb = bounds(all.map((x) => x.m));
    const c = [0, 1, 2].map((a) => (bb.min[a]! + bb.max[a]!) / 2) as [number, number, number];
    const [rx, ry, rz] = s.rotation;
    const turned = all.map((x) => keep(keep(keep(x.m.translate([-c[0], -c[1], -c[2]])).rotate([rx * 90, ry * 90, rz * 90])).translate(c)));
    const rb = bounds(turned);
    const placed = turned.map((m) => keep(m.translate([0, 0, -rb.min[2]!])));

    const parts: Part[] = [];
    let i = 0;
    for (const o of objects) {
      for (const x of o.solids) {
        const mesh = placed[i++]!.getMesh();
        parts.push({ name: x.name, hex: x.hex, object: o.object, mesh: { vertProperties: mesh.vertProperties, triVerts: mesh.triVerts } });
      }
    }
    return {
      parts,
      size: { x: rb.max[0]! - rb.min[0]!, y: rb.max[1]! - rb.min[1]!, z: rb.max[2]! - rb.min[2]! },
      pieces: pieces(g).length,
      warnings: [],
      pauseZ: [],
    };
  } finally {
    for (const o of trash) o.delete();
  }
}

function bounds(ms: Manifold[]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of ms) {
    const b = m.boundingBox();
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, b.min[a]!); max[a] = Math.max(max[a]!, b.max[a]!); }
  }
  return { min, max };
}

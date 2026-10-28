import type { Grid } from './grid';
import type { Settings } from './settings';
import { initManifold } from './manifold';
import type { ManifoldToplevel } from './manifold';
import { traceLoops } from './outline';
import { bounds, opaqueBox, pixelSize } from './mesh';
import type { Model, Part } from './mesh';

type Manifold = InstanceType<ManifoldToplevel['Manifold']>;
type CrossSection = InstanceType<ManifoldToplevel['CrossSection']>;

/**
 * Nominal Cherry MX numbers (spec §4.6b), mm.
 *
 * Checked against the Cherry MX1A switch datasheet values as quoted by the ai03 keyboard design wiki
 * ("Switch Dimensions and Physical Specifications", wiki.ai03.com/books/case-and-plate-design): plate cutout
 * 14.0 x 14.0 (datasheet 14 +/-0.05, corners r <= 0.3), plate thickness 1.5 +/-0.1, key pitch 19.05 (0.75 in),
 * plate top to PCB top 5.0. The rest are the well-known MX datasheet / keycap figures: 11.6 above the plate top
 * (stem tip at rest), 5.0 housing + 3.3 pins below the plate (8.3, so 8.5 of clearance), total travel 4.0
 * (actuation 2.0), keycap stem 5.5 round with a + socket 4.1 x 1.3 (the switch's cross is about 4.0 x 1.17,
 * so this socket carries the clearance), engagement about 3.6-4.0 deep.
 * These are nominal: the fit-test export (`fitTest`) lets the user tune them on their own printer.
 */
export const MX = {
  /** Square plate cutout the switch clips into. */
  cut: 14,
  /** Square clearance column for the switch housing, above and below the plate. */
  column: 15.6,
  /** Plate thickness the clips grip. */
  plate: 1.5,
  /** Clearance below the plate for the housing and pins. */
  below: 8.5,
  /** Body floor under the clearance. */
  floor: 1.2,
  /** Switch stem tip above the plate top, at rest. */
  above: 11.6,
  /** Cap stem diameter. */
  stemD: 5.5,
  /** Cross socket arms, long x wide. */
  cross: [4.1, 1.3] as [number, number],
  /** Cross socket depth (how far the switch stem goes into the cap stem). */
  engage: 3.8,
  /** Cap stem and skirt length below the cap backing. */
  stemLen: 4.5,
  /** Full key travel. */
  travel: 4,
  /** Keyboard key pitch, for 2-3 switches. */
  pitch: 19.05,
};

/** Gap between the cap and the body as printed, mm. */
const APART = 8;
/** Narrowest skirt wall, mm (a pixel wide when pixels are bigger). */
const SKIRT_MIN = 1.2;
const SEGMENTS = 64;

/**
 * Heights in the body's frame (Z 0 = its underside on the bed) for a cap whose backing is `capT` thick,
 * with the cap seated on the switch at rest.
 */
export function clickerLevels(s: Settings, capT: number) {
  const plateBottom = MX.floor + MX.below;
  const plateTop = plateBottom + MX.plate;
  const stemTop = plateTop + MX.above;
  /** The cap's backing underside, assembled at rest: the switch stem fills the socket. */
  const capUnder = stemTop - MX.engage + MX.stemLen;
  /** Room for the stems and skirt to travel the full 4 mm. */
  const wellFloor = capUnder - MX.stemLen - MX.travel;
  /** The cap's backing stands `capHeight` above the rim at rest. */
  const rimTop = capUnder + capT - s.clicker.capHeight;
  return { plateBottom, plateTop, stemTop, capUnder, wellFloor, rimTop };
}

/** Switch centres in the art's mm frame: one in the middle, or 2-3 at keyboard pitch along the long side. */
function switchSpots(w: number, h: number, n: number): [number, number][] {
  const long = w >= h;
  return Array.from({ length: n }, (_, i) => {
    const o = (i - (n - 1) / 2) * MX.pitch;
    return long ? [w / 2 + o, h / 2] : [w / 2, h / 2 + o];
  });
}

const warningsOf = (w: number, h: number, n: number): string[] => {
  const out: string[] = [];
  const min = MX.column + 2;
  if (Math.min(w, h) < min) out.push(`The art is smaller than the switch. Make it at least ${min} mm across so the cap covers it.`);
  const need = Math.round(((n - 1) * MX.pitch + min) * 10) / 10;
  if (n > 1 && Math.max(w, h) < need) out.push(`${n} switches need art at least ${need} mm along its long side.`);
  return out;
};

/** Pieces of a union of solids. */
function countPieces(wasm: ManifoldToplevel, ms: Manifold[]): number {
  const u = wasm.Manifold.union(ms);
  const parts = u.decompose();
  const n = parts.length;
  for (const p of parts) p.delete();
  u.delete();
  return n;
}

function toModel(objects: { object: Part['object']; solids: { name: string; hex: string; m: Manifold }[] }[], pieces: number, warnings: string[]): Model {
  const bb = bounds(objects.flatMap((o) => o.solids.map((x) => x.m)));
  const parts: Part[] = [];
  for (const o of objects) for (const x of o.solids) {
    const mesh = x.m.getMesh();
    parts.push({ name: x.name, hex: x.hex, object: o.object, mesh: { vertProperties: mesh.vertProperties, triVerts: mesh.triVerts } });
  }
  return {
    parts,
    size: { x: bb.max[0]! - bb.min[0]!, y: bb.max[1]! - bb.min[1]!, z: bb.max[2]! - bb.min[2]! },
    bounds: { min: [bb.min[0]!, bb.min[1]!, bb.min[2]!], max: [bb.max[0]!, bb.max[1]!, bb.max[2]!] },
    pieces,
    warnings,
    pauseZ: [],
  };
}

/** A cap stem, `z0` to `z0 + stemLen`, at (x, y), with the cross socket open at the bottom (`down`) or top. */
function stem(wasm: ManifoldToplevel, x: number, y: number, z0: number, down: boolean, keep: <T extends { delete(): void }>(o: T) => T): Manifold {
  const { Manifold, CrossSection } = wasm;
  const [a, b] = MX.cross;
  const body = keep(keep(Manifold.cylinder(MX.stemLen, MX.stemD / 2, MX.stemD / 2, SEGMENTS)).translate([x, y, z0]));
  const plus = keep(CrossSection.union([keep(CrossSection.square([a, b], true)), keep(CrossSection.square([b, a], true))]));
  // the socket pokes 0.1 out of the open end so the cut never leaves a skin
  const sz = down ? z0 - 0.1 : z0 + MX.stemLen - MX.engage;
  const socket = keep(keep(plus.extrude(MX.engage + 0.1)).translate([x, y, sz]));
  return keep(body.subtract(socket));
}

/**
 * The keycap clicker of spec §4.6b: a `cap` (the art on its backing, standing on one stem per switch and a skirt)
 * and a `body` (the footprint with a well shaped like the cap plus the fit gap, and an MX socket per switch).
 * Both are laid out as printed: the body on the bed, the cap art side up beside it on +X.
 * Keychain, magnets, sides, inside and rotation are not used on a clicker.
 */
export async function buildClicker(g: Grid, s: Settings): Promise<Model> {
  const wasm = await initManifold();
  const { Manifold, CrossSection } = wasm;
  const box = opaqueBox(g);
  if (!box) return { parts: [], size: { x: 0, y: 0, z: 0 }, bounds: { min: [0, 0, 0], max: [0, 0, 0] }, pieces: 0, warnings: [], pauseZ: [] };
  const px = pixelSize(s, box);
  const W = box.w * px.x, H = box.h * px.y;
  const c = s.clicker;

  const trash: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(o: T): T => { trash.push(o); return o; };
  try {
    // regions as cross-sections in mm, the opaque box at the origin
    const region = (pick: (v: number) => boolean): CrossSection | null => {
      const on = new Uint8Array(g.cells.length);
      let any = false;
      for (let k = 0; k < on.length; k++) if (pick(g.cells[k]!)) { on[k] = 1; any = true; }
      if (!any) return null;
      const cs = keep(new CrossSection(traceLoops(on, g.w, g.h), 'Positive'));
      return keep(keep(cs.translate([-box.x0, -box.y0])).scale([px.x, px.y]));
    };
    const outline = region((v) => v >= 0)!;
    const colours = g.palette.map((_, i) => region((v) => v === i));
    const spots = switchSpots(W, H, c.switches);

    // ---- cap, in its own frame: stems and skirt 0..stemLen, the backing and art above
    const bt = s.base.enabled ? s.base.height : 0;
    const used = g.palette.filter((_, i) => colours[i]);
    const capT = bt > 0 ? bt : Math.min(...used.map((p) => p.height));
    const z0 = MX.stemLen;
    const capSolids: { name: string; hex: string; m: Manifold }[] = [];
    const skirtW = Math.max(SKIRT_MIN, Math.min(px.x, px.y));
    const clear = MX.column + 2;
    let skirtCs = keep(outline.subtract(keep(outline.offset(-skirtW, 'Miter'))));
    for (const [x, y] of spots) skirtCs = keep(skirtCs.subtract(keep(keep(CrossSection.square([clear, clear], true)).translate([x, y]))));
    // small art can leave no skirt at all; an empty extrusion would void the union
    const under = spots.map(([x, y]) => stem(wasm, x, y, 0, true, keep));
    if (skirtCs.area() > 1e-6) under.push(keep(skirtCs.extrude(MX.stemLen)));
    if (s.base.enabled) under.push(keep(keep(outline.extrude(bt)).translate([0, 0, z0])));
    capSolids.push({ name: 'base', hex: s.base.colour, m: keep(Manifold.union(under)) });
    g.palette.forEach((p, i) => {
      const cs = colours[i];
      if (cs) capSolids.push({ name: p.hex, hex: p.hex, m: keep(keep(cs.extrude(p.height)).translate([0, 0, z0 + bt])) });
    });

    // ---- body: footprint minus the well, and per switch the clearance column, the plate socket and the column above
    const L = clickerLevels(s, capT);
    let foot: CrossSection;
    if (c.shape === 'outline') {
      foot = keep(outline.offset(c.border, 'Miter'));
    } else if (c.shape === 'circle') {
      let r = 0;
      for (const poly of outline.toPolygons()) for (const [x, y] of poly) r = Math.max(r, Math.hypot(x - W / 2, y - H / 2));
      foot = keep(keep(CrossSection.circle(r + c.border, 2 * SEGMENTS)).translate([W / 2, H / 2]));
    } else {
      const w = W + 2 * c.border, h = H + 2 * c.border, r = Math.min(4, w / 4, h / 4);
      foot = keep(keep(keep(CrossSection.square([w - 2 * r, h - 2 * r], true)).offset(r, 'Round', 2, SEGMENTS)).translate([W / 2, H / 2]));
    }
    const block = (side: number, x: number, y: number, za: number, zb: number) =>
      keep(keep(Manifold.cube([side, side, zb - za], true)).translate([x, y, (za + zb) / 2]));
    const cuts: Manifold[] = [keep(keep(keep(outline.offset(c.fitGap, 'Miter')).extrude(L.rimTop + 1 - L.wellFloor)).translate([0, 0, L.wellFloor]))];
    for (const [x, y] of spots) {
      cuts.push(block(MX.column, x, y, MX.floor, L.plateBottom));
      cuts.push(block(MX.cut, x, y, L.plateBottom - 0.5, L.plateTop + 0.5));
      cuts.push(block(MX.column, x, y, L.plateTop, L.wellFloor));
    }
    const body = keep(keep(foot.extrude(L.rimTop)).subtract(keep(Manifold.union(cuts))));

    // ---- lay out as printed: the cap beside the body on +X
    const bb = body.boundingBox();
    const cb = bounds(capSolids.map((x) => x.m));
    const dx = bb.max[0]! + APART - cb.min[0]!;
    for (const x of capSolids) x.m = keep(x.m.translate([dx, 0, 0]));

    const pieces = Math.max(countPieces(wasm, capSolids.map((x) => x.m)), countPieces(wasm, [body]));
    return toModel(
      [{ object: 'cap', solids: capSolids }, { object: 'body', solids: [{ name: 'base', hex: s.base.colour, m: body }] }],
      pieces,
      warningsOf(W, H, c.switches),
    );
  } finally {
    for (const o of trash) o.delete();
  }
}

/**
 * A small fit-test print (spec §4.6b): a `socket` coupon (the body's switch column and 14.0 plate socket, open
 * underneath) and a `stem` coupon (a cap stem with the cross socket on a small pad, socket up). Print both,
 * clip a switch in, push the stem on, and tune the fit before printing a full clicker.
 */
export async function fitTest(s: Settings): Promise<Model> {
  const wasm = await initManifold();
  const { Manifold } = wasm;
  const trash: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(o: T): T => { trash.push(o); return o; };
  try {
    const wall = 2, side = MX.column + 2 * wall, h = MX.below + MX.plate;
    const c = side / 2;
    const cube = (w: number, x: number, y: number, za: number, zb: number) => keep(keep(Manifold.cube([w, w, zb - za], true)).translate([x, y, (za + zb) / 2]));
    const socket = keep(cube(side, c, c, 0, h).subtract(keep(Manifold.union([cube(MX.column, c, c, -1, MX.below), cube(MX.cut, c, c, MX.below - 0.5, h + 1)]))));
    const pad = 10, padT = 2, sx = side + APART + pad / 2;
    const stemCoupon = keep(Manifold.union([cube(pad, sx, c, 0, padT), stem(wasm, sx, c, padT, false, keep)]));
    return toModel([
      { object: 'stem', solids: [{ name: 'base', hex: s.base.colour, m: stemCoupon }] },
      { object: 'socket', solids: [{ name: 'base', hex: s.base.colour, m: socket }] },
    ], 1, []);
  } finally {
    for (const o of trash) o.delete();
  }
}

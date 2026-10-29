import type { Grid } from './grid';
import type { Settings } from './settings';
import { initManifold } from './manifold';
import type { ManifoldToplevel } from './manifold';
import { bounds, opaqueBox, pixelSize } from './mesh';
import { bridge, fillHoles, grow, lowestUsed, nearestColors, regionCount, regionMm, smoothRadius } from './shapes';
import type { Model, Part } from './mesh';
import { loopSolid } from './features';

type Manifold = InstanceType<ManifoldToplevel['Manifold']>;
type CrossSection = InstanceType<ManifoldToplevel['CrossSection']>;
type Keep = <T extends { delete(): void }>(o: T) => T;

/**
 * Cherry MX clicker numbers, mm, per user reference partsref.obj / Skull.obj (ruling R22; analysis in
 * .superpowers/sdd/2026-10-28-pixel3d/clicker-reference.md). These are the boolean cutters the user prints with
 * (MakerWorld 1388810 "Negative modifiers to make clicker fidget toys", re-measured) and a finished clicker that
 * prints and clicks. Where they differ from the nominal Cherry datasheet (14.0 plate cutout in a 1.5 plate), the
 * reference wins: the switch is a press fit in a straight shaft and rests on a step, with no plate.
 * Only `above` (stem tip 11.6 above the plate top / seat, at rest), `travel` (4.0) and `pitch` (19.05) are the
 * Cherry datasheet values (ai03 wiki "Switch Dimensions and Physical Specifications").
 */
export const MX = {
  /** Press-fit shaft for the lower housing and pins, X x Y (Y, the clip axis, is the wider). */
  shaft: [14.1, 14.56] as [number, number],
  /** Shaft depth below the seat: 5.0 housing + 3.3 pins + 0.08. */
  depth: 8.38,
  /** Body floor under the blind shaft. */
  floor: 1.2,
  /** Rounded-square clearance column round the top housing, above the seat. */
  column: 19.0,
  /** Its corner radius and height. */
  columnR: 3,
  columnH: 3.0,
  /** Rounded-square lead-in from the column up to the well floor. */
  leadIn: 20.0,
  leadInR: 4,
  /** Switch stem tip above the seat (the plate-top equivalent), at rest. Cherry datasheet. */
  above: 11.6,
  /** Cap stem diameter, flush with the cap's underside. */
  stemD: 5.8,
  /** Cross socket arms, long x wide. */
  cross: [4.27, 1.22] as [number, number],
  /** Cross socket and pocket depth into the cap. */
  engage: 3.35,
  /** The cap's pocket round the stem: a rounded square, wide at the mouth (cap underside), narrow at its ceiling. */
  pocket: [14.5, 14.0] as [number, number],
  pocketR: 4.1,
  /** Full key travel. Cherry datasheet. */
  travel: 4,
  /** Keyboard key pitch, for 2-3 switches. */
  pitch: 19.05,
};

/** Gap between the cap and the body as printed, mm. */
const APART = 8;
const SEGMENTS = 64;
/** Extra well depth below full travel, so the switch, not the cap, is the hard stop (cap first-layer squish). */
export const TRAVEL_MARGIN = 0.4;
/** Solid cap above the pocket ceiling, mm. */
export const CAP_ROOF = 1.2;
/** The square the art must cover over each switch: the pocket mouth plus a 1.5 mm wall each side. */
export const MIN_ART = MX.pocket[0] + 2 * 1.5;
/** Thinnest body wall round a switch's 20.0 lead-in, mm: the footprint always covers that square round each switch. */
export const MIN_WALL = 1.2;

/** The cap's backing thickness: the base height, but never less than the pocket plus its roof. */
export const capThickness = (s: Settings): number => Math.max(s.base.enabled ? s.base.height : 0, MX.engage + CAP_ROOF);

/**
 * Heights in the body's frame (Z 0 = its underside on the bed) for a cap whose backing is `capT` thick,
 * with the cap seated on the switch at rest.
 */
export function clickerLevels(s: Settings, capT: number = capThickness(s)) {
  const shaftBottom = MX.floor;
  /** The step the switch's top housing rests on (the plate-top equivalent). */
  const seat = shaftBottom + MX.depth;
  const columnTop = seat + MX.columnH;
  const stemTop = seat + MX.above;
  /** The cap's underside, assembled at rest: the switch stem tip at the socket ceiling. */
  const capUnder = stemTop - MX.engage;
  /** Room for the cap to travel the full 4 mm, plus a margin. */
  const wellFloor = capUnder - MX.travel - TRAVEL_MARGIN;
  /** The cap's top of backing stands `capHeight` above the rim at rest. */
  const rimTop = capUnder + capT - s.clicker.capHeight;
  return { shaftBottom, seat, columnTop, stemTop, capUnder, wellFloor, rimTop };
}

/** Switch centers in the art's mm frame: one in the middle, or 2-3 at keyboard pitch along the long side. */
function switchSpots(w: number, h: number, n: number): [number, number][] {
  const long = w >= h;
  return Array.from({ length: n }, (_, i) => {
    const o = (i - (n - 1) / 2) * MX.pitch;
    return long ? [w / 2 + o, h / 2] : [w / 2, h / 2 + o];
  });
}

const warningsOf = (w: number, h: number, n: number, uncovered: number): string[] => {
  const out: string[] = [];
  const min = MIN_ART;
  if (Math.min(w, h) < min) out.push(`The art is smaller than the switch. Make it at least ${min} mm across so the cap covers it.`);
  const need = Math.round(((n - 1) * MX.pitch + min) * 10) / 10;
  if (n > 1 && Math.max(w, h) < need) out.push(`${n} switches need art at least ${need} mm along its long side.`);
  if (uncovered > 0) out.push(`The art doesn't fully cover ${n > 1 ? `${uncovered} of the switches` : 'the switch'}: it needs a solid ${min} mm square over each switch so the cap covers it.`);
  return out;
};

type Objects = { object: Part['object']; solids: { name: string; hex: string; m: Manifold }[] }[];

function toModel(objects: Objects, pieces: number, warnings: string[], clicker?: Model['clicker']): Model {
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
    ...(clicker ? { clicker } : {}),
  };
}

/** A rounded rectangle centered on the origin. */
function rounded(wasm: ManifoldToplevel, w: number, h: number, r: number, keep: Keep): CrossSection {
  const { CrossSection } = wasm;
  return keep(keep(CrossSection.square([w - 2 * r, h - 2 * r], true)).offset(r, 'Round', 2, SEGMENTS));
}

/**
 * What one switch cuts from the cap's underside (Z 0 up) at (x, y): the tapered rounded-square pocket round a
 * 5.8 stem, plus the cross socket in the stem, all `engage` deep. The cutter pokes 0.1 below Z 0 so no skin is left.
 */
function capCutter(wasm: ManifoldToplevel, x: number, y: number, keep: Keep): Manifold {
  const { Manifold, CrossSection } = wasm;
  const [mouth, ceiling] = MX.pocket;
  const h = MX.engage + 0.1;
  // mouth size at Z -0.1, tapering to `ceiling` at Z engage
  const at = (z: number) => mouth + (ceiling - mouth) * (z / MX.engage);
  const w0 = at(-0.1);
  const pocket = keep(keep(rounded(wasm, w0, w0, MX.pocketR, keep).extrude(h, 0, 0, [ceiling / w0, ceiling / w0])).translate([x, y, -0.1]));
  const stem = keep(keep(Manifold.cylinder(h + 0.2, MX.stemD / 2, MX.stemD / 2, SEGMENTS)).translate([x, y, -0.2]));
  const [a, b] = MX.cross;
  const plus = keep(CrossSection.union([keep(CrossSection.square([a, b], true)), keep(CrossSection.square([b, a], true))]));
  const socket = keep(keep(plus.extrude(h)).translate([x, y, -0.1]));
  return keep(Manifold.union([keep(pocket.subtract(stem)), socket]));
}

/**
 * What one switch cuts from the body at (x, y): the blind press-fit shaft from `shaftBottom` to the seat,
 * the 19.0 column 3.0 tall above the seat, and the 20.0 lead-in from there to `top`.
 */
function seatCutter(wasm: ManifoldToplevel, x: number, y: number, shaft: [number, number], shaftBottom: number, top: number, keep: Keep): Manifold {
  const { Manifold } = wasm;
  const seat = shaftBottom + MX.depth, columnTop = seat + MX.columnH;
  const prism = (cs: CrossSection, za: number, zb: number) => keep(keep(cs.extrude(zb - za)).translate([x, y, za]));
  return keep(Manifold.union([
    keep(keep(Manifold.cube([shaft[0], shaft[1], MX.depth + 0.01], true)).translate([x, y, shaftBottom + (MX.depth + 0.01) / 2])),
    prism(rounded(wasm, MX.column, MX.column, MX.columnR, keep), seat, columnTop),
    prism(rounded(wasm, MX.leadIn, MX.leadIn, MX.leadInR, keep), columnTop, top),
  ]));
}

/** loopSolid's frame for a point already in mm. */
const MM_FRAME = { px: { x: 1, y: 1 }, x0: 0, y0: 0 };

/**
 * Where a keychain loop meets the body: the farthest crossing of the footprint's outline by a ray from its bounding
 * box center at `deg` (0° up, clockwise, as the flat model's loop), facing along the ray.
 */
function footEdge(foot: CrossSection, deg: number) {
  const b = foot.bounds();
  const cx = (b.min[0]! + b.max[0]!) / 2, cy = (b.min[1]! + b.max[1]!) / 2;
  const a = (deg * Math.PI) / 180, dx = Math.sin(a), dy = Math.cos(a);
  let far = 0;
  for (const poly of foot.toPolygons()) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]!, [x1, y1] = poly[(i + 1) % poly.length]!;
      const ex = x1 - x0, ey = y1 - y0, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((x0 - cx) * ey - (y0 - cy) * ex) / den, u = ((x0 - cx) * dy - (y0 - cy) * dx) / den;
      if (t > far && u >= 0 && u <= 1) far = t;
    }
  }
  return { u: cx + dx * far, v: cy + dy * far, nx: dx, ny: dy };
}

/**
 * The keycap clicker of spec §4.6b (per user reference, R22): a `cap` (the art on a solid backing whose flat
 * underside holds, per switch, the pocket, stem and cross socket) and a `body` (the footprint with a well shaped
 * like the cap plus the fit gap, and per switch the press-fit shaft, column and lead-in).
 * Both are laid out as printed, flat side down: the body on its underside, the cap underside down beside it on +X.
 * `model.clicker` says how to assemble them. A keychain loop joins the body (a hole would cut into a switch, so a
 * hole keychain is ignored); magnets, sides, inside and rotation are not used on a clicker.
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
  const keep: Keep = (o) => { trash.push(o); return o; };
  try {
    const region = (pick: (v: number) => boolean) => regionMm(wasm, g, pick, box.x0, box.y0, px, keep);
    const art = region((v) => v >= 0)!;
    // the art with its interior holes filled (outer loops only): the cap's backing and the body's well follow it, so a
    // transparent hole in the art never splits the cap or leaves body plastic over a switch
    const filled = fillHoles(wasm, art, keep);
    const colors = g.palette.map((_, i) => region((v) => v === i));
    const r = smoothRadius(px);
    // the cap's outline: grown to hold the outline ring, rounded by `smooth`, then separate islands bridged (a close of
    // up to 3 mm) so the backing is one piece. The art itself is never changed.
    const ringOuter = s.outline.on ? grow(filled, s.outline.width, s.smooth, r, keep) : null;
    const capShape = bridge(wasm, ringOuter ?? (s.smooth ? grow(filled, r, true, r, keep) : filled), keep).cs;
    const ring = ringOuter ? keep(ringOuter.subtract(filled)) : null;
    const spots = switchSpots(W, H, c.switches);
    const coverAt = (x: number, y: number) => keep(keep(CrossSection.square([MIN_ART, MIN_ART], true)).translate([x, y]));
    const uncovered = spots.filter(([x, y]) => keep(coverAt(x, y).subtract(capShape)).area() > 1e-3).length;
    /** `cs` grown by `d`: round when smoothing, else mitered (which keeps the pixel corners and always clears `d`). */
    const offset = (cs: CrossSection, d: number) => keep(s.smooth ? cs.offset(d, 'Round', 2, SEGMENTS / 2) : cs.offset(d, 'Miter', 2));
    const prism = (cs: CrossSection, z0: number, h: number) => keep(keep(cs.extrude(h)).translate([0, 0, z0]));

    // ---- cap, printed underside down: a solid backing minus the pockets, the art (and any outline ring) on top
    const capT = capThickness(s);
    const low = lowestUsed(g);
    const capCuts = keep(Manifold.union(spots.map(([x, y]) => capCutter(wasm, x, y, keep))));
    const capSolids: { name: string; hex: string; m: Manifold }[] = [];
    if (c.backing === 'base') {
      capSolids.push({ name: 'base', hex: s.base.color, m: keep(prism(capShape, 0, capT).subtract(capCuts)) });
      g.palette.forEach((p, i) => { const cs = colors[i]; if (cs) capSolids.push({ name: p.hex, hex: p.hex, m: prism(cs, capT, p.height) }); });
      if (ring) capSolids.push({ name: 'outline', hex: s.outline.color, m: prism(ring, capT, low) });
    } else {
      // no base color: each art pixel's color runs from the underside to its top. The rest of the backing takes the
      // nearest art pixel's color, except outside the art's silhouette when there is an outline ring: that is the ring's
      const zone = ring ? filled : capShape;
      const b = capShape.bounds();
      const over = Math.max(-b.min[0]!, -b.min[1]!, b.max[0]! - W, b.max[1]! - H, 0);
      const pad = Math.ceil(over / Math.min(px.x, px.y)) + 1;
      const near = nearestColors(g, pad);
      const nearGrid = { w: near.w, h: near.h, cells: near.cells, palette: g.palette };
      g.palette.forEach((p, i) => {
        const cs = colors[i];
        if (!cs) return;
        const under = keep(regionMm(wasm, nearGrid, (v) => v === i, box.x0 + pad, box.y0 + pad, px, keep)!.intersect(zone));
        const m = keep(Manifold.union([prism(under, 0, capT), prism(cs, 0, capT + p.height)]));
        capSolids.push({ name: p.hex, hex: p.hex, m: keep(m.subtract(capCuts)) });
      });
      if (ring) {
        const m = keep(Manifold.union([prism(keep(capShape.subtract(filled)), 0, capT), prism(ring, 0, capT + low)]));
        capSolids.push({ name: 'outline', hex: s.outline.color, m: keep(m.subtract(capCuts)) });
      }
    }

    // ---- body, printed underside down: footprint minus the well and each switch's seat
    const L = clickerLevels(s, capT);
    // the border is the wall beyond the well (cap + fit gap), so the two never eat into each other
    const wall = c.fitGap + c.border;
    let foot: CrossSection;
    if (c.shape === 'outline') {
      foot = offset(capShape, wall);
    } else if (c.shape === 'circle') {
      let rr = 0;
      for (const poly of capShape.toPolygons()) for (const [x, y] of poly) rr = Math.max(rr, Math.hypot(x - W / 2, y - H / 2));
      foot = keep(keep(CrossSection.circle(rr + wall, 2 * SEGMENTS)).translate([W / 2, H / 2]));
    } else {
      const b = capShape.bounds();
      const w = b.max[0]! - b.min[0]! + 2 * wall, h = b.max[1]! - b.min[1]! + 2 * wall, rr = Math.min(4, w / 4, h / 4);
      foot = keep(rounded(wasm, w, h, rr, keep).translate([(b.min[0]! + b.max[0]!) / 2, (b.min[1]! + b.max[1]!) / 2]));
    }
    // never less than a MIN_WALL wall round each switch's lead-in (small art at a thin border)
    const guard = MX.leadIn + 2 * MIN_WALL;
    foot = keep(CrossSection.union([foot, ...spots.map(([x, y]) => keep(rounded(wasm, guard, guard, MX.leadInR + MIN_WALL, keep).translate([x, y])))]));
    // the well: the cap's outline plus the fit gap
    const cuts: Manifold[] = [prism(offset(capShape, c.fitGap), L.wellFloor, L.rimTop + 1 - L.wellFloor)];
    for (const [x, y] of spots) cuts.push(seatCutter(wasm, x, y, MX.shaft, L.shaftBottom, L.wellFloor + 0.01, keep));
    // neighboring switches: at 19.05 pitch the 19.0 columns (and the rounded corners of the 20.0 lead-ins) would
    // leave a thin fin between them, so join them with a straight slot
    for (let i = 1; i < spots.length; i++) {
      const [x0, y0] = spots[i - 1]!, [x1, y1] = spots[i]!;
      const along = Math.hypot(x1 - x0, y1 - y0), alongX = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
      const slot = (across: number, za: number, zb: number) => keep(keep(Manifold.cube(alongX ? [along, across, zb - za] : [across, along, zb - za], true))
        .translate([(x0 + x1) / 2, (y0 + y1) / 2, (za + zb) / 2]));
      cuts.push(slot(MX.column, L.seat, L.columnTop + 0.01), slot(MX.leadIn, L.columnTop, L.wellFloor + 0.01));
    }
    // the keychain loop sticks out from the body's side, at the bed or halfway up, at its own thickness; added before
    // the cuts so it never fills the well
    const solid = keep(foot.extrude(L.rimTop));
    const loopT = Math.min(c.loopThickness, L.rimTop);
    const keyLoop = s.keychain.type === 'loop' && s.keychain.loop.outer > s.keychain.loop.inner
      ? keep(keep(loopSolid(wasm, footEdge(foot, s.keychain.loop.angle), s, loopT, MM_FRAME)).translate([0, 0, c.loopAt === 'center' ? (L.rimTop - loopT) / 2 : 0]))
      : null;
    const body = keep((keyLoop ? keep(solid.add(keyLoop)) : solid).subtract(keep(Manifold.union(cuts))));

    // ---- lay out as printed: the cap beside the body on +X
    const bb = body.boundingBox();
    const cb = bounds(capSolids.map((x) => x.m));
    const dx = bb.max[0]! + APART - cb.min[0]!;
    for (const x of capSolids) x.m = keep(x.m.translate([dx, 0, 0]));

    // pieces per printed object, so a warning can say which one is split. Each is its footprint's regions: the cap's
    // pockets are blind (a roof stays over them) and every color stands on or in its backing; the body is solid from
    // the bed up to the shaft floor. (A 3D union of every color takes seconds on busy art, and solids that only share
    // faces, as the art-color backing's do, don't merge in it.)
    const counts = { cap: regionCount(capShape), body: regionCount(foot) };
    const warnings = warningsOf(W, H, c.switches, uncovered);
    if (counts.cap > 1) warnings.push(`The cap is in ${counts.cap} pieces. Move the islands closer together or join them.`);
    if (counts.body > 1) warnings.push(`The body is in ${counts.body} pieces. Move the islands closer together or join them, or pick Circle or Square for the body shape.`);
    const model = toModel(
      [{ object: 'cap', solids: capSolids }, { object: 'body', solids: [{ name: 'base', hex: s.base.color, m: body }] }],
      Math.max(counts.cap, counts.body),
      warnings,
      { capShift: [-dx, 0], restZ: L.capUnder, pressedZ: L.capUnder - MX.travel, rimZ: L.rimTop },
    );
    return { ...model, pieceCounts: counts };
  } finally {
    for (const o of trash) o.delete();
  }
}

/** The fit-test shaft coupons' size steps, mm added to both shaft sides, tightest first. */
export const FIT_STEPS = [-0.1, 0, 0.1];

const signed = (d: number) => `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(2)}`;

/**
 * A small fit-test print (spec §4.6b, per user reference): a `stem` coupon (a small cap backing with the pocket,
 * stem and cross socket, printed underside down like the cap) and three shaft coupons, `socket_<step>` for each
 * `FIT_STEPS` step (`socket_-0.10`, `socket_+0.00`, `socket_+0.10`). Each shaft coupon is the body's switch seat:
 * the press-fit shaft (14.1 x 14.56 plus the step) over a floor, the 19.0 column and the 20.0 lead-in, in a 2 mm
 * wall. They are laid out tightest to loosest along +X, and each carries 1, 2 or 3 notches on the top of its front
 * (-Y) wall, so the printed coupons can be told apart.
 */
export async function fitTest(s: Settings): Promise<Model> {
  const wasm = await initManifold();
  const { Manifold } = wasm;
  const trash: { delete(): void }[] = [];
  const keep: Keep = (o) => { trash.push(o); return o; };
  try {
    const wall = 2;
    const box = (w: number, d: number, x: number, y: number, za: number, zb: number) =>
      keep(keep(Manifold.cube([w, d, zb - za], true)).translate([x, y, (za + zb) / 2]));
    const objects: Objects = [];
    const pad = MIN_ART, capT = MX.engage + CAP_ROOF;
    const stemCoupon = keep(box(pad, pad, pad / 2, 0, 0, capT).subtract(capCutter(wasm, pad / 2, 0, keep)));
    objects.push({ object: 'stem', solids: [{ name: 'base', hex: s.base.color, m: stemCoupon }] });
    const side = MX.leadIn + 2 * wall;
    const top = MX.floor + MX.depth + MX.columnH + 1;
    let x0 = pad + APART;
    FIT_STEPS.forEach((d, k) => {
      const cx = x0 + side / 2;
      const cuts = [seatCutter(wasm, cx, 0, [MX.shaft[0] + d, MX.shaft[1] + d], MX.floor, top + 1, keep)];
      // k + 1 notches, 1 mm wide and deep, in the top of the front wall
      for (let i = 0; i <= k; i++) cuts.push(box(1, wall + 2, cx + (i - k / 2) * 2.5, -side / 2, top - 1, top + 1));
      const m = keep(box(side, side, cx, 0, 0, top).subtract(keep(Manifold.union(cuts))));
      objects.push({ object: `socket_${signed(d)}`, solids: [{ name: 'base', hex: s.base.color, m }] });
      x0 += side + APART;
    });
    return toModel(objects, 1, []);
  } finally {
    for (const o of trash) o.delete();
  }
}

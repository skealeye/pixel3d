import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildClicker, buildModel, CAP_ROOF, capThickness, clickerLevels, convert, decodeImage, DEFAULTS, detectScale, downsampleNearest,
  FIT_STEPS, fitTest, MIN_ART, MIN_WALL, MX, settingsSchema, to3MF, toGrid, toSTL, TRAVEL_MARGIN,
} from '../src/index';
import type { Grid, Model, Part, Settings } from '../src/index';
import { initManifold } from '../src/manifold';
import { assertManifold } from './util/assertManifold';

type Mesh = Part['mesh'];
type Vec3 = [number, number, number];
type Box3 = { min: Vec3; max: Vec3 };

const load = async (name: string): Promise<Grid> => {
  const img = await decodeImage(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));
  return toGrid(downsampleNearest(img, detectScale(img)), 16);
};
const settings = (patch: (s: Settings) => void): Settings => {
  const s = structuredClone(DEFAULTS);
  s.make = 'clicker';
  patch(s);
  return s;
};
/** An n x n sprite of one color. */
const square = (n: number, height = 1): Grid => ({ w: n, h: n, cells: new Int16Array(n * n), palette: [{ hex: '#cc3333', height }] });
/** An n x n sprite with the cells where `clear(x, y)` (y from the top) transparent. */
const holed = (n: number, clear: (x: number, y: number) => boolean): Grid => {
  const g = square(n);
  for (let k = 0; k < g.cells.length; k++) if (clear(k % n, Math.floor(k / n))) g.cells[k] = -1;
  return g;
};

const boxOf = (parts: Part[]): Box3 => {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const v = p.mesh.vertProperties;
    for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, v[i + a]!); max[a] = Math.max(max[a]!, v[i + a]!); }
  }
  return { min, max };
};
const of = (m: Model, object: Part['object']) => m.parts.filter((p) => p.object === object);
const center = (b: Box3) => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] as const;

/** The parts' union as one Manifold (caller deletes), optionally moved. */
const solidOf = async (parts: Part[], move: Vec3 = [0, 0, 0]) => {
  const { Manifold, Mesh } = await initManifold();
  const ms = parts.map((p: { mesh: Mesh }) => new Manifold(new Mesh({ numProp: 3, ...p.mesh })));
  const u = Manifold.union(ms);
  const out = u.translate(move);
  for (const o of [...ms, u]) o.delete();
  return out;
};
/** Volume of the parts' union inside an axis-aligned box, mm³. */
const volumeIn = async (parts: Part[], lo: Vec3, hi: Vec3) => {
  const { Manifold } = await initManifold();
  const u = await solidOf(parts);
  const c0 = Manifold.cube([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]), cube = c0.translate(lo);
  const cut = u.intersect(cube);
  try { return cut.volume(); } finally { for (const o of [u, c0, cube, cut]) o.delete(); }
};
/** A box centered on (x, y), w x d across, from z0 to z1. */
const around = (x: number, y: number, w: number, d: number, z0: number, z1: number) =>
  [[x - w / 2, y - d / 2, z0], [x + w / 2, y + d / 2, z1]] as [Vec3, Vec3];

/**
 * The slice of the parts at height z, inside a `win` x `win` window centered on (x, y) (a circle of diameter `win`
 * when `round`): its empty part (`void`) or its solid part, as width, depth and area.
 */
const sliceAt = async (parts: Part[], z: number, x: number, y: number, win: number, want: 'void' | 'solid', round = false) => {
  const { CrossSection } = await initManifold();
  const u = await solidOf(parts);
  const sl = u.slice(z);
  const w0 = round ? CrossSection.circle(win / 2, 128) : CrossSection.square([win, win], true), w = w0.translate([x, y]);
  const r = want === 'void' ? w.subtract(sl) : w.intersect(sl);
  try {
    const b = r.bounds();
    return { w: b.max[0]! - b.min[0]!, d: b.max[1]! - b.min[1]!, area: r.area(), empty: r.isEmpty() };
  } finally { for (const o of [u, sl, w0, w, r]) o.delete(); }
};

let potion: Grid;
beforeAll(async () => { potion = await load('potion.png'); await initManifold(); });

describe('MX', () => {
  it('holds the numbers of the user reference (R22)', () => {
    expect(MX).toEqual({
      shaft: [14.1, 14.56], depth: 8.38, floor: 1.2, column: 19.0, columnR: 3, columnH: 3.0, leadIn: 20.0, leadInR: 4,
      above: 11.6, stemD: 5.8, cross: [4.27, 1.22], engage: 3.35, pocket: [14.5, 14.0], pocketR: 4.1, travel: 4, pitch: 19.05,
    });
    expect(MIN_ART).toBeCloseTo(17.5, 6);
  });

  it('fitGap is the cap-to-well clearance: default 0.5, 0.2 to 1.5', () => {
    expect(DEFAULTS.clicker.fitGap).toBe(0.5);
    const at = (fitGap: number) => settingsSchema.safeParse({ ...DEFAULTS, clicker: { ...DEFAULTS.clicker, fitGap } }).success;
    expect([at(0.1), at(0.2), at(1.5), at(1.6)]).toEqual([false, true, true, false]);
  });
});

describe('buildClicker', () => {
  for (const shape of ['outline', 'circle', 'square'] as const) {
    for (const n of [1, 2, 3] as const) {
      it(`${shape}, ${n} switch${n > 1 ? 'es' : ''}: a manifold cap and body`, async () => {
        const s = settings((s) => { s.clicker.shape = shape; s.clicker.switches = n; s.size.width = 64; });
        const t0 = performance.now();
        const m = await buildClicker(potion, s);
        expect(performance.now() - t0).toBeLessThan(2000);
        expect([...new Set(m.parts.map((p) => p.object))]).toEqual(['cap', 'body']);
        for (const p of m.parts) await assertManifold(p);
        expect(m.pieces).toBe(1);
        expect(of(m, 'body').map((p) => [p.name, p.hex])).toEqual([['base', DEFAULTS.base.color]]);
        expect(of(m, 'cap')[0]!.name).toBe('base');
        // printed apart, flat sides down: nothing below Z 0, cap beside the body
        const all = boxOf(m.parts), cap = boxOf(of(m, 'cap')), body = boxOf(of(m, 'body'));
        expect(all.min[2]).toBeCloseTo(0, 4);
        expect(cap.min[2]).toBeCloseTo(0, 4);
        expect(body.min[2]).toBeCloseTo(0, 4);
        expect(cap.min[0]).toBeGreaterThan(body.max[0]);
        expect(m.size.x).toBeCloseTo(all.max[0] - all.min[0], 3);
        expect(m.size.z).toBeCloseTo(all.max[2], 3);
        expect(m.clicker).toBeDefined();
      });
    }
  }

  it('buildModel branches into it when make is clicker', async () => {
    const m = await buildModel(potion, settings(() => {}));
    expect([...new Set(m.parts.map((p) => p.object))]).toEqual(['cap', 'body']);
  });

  it('the body seat: a blind 14.1 x 14.56 shaft 8.38 deep over a floor, a 19.0 column 3.0 tall, a 20.0 lead-in to the well floor', async () => {
    const s = settings(() => {});
    const m = await buildClicker(square(32), s);
    const body = of(m, 'body');
    const [cx, cy] = center(boxOf(body));
    const L = clickerLevels(s);
    const [sx, sy] = MX.shaft;
    expect(L.seat - L.shaftBottom).toBeCloseTo(MX.depth, 6);
    // the shaft is clear, with plastic right round it (no plate: it is all shaft wall)
    expect(await volumeIn(body, ...around(cx, cy, sx, sy, L.shaftBottom, L.seat))).toBeCloseTo(0, 3);
    expect(await volumeIn(body, ...around(cx, cy, sx + 0.4, sy + 0.4, L.shaftBottom, L.seat))).toBeCloseTo(((sx + 0.4) * (sy + 0.4) - sx * sy) * MX.depth, 1);
    expect(await volumeIn(body, ...around(cx, cy, 10, 10, 0, MX.floor))).toBeCloseTo(100 * MX.floor, 2);
    // the 19.0 column and the 20.0 lead-in (probed along their straight sides, clear of the rounded corners)
    expect(await volumeIn(body, ...around(cx, cy, 19, 12, L.seat, L.columnTop))).toBeCloseTo(0, 3);
    expect(await volumeIn(body, ...around(cx, cy, 19.4, 12, L.seat + 0.1, L.columnTop - 0.1))).toBeCloseTo(0.4 * 12 * (MX.columnH - 0.2), 2);
    expect(await volumeIn(body, ...around(cx, cy, 20, 12, L.columnTop, L.wellFloor))).toBeCloseTo(0, 3);
    expect(await volumeIn(body, ...around(cx, cy, 20.4, 12, L.columnTop + 0.1, L.wellFloor - 0.1))).toBeCloseTo(0.4 * 12 * (L.wellFloor - L.columnTop - 0.2), 2);
  });

  it('two and three switches sit at keyboard pitch along the long side, each with its own shaft', async () => {
    const s = settings((s) => { s.clicker.switches = 3; s.size.keepAspect = false; s.size.width = 64; s.size.height = 24; });
    const m = await buildClicker(square(32), s);
    const body = of(m, 'body');
    const [cx, cy] = center(boxOf(body));
    const L = clickerLevels(s);
    for (const dx of [-MX.pitch, 0, MX.pitch]) {
      expect(await volumeIn(body, ...around(cx + dx, cy, MX.shaft[0], MX.shaft[1], L.shaftBottom, L.seat))).toBeCloseTo(0, 3);
    }
    // between shafts, the shaft wall is solid
    expect(await volumeIn(body, ...around(cx + MX.pitch / 2, cy, 2, 2, L.shaftBottom, L.seat))).toBeCloseTo(4 * MX.depth, 3);
  });

  it('neighboring switches share one joined column and lead-in, with no fin between them', async () => {
    const s = settings((s) => { s.clicker.switches = 3; s.size.keepAspect = false; s.size.width = 64; s.size.height = 24; });
    const m = await buildClicker(square(32), s);
    const body = of(m, 'body');
    const [cx, cy] = center(boxOf(body));
    const L = clickerLevels(s);
    for (const mid of [-MX.pitch / 2, MX.pitch / 2]) {
      expect(await volumeIn(body, ...around(cx + mid, cy, 1, MX.column, L.seat, L.columnTop))).toBeCloseTo(0, 3);
      expect(await volumeIn(body, ...around(cx + mid, cy, 1, MX.leadIn, L.columnTop, L.wellFloor))).toBeCloseTo(0, 3);
    }
    expect(m.pieces).toBe(1);
    for (const p of m.parts) await assertManifold(p);
  });

  for (const shape of ['outline', 'circle', 'square'] as const) {
    it(`${shape}, fit gap 1.5 and border 1.5: the border is a 1.5 mm wall beyond the well, in one body piece`, async () => {
      const s = settings((s) => { s.clicker.shape = shape; s.clicker.fitGap = 1.5; s.clicker.border = 1.5; });
      const m = await buildClicker(square(32), s);
      for (const p of m.parts) await assertManifold(p);
      expect(m.pieces).toBe(1);
      const body = of(m, 'body'), b = boxOf(body);
      const [cx, cy] = center(b);
      const L = clickerLevels(s);
      // the well edge is 20 + 1.5 from the center; the wall stands just beyond it, up to the rim
      const wellEdge = 20 + s.clicker.fitGap;
      expect(await volumeIn(body, ...around(cx + wellEdge + 0.75, cy, 1, 1, L.rimTop - 1, L.rimTop))).toBeCloseTo(1, 3);
      expect(await volumeIn(body, ...around(cx, cy - wellEdge - 0.75, 1, 1, L.rimTop - 1, L.rimTop))).toBeCloseTo(1, 3);
      if (shape !== 'circle') expect(b.max[0] - b.min[0]).toBeCloseTo(40 + 2 * (s.clicker.fitGap + s.clicker.border), 3);
    });
  }

  it(`minimum art at a 1.5 mm border still leaves a ${MIN_WALL} mm wall round the 20.0 lead-in`, async () => {
    const s = settings((s) => { s.size.width = MIN_ART; s.clicker.border = 1.5; s.clicker.fitGap = 0.2; });
    const m = await buildClicker(square(16), s);
    for (const p of m.parts) await assertManifold(p);
    expect(m.pieces).toBe(1);
    const body = of(m, 'body'), b = boxOf(body);
    expect(b.max[0] - b.min[0]).toBeGreaterThanOrEqual(MX.leadIn + 2 * MIN_WALL - 1e-4);
    expect(b.max[1] - b.min[1]).toBeGreaterThanOrEqual(MX.leadIn + 2 * MIN_WALL - 1e-4);
    const [cx, cy] = center(b);
    const L = clickerLevels(s);
    // a wall MIN_WALL thick all along each side of the lead-in
    for (const [dx, dy, w, d] of [[1, 0, MIN_WALL, 10], [-1, 0, MIN_WALL, 10], [0, 1, 10, MIN_WALL], [0, -1, 10, MIN_WALL]] as const) {
      const off = MX.leadIn / 2 + MIN_WALL / 2;
      expect(await volumeIn(body, ...around(cx + dx * off, cy + dy * off, w - 0.02, d - 0.02, L.columnTop + 0.1, L.wellFloor - 0.1)))
        .toBeCloseTo((w - 0.02) * (d - 0.02) * (L.wellFloor - L.columnTop - 0.2), 3);
    }
  });

  it('the cap is solid underneath apart from the pocket round a 5.8 stem with the cross socket, 3.35 deep', async () => {
    const s = settings(() => {});
    const m = await buildClicker(square(32), s);
    const cap = of(m, 'cap'), b = boxOf(cap);
    const [cx, cy] = center(b);
    const [a, w] = MX.cross;
    // solid flat underside outside the pocket: a corner and a strip beside the pocket
    expect(await volumeIn(cap, [b.min[0], b.min[1], 0], [b.min[0] + 2, b.min[1] + 2, MX.engage])).toBeCloseTo(4 * MX.engage, 3);
    expect(await volumeIn(cap, ...around(cx + 9, cy, 1, 1, 0, MX.engage))).toBeCloseTo(MX.engage, 3);
    // the pocket ring is empty, between the stem and the 14.0 ceiling
    expect(await volumeIn(cap, ...around(cx + 5, cy, 1, 1, 0, MX.engage))).toBeCloseTo(0, 3);
    // the cross is open both ways, the stem solid beside it, and the roof solid above
    expect(await volumeIn(cap, ...around(cx, cy, a, w, 0, MX.engage))).toBeCloseTo(0, 3);
    expect(await volumeIn(cap, ...around(cx, cy, w, a, 0, MX.engage))).toBeCloseTo(0, 3);
    expect(await volumeIn(cap, ...around(cx + 1.5, cy + 1.5, 0.5, 0.5, 0, MX.engage))).toBeCloseTo(0.25 * MX.engage, 3);
    const capT = capThickness(s);
    expect(capT).toBeCloseTo(MX.engage + CAP_ROOF, 6);
    expect(await volumeIn(cap, ...around(cx, cy, 16, 16, MX.engage, capT))).toBeCloseTo(256 * CAP_ROOF, 1);
    // the art sits on the backing
    expect(b.max[2]).toBeCloseTo(capT + 1, 4);
  });

  it('matches the reference cross-sections (partsref.obj / Skull.obj) within 0.05 mm', async () => {
    const s = settings(() => {});
    const m = await buildClicker(square(32), s);
    const cap = of(m, 'cap'), body = of(m, 'body');
    const [kx, ky] = center(boxOf(cap)), [bx, by] = center(boxOf(body));
    const L = clickerLevels(s);
    const near = (ours: number, ref: number) => expect(Math.abs(ours - ref), `ours ${ours.toFixed(3)} vs ref ${ref}`).toBeLessThanOrEqual(0.05);
    // cap pocket: 14.518 x 14.499 at the mouth, 13.998 x 13.978 at the ceiling (3.362 / 3.35 deep)
    const mouth = await sliceAt(cap, 0.01, kx, ky, 17, 'void');
    near(mouth.w, 14.518); near(mouth.d, 14.499);
    const ceil = await sliceAt(cap, MX.engage - 0.01, kx, ky, 17, 'void');
    near(ceil.w, 13.998); near(ceil.d, 13.978);
    expect((await sliceAt(cap, MX.engage + 0.02, kx, ky, 17, 'void')).empty).toBe(true);
    near(MX.engage, 3.35);
    // stem 5.787 x 5.790
    const stem = await sliceAt(cap, 1, kx, ky, 6.6, 'solid');
    near(stem.w, 5.787); near(stem.d, 5.790);
    // cross 4.272 / 4.267 long, 1.220 wide
    const cross = await sliceAt(cap, 1, kx, ky, 5.6, 'void', true);
    near(cross.w, 4.272); near(cross.d, 4.267);
    near(cross.w - Math.sqrt(cross.w ** 2 - cross.area), 1.22);
    // body: shaft 14.106 x 14.560, 8.383 deep; column 19.005 x 19.010, 3.0 tall; lead-in 20.000 x 19.996
    const shaft = await sliceAt(body, L.seat - 1, bx, by, 17, 'void');
    near(shaft.w, 14.106); near(shaft.d, 14.56);
    near(L.seat - L.shaftBottom, 8.383);
    expect((await sliceAt(body, L.shaftBottom - 0.02, bx, by, 17, 'void')).empty).toBe(true);
    const column = await sliceAt(body, L.seat + 1.5, bx, by, 19.8, 'void');
    near(column.w, 19.005); near(column.d, 19.01);
    near(L.columnTop - L.seat, 3.0);
    const lead = await sliceAt(body, (L.columnTop + L.wellFloor) / 2, bx, by, 20.8, 'void');
    near(lead.w, 20.0); near(lead.d, 19.996);
  });

  for (const [label, patch] of [
    ['base 2, cap height 2', () => {}],
    ['no base, cap height 4', (s: Settings) => { s.base.enabled = false; s.clicker.capHeight = 4; }],
    ['base 6, cap height 0.5, fit gap 1.5', (s: Settings) => { s.base.height = 6; s.clicker.capHeight = 0.5; s.clicker.fitGap = 1.5; }],
  ] as const) {
    it(`the well leaves 4 mm of travel plus the margin and the cap stands proud (${label})`, async () => {
      const s = settings(patch);
      const m = await buildClicker(square(32), s);
      const capT = capThickness(s);
      const L = clickerLevels(s, capT);
      expect(L.capUnder - L.wellFloor).toBeCloseTo(MX.travel + TRAVEL_MARGIN, 6);
      expect(L.capUnder + capT - L.rimTop).toBeCloseTo(s.clicker.capHeight, 6);
      // the socket ceiling sits on the switch stem tip
      expect(L.capUnder + MX.engage).toBeCloseTo(L.seat + MX.above, 6);
      expect(m.clicker!.restZ).toBeCloseTo(L.capUnder, 6);
      expect(m.clicker!.pressedZ).toBeCloseTo(L.capUnder - MX.travel, 6);
      expect(m.clicker!.rimZ).toBeCloseTo(L.rimTop, 6);
      const body = of(m, 'body'), b = boxOf(body);
      expect(b.max[2]).toBeCloseTo(L.rimTop, 4);
      const [cx, cy] = center(b);
      // open over the art from the well floor up, solid just below it (outside the lead-in)
      expect(await volumeIn(body, ...around(cx, cy, 40, 40, L.wellFloor, L.rimTop))).toBeCloseTo(0, 2);
      expect(await volumeIn(body, [cx - 19, cy - 19, L.wellFloor - 1], [cx - 17, cy - 17, L.wellFloor])).toBeCloseTo(4, 3);
      // the well is the art plus the fit gap
      const g = s.clicker.fitGap;
      expect(await volumeIn(body, ...around(cx, cy, 40 + 2 * g, 40 + 2 * g, L.wellFloor, L.rimTop))).toBeCloseTo(0, 2);
      expect(await volumeIn(body, ...around(cx, cy, 40 + 2 * g + 0.2, 40 + 2 * g + 0.2, L.wellFloor + 0.1, L.rimTop))).toBeGreaterThan(0);
    });
  }

  it('assembled with model.clicker, the cap clears the body at rest and fully pressed, over each shaft', async () => {
    const s = settings((s) => { s.clicker.switches = 3; s.size.keepAspect = false; s.size.width = 64; s.size.height = 24; });
    const m = await buildClicker(square(32), s);
    const a = m.clicker!;
    const cap = of(m, 'cap'), body = of(m, 'body');
    const B = await solidOf(body);
    for (const z of [a.restZ, a.pressedZ]) {
      const C = await solidOf(cap, [a.capShift[0], a.capShift[1], z]);
      const hit = C.intersect(B);
      expect(hit.volume()).toBeCloseTo(0, 4);
      for (const o of [C, hit]) o.delete();
    }
    B.delete();
    // each cap stem's cross socket, moved by capShift, sits over a body shaft
    const L = clickerLevels(s);
    const [kx, ky] = center(boxOf(cap));
    for (const k of [-1, 0, 1]) {
      const x = kx + k * MX.pitch;
      expect(await volumeIn(cap, ...around(x, ky, MX.cross[0], MX.cross[1], 0, MX.engage))).toBeCloseTo(0, 3);
      const bx = x + a.capShift[0], by = ky + a.capShift[1];
      expect(await volumeIn(body, ...around(bx, by, MX.shaft[0], MX.shaft[1], L.shaftBottom, L.seat))).toBeCloseTo(0, 3);
      expect(await volumeIn(body, ...around(bx, by, MX.shaft[0] + 0.4, MX.shaft[1] + 0.4, L.shaftBottom, L.seat))).toBeGreaterThan(1);
    }
  });

  it('art under 17.5 mm gives a warning; 40 mm art does not', async () => {
    const small = await buildClicker(square(16), settings((s) => { s.size.width = 15; }));
    expect(small.warnings.join(' ')).toMatch(/17\.5 mm/);
    for (const p of small.parts) await assertManifold(p);
    const ok = await buildClicker(square(32), settings(() => {}));
    expect(ok.warnings).toEqual([]);
  });

  it('three switches on art too short for them gives a warning', async () => {
    const m = await buildClicker(square(32), settings((s) => { s.clicker.switches = 3; }));
    expect(m.warnings.join(' ')).toMatch(/3 switches/);
  });

  it('ignores a keychain hole, magnets, sides and inside', async () => {
    const plain = await buildClicker(potion, settings(() => {}));
    const busy = await buildClicker(potion, settings((s) => {
      s.keychain.type = 'hole'; s.magnets.at = [{ fx: 0.5, fy: 0.5 }]; s.sides.mode = 'halves'; s.inside.mode = 'hollow';
    }));
    expect(busy.parts.map((p) => [p.object, p.name, p.mesh.triVerts.length])).toEqual(plain.parts.map((p) => [p.object, p.name, p.mesh.triVerts.length]));
  });

  for (const [shape, angle] of [['outline', 0], ['circle', 90], ['square', 225]] as const) {
    it(`a keychain loop joins the body (${shape} body, ${angle}°): one piece, at the bed, cap unchanged`, async () => {
      const plain = await buildClicker(potion, settings((s) => { s.clicker.shape = shape; }));
      const m = await buildClicker(potion, settings((s) => {
        s.clicker.shape = shape; s.keychain.type = 'loop'; s.keychain.loop.angle = angle; s.keychain.loop.style = angle === 90 ? 'pixel' : 'round';
      }));
      const body = (x: typeof m) => x.parts.find((p) => p.object === 'body')!;
      for (const p of m.parts) await assertManifold(p);
      expect(m.pieceCounts).toEqual({ cap: 1, body: 1 });
      expect(m.parts.filter((p) => p.object === 'body').map((p) => p.name)).toEqual(['base']);
      const vol = (x: typeof m) => volumeIn([body(x)], [-500, -500, -500], [500, 500, 500]);
      expect(await vol(m)).toBeGreaterThan(await vol(plain));
      const zs = (x: typeof m) => { const v = body(x).mesh.vertProperties; let lo = Infinity; for (let i = 2; i < v.length; i += 3) lo = Math.min(lo, v[i]!); return lo; };
      expect(zs(m)).toBeCloseTo(0, 6);
      // the loop sticks out on its side: at 0° the body grows upward (+Y)
      if (angle === 0) expect(m.bounds.max[1]).toBeGreaterThan(plain.bounds.max[1] + 4);
      const caps = (x: typeof m) => x.parts.filter((p) => p.object === 'cap').map((p) => p.mesh.triVerts.length);
      expect(caps(m)).toEqual(caps(plain));
    });
  }

  it('a keychain loop at Center sits halfway up the body; Bottom sits on the bed', async () => {
    const at = (loopAt: 'bottom' | 'center') => buildClicker(potion, settings((s) => { s.keychain.type = 'loop'; s.clicker.loopAt = loopAt; }));
    const bottom = await at('bottom'), center = await at('center');
    const L = clickerLevels(settings(() => {}));
    const t = Math.min(DEFAULTS.base.height, L.rimTop);
    // the loop is the only body plastic above the plain body's top edge (+Y), so its z range shows there
    const plain = await buildClicker(potion, settings(() => {}));
    const top = plain.parts.find((p) => p.object === 'body')!;
    const yTop = (() => { const v = top.mesh.vertProperties; let m = -Infinity; for (let i = 1; i < v.length; i += 3) m = Math.max(m, v[i]!); return m; })();
    const zIn = async (m: Model) => {
      const b = m.parts.filter((p) => p.object === 'body');
      const lo = await volumeIn(b, [-500, yTop + 0.5, -1], [500, 500, t / 2]), hi = await volumeIn(b, [-500, yTop + 0.5, (L.rimTop - t) / 2 + t / 2], [500, 500, L.rimTop]);
      return { lo, hi };
    };
    const zb = await zIn(bottom), zc = await zIn(center);
    expect(zb.lo).toBeGreaterThan(1);
    expect(zb.hi).toBeCloseTo(0, 3);
    expect(zc.lo).toBeCloseTo(0, 3);
    expect(zc.hi).toBeGreaterThan(1);
    for (const p of center.parts) await assertManifold(p);
    expect(center.pieceCounts).toEqual({ cap: 1, body: 1 });
  });

  it('the 3MF has two objects; toSTL gives name_cap and name_body', async () => {
    const m = await buildClicker(potion, settings(() => {}));
    const zip = unzipSync(await to3MF(m, { slicer: 'generic', mono: false, name: 'potion' }));
    const xml = strFromU8(zip['3D/3dmodel.model']!);
    expect(xml.match(/<item /g)).toHaveLength(2);
    expect(xml).toContain('name="potion_cap"');
    expect(xml).toContain('name="potion_body"');
    const bambu = strFromU8(unzipSync(await to3MF(m, { slicer: 'bambu', mono: false, name: 'potion' }))['3D/3dmodel.model']!);
    expect(bambu.match(/<item /g)).toHaveLength(2);
    const stl = await toSTL(m, { mono: false, name: 'potion' });
    expect(stl.map((f) => f.name)).toEqual(['potion_cap.stl', 'potion_body.stl']);
  });
});

describe('art with holes and narrow art', () => {
  for (const base of [true, false]) {
    for (const hole of [4, 12]) {
      it(`a ${hole} px hole over the switch (${base ? 'base' : 'no base'}): 1 cap piece, the body open over the switch, no warning`, async () => {
        const lo = 16 - hole / 2, hi = 16 + hole / 2;
        const s = settings((s) => { s.base.enabled = base; });
        const m = await buildClicker(holed(32, (x, y) => x >= lo && x < hi && y >= lo && y < hi), s);
        for (const p of m.parts) await assertManifold(p);
        expect(m.pieces).toBe(1);
        expect(m.warnings).toEqual([]);
        const body = of(m, 'body');
        const [cx, cy] = center(boxOf(body));
        const L = clickerLevels(s);
        expect(await volumeIn(body, ...around(cx, cy, 40, 40, L.wellFloor, L.rimTop))).toBeCloseTo(0, 2);
      });
    }
  }

  it("art too narrow over the switch (a notch to the center) warns that it doesn't cover the switch", async () => {
    const m = await buildClicker(holed(32, (x, y) => x >= 14 && x < 18 && y < 17), settings(() => {}));
    expect(m.warnings.join(' ')).toMatch(/doesn't fully cover the switch/);
    for (const p of m.parts) await assertManifold(p);
  });
});

describe('convert', () => {
  it('a clicker preset writes name_cap.stl and name_body.stl, or one 3MF', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/potion.png', import.meta.url)));
    const stl = await convert(bytes, { version: 1, settings: { make: 'clicker', export: { format: 'stl' } }, colorRules: [] }, 'potion');
    expect(stl.report.error).toBeUndefined();
    expect(stl.report.files).toEqual(['potion_cap.stl', 'potion_body.stl']);
    const mf = await convert(bytes, { version: 1, settings: { make: 'clicker' }, colorRules: [] }, 'potion');
    expect(mf.report.files).toEqual(['potion.3mf']);
  });
});

describe('fitTest', () => {
  it('a stem coupon and three small shaft coupons at shaft size -0.1, 0, +0.1, tightest first, notched 1-3', async () => {
    const s = settings(() => {});
    expect(FIT_STEPS).toEqual([-0.1, 0, 0.1]);
    const m = await fitTest(s);
    const objects = [...new Set(m.parts.map((p) => p.object))];
    expect(objects).toEqual(['stem', 'socket_-0.10', 'socket_+0.00', 'socket_+0.10']);
    for (const p of m.parts) await assertManifold(p);
    let lastX = -Infinity;
    for (const o of objects) {
      const b = boxOf(of(m, o));
      expect(b.min[2]).toBeCloseTo(0, 4);
      for (let a = 0; a < 3; a++) expect(b.max[a]! - b.min[a]!).toBeLessThan(25);
      expect(b.min[0]).toBeGreaterThan(lastX);
      lastX = b.max[0];
    }
    // the stem coupon is the cap's underside: pocket, stem and cross, printed underside down
    const stem = of(m, 'stem');
    const [tx, ty] = center(boxOf(stem));
    expect(await volumeIn(stem, ...around(tx, ty, MX.cross[0], MX.cross[1], 0, MX.engage))).toBeCloseTo(0, 3);
    expect(await volumeIn(stem, ...around(tx, ty, MX.cross[1], MX.cross[0], 0, MX.engage))).toBeCloseTo(0, 3);
    expect(await volumeIn(stem, ...around(tx + 5, ty, 1, 1, 0, MX.engage))).toBeCloseTo(0, 3);
    const mouth = await sliceAt(stem, 0.01, tx, ty, 16, 'void');
    expect(mouth.w).toBeCloseTo(MX.pocket[0], 1);
    const seat = MX.floor + MX.depth;
    for (const [k, d] of FIT_STEPS.entries()) {
      const name = `socket_${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(2)}` as Part['object'];
      const sock = of(m, name), sb = boxOf(sock);
      const [sx, sy] = center(sb);
      // the shaft at this step, over a floor, then the 19.0 column
      const shaft = await sliceAt(sock, seat - 1, sx, sy, 17, 'void');
      expect(shaft.w).toBeCloseTo(MX.shaft[0] + d, 3);
      expect(shaft.d).toBeCloseTo(MX.shaft[1] + d, 3);
      expect(await volumeIn(sock, ...around(sx, sy, 10, 10, 0, MX.floor))).toBeCloseTo(100 * MX.floor, 2);
      const column = await sliceAt(sock, seat + 1.5, sx, sy, 19.8, 'void');
      expect(column.w).toBeCloseTo(MX.column, 3);
      // k + 1 notches in the top of the front wall: count the gaps along a strip there
      const front = sb.min[1] + 1;
      let notches = 0, inNotch = false;
      for (let x = sb.min[0] + 0.25; x < sb.max[0]; x += 0.25) {
        const open = (await volumeIn(sock, [x - 0.05, front - 0.25, sb.max[2] - 0.5], [x + 0.05, front + 0.25, sb.max[2]])) < 1e-6;
        if (open && !inNotch) notches++;
        inNotch = open;
      }
      expect(notches).toBe(k + 1);
    }
    const stl = await toSTL(m, { mono: false, name: 'fit' });
    expect(stl.map((f) => f.name)).toEqual(['fit_stem.stl', 'fit_socket_-0.10.stl', 'fit_socket_+0.00.stl', 'fit_socket_+0.10.stl']);
  });
});

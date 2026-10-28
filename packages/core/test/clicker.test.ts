import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildClicker, buildModel, clickerLevels, convert, decodeImage, DEFAULTS, detectScale, downsampleNearest, fitTest, MX, to3MF, toGrid, toSTL } from '../src/index';
import type { Grid, Model, Part, Settings } from '../src/index';
import { initManifold } from '../src/manifold';
import { assertManifold } from './util/assertManifold';

type Mesh = Part['mesh'];
type Box3 = { min: [number, number, number]; max: [number, number, number] };

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
/** An n x n sprite of one colour. */
const square = (n: number, height = 1): Grid => ({ w: n, h: n, cells: new Int16Array(n * n), palette: [{ hex: '#cc3333', height }] });

const boxOf = (parts: Part[]): Box3 => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const v = p.mesh.vertProperties;
    for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, v[i + a]!); max[a] = Math.max(max[a]!, v[i + a]!); }
  }
  return { min, max };
};
const of = (m: Model, object: Part['object']) => m.parts.filter((p) => p.object === object);

/** Volume of the parts' union inside an axis-aligned box, mm³. */
const volumeIn = async (parts: Part[], lo: [number, number, number], hi: [number, number, number]) => {
  const { Manifold, Mesh } = await initManifold();
  const ms = parts.map((p: { mesh: Mesh }) => new Manifold(new Mesh({ numProp: 3, ...p.mesh })));
  const u = Manifold.union(ms);
  const cube = Manifold.cube([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]).translate(lo);
  const cut = u.intersect(cube);
  try { return cut.volume(); } finally { for (const o of [...ms, u, cube, cut]) o.delete(); }
};
/** A box centred on (x, y), w x d across, from z0 to z1. */
const around = (x: number, y: number, w: number, d: number, z0: number, z1: number) =>
  [[x - w / 2, y - d / 2, z0], [x + w / 2, y + d / 2, z1]] as [[number, number, number], [number, number, number]];

let potion: Grid;
beforeAll(async () => { potion = await load('potion.png'); await initManifold(); });

describe('MX', () => {
  it('holds the nominal Cherry MX numbers of spec §4.6b', () => {
    expect(MX).toEqual({ cut: 14, column: 15.6, plate: 1.5, below: 8.5, floor: 1.2, above: 11.6, stemD: 5.5, cross: [4.1, 1.3], engage: 3.8, stemLen: 4.5, travel: 4, pitch: 19.05 });
  });
});

describe('buildClicker', () => {
  for (const shape of ['outline', 'circle', 'square'] as const) {
    for (const n of [1, 2, 3] as const) {
      it(`${shape}, ${n} switch${n > 1 ? 'es' : ''}: a manifold cap and body`, async () => {
        const s = settings((s) => { s.clicker.shape = shape; s.clicker.switches = n; s.size.width = 64; });
        const t0 = performance.now();
        const m = await buildClicker(potion, s);
        const ms = performance.now() - t0;
        expect(ms).toBeLessThan(2000);
        expect([...new Set(m.parts.map((p) => p.object))]).toEqual(['cap', 'body']);
        for (const p of m.parts) await assertManifold(p);
        expect(m.pieces).toBe(1);
        // the body is the base colour, one part
        expect(of(m, 'body').map((p) => [p.name, p.hex])).toEqual([['base', DEFAULTS.base.colour]]);
        // printed apart on the bed: nothing below Z 0, cap beside the body
        const all = boxOf(m.parts), cap = boxOf(of(m, 'cap')), body = boxOf(of(m, 'body'));
        expect(all.min[2]).toBeCloseTo(0, 4);
        expect(cap.min[2]).toBeCloseTo(0, 4);
        expect(body.min[2]).toBeCloseTo(0, 4);
        expect(cap.min[0]).toBeGreaterThan(body.max[0]);
        expect(m.size.x).toBeCloseTo(all.max[0] - all.min[0], 3);
        expect(m.size.z).toBeCloseTo(all.max[2], 3);
      });
    }
  }

  it('buildModel branches into it when make is clicker', async () => {
    const m = await buildModel(potion, settings(() => {}));
    expect([...new Set(m.parts.map((p) => p.object))]).toEqual(['cap', 'body']);
  });

  it('the body has a 14.0 x 14.0 opening at the plate height, the column below it and a floor', async () => {
    const s = settings(() => { /* 40 mm square art */ });
    const m = await buildClicker(square(32), s);
    const body = of(m, 'body'), b = boxOf(body);
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
    const L = clickerLevels(s, 2);
    expect(L.plateTop - L.plateBottom).toBeCloseTo(MX.plate, 6);
    // the plate: nothing inside 14.0 x 14.0, plastic just outside it
    expect(await volumeIn(body, ...around(cx, cy, 14, 14, L.plateBottom, L.plateTop))).toBeCloseTo(0, 3);
    expect(await volumeIn(body, ...around(cx, cy, 14.4, 14.4, L.plateBottom, L.plateTop))).toBeCloseTo((14.4 ** 2 - 14 ** 2) * MX.plate, 1);
    // 15.6 square column of clearance below the plate, over a 1.2 mm floor
    expect(await volumeIn(body, ...around(cx, cy, MX.column, MX.column, MX.floor, L.plateBottom))).toBeCloseTo(0, 3);
    expect(await volumeIn(body, ...around(cx, cy, 10, 10, 0, MX.floor))).toBeCloseTo(100 * MX.floor, 2);
  });

  it('two and three switches sit at keyboard pitch along the long side, each with its own socket', async () => {
    const s = settings((s) => { s.clicker.switches = 3; s.size.keepAspect = false; s.size.width = 64; s.size.height = 24; });
    const m = await buildClicker(square(32), s);
    const body = of(m, 'body'), b = boxOf(body);
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
    const L = clickerLevels(s, 2);
    for (const dx of [-MX.pitch, 0, MX.pitch]) {
      expect(await volumeIn(body, ...around(cx + dx, cy, 14, 14, L.plateBottom, L.plateTop))).toBeCloseTo(0, 3);
    }
    // between sockets, the plate is solid
    expect(await volumeIn(body, ...around(cx + MX.pitch / 2, cy, 2, 2, L.plateBottom, L.plateTop))).toBeCloseTo(4 * MX.plate, 3);
  });

  it('cap stems have the MX cross socket, 3.8 mm deep, under a solid stem top', async () => {
    const m = await buildClicker(square(32), settings(() => {}));
    const cap = of(m, 'cap'), b = boxOf(cap);
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
    const [w, h] = MX.cross;
    // both arms are open from the stem's tip up to the engage depth
    expect(await volumeIn(cap, ...around(cx, cy, w, h, 0, MX.engage))).toBeCloseTo(0, 3);
    expect(await volumeIn(cap, ...around(cx, cy, h, w, 0, MX.engage))).toBeCloseTo(0, 3);
    // the socket is exactly that size: plastic right beside the arms
    expect(await volumeIn(cap, ...around(cx, cy, w + 0.4, h, 0.1, MX.engage - 0.1))).toBeGreaterThan(0);
    expect(await volumeIn(cap, ...around(cx, cy, h + 0.4, h + 0.4, 0, MX.engage))).toBeGreaterThan(0);
    // the stem is solid above the socket, and round 5.5 mm
    expect(await volumeIn(cap, ...around(cx, cy, 1, 1, MX.engage + 0.1, MX.stemLen - 0.1))).toBeCloseTo(0.5, 3);
    const ring = await volumeIn(cap, ...around(cx, cy, 8, 8, 0, MX.stemLen));
    expect(ring).toBeCloseTo(Math.PI * (MX.stemD / 2) ** 2 * MX.stemLen - 2 * w * h * MX.engage + h * h * MX.engage, 0);
  });

  it('the cap has a skirt round its edge as tall as the stems, clear of the switch', async () => {
    const m = await buildClicker(square(32), settings(() => {}));
    const cap = of(m, 'cap'), b = boxOf(cap);
    // the corner of the cap stands on the skirt
    expect(await volumeIn(cap, [b.min[0], b.min[1], 0], [b.min[0] + 1, b.min[1] + 1, MX.stemLen])).toBeCloseTo(MX.stemLen, 3);
    // nothing but the stem within the switch's clearance
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
    const clear = MX.column + 2;
    const v = await volumeIn(cap, ...around(cx, cy, clear, clear, 0, MX.stemLen));
    expect(v).toBeCloseTo(await volumeIn(cap, ...around(cx, cy, 8, 8, 0, MX.stemLen)), 3);
  });

  for (const [label, patch] of [
    ['base, cap height 2', () => {}],
    ['no base, cap height 4', (s: Settings) => { s.base.enabled = false; s.clicker.capHeight = 4; }],
    ['base 5, cap height 0.5', (s: Settings) => { s.base.height = 5; s.clicker.capHeight = 0.5; }],
  ] as const) {
    it(`the well leaves at least 4 mm of travel and the cap stands proud (${label})`, async () => {
      const s = settings(patch);
      const m = await buildClicker(square(32), s);
      const capT = s.base.enabled ? s.base.height : 1;
      const L = clickerLevels(s, capT);
      // assembled at rest, the cap's lowest point (stems, skirt) is 4 mm or more above the well floor
      expect(L.capUnder - MX.stemLen - L.wellFloor).toBeGreaterThanOrEqual(MX.travel - 1e-9);
      // the cap's backing stands `capHeight` above the rim at rest
      expect(L.capUnder + capT - L.rimTop).toBeCloseTo(s.clicker.capHeight, 6);
      // the stems hold the switch's stem: socket top at the switch stem top
      expect(L.capUnder - MX.stemLen + MX.engage).toBeCloseTo(L.plateTop + MX.above, 6);
      // the body really is open over the art from the well floor up, and solid just below it (off the switch)
      const body = of(m, 'body'), b = boxOf(body);
      expect(b.max[2]).toBeCloseTo(L.rimTop, 4);
      const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
      expect(await volumeIn(body, ...around(cx, cy, 40, 40, L.wellFloor, L.rimTop))).toBeCloseTo(0, 2);
      const corner: [number, number, number] = [cx - 19, cy - 19, L.wellFloor - 1];
      expect(await volumeIn(body, corner, [cx - 17, cy - 17, L.wellFloor])).toBeCloseTo(4, 3);
      // the well is the art plus the fit gap: the rim starts just outside it
      expect(await volumeIn(body, ...around(cx, cy, 40 + 2 * s.clicker.fitGap, 40 + 2 * s.clicker.fitGap, L.wellFloor, L.rimTop))).toBeCloseTo(0, 2);
      expect(await volumeIn(body, ...around(cx, cy, 40 + 2 * s.clicker.fitGap + 0.2, 40 + 2 * s.clicker.fitGap + 0.2, L.wellFloor + 0.1, L.rimTop))).toBeGreaterThan(0);
    });
  }

  it('art under 17.6 mm gives a warning; 40 mm art does not', async () => {
    const small = await buildClicker(square(16), settings((s) => { s.size.width = 15; }));
    expect(small.warnings.join(' ')).toMatch(/17\.6 mm/);
    for (const p of small.parts) await assertManifold(p);
    const ok = await buildClicker(square(32), settings(() => {}));
    expect(ok.warnings).toEqual([]);
  });

  it('three switches on art too short for them gives a warning', async () => {
    const m = await buildClicker(square(32), settings((s) => { s.clicker.switches = 3; }));
    expect(m.warnings.join(' ')).toMatch(/3 switches/);
  });

  it('ignores keychain, magnets, sides and inside', async () => {
    const plain = await buildClicker(potion, settings(() => {}));
    const busy = await buildClicker(potion, settings((s) => {
      s.keychain.type = 'hole'; s.magnets.at = [{ fx: 0.5, fy: 0.5 }]; s.sides.mode = 'halves'; s.inside.mode = 'hollow';
    }));
    expect(busy.parts.map((p) => [p.object, p.name, p.mesh.triVerts.length])).toEqual(plain.parts.map((p) => [p.object, p.name, p.mesh.triVerts.length]));
  });

  it('the 3MF has two objects; toSTL gives name_cap and name_body, each one body', async () => {
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

describe('convert', () => {
  it('a clicker preset writes name_cap.stl and name_body.stl, or one 3MF', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/potion.png', import.meta.url)));
    const stl = await convert(bytes, { version: 1, settings: { make: 'clicker', export: { format: 'stl' } }, colourRules: [] }, 'potion');
    expect(stl.report.error).toBeUndefined();
    expect(stl.report.files).toEqual(['potion_cap.stl', 'potion_body.stl']);
    const mf = await convert(bytes, { version: 1, settings: { make: 'clicker' }, colourRules: [] }, 'potion');
    expect(mf.report.files).toEqual(['potion.3mf']);
  });
});

describe('fitTest', () => {
  it('is two small manifold objects: a socket coupon with the 14.0 opening and a stem coupon with the cross socket', async () => {
    const s = settings(() => {});
    const m = await fitTest(s);
    const objects = [...new Set(m.parts.map((p) => p.object))];
    expect(objects).toEqual(['stem', 'socket']);
    for (const p of m.parts) await assertManifold(p);
    for (const o of objects) {
      const b = boxOf(of(m, o));
      expect(b.min[2]).toBeCloseTo(0, 4);
      for (let a = 0; a < 3; a++) expect(b.max[a]! - b.min[a]!).toBeLessThan(25);
    }
    const sock = of(m, 'socket'), sb = boxOf(sock);
    const sx = (sb.min[0] + sb.max[0]) / 2, sy = (sb.min[1] + sb.max[1]) / 2, top = sb.max[2];
    expect(await volumeIn(sock, ...around(sx, sy, 14, 14, top - MX.plate, top))).toBeCloseTo(0, 3);
    expect(await volumeIn(sock, ...around(sx, sy, 14.4, 14.4, top - MX.plate, top))).toBeCloseTo((14.4 ** 2 - 14 ** 2) * MX.plate, 1);
    const stem = of(m, 'stem'), tb = boxOf(stem);
    const tx = (tb.min[0] + tb.max[0]) / 2, ty = (tb.min[1] + tb.max[1]) / 2;
    expect(await volumeIn(stem, ...around(tx, ty, MX.cross[0], MX.cross[1], tb.max[2] - MX.engage, tb.max[2]))).toBeCloseTo(0, 3);
    expect(await volumeIn(stem, ...around(tx, ty, MX.cross[1], MX.cross[0], tb.max[2] - MX.engage, tb.max[2]))).toBeCloseTo(0, 3);
    const stl = await toSTL(m, { mono: false, name: 'fit' });
    expect(stl.map((f) => f.name)).toEqual(['fit_stem.stl', 'fit_socket.stl']);
  });
});

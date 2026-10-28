import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildModel, capThickness, clickerLevels, convert, decodeImage, DEFAULTS, detectScale, downsampleNearest, filamentColors,
  filamentSlots, MX, opaqueBox, pixelSize, settingsSchema, to3MF, toGrid,
} from '../src/index';
import type { Grid, Model, Part, Settings } from '../src/index';
import { initManifold } from '../src/manifold';
import { traceLoops } from '../src/outline';
import { assertManifold } from './util/assertManifold';

// v0.2.35 (user request 2026-10-28): clicker piece counts, cap backing color, smooth edges and the outline ring.

type Vec3 = [number, number, number];
type Box3 = { min: Vec3; max: Vec3 };

const load = async (name: string): Promise<Grid> => {
  const img = await decodeImage(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));
  return toGrid(downsampleNearest(img, detectScale(img)), 16);
};
const settings = (patch: (s: Settings) => void = () => {}): Settings => {
  const s = structuredClone(DEFAULTS);
  patch(s);
  return s;
};
const clicker = (patch: (s: Settings) => void = () => {}) => settings((s) => { s.make = 'clicker'; patch(s); });

/**
 * A sprite from text rows (top row first): '.' is empty, a digit is that palette entry. Palette entries are
 * `[hex, height]`.
 */
const sprite = (rows: string[], palette: [string, number][] = [['#cc3333', 1]]): Grid => {
  const h = rows.length, w = rows[0]!.length;
  const cells = new Int16Array(w * h);
  rows.forEach((r, y) => { for (let x = 0; x < w; x++) cells[y * w + x] = r[x] === '.' ? -1 : Number(r[x]); });
  return { w, h, cells, palette: palette.map(([hex, height]) => ({ hex, height })) };
};
/** An n x n square of one color. */
const square = (n: number, hex = '#cc3333', height = 1): Grid => ({ w: n, h: n, cells: new Int16Array(n * n), palette: [{ hex, height }] });
/** Rows of `w` cells where `on(x, y)` (y from the top) is palette 0, else empty. */
const shape = (w: number, h: number, on: (x: number, y: number) => boolean) =>
  sprite(Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (on(x, y) ? '0' : '.')).join('')));

const boxOf = (parts: Part[]): Box3 => {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const v = p.mesh.vertProperties;
    for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, v[i + a]!); max[a] = Math.max(max[a]!, v[i + a]!); }
  }
  return { min, max };
};
const of = (m: Model, object: Part['object']) => m.parts.filter((p) => p.object === object);
const named = (m: Model, name: string) => m.parts.filter((p) => p.name === name);
const center = (b: Box3) => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] as const;

/** The parts' union as one Manifold (caller deletes), optionally moved. */
const solidOf = async (parts: Part[], move: Vec3 = [0, 0, 0]) => {
  const { Manifold, Mesh } = await initManifold();
  const ms = parts.map((p) => new Manifold(new Mesh({ numProp: 3, ...p.mesh })));
  const u = Manifold.union(ms);
  const out = u.translate(move);
  for (const o of [...ms, u]) o.delete();
  return out;
};
const piecesOf = async (parts: Part[]) => {
  const u = await solidOf(parts);
  const d = u.decompose();
  const n = d.length;
  for (const o of [...d, u]) o.delete();
  return n;
};
/** Volume of the parts' union inside an axis-aligned box, mm³. */
const volumeIn = async (parts: Part[], lo: Vec3, hi: Vec3) => {
  const { Manifold } = await initManifold();
  const u = await solidOf(parts);
  const c0 = Manifold.cube([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]), cube = c0.translate(lo);
  const cut = u.intersect(cube);
  try { return cut.volume(); } finally { for (const o of [u, c0, cube, cut]) o.delete(); }
};
const around = (x: number, y: number, w: number, d: number, z0: number, z1: number) =>
  [[x - w / 2, y - d / 2, z0], [x + w / 2, y + d / 2, z1]] as [Vec3, Vec3];

/** The art's footprint in mm, in the model frame (the opaque box corner at the origin), as core lays it out. */
const artMm = async (g: Grid, px: number) => {
  const { CrossSection } = await initManifold();
  const on = new Uint8Array(g.cells.length);
  let x0 = Infinity, y0 = Infinity;
  for (let k = 0; k < on.length; k++) {
    if (g.cells[k]! < 0) continue;
    on[k] = 1;
    const x = k % g.w, y = g.h - 1 - (k - x) / g.w;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
  }
  const a = new CrossSection(traceLoops(on, g.w, g.h), 'Positive'), b = a.translate([-x0, -y0]), c = b.scale([px, px]);
  a.delete(); b.delete();
  return c;
};

/** Pocket mouth and ceiling, stem and cross of a cap at its center, as the clicker tests measure them. */
async function pocketOf(cap: Part[]) {
  const { CrossSection } = await initManifold();
  const u = await solidOf(cap);
  const [kx, ky] = center(boxOf(cap));
  const voidAt = (z: number, win: number) => {
    const sl = u.slice(z), w0 = CrossSection.square([win, win], true), w = w0.translate([kx, ky]), r = w.subtract(sl);
    const b = r.bounds();
    try { return [b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!].map((v) => Math.round(v * 1000) / 1000); } finally { for (const o of [sl, w0, w, r]) o.delete(); }
  };
  const solidAt = (z: number, win: number) => {
    const sl = u.slice(z), w0 = CrossSection.square([win, win], true), w = w0.translate([kx, ky]), r = w.intersect(sl);
    const b = r.bounds();
    try { return [b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!].map((v) => Math.round(v * 1000) / 1000); } finally { for (const o of [sl, w0, w, r]) o.delete(); }
  };
  try {
    return { mouth: voidAt(0.01, 17), ceiling: voidAt(MX.engage - 0.01, 17), stem: solidAt(1, 6.6), cross: voidAt(1, 5) };
  } finally { u.delete(); }
}

let potion: Grid;
beforeAll(async () => { potion = await load('potion.png'); await initManifold(); });

describe('settings', () => {
  it('smooth, outline and clicker.backing have defaults and limits', () => {
    expect(DEFAULTS.smooth).toBe(false);
    expect(DEFAULTS.outline).toEqual({ on: false, width: 1.5, color: '#000000' });
    expect(DEFAULTS.clicker.backing).toBe('base');
    const ok = (patch: (s: Settings) => void) => settingsSchema.safeParse(settings(patch)).success;
    expect([0.4, 0.5, 5, 5.1].map((w) => ok((s) => { s.outline.width = w; }))).toEqual([false, true, true, false]);
    expect(ok((s) => { (s.clicker as { backing: string }).backing = 'nope'; })).toBe(false);
  });

  it('a preset sets them (CLI --set, HTTP and MCP all go through presets)', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/potion.png', import.meta.url)));
    const r = await convert(bytes, { version: 1, settings: { smooth: true, outline: { on: true, color: '#FFFFFF' } }, colorRules: [] }, 'potion');
    expect(r.report.error).toBeUndefined();
    const cfg = strFromU8(unzipSync(r.files[0]!.bytes)['Metadata/model_settings.config']!);
    expect(cfg).toContain('value="outline"');
  });
});

describe('clicker piece counts (bug fix)', () => {
  // 20 x 10 cells at 2 mm: three 6-cell islands with 1-cell (2 mm) gaps
  const three = shape(20, 10, (x) => x % 7 !== 6);

  it('three islands with gaps under 3 mm are bridged into one cap and one body; the art is unchanged', async () => {
    const s = clicker((s) => { s.size.width = 40; });
    const m = await buildModel(three, s);
    expect(m.pieceCounts).toEqual({ cap: 1, body: 1 });
    expect(m.pieces).toBe(1);
    expect(m.warnings.filter((w) => /pieces/.test(w))).toEqual([]);
    for (const p of m.parts) await assertManifold(p);
    expect(await piecesOf(of(m, 'cap'))).toBe(1);
    // the art itself keeps its gaps: nothing red stands in them
    const art = named(m, '#cc3333');
    const b = boxOf(of(m, 'cap'));
    const capT = capThickness(s);
    expect(await volumeIn(art, [b.min[0] + 12.2, b.min[1], capT + 0.1], [b.min[0] + 13.8, b.max[1], capT + 0.9])).toBeCloseTo(0, 4);
    // ...and the backing under the gap is solid
    expect(await volumeIn(of(m, 'cap'), [b.min[0] + 12.2, b.min[1] + 2, 0.1], [b.min[0] + 13.8, b.min[1] + 4, capT - 0.1])).toBeGreaterThan(1);
  });

  it('widely spaced islands warn, naming the cap; the body is named when it splits too', async () => {
    // 20 mm apart: the switch's guard wall still joins the body
    const far = shape(30, 10, (x) => x < 10 || x >= 20);
    const m = await buildModel(far, clicker((s) => { s.size.width = 60; }));
    expect(m.pieceCounts).toEqual({ cap: 2, body: 1 });
    expect(m.pieces).toBe(2);
    expect(m.warnings).toContain('The cap is in 2 pieces. Move the islands closer together or join them.');
    for (const p of m.parts) await assertManifold(p);
    // a lone island far out on the left: both split
    const lone = shape(40, 10, (x, y) => x >= 20 || (x < 3 && y < 3));
    const m2 = await buildModel(lone, clicker((s) => { s.size.width = 80; }));
    expect(m2.pieceCounts).toEqual({ cap: 2, body: 2 });
    expect(m2.warnings).toContain('The body is in 2 pieces. Move the islands closer together or join them, or pick Circle or Square for the body shape.');
  });

  it('a ring with a dot in its middle is one cap piece', async () => {
    const ring = shape(16, 16, (x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      return d >= 5 || d < 1;
    });
    const m = await buildModel(ring, clicker());
    expect(m.pieceCounts).toEqual({ cap: 1, body: 1 });
    expect(m.warnings.filter((w) => /pieces/.test(w))).toEqual([]);
  });

  it('convert reports the named warning, not a bare "N separate pieces"', async () => {
    const far = shape(30, 10, (x) => x < 10 || x >= 20);
    const m = await buildModel(far, clicker((s) => { s.size.width = 60; }));
    expect(m.warnings.some((w) => /separate pieces/.test(w))).toBe(false);
  });
});

describe('cap backing color', () => {
  const two = sprite(['0011', '0011', '1100', '1100'].flatMap((r) => [r.replace(/./g, (c) => c.repeat(8))].flatMap((x) => Array(8).fill(x))), [['#cc3333', 1], ['#3366cc', 2.5]]);

  it("art mode: no cap part has the base color, the cap is one manifold piece, and the art's top is unchanged", async () => {
    const base = clicker((s) => { s.base.color = '#123456'; });
    const art = clicker((s) => { s.base.color = '#123456'; s.clicker.backing = 'art'; });
    const mb = await buildModel(two, base), ma = await buildModel(two, art);
    expect(of(ma, 'cap').map((p) => p.hex)).not.toContain('#123456');
    expect(of(ma, 'cap').map((p) => p.name).sort()).toEqual(['#3366cc', '#cc3333']);
    expect(of(ma, 'body').map((p) => p.hex)).toEqual(['#123456']);
    for (const p of ma.parts) await assertManifold(p);
    expect(ma.pieceCounts).toEqual({ cap: 1, body: 1 });
    expect(await piecesOf(of(ma, 'cap'))).toBe(1);
    // the top surface: same box, and each color stands as tall over the same area
    expect(boxOf(of(ma, 'cap'))).toEqual(boxOf(of(mb, 'cap')));
    const capT = capThickness(art);
    const b = boxOf(of(ma, 'cap'));
    for (const hex of ['#cc3333', '#3366cc']) {
      const lo: Vec3 = [b.min[0], b.min[1], capT + 0.01], hi: Vec3 = [b.max[0], b.max[1], b.max[2]];
      expect(await volumeIn(named(ma, hex), lo, hi)).toBeCloseTo(await volumeIn(named(mb, hex), lo, hi), 2);
    }
    // each color runs the full depth: red is solid from the underside in its own corner
    expect(await volumeIn(named(ma, '#cc3333'), [b.min[0] + 1, b.max[1] - 3, 0], [b.min[0] + 3, b.max[1] - 1, capT])).toBeCloseTo(4 * capT, 3);
  });

  it('art mode: the pocket, stem and cross are the same as with a base-color backing', async () => {
    const mb = await buildModel(square(32), clicker());
    const ma = await buildModel(square(32), clicker((s) => { s.clicker.backing = 'art'; }));
    expect(await pocketOf(of(ma, 'cap'))).toEqual(await pocketOf(of(mb, 'cap')));
    expect(boxOf(of(ma, 'body'))).toEqual(boxOf(of(mb, 'body')));
  });

  it('art mode: filled holes, bridges and the smoothed margin take the nearest art color', async () => {
    // red left half, blue right half, a hole in the middle straddling both
    const g = sprite(Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x >= 6 && x < 10 && y >= 6 && y < 10 ? '.' : x < 8 ? '0' : '1')).join('')),
      [['#cc3333', 1], ['#3366cc', 1]]);
    const m = await buildModel(g, clicker((s) => { s.clicker.backing = 'art'; s.smooth = true; }));
    for (const p of m.parts) await assertManifold(p);
    expect(of(m, 'cap').map((p) => p.name).sort()).toEqual(['#3366cc', '#cc3333']);
    const b = boxOf(of(m, 'cap'));
    const [cx, cy] = center(b);
    const capT = capThickness(clicker());
    // the filled hole: red on the left of center, blue on the right, solid through the backing (above the pocket)
    expect(await volumeIn(named(m, '#cc3333'), ...around(cx - 2, cy, 1, 1, MX.engage + 0.1, capT - 0.1))).toBeCloseTo(capT - MX.engage - 0.2, 3);
    expect(await volumeIn(named(m, '#3366cc'), ...around(cx + 2, cy, 1, 1, MX.engage + 0.1, capT - 0.1))).toBeCloseTo(capT - MX.engage - 0.2, 3);
  });

  it('filament count and 3MF slots follow the parts present', async () => {
    for (const patch of [
      (s: Settings) => { s.clicker.backing = 'art'; },
      (s: Settings) => { s.clicker.backing = 'art'; s.outline.on = true; },
      (s: Settings) => { s.clicker.backing = 'art'; s.base.color = '#7a4fd6'; },
      (s: Settings) => { s.outline.on = true; s.outline.color = '#7a4fd6'; },
    ]) {
      const s = clicker(patch);
      const m = await buildModel(potion, s);
      expect(filamentColors(potion, s)).toEqual(filamentSlots(m.parts.map((p) => p.hex)));
    }
    // 7 art colors; the body still prints in the base color, so 8 unless the base matches an art color
    const s = clicker((s) => { s.clicker.backing = 'art'; });
    expect(filamentColors(potion, s)).toHaveLength(8);
    expect(filamentColors(potion, clicker((s) => { s.clicker.backing = 'art'; s.base.color = '#7a4fd6'; }))).toHaveLength(7);
  });
});

describe('smooth edges', () => {
  it('the flat base is rounded, contains every art pixel and stays manifold, with a modest vertex count', async () => {
    for (const mode of ['single', 'solid', 'halves'] as const) {
      const sp = settings((s) => { s.sides.mode = mode; });
      const ss = settings((s) => { s.sides.mode = mode; s.smooth = true; });
      const pixel = await buildModel(potion, sp), smooth = await buildModel(potion, ss);
      for (const p of smooth.parts) await assertManifold(p);
      expect(smooth.pieces).toBe(1);
      const base = named(smooth, 'base').filter((p) => p.object !== 'back');
      const pxBase = named(pixel, 'base').filter((p) => p.object !== 'back');
      // the base slice contains the art; the stepped base's corners are gone (it is bigger, rounded)
      const art = await artMm(potion, pixelSize(ss, opaqueBox(potion)!).x);
      const u = await solidOf(base);
      const bz = boxOf(base);
      const sl = u.slice((bz.min[2] + bz.max[2]) / 2);
      const left = art.subtract(sl);
      expect(left.area()).toBeLessThan(1e-6);
      expect(sl.area()).toBeGreaterThan(art.area());
      for (const o of [u, sl, left, art]) o.delete();
      const tris = (ps: Part[]) => ps.reduce((n, p) => n + p.mesh.triVerts.length / 3, 0);
      expect(tris(base)).toBeLessThan(Math.max(4000, 12 * tris(pxBase)));
    }
  });

  it('art columns keep their pixels', async () => {
    const pixel = await buildModel(potion, settings()), smooth = await buildModel(potion, settings((s) => { s.smooth = true; }));
    for (const p of pixel.parts.filter((p) => p.name !== 'base')) {
      const q = smooth.parts.find((x) => x.name === p.name)!;
      expect(q.mesh.triVerts.length).toBe(p.mesh.triVerts.length);
    }
  });

  it('works with a keychain loop, a hole, magnets and a shell inside', async () => {
    for (const patch of [
      (s: Settings) => { s.keychain.type = 'loop'; },
      (s: Settings) => { s.keychain.type = 'loop'; s.base.enabled = false; },
      (s: Settings) => { s.keychain.type = 'hole'; s.magnets.at = [{ fx: 0.5, fy: 0.6 }]; },
      (s: Settings) => { s.inside.mode = 'shell'; s.base.height = 4; },
    ]) {
      const m = await buildModel(potion, settings((s) => { s.smooth = true; patch(s); }));
      for (const p of m.parts) await assertManifold(p);
      expect(m.pieces).toBe(1);
    }
  });

  for (const shape of ['outline', 'circle', 'square'] as const) {
    it(`clicker (${shape}): the well clears the smoothed cap by at least the fit gap everywhere`, async () => {
      const s = clicker((s) => { s.smooth = true; s.clicker.shape = shape; s.size.width = 50; });
      const m = await buildModel(potion, s);
      for (const p of m.parts) await assertManifold(p);
      expect(m.pieceCounts).toEqual({ cap: 1, body: 1 });
      const a = m.clicker!;
      const cap = await solidOf(of(m, 'cap'), [a.capShift[0], 0, 0]), body = await solidOf(of(m, 'body'));
      const L = clickerLevels(s);
      const capSl = cap.slice(capThickness(s) / 2), wellSl = body.slice((L.wellFloor + L.rimTop) / 2);
      const g = s.clicker.fitGap;
      const near = capSl.offset(g - 0.01, 'Round', 2, 64), hit = near.intersect(wellSl);
      expect(hit.area()).toBeLessThan(1e-4);
      // ...and not much more: the wall is within 0.1 mm of the gap somewhere
      const far = capSl.offset(g + 0.1, 'Round', 2, 64), touch = far.intersect(wellSl);
      expect(touch.area()).toBeGreaterThan(0);
      for (const o of [cap, body, capSl, wellSl, near, hit, far, touch]) o.delete();
    });
  }
});

describe('outline', () => {
  const W = 1.5;

  it('flat: an outline part of the right width and height, sitting on the base, which grows to hold it', async () => {
    const s = settings((s) => { s.outline.on = true; s.outline.color = '#ffffff'; });
    const plain = await buildModel(square(32), settings());
    const m = await buildModel(square(32), s);
    for (const p of m.parts) await assertManifold(p);
    const ring = named(m, 'outline');
    expect(ring).toHaveLength(1);
    expect(ring[0]!.hex).toBe('#ffffff');
    expect(ring[0]!.object).toBe('main');
    expect(m.size.x).toBeCloseTo(plain.size.x + 2 * W, 3);
    expect(m.size.y).toBeCloseTo(plain.size.y + 2 * W, 3);
    const rb = boxOf(ring);
    // as tall as the lowest color, on top of the 2 mm base
    expect(rb.min[2]).toBeCloseTo(2, 4);
    expect(rb.max[2]).toBeCloseTo(3, 4);
    const base = boxOf(named(m, 'base'));
    expect(base.max[0] - base.min[0]).toBeCloseTo(40 + 2 * W, 3);
    // a ring: W wide all round, empty over the art
    const [cx, cy] = center(rb);
    expect(await volumeIn(ring, ...around(cx, cy, 40, 40, 2, 3))).toBeCloseTo(0, 4);
    expect(await volumeIn(ring, ...around(cx, cy, 40 + 2 * W, 40 + 2 * W, 2, 3))).toBeCloseTo(((40 + 2 * W) ** 2 - 1600) * 1, 2);
    expect(m.pieces).toBe(1);
  });

  it('flat, no base: the outline is one piece with the art and as tall as the lowest color', async () => {
    const g = sprite(Array.from({ length: 16 }, (_, y) => (y < 8 ? '0' : '1').repeat(16)), [['#cc3333', 2], ['#3366cc', 3]]);
    const m = await buildModel(g, settings((s) => { s.base.enabled = false; s.outline.on = true; }));
    for (const p of m.parts) await assertManifold(p);
    const rb = boxOf(named(m, 'outline'));
    expect(rb.min[2]).toBeCloseTo(0, 4);
    expect(rb.max[2]).toBeCloseTo(2, 4);
    expect(m.pieces).toBe(1);
    expect(await piecesOf(m.parts)).toBe(1);
  });

  it('flat: separate islands each get a ring; a loop sits outside the ring', async () => {
    const m = await buildModel(potion, settings((s) => { s.outline.on = true; s.keychain.type = 'loop'; }));
    for (const p of m.parts) await assertManifold(p);
    expect(m.pieces).toBe(1);
    const ring = await solidOf(named(m, 'outline')), loop = await solidOf(named(m, 'base'));
    // the ring and the base never overlap
    const both = ring.intersect(loop);
    expect(both.volume()).toBeCloseTo(0, 4);
    for (const o of [ring, loop, both]) o.delete();
  });

  it('flat: double sided and halves mirror the ring like the art; smooth rounds it', async () => {
    for (const patch of [
      (s: Settings) => { s.sides.mode = 'solid'; },
      (s: Settings) => { s.sides.mode = 'halves'; },
      (s: Settings) => { s.sides.mode = 'halves'; s.smooth = true; },
      (s: Settings) => { s.smooth = true; s.inside.mode = 'shell'; s.base.height = 4; },
    ]) {
      const s = settings((s) => { s.outline.on = true; patch(s); });
      const m = await buildModel(potion, s);
      for (const p of m.parts) await assertManifold(p);
      expect(m.pieces).toBe(1);
      if (s.sides.mode === 'halves') {
        const f = boxOf(named(m, 'outline').filter((p) => p.object === 'front')), b = boxOf(named(m, 'outline').filter((p) => p.object === 'back'));
        expect(b.max[0] - b.min[0]).toBeCloseTo(f.max[0] - f.min[0], 3);
      } else if (s.sides.mode === 'solid') {
        const rb = boxOf(named(m, 'outline'));
        expect(rb.max[2] - rb.min[2]).toBeGreaterThan(s.base.height + 1.9);
      }
    }
  });

  it('counts as a filament, sharing a slot when its color matches; 3MF puts it on that slot', async () => {
    const own = settings((s) => { s.outline.on = true; s.outline.color = '#ffffff'; });
    const shared = settings((s) => { s.outline.on = true; s.outline.color = potion.palette[0]!.hex; });
    const n = filamentColors(potion, settings()).length;
    expect(filamentColors(potion, own)).toHaveLength(n + 1);
    expect(filamentColors(potion, shared)).toHaveLength(n);
    for (const s of [own, shared, settings((s) => { s.outline.on = true; s.base.enabled = false; s.keychain.type = 'loop'; s.keychain.loop.color = '#00ff00'; })]) {
      const m = await buildModel(potion, s);
      expect(filamentColors(potion, s)).toEqual(filamentSlots(m.parts.map((p) => p.hex)));
    }
    const m = await buildModel(potion, own);
    const zip = unzipSync(await to3MF(m, { slicer: 'bambu', mono: false, name: 'potion' }));
    const cfg = strFromU8(zip['Metadata/model_settings.config']!);
    const slot = filamentColors(potion, own).indexOf('#ffffff') + 1;
    expect(cfg).toMatch(new RegExp(`name" value="outline"[\\s\\S]*?extruder" value="${slot}"`));
  });

  it('clicker: the ring goes round the cap and the well and footprint grow to fit it', async () => {
    const s = clicker((s) => { s.outline.on = true; });
    const plain = await buildModel(square(32), clicker());
    const m = await buildModel(square(32), s);
    for (const p of m.parts) await assertManifold(p);
    expect(m.pieceCounts).toEqual({ cap: 1, body: 1 });
    const ring = named(m, 'outline');
    expect(ring.map((p) => p.object)).toEqual(['cap']);
    const capT = capThickness(s);
    expect(boxOf(ring).min[2]).toBeCloseTo(capT, 4);
    expect(boxOf(ring).max[2]).toBeCloseTo(capT + 1, 4);
    const body = of(m, 'body'), b = boxOf(body);
    expect(b.max[0] - b.min[0]).toBeCloseTo(boxOf(of(plain, 'body')).max[0] - boxOf(of(plain, 'body')).min[0] + 2 * W, 3);
    const [cx, cy] = center(b);
    const L = clickerLevels(s), g = s.clicker.fitGap;
    const well = 40 + 2 * (W + g);
    expect(await volumeIn(body, ...around(cx, cy, well, well, L.wellFloor, L.rimTop))).toBeCloseTo(0, 2);
    expect(await volumeIn(body, ...around(cx, cy, well + 0.2, well + 0.2, L.wellFloor + 0.1, L.rimTop))).toBeGreaterThan(0);
  });

  it('clicker, art backing: the backing under the outline is the outline color, and no cap part is the base color', async () => {
    const s = clicker((s) => { s.outline.on = true; s.outline.color = '#ffffff'; s.clicker.backing = 'art'; s.smooth = true; });
    const m = await buildModel(potion, s);
    for (const p of m.parts) await assertManifold(p);
    expect(of(m, 'cap').map((p) => p.hex)).not.toContain(s.base.color);
    expect(m.pieceCounts).toEqual({ cap: 1, body: 1 });
    const ring = named(m, 'outline'), rb = boxOf(ring);
    expect(rb.min[2]).toBeCloseTo(0, 4);
    const [cx] = center(rb);
    const capT = capThickness(s);
    // the left edge of the cap is outline color all the way down
    expect(await volumeIn(ring, [rb.min[0] + 0.05, center(rb)[1] - 0.5, 0.05], [rb.min[0] + 0.5, center(rb)[1] + 0.5, capT - 0.05])).toBeGreaterThan(0.3 * (capT - 0.1));
    expect(cx).toBeGreaterThan(0);
  });
});

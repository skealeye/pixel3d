import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, cornerTouches, decodeImage, DEFAULTS, detectScale, downsampleNearest, toGrid } from '../src/index';
import type { Grid, Model, Part, Settings } from '../src/index';
import { initManifold } from '../src/manifold';
import { assertManifold } from './util/assertManifold';

const load = async (name: string): Promise<Grid> => {
  const img = await decodeImage(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));
  return toGrid(downsampleNearest(img, detectScale(img)), 16);
};
const settings = (patch: (s: Settings) => void): Settings => {
  const s = structuredClone(DEFAULTS);
  patch(s);
  return s;
};
const checkAll = async (m: Model) => { for (const p of m.parts) await assertManifold(p); };
const withHeight = (g: Grid, h: (i: number) => number): Grid => ({ ...g, palette: g.palette.map((p, i) => ({ ...p, height: h(i) })) });

/** Axis-aligned bounds of a set of parts' vertices. */
const bounds = (parts: Part[]) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const v = p.mesh.vertProperties;
    for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, v[i + a]!); max[a] = Math.max(max[a]!, v[i + a]!);
    }
  }
  return { min, max };
};
/** Distinct vertex positions of a part, optionally reflected across the plane `axis = c`, as sorted keys. */
const positions = (p: Part, axis = -1, c = 0): string[] => {
  const v = p.mesh.vertProperties, out = new Set<string>();
  for (let i = 0; i < v.length; i += 3) {
    const q = [v[i]!, v[i + 1]!, v[i + 2]!];
    if (axis >= 0) q[axis] = 2 * c - q[axis]!;
    out.add(q.map((n) => (Math.round(n * 1000) / 1000 + 0).toFixed(3)).join(','));
  }
  return [...out].sort();
};
/** Each back part's vertices, reflected across the midplane between the halves along `axis`, equal its front twin's. */
const expectMirrored = (m: Model, axis: number) => {
  const front = m.parts.filter((p) => p.object === 'front'), back = m.parts.filter((p) => p.object === 'back');
  expect(front.map((p) => p.name)).toEqual(back.map((p) => p.name));
  const f = bounds(front), b = bounds(back);
  for (let a = 0; a < 3; a++) expect(b.max[a]! - b.min[a]!).toBeCloseTo(f.max[a]! - f.min[a]!, 4);
  const c = (f.min[axis]! + f.max[axis]! + b.min[axis]! + b.max[axis]!) / 4;
  front.forEach((p, i) => expect(positions(back[i]!, axis, c)).toEqual(positions(p)));
};

let potion: Grid;
beforeAll(async () => { potion = await load('potion.png'); await initManifold(); });

describe('buildModel', () => {
  it('potion, single sided with base: base + 7 colours, 40 x 53.3 x 3.0', async () => {
    const m = await buildModel(potion, DEFAULTS);
    expect(m.parts.map((p) => p.name)).toEqual(['base', ...potion.palette.map((p) => p.hex)]);
    expect(m.parts).toHaveLength(8);
    expect(m.parts[0]!.hex).toBe(DEFAULTS.base.colour);
    expect(m.parts.every((p) => p.object === 'main')).toBe(true);
    expect(m.size.x).toBeCloseTo(40, 4);
    expect(m.size.y).toBeCloseTo(53.333, 2);
    expect(m.size.z).toBeCloseTo(3.0, 4);
    expect(m.pieces).toBe(1);
    expect(m.warnings).toEqual([]);
    expect(m.pauseZ).toEqual([]);
    await checkAll(m);
    // base 0..2, each colour flush on it: 2..3
    expect(bounds([m.parts[0]!]).min[2]).toBeCloseTo(0, 5);
    expect(bounds([m.parts[0]!]).max[2]).toBeCloseTo(2, 5);
    for (const p of m.parts.slice(1)) {
      expect(bounds([p]).min[2]).toBeCloseTo(2, 5);
      expect(bounds([p]).max[2]).toBeCloseTo(3, 5);
    }
  });

  it('colour heights come from the palette, measured from the base top', async () => {
    const m = await buildModel(withHeight(potion, (i) => (i === 0 ? 4 : 1)), DEFAULTS);
    expect(m.size.z).toBeCloseTo(6, 4);
    expect(bounds([m.parts[1]!]).max[2]).toBeCloseTo(6, 5);
    await checkAll(m);
  });

  it('explicit pixelMm wins over size', async () => {
    const m = await buildModel(potion, settings((s) => { s.pixelMm = { x: 1, y: 2 }; }));
    expect(m.size.x).toBeCloseTo(12, 4);
    expect(m.size.y).toBeCloseTo(32, 4);
  });

  it('keepAspect off: y comes from size.height', async () => {
    const m = await buildModel(potion, settings((s) => { s.size = { width: 40, height: 20, keepAspect: false, unit: 'mm' }; }));
    expect(m.size.x).toBeCloseTo(40, 4);
    expect(m.size.y).toBeCloseTo(20, 4);
  });

  it('base off: no base part, colours sit on the bed', async () => {
    const m = await buildModel(potion, settings((s) => { s.base.enabled = false; }));
    expect(m.parts.map((p) => p.name)).toEqual(potion.palette.map((p) => p.hex));
    expect(m.size.z).toBeCloseTo(1, 4);
    await checkAll(m);
  });

  // corner-touch.png is a background-detection fixture (fully opaque, 1 piece), so corner-only contacts are drawn here
  const art = (rows: string[]): Grid => {
    const h = rows.length, w = rows[0]!.length, cells = new Int16Array(w * h);
    rows.forEach((r, y) => [...r].forEach((c, x) => { cells[y * w + x] = c === '.' ? -1 : Number(c); }));
    return { w, h, cells, palette: [{ hex: '#ff0000', height: 1 }, { hex: '#0000ff', height: 2 }] };
  };

  it('corner-only contact: two pixels touching at a corner are 2 pieces, every part manifold', async () => {
    const g = art(['0.', '.0']);
    expect(cornerTouches(g)).toBe(1);
    for (const base of [true, false]) {
      const m = await buildModel(g, settings((s) => { s.base.enabled = base; }));
      expect(m.pieces).toBe(2);
      for (const p of m.parts) await assertManifold(p, -1); // two separate blocks
    }
  });

  it('corner-only contacts inside a ring, across colours, and pinching a hole stay manifold', async () => {
    const g = art([
      '0000.1',
      '0..0.1',
      '0.1001',
      '0000.1',
      '....1.',
    ]);
    for (const mode of ['single', 'solid', 'halves'] as const) {
      for (const base of [true, false]) {
        const m = await buildModel(g, settings((s) => { s.base.enabled = base; s.sides.mode = mode; }));
        await checkAll(m);
      }
    }
  });

  it('double sided: z = base + 2 x height, re-seated on the bed', async () => {
    const m = await buildModel(potion, settings((s) => { s.sides.mode = 'solid'; }));
    expect(m.size.z).toBeCloseTo(2 + 2 * 1, 4);
    expect(bounds(m.parts).min[2]).toBeCloseTo(0, 5);
    const base = bounds([m.parts[0]!]);
    expect(base.min[2]).toBeCloseTo(1, 5);
    expect(base.max[2]).toBeCloseTo(3, 5);
    await checkAll(m);
  });

  it("double sided with heightsOn 'top': the under side uses the default height", async () => {
    const g = withHeight(potion, () => 3);
    const both = await buildModel(g, settings((s) => { s.sides.mode = 'solid'; }));
    const top = await buildModel(g, settings((s) => { s.sides = { mode: 'solid', heightsOn: 'top' }; s.heights.h = 0.5; }));
    expect(both.size.z).toBeCloseTo(2 + 3 + 3, 4);
    expect(top.size.z).toBeCloseTo(2 + 3 + 0.5, 4);
    await checkAll(top);
  });

  it('halves: front and back, back mirrored in X and 8 mm beyond the front', async () => {
    const m = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; }));
    const front = m.parts.filter((p) => p.object === 'front'), back = m.parts.filter((p) => p.object === 'back');
    expect(front.map((p) => p.name)).toEqual(['base', ...potion.palette.map((p) => p.hex)]);
    expect(back).toHaveLength(front.length);
    expect(m.parts).toHaveLength(front.length * 2);
    const f = bounds(front), b = bounds(back);
    expect(b.min[0]! - f.max[0]!).toBeCloseTo(8, 4);
    expect(m.size.x).toBeCloseTo(40 * 2 + 8, 4);
    expect(m.size.z).toBeCloseTo(1 + 1, 4); // half the base each
    expectMirrored(m, 0);
    await checkAll(m);
  });

  it("halves with heightsOn 'top': the back uses the default height", async () => {
    const m = await buildModel(withHeight(potion, () => 3), settings((s) => { s.sides = { mode: 'halves', heightsOn: 'top' }; s.heights.h = 0.5; }));
    expect(bounds(m.parts.filter((p) => p.object === 'front')).max[2]).toBeCloseTo(1 + 3, 4);
    expect(bounds(m.parts.filter((p) => p.object === 'back')).max[2]).toBeCloseTo(1 + 0.5, 4);
  });

  it('review focus 4: aspect off (2 x 3 mm pixels) + halves + rotate Z 90: the mirrored back still overlays the front', async () => {
    const m = await buildModel(potion, settings((s) => {
      s.size = { width: 24, height: 48, keepAspect: false, unit: 'mm' };
      s.sides.mode = 'halves';
      s.rotation = [0, 0, 1];
    }));
    // unrotated: X = 24 + 8 + 24, Y = 48; a quarter turn about Z swaps them
    expect(m.size.x).toBeCloseTo(48, 4);
    expect(m.size.y).toBeCloseTo(56, 4);
    const f = bounds(m.parts.filter((p) => p.object === 'front'));
    expect(f.max[0]! - f.min[0]!).toBeCloseTo(48, 4);
    expect(f.max[1]! - f.min[1]!).toBeCloseTo(24, 4);
    expectMirrored(m, 1);
    await checkAll(m);
  });

  it('rotation: a quarter turn about X stands the model up, min Z = 0', async () => {
    const m = await buildModel(potion, settings((s) => { s.rotation = [1, 0, 0]; }));
    expect(m.size.x).toBeCloseTo(40, 4);
    expect(m.size.y).toBeCloseTo(3, 4);
    expect(m.size.z).toBeCloseTo(53.333, 2);
    expect(bounds(m.parts).min[2]).toBeCloseTo(0, 5);
    await checkAll(m);
  });

  // worst case for the outline: ~14k loops. Built once, valid, then timed after warm-up.
  const noisy = (): Grid => {
    let seed = 1;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const cells = new Int16Array(128 * 128).map(() => Math.floor(rnd() * 16));
    const palette = Array.from({ length: 16 }, (_, i) => ({ hex: `#0000${i.toString(16).padStart(2, '0')}`, height: 1 + (i % 4) * 0.5 }));
    return { w: 128, h: 128, cells, palette };
  };
  const timeBuild = async (g: Grid) => {
    const t = performance.now();
    await buildModel(g, DEFAULTS);
    return performance.now() - t;
  };

  it('128x128 random 16-colour grid: valid, and no slower than 400 ms (regression guard)', async () => {
    const g = noisy();
    await checkAll(await buildModel(g, DEFAULTS));
    expect(await timeBuild(g)).toBeLessThan(400);
  });

  // R3 target. CrossSection.extrude measures ~180 ms here (Clipper ~60 ms + triangulation ~100 ms for 14k loops),
  // so this stays skipped until the preview fast path lands. Run with PIXEL3D_PERF=1.
  it.skipIf(!process.env.PIXEL3D_PERF)('perf: 128x128 random 16-colour grid builds in < 50 ms after warm-up', async () => {
    const g = noisy();
    await buildModel(g, DEFAULTS);
    const ms = await timeBuild(g);
    console.info(`perf: 128x128 16-colour buildModel ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
  });
});

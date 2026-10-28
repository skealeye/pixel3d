import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, decodeImage, DEFAULTS, detectScale, downsampleNearest, edgeAtAngle, loopSolid, toGrid } from '../src/index';
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
const center = { fx: 0.5, fy: 0.5 };

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
const volume = async (parts: Part[]) => {
  const { Manifold, Mesh } = await initManifold();
  let sum = 0;
  for (const p of parts) {
    const m = new Manifold(new Mesh({ numProp: 3, vertProperties: p.mesh.vertProperties, triVerts: p.mesh.triVerts }));
    sum += m.volume();
    m.delete();
  }
  return sum;
};
/** Area of the triangles lying flat in the plane z = `z` (the bed face when z = 0). */
const areaAt = (parts: Part[], z = 0) => {
  let sum = 0;
  for (const p of parts) {
    const v = p.mesh.vertProperties, t = p.mesh.triVerts;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i]! * 3, t[i + 1]! * 3, t[i + 2]! * 3];
      if ([a, b, c].some((k) => Math.abs(v[k + 2]! - z) > 1e-5)) continue;
      sum += Math.abs((v[b]! - v[a]!) * (v[c + 1]! - v[a + 1]!) - (v[c]! - v[a]!) * (v[b + 1]! - v[a + 1]!)) / 2;
    }
  }
  return sum;
};
/** Opaque bounding box origin in y-up cells: the mm origin of the model. */
const origin = (g: Grid) => {
  let x0 = Infinity, y0 = Infinity;
  for (let k = 0; k < g.cells.length; k++) if (g.cells[k]! >= 0) {
    const x = k % g.w; x0 = Math.min(x0, x); y0 = Math.min(y0, g.h - 1 - (k - x) / g.w);
  }
  return { x0, y0 };
};
const art = (rows: string[]): Grid => {
  const h = rows.length, w = rows[0]!.length, cells = new Int16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { cells[y * w + x] = c === '.' ? -1 : Number(c); }));
  return { w, h, cells, palette: [{ hex: '#ff0000', height: 1 }] };
};

let potion: Grid;
let plain: Model;
beforeAll(async () => {
  potion = await load('potion.png');
  potion = { ...potion, palette: potion.palette.map((p) => ({ ...p, height: 1 })) };
  plain = await buildModel(potion, DEFAULTS);
});
const PX = 40 / 12; // potion is 12 opaque pixels across

describe('keychain hole', () => {
  for (const [style, area] of [['round', Math.PI * 2 ** 2], ['square', 4 ** 2]] as const) {
    it(`a 4 mm ${style} hole removes ${style === 'round' ? 'π·2²' : '4²'} x the stack height, and nothing moves`, async () => {
      const m = await buildModel(potion, settings((s) => { s.keychain.type = 'hole'; s.keychain.hole = { style, size: 4, at: center }; }));
      const lost = (await volume(plain.parts)) - (await volume(m.parts));
      expect(Math.abs(lost / (area * 3) - 1)).toBeLessThan(0.02);
      expect(bounds(m.parts)).toEqual(bounds(plain.parts));
      expect(m.size).toEqual(plain.size);
      await checkAll(m);
    });
  }

  it('a hole cutting the outer edge never moves or shrinks the model, rotated or not', async () => {
    for (const rotation of [[0, 0, 0], [1, 0, 0]] as [number, number, number][]) {
      const none = await buildModel(potion, settings((s) => { s.rotation = rotation; }));
      const m = await buildModel(potion, settings((s) => { s.rotation = rotation; s.keychain.type = 'hole'; s.keychain.hole.size = 10; }));
      expect(m.size).toEqual(none.size);
      expect(bounds(m.parts).min[2]).toBeCloseTo(0, 5);
      expect(await volume(m.parts)).toBeLessThan(await volume(none.parts));
      await checkAll(m);
    }
  });

  it('bounds are the uncut box where the parts sit: a hole cutting the outermost column leaves them as they were', async () => {
    // 4 mm pixels; the top-right pixel sticks out alone, and the hole takes it away
    const g = art(['0000000000', '000000000.', '000000000.']);
    for (const rotation of [[0, 0, 0], [3, 0, 0], [0, 1, 1]] as [number, number, number][]) {
      const none = await buildModel(g, settings((s) => { s.rotation = rotation; }));
      const m = await buildModel(g, settings((s) => { s.rotation = rotation; s.keychain.type = 'hole'; s.keychain.hole = { style: 'square', size: 6, at: { fx: 1, fy: 0 } }; }));
      const b = bounds(none.parts);
      for (let a = 0; a < 3; a++) {
        expect(none.bounds.min[a]).toBeCloseTo(b.min[a]!, 4);
        expect(none.bounds.max[a]).toBeCloseTo(b.max[a]!, 4);
      }
      expect(m.bounds).toEqual(none.bounds);
      // the cut parts themselves no longer reach the uncut box
      const c = bounds(m.parts);
      expect([0, 1, 2].some((k) => Math.abs(c.max[k]! - b.max[k]!) > 0.1 || Math.abs(c.min[k]! - b.min[k]!) > 0.1)).toBe(true);
      expect(none.bounds.min[2]).toBe(0);
      expect(none.bounds.max[2]).toBeCloseTo(none.size.z, 6);
    }
  });

  it('cuts every part of both halves', async () => {
    const none = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; }));
    const m = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; s.keychain.type = 'hole'; s.keychain.hole = { style: 'square', size: 4, at: center }; }));
    for (const o of ['front', 'back'] as const) {
      const lost = (await volume(none.parts.filter((p) => p.object === o))) - (await volume(m.parts.filter((p) => p.object === o)));
      expect(lost).toBeCloseTo(16 * 2, 1); // half base 1 + color 1
    }
    await checkAll(m);
  });

  it('review focus 2: a 10 mm hole that splits a thin sprite gives pieces >= 2', async () => {
    const bar = art(['0000000000']); // 4 mm pixels: a 40 x 4 mm bar
    const m = await buildModel(bar, settings((s) => { s.keychain.type = 'hole'; s.keychain.hole = { style: 'round', size: 10, at: center }; }));
    expect(m.pieces).toBeGreaterThanOrEqual(2);
    await checkAll(m);
  });

  it('review focus 2: a magnet overlapping the hole stays manifold', async () => {
    for (const position of ['bottom', 'center'] as const) {
      const m = await buildModel(potion, settings((s) => {
        s.base.height = 5;
        s.keychain.type = 'hole';
        s.keychain.hole = { style: 'round', size: 6, at: center };
        s.magnets = { size: '8x3', position, at: [{ fx: 0.6, fy: 0.55 }] };
      }));
      expect(m.pieces).toBe(1);
      await checkAll(m);
    }
  });
});

describe('piece count after cuts', () => {
  it('an open pocket deeper than base + lowest color leaves a taller color island floating: pieces >= 2', async () => {
    // 9 x 9 at 4 mm: a field of color 0 (1 mm) with one 3 mm pixel of color 1 in the middle, inside a 10 mm pocket
    const cells = new Int16Array(81).fill(0);
    cells[4 * 9 + 4] = 1;
    const g: Grid = { w: 9, h: 9, cells, palette: [{ hex: '#ff0000', height: 1 }, { hex: '#0000ff', height: 3 }] };
    for (const mode of ['single', 'halves'] as const) {
      const m = await buildModel(g, settings((s) => {
        s.size.width = 36;
        s.sides.mode = mode;
        s.magnets = { size: '10x3', position: 'bottom', at: [center] };
      }));
      expect(m.pieces).toBeGreaterThanOrEqual(2);
      await checkAll(m);
    }
  });

  it('corner-touching art plus a small hole: the decompose path agrees with the 4-connected count', async () => {
    const g = art(['00..', '00..', '..00', '..00']);
    for (const base of [true, false]) {
      const plainM = await buildModel(g, settings((s) => { s.base.enabled = base; }));
      const holed = await buildModel(g, settings((s) => {
        s.base.enabled = base;
        s.keychain.type = 'hole';
        s.keychain.hole = { style: 'round', size: 2, at: { fx: 0.25, fy: 0.25 } };
      }));
      expect(plainM.pieces).toBe(2);
      expect(holed.pieces).toBe(plainM.pieces);
      for (const p of holed.parts) await assertManifold(p);
    }
  });
});

describe('keychain loop', () => {
  it('edgeAtAngle: 0° leaves through the top edge, 90° through the right', () => {
    const up = edgeAtAngle(potion, 0), right = edgeAtAngle(potion, 90);
    expect([up.nx, up.ny]).toEqual([0, 1]);
    expect(up.v).toBe(16); // top of the cork
    expect([right.nx, right.ny]).toEqual([1, 0]);
  });

  it('a pixel loop (in 3, out 14) at 60° is unioned into the base: one body, hole centered at edge + normal x R', async () => {
    const m = await buildModel(potion, settings((s) => {
      s.keychain.type = 'loop';
      s.keychain.loop = { ...s.keychain.loop, style: 'pixel', inner: 3, outer: 14, angle: 60 };
    }));
    expect(m.parts.map((p) => p.name)).toEqual(plain.parts.map((p) => p.name));
    const base = m.parts[0]!;
    await checkAll(m);
    const { Manifold, Mesh } = await initManifold();
    const solid = new Manifold(new Mesh({ numProp: 3, vertProperties: base.mesh.vertProperties, triVerts: base.mesh.triVerts }));
    const comps = solid.decompose();
    expect(comps).toHaveLength(1);
    for (const c of comps) c.delete();
    solid.delete();

    const e = edgeAtAngle(potion, 60), o = origin(potion), R = (3 + 14) / 4;
    expect(e.nx * Math.sin(Math.PI / 3) + e.ny * Math.cos(Math.PI / 3)).toBeGreaterThan(0.3);
    const cx = (e.u - o.x0) * PX + e.nx * R, cy = (e.v - o.y0) * PX + e.ny * R;
    // the square hole's four corners are vertices of the base, so the hole is centered on (cx, cy)
    const v = base.mesh.vertProperties;
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      let best = Infinity;
      for (let i = 0; i < v.length; i += 3) best = Math.min(best, Math.hypot(v[i]! - (cx + dx * 1.5), v[i + 1]! - (cy + dy * 1.5)));
      expect(best).toBeLessThan(0.01);
    }
    expect(m.pieces).toBe(1);
    expect(m.size.x).toBeGreaterThan(plain.size.x);
  });

  it('loopSolid: a pixel frame of exactly out mm, centered at edge + normal x R', async () => {
    const wasm = await initManifold();
    const l = loopSolid(wasm, { u: 2, v: 3, nx: 0, ny: 1 }, settings((s) => { s.keychain.loop = { ...s.keychain.loop, style: 'pixel', inner: 3, outer: 14 }; }), 2, { px: { x: 2, y: 2 }, x0: 0, y0: 0 });
    const b = l.boundingBox();
    expect([...b.min].map((n) => +n.toFixed(4))).toEqual([4 - 7, 6 + 4.25 - 7, 0]);
    expect([...b.max].map((n) => +n.toFixed(4))).toEqual([4 + 7, 6 + 4.25 + 7, 2]);
    expect(l.volume()).toBeCloseTo((14 ** 2 - 3 ** 2) * 2, 4);
    l.delete();
  });

  it('a rounded loop with no base is its own part in the loop color, as thick as the lowest color', async () => {
    const g = { ...potion, palette: potion.palette.map((p, i) => ({ ...p, height: i === 0 ? 0.8 : 2 })) };
    const m = await buildModel(g, settings((s) => {
      s.base.enabled = false;
      s.keychain.type = 'loop';
      s.keychain.loop = { style: 'round', inner: 4, outer: 8, angle: 0, color: '#ff8800' };
    }));
    const loop = m.parts.find((p) => p.name === 'loop')!;
    expect(loop.hex).toBe('#ff8800');
    expect(loop.object).toBe('main');
    const b = bounds([loop]);
    expect(b.min[2]).toBeCloseTo(0, 4);
    expect(b.max[2]).toBeCloseTo(0.8, 4);
    expect(m.pieces).toBe(1);
    await checkAll(m);
  });

  it('halves: each half gets a loop of half the thickness, the back mirrored', async () => {
    const m = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; s.keychain.type = 'loop'; s.keychain.loop.angle = 90; }));
    const fb = bounds([m.parts.find((p) => p.object === 'front' && p.name === 'base')!]);
    const bb = bounds([m.parts.find((p) => p.object === 'back' && p.name === 'base')!]);
    expect(fb.max[2]).toBeCloseTo(1, 5);
    expect(fb.max[0]! - fb.min[0]!).toBeCloseTo(bb.max[0]! - bb.min[0]!, 4);
    expect(fb.max[0]! - fb.min[0]!).toBeGreaterThan(40);
    expect(bb.min[0]! - fb.max[0]!).toBeCloseTo(8, 4); // the loops face each other, still 8 mm apart
    await checkAll(m);
  });
});

describe('magnets', () => {
  const magnet = (patch: (s: Settings) => void = () => {}) => settings((s) => { s.magnets = { size: '8x3', position: 'bottom', at: [center] }; patch(s); });

  it('an 8x3 bottom pocket opens at z = 0; a 2 mm base carries the warning', async () => {
    const m = await buildModel(potion, magnet());
    expect(m.warnings).toEqual(['A 8 × 3 mm magnet needs about 3.6 mm here. Make the base thicker or pick a smaller magnet.']);
    expect(areaAt(plain.parts) - areaAt(m.parts)).toBeGreaterThan(Math.PI * 16 * 0.98);
    expect(m.pauseZ).toEqual([]);
    await checkAll(m);
  });

  it('a 4 mm base: no warning, a 3 mm deep pocket open on the bed', async () => {
    const none = await buildModel(potion, settings((s) => { s.base.height = 4; }));
    const m = await buildModel(potion, magnet((s) => { s.base.height = 4; }));
    expect(m.warnings).toEqual([]);
    const lost = (await volume(none.parts)) - (await volume(m.parts));
    expect(Math.abs(lost / (Math.PI * 16 * 3) - 1)).toBeLessThan(0.02);
    expect(areaAt(none.parts) - areaAt(m.parts)).toBeCloseTo(lost / 3, 0);
    expect(areaAt(m.parts, 3) - areaAt(none.parts, 3)).toBeCloseTo(lost / 3, 0); // pocket ceiling at z = 3
    await checkAll(m);
  });

  it('sealed in the center of a 5 mm base: closed on the bed, pause at the top of the pocket', async () => {
    const none = await buildModel(potion, settings((s) => { s.base.height = 5; }));
    const m = await buildModel(potion, magnet((s) => { s.base.height = 5; s.magnets.position = 'center'; }));
    expect(m.warnings).toEqual([]);
    expect(areaAt(m.parts)).toBeCloseTo(areaAt(none.parts), 3);
    expect(m.pauseZ).toEqual([4]);
    expect(m.pieces).toBe(1);
    await checkAll(m);
  });

  it('sealed on a thin base warns with the sealed allowance (h + 1.2)', async () => {
    const m = await buildModel(potion, magnet((s) => { s.magnets.size = { d: 6, h: 2 }; s.magnets.position = 'center'; }));
    expect(m.warnings).toEqual(['A 6 × 2 mm magnet needs about 3.2 mm here. Make the base thicker or pick a smaller magnet.']);
  });

  it('a sealed pocket clamped onto the bed (base thinner than the magnet) is open: no pause', async () => {
    const m = await buildModel(potion, magnet((s) => { s.magnets.position = 'center'; })); // 2 mm base, 3 mm magnet
    expect(m.pauseZ).toEqual([]);
    expect(m.warnings).toHaveLength(1);
  });

  it('double sided is always sealed, centered on the middle base; pauseZ is in bed coordinates', async () => {
    const m = await buildModel(potion, magnet((s) => { s.base.height = 5; s.sides.mode = 'solid'; }));
    expect(m.warnings).toEqual([]);
    expect(m.pauseZ).toEqual([1 + 1 + 3]); // under layer 1, pocket from 1 above the base bottom
    await checkAll(m);
  });

  it('halves: each half has a pocket open on its glue face, mirrored on the back', async () => {
    const none = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; s.base.height = 8; }));
    const m = await buildModel(potion, magnet((s) => { s.sides.mode = 'halves'; s.base.height = 8; s.magnets.at = [{ fx: 0.3, fy: 0.6 }]; }));
    expect(m.warnings).toEqual([]);
    expect(m.pauseZ).toEqual([]);
    for (const o of ['front', 'back'] as const) {
      const a = none.parts.filter((p) => p.object === o), b = m.parts.filter((p) => p.object === o);
      expect(areaAt(a) - areaAt(b)).toBeGreaterThan(Math.PI * 16 * 0.98);
    }
    // mirrored: the pockets sit at mirror-image x positions about the midplane between the halves
    const hole = (o: 'front' | 'back') => {
      const p = m.parts.filter((q) => q.object === o && q.name === 'base');
      const v = p[0]!.mesh.vertProperties;
      let sx = 0, n = 0;
      for (let i = 0; i < v.length; i += 3) if (Math.abs(v[i + 2]! - 3) < 1e-5) { sx += v[i]!; n++; } // pocket ceiling
      return sx / n;
    };
    expect(hole('front') + hole('back')).toBeCloseTo(40 * 2 + 8, 1);
    await checkAll(m);
  });
});

describe('inside', () => {
  it('shell with a 1.2 mm wall: lighter, floor kept, still manifold', async () => {
    const m = await buildModel(potion, settings((s) => { s.inside = { mode: 'shell', wall: 1.2 }; }));
    expect(m.warnings).toEqual([]);
    expect(await volume(m.parts)).toBeLessThan((await volume(plain.parts)) * 0.9);
    expect(areaAt(m.parts)).toBeCloseTo(areaAt(plain.parts), 3);
    expect(bounds(m.parts)).toEqual(bounds(plain.parts));
    await checkAll(m);
  });

  it('hollow opens the bottom face: no triangles at z = 0 inside the outline', async () => {
    const m = await buildModel(potion, settings((s) => { s.inside = { mode: 'hollow', wall: 1.2 }; }));
    expect(m.warnings).toEqual([]);
    expect(areaAt(m.parts)).toBeLessThan(areaAt(plain.parts) * 0.5);
    expect(m.size).toEqual(plain.size);
    await checkAll(m);
  });

  it('too thin: a warning, and the model stays solid', async () => {
    const m = await buildModel(potion, settings((s) => { s.base.height = 0.5; s.inside = { mode: 'shell', wall: 1.2 }; }));
    const none = await buildModel(potion, settings((s) => { s.base.height = 0.5; }));
    expect(m.warnings).toEqual(['Too thin to hollow out. Make the base thicker or the wall thinner.']);
    expect(await volume(m.parts)).toBeCloseTo(await volume(none.parts), 3);
  });

  it('halves stay solid', async () => {
    const none = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; }));
    const m = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; s.inside.mode = 'shell'; }));
    expect(m.warnings).toEqual([]);
    expect(await volume(m.parts)).toBeCloseTo(await volume(none.parts), 3);
  });

  it('double sided: hollow is built as shell, with a warning', async () => {
    const shell = await buildModel(potion, settings((s) => { s.sides.mode = 'solid'; s.base.height = 4; s.inside.mode = 'shell'; }));
    const hollow = await buildModel(potion, settings((s) => { s.sides.mode = 'solid'; s.base.height = 4; s.inside.mode = 'hollow'; }));
    expect(shell.warnings).toEqual([]);
    expect(hollow.warnings).toEqual(['Double sided has no open bottom, so Hollow is built as Shell.']);
    expect(await volume(hollow.parts)).toBeCloseTo(await volume(shell.parts), 3);
    expect(areaAt(shell.parts)).toBeGreaterThan(0);
    await checkAll(shell);
  });

  it('the cavity keeps a wall around the hole, so the model stays one sealed body', async () => {
    const m = await buildModel(potion, settings((s) => {
      s.base.height = 4;
      s.inside = { mode: 'shell', wall: 1.2 };
      s.keychain.type = 'hole';
      s.keychain.hole = { style: 'round', size: 6, at: center };
    }));
    expect(m.pieces).toBe(1);
    for (const p of m.parts) await assertManifold(p);
    // a sealed cavity is its own inner surface; had it broken into the hole it would join the outside surface
    const base = m.parts[0]!;
    const { Manifold, Mesh } = await initManifold();
    const b = new Manifold(new Mesh({ numProp: 3, vertProperties: base.mesh.vertProperties, triVerts: base.mesh.triVerts }));
    const comps = b.decompose();
    expect(comps.length).toBe(2); // outer shell + the cavity's inner surface
    for (const c of comps) c.delete();
    b.delete();
  });
});

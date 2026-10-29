import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Mesh as ThreeMesh, type MeshLambertMaterial } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { buildModel, decodeImage, DEFAULTS, detectScale, downsampleNearest, exportModel, filamentSlots, toFBX, toGrid, toOBJ } from '../src/index';
import type { Model, Settings } from '../src/index';

const load = async (name: string) => {
  const img = await decodeImage(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));
  return toGrid(downsampleNearest(img, detectScale(img)), 16);
};
const settings = (patch: (s: Settings) => void = () => {}): Settings => {
  const s = structuredClone(DEFAULTS);
  patch(s);
  return s;
};
const verts = (m: Model) => m.parts.reduce((n, p) => n + p.mesh.vertProperties.length / 3, 0);
const tris = (m: Model) => m.parts.reduce((n, p) => n + p.mesh.triVerts.length / 3, 0);
/** The parts' vertex box, mm. */
const boxOf = (m: Model) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { mesh: { vertProperties: v } } of m.parts) for (let i = 0; i < v.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, v[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, v[i]!);
  }
  return { lo, hi };
};
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const hex01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** A minimal OBJ + MTL reader: objects, groups with their material, vertices and faces. */
function parseObj(obj: string, mtl: string) {
  const v: number[][] = [], f: number[][] = [], objects: string[] = [], groups: { name: string; mat: string; faces: number }[] = [];
  let mtllib = '';
  for (const line of obj.split('\n')) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === 'mtllib') mtllib = r.join(' ');
    else if (k === 'o') objects.push(r[0]!);
    else if (k === 'g') groups.push({ name: r[0]!, mat: '', faces: 0 });
    else if (k === 'usemtl') groups.at(-1)!.mat = r[0]!;
    else if (k === 'v') v.push(r.map(Number));
    else if (k === 'f') { f.push(r.map(Number)); groups.at(-1)!.faces++; }
  }
  const mats = new Map<string, number[]>();
  let cur = '';
  for (const line of mtl.split('\n')) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === 'newmtl') cur = r[0]!;
    else if (k === 'Kd') mats.set(cur, r.map(Number));
  }
  return { v, f, objects, groups, mats, mtllib };
}

describe('OBJ', () => {
  let model: Model;
  beforeAll(async () => { model = await buildModel(await load('potion.png'), settings()); }, 60_000);

  it('holds every part as its own group, with its color', () => {
    const [obj, mtl] = toOBJ(model, { mono: false, name: 'potion' });
    expect([obj!.name, mtl!.name]).toEqual(['potion.obj', 'potion.mtl']);
    expect(text(obj!.bytes).startsWith('# pixel3d OBJ, mm, Z up\n')).toBe(true);
    const o = parseObj(text(obj!.bytes), text(mtl!.bytes));
    expect(o.mtllib).toBe('potion.mtl');
    expect(o.objects).toEqual(['potion']);
    expect(o.v.length).toBe(verts(model));
    expect(o.f.length).toBe(tris(model));
    for (const face of o.f) {
      expect(face.length).toBe(3);
      for (const i of face) expect(Number.isInteger(i) && i >= 1 && i <= o.v.length).toBe(true);
    }
    expect(o.groups.length).toBe(model.parts.length);
    o.groups.forEach((g, i) => {
      expect(g.faces).toBe(model.parts[i]!.mesh.triVerts.length / 3);
      const kd = o.mats.get(g.mat)!;
      hex01(model.parts[i]!.hex).forEach((c, k) => expect(kd[k]).toBeCloseTo(c, 5));
    });
    expect(o.mats.size).toBe(filamentSlots(model.parts.map((p) => p.hex)).length);
    // vertices unchanged, mm
    const { lo, hi } = boxOf(model);
    for (let k = 0; k < 3; k++) {
      expect(Math.min(...o.v.map((p) => p[k]!))).toBeCloseTo(lo[k]!, 5);
      expect(Math.max(...o.v.map((p) => p[k]!))).toBeCloseTo(hi[k]!, 5);
    }
  });

  it('mono: one material in the mono color', () => {
    const [obj, mtl] = toOBJ(model, { mono: true, monoHex: '#336699', name: 'potion' });
    const o = parseObj(text(obj!.bytes), text(mtl!.bytes));
    expect(o.mats.size).toBe(1);
    expect(new Set(o.groups.map((g) => g.mat)).size).toBe(1);
    hex01('#336699').forEach((c, k) => expect(o.mats.get(o.groups[0]!.mat)![k]).toBeCloseTo(c, 5));
    expect(o.groups.length).toBe(model.parts.length);
    expect(o.f.length).toBe(tris(model));
  });

  it('halves through exportModel: one object each, deterministic', async () => {
    const s = settings((s) => { s.sides.mode = 'halves'; s.export.format = 'obj'; });
    const m = await buildModel(await load('potion.png'), s);
    const files = await exportModel(m, s, 'potion');
    expect(files.map((f) => f.name)).toEqual(['potion.obj', 'potion.mtl']);
    const o = parseObj(text(files[0]!.bytes), text(files[1]!.bytes));
    expect(o.objects).toEqual(['potion_front', 'potion_back']);
    expect(o.f.length).toBe(tris(m));
    expect(Buffer.from((await exportModel(m, s, 'potion'))[0]!.bytes).equals(Buffer.from(files[0]!.bytes))).toBe(true);
  }, 60_000);
});

describe('FBX', () => {
  let model: Model;
  beforeAll(async () => { model = await buildModel(await load('potion.png'), settings()); }, 60_000);

  const parse = (bytes: Uint8Array) => {
    const warn = console.warn;
    console.warn = () => {}; // the loader's Z-up notice
    try {
      return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
    } finally {
      console.warn = warn;
    }
  };
  const meshesOf = (bytes: Uint8Array) => {
    const out: ThreeMesh[] = [];
    parse(bytes).traverse((o) => { if (o instanceof ThreeMesh) out.push(o); });
    return out;
  };

  it('is binary FBX 7.4 with the standard header and footer, deterministic', () => {
    const b = toFBX(model, { mono: false, name: 'potion' });
    expect(text(b.subarray(0, 18))).toBe('Kaydara FBX Binary');
    expect([...b.subarray(18, 23)]).toEqual([0x20, 0x20, 0x00, 0x1a, 0x00]);
    expect(new DataView(b.buffer, b.byteOffset).getUint32(23, true)).toBe(7400);
    expect((b.length - 140) % 16).toBe(0); // padding to 16, then version, 120 zeros, magic
    expect([...b.subarray(b.length - 16)]).toEqual([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]);
    expect(Buffer.from(toFBX(model, { mono: false, name: 'potion' })).equals(Buffer.from(b))).toBe(true);
  });

  it('loads in three.js: one mesh per part, every triangle, the model box in mm, the part colors', () => {
    const b = toFBX(model, { mono: false, name: 'potion' });
    expect(parse(b).userData.unitScaleFactor).toBe(0.1); // cm per unit: mm
    const meshes = meshesOf(b);
    expect(meshes.length).toBe(model.parts.length);
    expect(meshes.map((m) => m.name)).toEqual(model.parts.map((_, i) => `potion_${i + 1}`));
    expect(meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0)).toBe(tris(model));
    // raw geometry: the loader leaves units alone and only rotates the scene root for Z up
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      [bb.min.x, bb.min.y, bb.min.z].forEach((x, k) => (lo[k] = Math.min(lo[k]!, x)));
      [bb.max.x, bb.max.y, bb.max.z].forEach((x, k) => (hi[k] = Math.max(hi[k]!, x)));
    }
    const box = boxOf(model);
    const size = [model.size.x, model.size.y, model.size.z];
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(lo[k]! - box.lo[k]!)).toBeLessThan(1e-3);
      expect(Math.abs(hi[k]! - box.hi[k]!)).toBeLessThan(1e-3);
      expect(Math.abs(hi[k]! - lo[k]! - size[k]!)).toBeLessThan(1e-3);
    }
    meshes.forEach((m, i) => expect(`#${(m.material as MeshLambertMaterial).color.getHexString()}`).toBe(model.parts[i]!.hex.toLowerCase()));
  });

  it('mono: one material in the mono color', () => {
    const meshes = meshesOf(toFBX(model, { mono: true, monoHex: '#336699', name: 'potion' }));
    expect(meshes.length).toBe(model.parts.length);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
    expect((meshes[0]!.material as MeshLambertMaterial).color.getHexString()).toBe('336699');
  });

  it('halves through exportModel: one file, meshes named by half', async () => {
    const s = settings((s) => { s.sides.mode = 'halves'; s.export.format = 'fbx'; });
    const m = await buildModel(await load('potion.png'), s);
    const files = await exportModel(m, s, 'potion');
    expect(files.map((f) => f.name)).toEqual(['potion.fbx']);
    const names = meshesOf(files[0]!.bytes).map((x) => x.name);
    expect(names.filter((x) => x.startsWith('potion_front_')).length).toBe(m.parts.filter((p) => p.object === 'front').length);
    expect(names.filter((x) => x.startsWith('potion_back_')).length).toBe(m.parts.filter((p) => p.object === 'back').length);
  }, 60_000);
});

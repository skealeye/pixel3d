import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, decodeImage, DEFAULTS, detectScale, downsampleNearest, filamentColors, to3MF, toGrid, toSTL } from '../src/index';
import type { Grid, Model, Part, Settings } from '../src/index';
import { initManifold } from '../src/manifold';
import { assertManifold } from './util/assertManifold';
import { all, kid, kids, metaOf, parseXml } from './util/xml';
import type { El } from './util/xml';

const load = async (name: string): Promise<Grid> => {
  const img = await decodeImage(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));
  return toGrid(downsampleNearest(img, detectScale(img)), 16);
};
const settings = (patch: (s: Settings) => void): Settings => {
  const s = structuredClone(DEFAULTS);
  patch(s);
  return s;
};
const tris = (m: Model, object?: string) =>
  m.parts.filter((p) => !object || p.object === object).reduce((n, p) => n + p.mesh.triVerts.length / 3, 0);

/** Binary STL: header, count, then 50 bytes a triangle. Returns the triangles' corners. */
const readStl = (bytes: Uint8Array) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  expect(bytes.byteLength).toBe(84 + 50 * n);
  const corners: number[] = [];
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) corners.push(dv.getFloat32(84 + 50 * t + 12 + 4 * k, true));
  return { n, corners };
};
/** Weld an STL's corners into an indexed mesh (exact float match). */
const weld = (corners: number[]) => {
  const ids = new Map<string, number>(), vertProperties: number[] = [], triVerts: number[] = [];
  for (let i = 0; i < corners.length; i += 3) {
    const key = `${corners[i]},${corners[i + 1]},${corners[i + 2]}`;
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); vertProperties.push(corners[i]!, corners[i + 1]!, corners[i + 2]!); }
    triVerts.push(id);
  }
  return { vertProperties: new Float32Array(vertProperties), triVerts: new Uint32Array(triVerts) };
};
/** Volume of an indexed mesh, mm³. */
const volume = async (mesh: { vertProperties: Float32Array; triVerts: Uint32Array }) => {
  const { Manifold, Mesh } = await initManifold();
  const m = new Manifold(new Mesh({ numProp: 3, ...mesh }));
  try { return m.volume(); } finally { m.delete(); }
};
const bodies = async (mesh: { vertProperties: Float32Array; triVerts: Uint32Array }) => {
  const { Manifold, Mesh } = await initManifold();
  const m = new Manifold(new Mesh({ numProp: 3, ...mesh }));
  const parts = m.decompose();
  const n = parts.length;
  for (const p of parts) p.delete();
  m.delete();
  return n;
};

const unzip = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return { names: Object.keys(files), text: (p: string) => { expect(files[p], p).toBeDefined(); return strFromU8(files[p]!); } };
};
type Mesh = { vertProperties: Float32Array; triVerts: Uint32Array };
/** An object's `<mesh>` as an indexed mesh. */
const meshOf = (o: El): Mesh => {
  const mesh = kid(o, 'mesh');
  const v = kids(kid(mesh, 'vertices'), 'vertex').flatMap((e) => ['x', 'y', 'z'].map((a) => Number(e.attrs[a])));
  const f = kids(kid(mesh, 'triangles'), 'triangle').flatMap((e) => ['v1', 'v2', 'v3'].map((a) => Number(e.attrs[a])));
  return { vertProperties: new Float32Array(v), triVerts: new Uint32Array(f) };
};
/** A mesh moved by a 3MF row-major 3x4 `transform` (absent: identity). */
const moved = (m: Mesh, transform?: string): Mesh => {
  if (!transform) return m;
  const t = transform.split(' ').map(Number), v = m.vertProperties, out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) for (let c = 0; c < 3; c++) out[i + c] = v[i]! * t[c]! + v[i + 1]! * t[3 + c]! + v[i + 2]! * t[6 + c]! + t[9 + c]!;
  return { vertProperties: out, triVerts: m.triVerts };
};
const xyCenter = (meshes: { vertProperties: Float32Array }[]) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const { vertProperties: v } of meshes) for (let i = 0; i < v.length; i += 3) {
    x0 = Math.min(x0, v[i]!); x1 = Math.max(x1, v[i]!); y0 = Math.min(y0, v[i + 1]!); y1 = Math.max(y1, v[i + 1]!);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
};

/** Everything Bambu Studio reads from one of our 3MFs, parsed and cross-checked against the model. */
const readBambu = (bytes: Uint8Array) => {
  const z = unzip(bytes);
  const model = parseXml(z.text('3D/3dmodel.model'));
  expect(model.attrs['xmlns:p']).toBe('http://schemas.microsoft.com/3dmanufacturing/production/2015/06');
  expect(model.attrs['xmlns:BambuStudio']).toBe('http://schemas.bambulab.com/package/2021');
  expect(Object.fromEntries(kids(model, 'metadata').map((m) => [m.attrs.name, m.text])).Application).toMatch(/^BambuStudio-/);
  const objects = kids(kid(model, 'resources'), 'object');
  const items = kids(kid(model, 'build'), 'item');
  const rels = parseXml(z.text('3D/_rels/3dmodel.model.rels'));
  const sub = new Map<string, El[]>(); // p:path -> its mesh objects
  const assemblies = objects.map((o) => {
    expect(kids(o, 'mesh'), 'top-level objects are assemblies').toHaveLength(0);
    const components = kids(kid(o, 'components'), 'component').map((c) => {
      const path = c.attrs['p:path']!;
      expect(kids(rels, 'Relationship').map((r) => r.attrs.Target)).toContain(path);
      if (!sub.has(path)) sub.set(path, kids(kid(parseXml(z.text(path.slice(1))), 'resources'), 'object'));
      const mesh = sub.get(path)!.find((m) => m.attrs.id === c.attrs.objectid)!;
      expect(mesh, `component ${c.attrs.objectid} in ${path}`).toBeDefined();
      return { id: c.attrs.objectid!, transform: c.attrs.transform, mesh };
    });
    const item = items.find((i) => i.attrs.objectid === o.attrs.id)!;
    expect(item, `build item for object ${o.attrs.id}`).toBeDefined();
    return { id: o.attrs.id!, components, item };
  });
  expect(items).toHaveLength(objects.length);
  const settings = parseXml(z.text('Metadata/model_settings.config'));
  const cfgObjects = kids(settings, 'object').map((o) => ({
    id: o.attrs.id!, meta: metaOf(o),
    parts: kids(o, 'part').map((p) => ({ id: p.attrs.id!, subtype: p.attrs.subtype, name: metaOf(p).name, extruder: metaOf(p).extruder })),
  }));
  const project = JSON.parse(z.text('Metadata/project_settings.config')) as Record<string, string[]>;
  return { z, assemblies, cfgObjects, project, settings };
};

let potion: Grid;
let main: Model; // potion, default settings (base on, single sided)
beforeAll(async () => {
  potion = await load('potion.png');
  await initManifold();
  main = await buildModel(potion, DEFAULTS);
});

/** An STL file must be one manifold body whose volume is the parts' total (the union of flush parts). */
const expectOneBody = async (bytes: Uint8Array, parts: Part[], label: string) => {
  const mesh = weld(readStl(bytes).corners);
  await assertManifold({ name: label, mesh });
  expect(await bodies(mesh), `${label}: bodies`).toBe(1);
  const want = (await Promise.all(parts.map((p) => volume(p.mesh)))).reduce((a, b) => a + b, 0);
  expect(Math.abs((await volume(mesh)) / want - 1), `${label}: volume`).toBeLessThan(0.005);
};

describe('toSTL', () => {
  it('one binary STL per object: one manifold body, volume the sum of the parts', async () => {
    const files = await toSTL(main, { mono: false, name: 'potion' });
    expect(files.map((f) => f.name)).toEqual(['potion.stl']);
    await expectOneBody(files[0]!.bytes, main.parts, 'stl');
  });

  it('halves: name_front and name_back, each one body', async () => {
    const m = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; }));
    const files = await toSTL(m, { mono: false, name: 'potion' });
    expect(files.map((f) => f.name)).toEqual(['potion_front.stl', 'potion_back.stl']);
    await expectOneBody(files[0]!.bytes, m.parts.filter((p) => p.object === 'front'), 'front stl');
    await expectOneBody(files[1]!.bytes, m.parts.filter((p) => p.object === 'back'), 'back stl');
  });

  it('mono: one watertight body per object', async () => {
    const files = await toSTL(main, { mono: true, name: 'potion' });
    expect(files).toHaveLength(1);
    await expectOneBody(files[0]!.bytes, main.parts, 'mono stl');
  });

  for (const mono of [false, true]) {
    it(`a loop and no base${mono ? ', mono' : ''}: the ring joins the outline in one body`, async () => {
      const m = await buildModel(potion, settings((s) => { s.base.enabled = false; s.keychain.type = 'loop'; }));
      expect(m.parts.map((p) => p.name)).toContain('loop');
      const [file] = await toSTL(m, { mono, name: 'potion' });
      await expectOneBody(file!.bytes, m.parts, 'loop stl');
    });
  }
});

describe('to3MF: Bambu', () => {
  it('one object holding N components, one per part, base first', async () => {
    const r = readBambu(await to3MF(main, { slicer: 'bambu', mono: false, name: 'potion' }));
    expect(r.assemblies).toHaveLength(1);
    const [a] = r.assemblies;
    expect(a!.components).toHaveLength(main.parts.length);
    for (const [i, c] of a!.components.entries()) {
      const mesh = moved(meshOf(c.mesh), c.transform);
      expect(mesh.triVerts.length).toBe(main.parts[i]!.mesh.triVerts.length);
      await assertManifold({ name: `3mf part ${i}`, mesh });
    }
    // the model sits in the middle of a 256 x 256 plate
    const placed = a!.components.map((c) => moved(moved(meshOf(c.mesh), c.transform), a!.item.attrs.transform));
    const [cx, cy] = xyCenter(placed);
    expect(cx).toBeCloseTo(128, 3);
    expect(cy).toBeCloseTo(128, 3);
  });

  it('model_settings.config: N parts on extruders 1..N; project filament colors include the base', async () => {
    const r = readBambu(await to3MF(main, { slicer: 'bambu', mono: false, name: 'potion' }));
    const [a] = r.assemblies, [o] = r.cfgObjects;
    expect(r.cfgObjects).toHaveLength(1);
    expect(o!.id).toBe(a!.id);
    expect(o!.meta.name).toBe('potion');
    expect(o!.meta.extruder).toBe('1');
    expect(o!.parts.map((p) => p.id)).toEqual(a!.components.map((c) => c.id));
    expect(o!.parts.every((p) => p.subtype === 'normal_part')).toBe(true);
    expect(o!.parts.map((p) => p.extruder)).toEqual(main.parts.map((_, i) => String(i + 1)));
    expect(o!.parts.map((p) => p.name)).toEqual(main.parts.map((p) => p.name));
    const colors = r.project.filament_colour!; // filament_colour: external format key, spelling fixed by Bambu Studio
    expect(colors).toEqual(main.parts.map((p) => p.hex.toUpperCase()));
    expect(colors[0]).toBe(DEFAULTS.base.color.toUpperCase());
    expect(r.project.filament_type).toEqual(colors.map(() => 'PLA'));
    expect(r.project.filament_settings_id).toHaveLength(colors.length);
    // plate and assemble blocks name the object
    expect(metaOf(kid(kid(r.settings, 'plate'), 'model_instance')).object_id).toBe(a!.id);
    expect(kid(kid(r.settings, 'assemble'), 'assemble_item').attrs.object_id).toBe(a!.id);
  });

  it('a base the same color as a palette entry shares its filament slot (R25); the parts stay separate', async () => {
    const same = await buildModel(potion, settings((s) => { s.base.color = potion.palette[0]!.hex; }));
    const r = readBambu(await to3MF(same, { slicer: 'bambu', mono: false, name: 'potion' }));
    const parts = r.cfgObjects[0]!.parts;
    expect(parts.map((p) => p.name)).toEqual(same.parts.map((p) => p.name));
    expect(parts[0]!.name).toBe('base');
    const art = parts.find((p) => p.name === potion.palette[0]!.hex)!;
    expect(parts[0]!.extruder).toBe(art.extruder);
    expect(r.project.filament_colour).toHaveLength(same.parts.length - 1);
    expect(r.project.filament_colour).toEqual(filamentColors(potion, settings((s) => { s.base.color = potion.palette[0]!.hex; })).map((h) => h.toUpperCase()));
  });

  it('8 art colors and a base equal to one of them: 8 filaments, 8 slots (R25)', async () => {
    // 8 columns, 3 rows, one color a column
    const hexes = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];
    const eight: Grid = { w: 8, h: 3, cells: Int16Array.from({ length: 24 }, (_, k) => k % 8), palette: hexes.map((hex) => ({ hex, height: 1 })) };
    const s = settings((x) => { x.base.color = eight.palette[3]!.hex.toUpperCase(); });
    expect(filamentColors(eight, s)).toHaveLength(8);
    const r = readBambu(await to3MF(await buildModel(eight, s), { slicer: 'bambu', mono: false, name: 'potion' }));
    expect(r.project.filament_colour).toHaveLength(8);
    expect(new Set(r.cfgObjects[0]!.parts.map((p) => p.extruder)).size).toBe(8);
  });

  it('a clicker with art-color backing and its body in one of the 8 art colors: 8 filaments; the body takes that color', async () => {
    const hexes = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];
    const eight: Grid = { w: 8, h: 3, cells: Int16Array.from({ length: 24 }, (_, k) => k % 8), palette: hexes.map((hex) => ({ hex, height: 1 })) };
    const base = settings((x) => { x.make = 'clicker'; x.clicker.backing = 'art'; });
    expect(filamentColors(eight, base)).toHaveLength(9);
    const s = settings((x) => { x.make = 'clicker'; x.clicker.backing = 'art'; x.clicker.bodyColor = hexes[3]!; });
    expect(filamentColors(eight, s)).toHaveLength(8);
    const m = await buildModel(eight, s);
    expect(m.parts.find((p) => p.object === 'body')!.hex).toBe(hexes[3]);
    const r = readBambu(await to3MF(m, { slicer: 'bambu', mono: false, name: 'potion' }));
    expect(r.project.filament_colour).toEqual(filamentColors(eight, s).map((h) => h.toUpperCase()));
  });

  it('a palette color with no pixels (just added) makes no part and no filament', async () => {
    const added: Grid = { ...potion, palette: [...potion.palette, { hex: '#e0715c', height: 1 }] };
    const s = settings(() => {});
    expect(filamentColors(added, s)).toEqual(filamentColors(potion, s));
    const r = readBambu(await to3MF(await buildModel(added, s), { slicer: 'bambu', mono: false, name: 'potion' }));
    expect(r.project.filament_colour).toEqual(filamentColors(added, s).map((h) => h.toUpperCase()));
  });

  it('filamentColors matches the 3MF slots: base off with a loop, mono, clicker', async () => {
    const cases: Settings[] = [
      settings((s) => { s.base.enabled = false; s.keychain.type = 'loop'; s.keychain.loop.color = potion.palette[1]!.hex; }),
      settings((s) => { s.base.enabled = false; s.keychain.type = 'loop'; s.keychain.loop.color = '#123456'; }),
      settings((s) => { s.export.mono = true; }),
      settings((s) => { s.make = 'clicker'; s.base.enabled = false; }),
    ];
    for (const s of cases) {
      const r = readBambu(await to3MF(await buildModel(potion, s), { slicer: 'bambu', mono: s.export.mono, monoHex: s.export.monoColor, name: 'potion' }));
      expect(r.project.filament_colour).toEqual(filamentColors(potion, s).map((h) => h.toUpperCase()));
    }
  }, 60_000);

  it('base off: no base part, no empty object', async () => {
    const m = await buildModel(potion, settings((s) => { s.base.enabled = false; }));
    const r = readBambu(await to3MF(m, { slicer: 'bambu', mono: false, name: 'potion' }));
    expect(r.assemblies).toHaveLength(1);
    expect(r.cfgObjects[0]!.parts.map((p) => p.name)).toEqual(potion.palette.map((p) => p.hex));
    for (const c of r.assemblies[0]!.components) expect(kids(kid(kid(c.mesh, 'mesh'), 'triangles'), 'triangle').length).toBeGreaterThan(0);
    expect(r.project.filament_colour).toEqual(potion.palette.map((p) => p.hex.toUpperCase()));
  });

  it('halves: two objects, the same color on the same slot in both', async () => {
    const m = await buildModel(potion, settings((s) => { s.sides.mode = 'halves'; }));
    const r = readBambu(await to3MF(m, { slicer: 'bambu', mono: false, name: 'potion' }));
    expect(r.assemblies).toHaveLength(2);
    expect(r.cfgObjects.map((o) => o.meta.name)).toEqual(['potion_front', 'potion_back']);
    const n = m.parts.length / 2;
    for (const o of r.cfgObjects) expect(o.parts.map((p) => p.extruder)).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
    expect(r.project.filament_colour).toHaveLength(n);
    expect(kids(kid(r.settings, 'plate'), 'model_instance')).toHaveLength(2);
  });

  it('a sealed magnet writes a pause layer; none without', async () => {
    const r = readBambu(await to3MF(main, { slicer: 'bambu', mono: false, name: 'potion', pauseZ: [1.4] }));
    const g = parseXml(r.z.text('Metadata/custom_gcode_per_layer.xml'));
    const plate = kid(g, 'plate');
    expect(kid(plate, 'plate_info').attrs.id).toBe('1');
    const layers = kids(plate, 'layer');
    expect(layers).toHaveLength(1);
    expect(layers[0]!.attrs.type).toBe('1');
    // just above the pocket top: the pause falls before the first layer over the pocket on any layer grid
    expect(layers[0]!.attrs.top_z).toBe('1.41');
    const none = unzip(await to3MF(main, { slicer: 'bambu', mono: false, name: 'potion' }));
    expect(none.names).not.toContain('Metadata/custom_gcode_per_layer.xml');
  });

  it("pauseZ defaults to the model's", async () => {
    const r = readBambu(await to3MF({ ...main, pauseZ: [1.4] }, { slicer: 'bambu', mono: false, name: 'potion' }));
    expect(kids(kid(parseXml(r.z.text('Metadata/custom_gcode_per_layer.xml')), 'plate'), 'layer')).toHaveLength(1);
  });

  it('Orca gets the Bambu file', async () => {
    const bambu = await to3MF(main, { slicer: 'bambu', mono: false, name: 'potion' });
    const orca = await to3MF(main, { slicer: 'orca', mono: false, name: 'potion' });
    expect(orca).toEqual(bambu);
  });

  it('mono: a single part in the mono color', async () => {
    const r = readBambu(await to3MF(main, { slicer: 'bambu', mono: true, monoHex: '#123456', name: 'potion' }));
    expect(r.assemblies[0]!.components).toHaveLength(1);
    expect(r.cfgObjects[0]!.parts.map((p) => p.extruder)).toEqual(['1']);
    expect(r.project.filament_colour).toEqual(['#123456']);
    const c = r.assemblies[0]!.components[0]!;
    const mesh = moved(meshOf(c.mesh), c.transform);
    await assertManifold({ name: 'mono 3mf', mesh });
    expect(await bodies(mesh)).toBe(1);
  });
});

describe('to3MF: Prusa', () => {
  it('one mesh object; Slic3r_PE_model.config has N volumes over its triangles, extruders 1..N', async () => {
    const z = unzip(await to3MF(main, { slicer: 'prusa', mono: false, name: 'potion' }));
    const model = parseXml(z.text('3D/3dmodel.model'));
    const objects = kids(kid(model, 'resources'), 'object');
    expect(objects).toHaveLength(1);
    const mesh = meshOf(objects[0]!);
    expect(mesh.triVerts.length / 3).toBe(tris(main));
    const cfg = parseXml(z.text('Metadata/Slic3r_PE_model.config'));
    const [o] = kids(cfg, 'object');
    expect(kids(cfg, 'object')).toHaveLength(1);
    expect(o!.attrs.id).toBe(objects[0]!.attrs.id);
    const vols = kids(o!, 'volume');
    expect(vols).toHaveLength(main.parts.length);
    let next = 0;
    vols.forEach((v, i) => {
      expect(Number(v.attrs.firstid)).toBe(next);
      next = Number(v.attrs.lastid) + 1;
      expect(next - Number(v.attrs.firstid)).toBe(main.parts[i]!.mesh.triVerts.length / 3);
      const m = Object.fromEntries(kids(v, 'metadata').filter((e) => e.attrs.type === 'volume').map((e) => [e.attrs.key, e.attrs.value]));
      expect(m.extruder).toBe(String(i + 1));
      expect(m.name).toBe(main.parts[i]!.name);
    });
    expect(next).toBe(tris(main));
  });

  it('a base the same color as an art color shares its extruder (R25)', async () => {
    const same = await buildModel(potion, settings((s) => { s.base.color = potion.palette[0]!.hex; }));
    const cfg = parseXml(unzip(await to3MF(same, { slicer: 'prusa', mono: false, name: 'potion' })).text('Metadata/Slic3r_PE_model.config'));
    const ex = kids(kids(cfg, 'object')[0]!, 'volume').map((v) => kids(v, 'metadata').find((e) => e.attrs.key === 'extruder')!.attrs.value);
    expect(ex[0]).toBe(ex[1]);
    expect(new Set(ex).size).toBe(same.parts.length - 1);
  });

  it('a sealed magnet writes a PausePrint at the same height; none without', async () => {
    const z = unzip(await to3MF(main, { slicer: 'prusa', mono: false, name: 'potion', pauseZ: [1.4, 2.25] }));
    const g = parseXml(z.text('Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml'));
    expect(g.tag).toBe('custom_gcodes_per_print_z');
    const codes = kids(g, 'code');
    expect(codes.map((c) => c.attrs.print_z)).toEqual(['1.41', '2.26']);
    expect(codes.every((c) => c.attrs.type === '1')).toBe(true);
    const none = unzip(await to3MF(main, { slicer: 'prusa', mono: false, name: 'potion' }));
    expect(none.names).not.toContain('Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml');
  });

  it('mono: one volume', async () => {
    const z = unzip(await to3MF(main, { slicer: 'prusa', mono: true, name: 'potion' }));
    const cfg = parseXml(z.text('Metadata/Slic3r_PE_model.config'));
    expect(all(cfg, 'volume')).toHaveLength(1);
  });
});

describe('to3MF: generic', () => {
  it('basematerials with one color per part, each part object pointing at its own', async () => {
    const z = unzip(await to3MF(main, { slicer: 'generic', mono: false, name: 'potion' }));
    const model = parseXml(z.text('3D/3dmodel.model'));
    const res = kid(model, 'resources');
    const mats = kid(res, 'basematerials');
    expect(kids(mats, 'base').map((b) => b.attrs.displaycolor)).toEqual(main.parts.map((p) => p.hex.toUpperCase()));
    const meshes = kids(res, 'object').filter((o) => kids(o, 'mesh').length);
    const assemblies = kids(res, 'object').filter((o) => kids(o, 'components').length);
    expect(meshes).toHaveLength(main.parts.length);
    expect(assemblies).toHaveLength(1);
    meshes.forEach((o, i) => { expect(o.attrs.pid).toBe(mats.attrs.id); expect(o.attrs.pindex).toBe(String(i)); });
    expect(kids(kid(assemblies[0]!, 'components'), 'component').map((c) => c.attrs.objectid)).toEqual(meshes.map((o) => o.attrs.id));
    expect(kids(kid(model, 'build'), 'item').map((i) => i.attrs.objectid)).toEqual([assemblies[0]!.attrs.id]);
  });

  it('no pause file, even with pause heights', async () => {
    const z = unzip(await to3MF(main, { slicer: 'generic', mono: false, name: 'potion', pauseZ: [1.4] }));
    expect(z.names.filter((n) => n.startsWith('Metadata/'))).toEqual([]);
  });

  it('mono: one base in the mono color', async () => {
    const z = unzip(await to3MF(main, { slicer: 'generic', mono: true, monoHex: '#abcdef', name: 'potion' }));
    const mats = all(parseXml(z.text('3D/3dmodel.model')), 'base');
    expect(mats.map((b) => b.attrs.displaycolor)).toEqual(['#ABCDEF']);
  });
});

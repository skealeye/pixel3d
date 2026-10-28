import * as THREE from 'three';
import { flatOutlines, initManifold, lowestUsed, opaqueBox, pixelSize, type Grid, type ManifoldToplevel, type Settings } from '@pixel3d/core';

/** A flat prism: a 2D shape's unit-height extrusion, stood at z0 and stretched to height h. */
export interface Prism { part: 'base' | 'outline'; hex: string; mesh: { vertProperties: Float32Array; triVerts: Uint32Array }; z0: number; h: number }

/** The preview in the same frame as core `buildModel`: mm, the opaque box at the origin, +Y up the image, +Z off the bed. */
export interface Preview {
  /** Part → one box per column of it: [x, y, z0, height] in mm. Parts are named as core names them: 'base' or a palette hex. */
  columns: Map<string, number[]>;
  /** The base and outline ring when they don't follow the pixels (Smooth edges, Outline): extruded shapes instead. */
  prisms: Prism[];
  /** The base's color (its part is keyed 'base', so a base the same color as an art color stays its own mesh). */
  baseHex: string;
  px: { x: number; y: number };
  size: { x: number; y: number; z: number };
}

let wasm: ManifoldToplevel | null = null;
let loading: Promise<void> | null = null;

/** Load manifold's 2D tools on the page (the worker has its own copy), for the base and outline shapes. */
export function loadShapes(): Promise<void> {
  return (loading ??= initManifold().then((w) => { wasm = w; }));
}

/** The flat model's base or outline ring isn't made of pixel columns: it needs shapes (Smooth edges, Outline). */
export const needsShapes = (s: Settings) => s.make !== 'clicker' && (s.outline.on || (s.smooth && s.base.enabled));
/** Whether the preview can show `s` now (the shapes need manifold, loaded with `loadShapes`). */
export const canPreview = (s: Settings) => !needsShapes(s) || wasm !== null;

/**
 * The last shapes made, and what from: a height slider changes neither the opaque cells nor the sizes, so it reuses
 * them and only restretches the prisms.
 */
let shapeCache: { mask: Uint8Array; key: string; base: Prism['mesh'] | null; ring: Prism['mesh'] | null; bounds: THREE.Box2 } | null = null;

/** A unit-height extrusion of polygons (outer loops counterclockwise, holes clockwise), with manifold. */
function unitPrism(w: ManifoldToplevel, polys: [number, number][][]): Prism['mesh'] | null {
  if (!polys.length) return null;
  const cs = new w.CrossSection(polys, 'Positive'), m = cs.extrude(1), mesh = m.getMesh();
  const out = { vertProperties: mesh.vertProperties.slice(), triVerts: mesh.triVerts.slice() };
  m.delete(); cs.delete();
  return out;
}

function shapesOf(g: Grid, s: Settings, box: { x0: number; y0: number }, px: { x: number; y: number }) {
  const w = wasm!;
  const mask = new Uint8Array(g.cells.length);
  for (let k = 0; k < mask.length; k++) mask[k] = g.cells[k]! >= 0 ? 1 : 0;
  const key = JSON.stringify([g.w, g.h, box.x0, box.y0, px, s.smooth, s.outline.on, s.outline.width, s.base.enabled]);
  const c = shapeCache;
  if (c && c.key === key && c.mask.length === mask.length && c.mask.every((v, i) => v === mask[i])) return c;
  const o = flatOutlines(w, g, s, box.x0, box.y0, px);
  const bounds = new THREE.Box2();
  for (const poly of [...o.base, ...o.ring]) for (const [x, y] of poly) bounds.expandByPoint(new THREE.Vector2(x, y));
  return (shapeCache = { mask, key, base: unitPrism(w, o.base), ring: unitPrism(w, o.ring), bounds });
}

/**
 * Per-color pixel columns straight from the grid: no booleans, so it takes a few milliseconds where `buildModel` takes
 * hundreds (Ruling R10). Covers the base and the pixel layers for one side or both, and, with Smooth edges or Outline,
 * the base and the outline ring as extruded shapes (made once per outline, so height changes stay fast). The keychain,
 * magnets and Inside come only from the core model, which replaces this preview when it arrives. The viewport applies
 * the rotation to both. Shapes need `loadShapes` first: check `canPreview`.
 */
export function previewOf(g: Grid, s: Settings): Preview | null {
  const box = opaqueBox(g);
  if (!box) return null;
  const px = pixelSize(s, box);
  const bt = s.base.enabled ? s.base.height : 0;
  const under = s.sides.mode === 'solid';
  const vary = (h: number) => (under && s.sides.heightsOn === 'top' ? s.heights.h : h);
  const shapes = needsShapes(s) && wasm ? shapesOf(g, s, box, px) : null;
  const columns = new Map<string, number[]>();
  const add = (hex: string, x: number, y: number, z0: number, h: number) => {
    let list = columns.get(hex);
    if (!list) columns.set(hex, (list = []));
    list.push(x, y, z0, h);
  };
  let top = 0, bottom = 0;
  for (let k = 0; k < g.cells.length; k++) {
    const v = g.cells[k]!;
    if (v < 0) continue;
    const cx = k % g.w, cy = g.h - 1 - (k - cx) / g.w;
    const x = (cx - box.x0) * px.x, y = (cy - box.y0) * px.y;
    const p = g.palette[v]!;
    if (bt > 0 && !shapes) add('base', x, y, 0, bt);
    add(p.hex, x, y, bt, p.height);
    top = Math.max(top, bt + p.height);
    if (under) { const hu = vary(p.height); add(p.hex, x, y, -hu, hu); bottom = Math.min(bottom, -hu); }
  }
  const prisms: Prism[] = [];
  let sx = box.w * px.x, sy = box.h * px.y;
  if (shapes) {
    if (bt > 0 && shapes.base) prisms.push({ part: 'base', hex: s.base.color, mesh: shapes.base, z0: 0, h: bt });
    if (shapes.ring) {
      const low = lowestUsed(g);
      prisms.push({ part: 'outline', hex: s.outline.color, mesh: shapes.ring, z0: bt, h: low });
      if (under) { const hu = vary(low); prisms.push({ part: 'outline', hex: s.outline.color, mesh: shapes.ring, z0: -hu, h: hu }); }
    }
    const b = shapes.bounds;
    if (!b.isEmpty()) { sx = Math.max(sx, b.max.x - b.min.x); sy = Math.max(sy, b.max.y - b.min.y); }
  }
  // seat the lowest point on the bed, as the core model does
  if (bottom < 0) {
    for (const list of columns.values()) for (let i = 2; i < list.length; i += 4) list[i]! -= bottom;
    for (const p of prisms) p.z0 -= bottom;
  }
  return { columns, prisms, baseHex: s.base.color, px, size: { x: sx, y: sy, z: top - bottom } };
}

const unit = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);

/** One InstancedMesh of unit boxes per color, and one mesh per prism. */
export function previewMeshes(p: Preview, material: (hex: string, part: string) => THREE.Material): THREE.Object3D[] {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const out: THREE.Object3D[] = [];
  for (const pr of p.prisms) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pr.mesh.vertProperties, 3));
    geo.setIndex(new THREE.BufferAttribute(pr.mesh.triVerts, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material(pr.hex, pr.part));
    mesh.position.z = pr.z0;
    mesh.scale.z = pr.h;
    mesh.userData.hex = pr.hex;
    mesh.userData.part = pr.part;
    out.push(mesh);
  }
  for (const [part, list] of p.columns) {
    const n = list.length / 4;
    const hex = part === 'base' ? p.baseHex : part;
    const mesh = new THREE.InstancedMesh(unit, material(hex, part), n);
    mesh.userData.hex = hex;
    mesh.userData.part = part;
    // bounds straight from the columns: three's computeBoundingBox walks every instance matrix, ~200 ms at 512²
    const box = new THREE.Box3();
    for (let i = 0; i < n; i++) {
      const x = list[i * 4]!, y = list[i * 4 + 1]!, z = list[i * 4 + 2]!, h = list[i * 4 + 3]!;
      pos.set(x, y, z);
      sc.set(p.px.x, p.px.y, h);
      mesh.setMatrixAt(i, m.compose(pos, q, sc));
      box.expandByPoint(pos);
      box.expandByPoint(sc.add(pos));
    }
    mesh.boundingBox = box;
    mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    out.push(mesh);
  }
  return out;
}

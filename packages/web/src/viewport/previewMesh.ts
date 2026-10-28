import * as THREE from 'three';
import { opaqueBox, pixelSize, type Grid, type Settings } from '@pixel3d/core';

/** The preview in the same frame as core `buildModel`: mm, the opaque box at the origin, +Y up the image, +Z off the bed. */
export interface Preview {
  /** Part → one box per column of it: [x, y, z0, height] in mm. Parts are named as core names them: 'base' or a palette hex. */
  columns: Map<string, number[]>;
  /** The base's color (its part is keyed 'base', so a base the same color as an art color stays its own mesh). */
  baseHex: string;
  px: { x: number; y: number };
  size: { x: number; y: number; z: number };
}

/**
 * Per-color pixel columns straight from the grid: no booleans, so it takes a few milliseconds where `buildModel` takes
 * hundreds (Ruling R10). Covers the base and the pixel layers for one side or both; the keychain, magnets and Inside
 * come only from the core model, which replaces this preview when it arrives. The viewport applies the rotation to both.
 */
export function previewOf(g: Grid, s: Settings): Preview | null {
  const box = opaqueBox(g);
  if (!box) return null;
  const px = pixelSize(s, box);
  const bt = s.base.enabled ? s.base.height : 0;
  const under = s.sides.mode === 'solid';
  const vary = (h: number) => (under && s.sides.heightsOn === 'top' ? s.heights.h : h);
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
    if (bt > 0) add('base', x, y, 0, bt);
    add(p.hex, x, y, bt, p.height);
    top = Math.max(top, bt + p.height);
    if (under) { const hu = vary(p.height); add(p.hex, x, y, -hu, hu); bottom = Math.min(bottom, -hu); }
  }
  // seat the lowest point on the bed, as the core model does
  if (bottom < 0) for (const list of columns.values()) for (let i = 2; i < list.length; i += 4) list[i]! -= bottom;
  return { columns, baseHex: s.base.colour, px, size: { x: box.w * px.x, y: box.h * px.y, z: top - bottom } };
}

const unit = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);

/** One InstancedMesh of unit boxes per color. */
export function previewMeshes(p: Preview, material: (hex: string, part: string) => THREE.Material): THREE.Object3D[] {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const out: THREE.Object3D[] = [];
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

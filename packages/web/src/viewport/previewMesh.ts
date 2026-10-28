import * as THREE from 'three';
import type { Grid, Settings } from '@pixel3d/core';

/** The preview in the same frame as core `buildModel`: mm, the opaque box at the origin, +Y up the image, +Z off the bed. */
export interface Preview {
  /** Hex → one box per column of that colour: [x, y, z0, height] in mm, plus the cell size. */
  columns: Map<string, number[]>;
  px: { x: number; y: number };
  size: { x: number; y: number; z: number };
}

/** Opaque bounding box in y-up cell coordinates (as core mesh.ts). */
function opaqueBox(g: Grid) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < g.cells.length; k++) {
    if (g.cells[k]! < 0) continue;
    const x = k % g.w, y = g.h - 1 - (k - x) / g.w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 > x1 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Per-colour pixel columns straight from the grid: no booleans, so it takes a few milliseconds where `buildModel` takes
 * hundreds (Ruling R10). Covers the base and the pixel layers for one side or both; the keychain, magnets, Inside and
 * rotation come only from the core model, which replaces this preview when it arrives.
 */
export function previewOf(g: Grid, s: Settings): Preview | null {
  const box = opaqueBox(g);
  if (!box) return null;
  const px = s.pixelMm ?? { x: s.size.width / box.w, y: s.size.keepAspect ? s.size.width / box.w : s.size.height / box.h };
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
    if (bt > 0) add(s.base.colour, x, y, 0, bt);
    add(p.hex, x, y, bt, p.height);
    top = Math.max(top, bt + p.height);
    if (under) { const hu = vary(p.height); add(p.hex, x, y, -hu, hu); bottom = Math.min(bottom, -hu); }
  }
  // seat the lowest point on the bed, as the core model does
  if (bottom < 0) for (const list of columns.values()) for (let i = 2; i < list.length; i += 4) list[i]! -= bottom;
  return { columns, px, size: { x: box.w * px.x, y: box.h * px.y, z: top - bottom } };
}

const unit = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);

/** One InstancedMesh of unit boxes per colour. */
export function previewMeshes(p: Preview, material: (hex: string) => THREE.Material): THREE.Object3D[] {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const out: THREE.Object3D[] = [];
  for (const [hex, list] of p.columns) {
    const n = list.length / 4;
    const mesh = new THREE.InstancedMesh(unit, material(hex), n);
    for (let i = 0; i < n; i++) {
      pos.set(list[i * 4]!, list[i * 4 + 1]!, list[i * 4 + 2]!);
      sc.set(p.px.x, p.px.y, list[i * 4 + 3]!);
      mesh.setMatrixAt(i, m.compose(pos, q, sc));
    }
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    out.push(mesh);
  }
  return out;
}

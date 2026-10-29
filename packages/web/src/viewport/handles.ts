import * as THREE from 'three';
import { magnetSize, opaqueBox, pixelSize, placeRelative, type Anchor, type Grid, type Settings } from '@pixel3d/core';

/**
 * Drag handles for the keychain hole and the magnets, and the conversions between the model frame and settings
 * anchors. The model frame is core `buildModel`'s, unrotated: mm, the opaque box's bottom-left corner at the origin,
 * +Y up the image. An anchor is a fraction of the opaque box measured from its top-left (core `placeRelative`).
 */

export interface Handle { kind: 'hole' | 'magnet'; i: number; x: number; y: number; round: boolean; size: number }

/** The art's frame: mm per pixel and the opaque box (y up, in cells), or null with nothing opaque. */
export function artFrame(g: Grid, s: Settings) {
  const box = opaqueBox(g);
  if (!box) return null;
  const px = pixelSize(s, box);
  return { box, px, w: box.w * px.x, h: box.h * px.y };
}

/** Where core puts an anchor (exactly, when on the art; else the nearest opaque cell center), in the model frame (mm). */
export function anchorToModel(a: Anchor, g: Grid, s: Settings): { x: number; y: number } | null {
  const f = artFrame(g, s);
  if (!f) return null;
  const p = placeRelative(a, g);
  return { x: (p.u - f.box.x0) * f.px.x, y: (p.v - f.box.y0) * f.px.y };
}

/**
 * A point in the model frame as an anchor, clamped to the opaque box. `snap` (Shift held) moves it to the nearest
 * half pixel: every pixel center and corner, which always includes the art's exact center.
 */
export function modelToAnchor(x: number, y: number, g: Grid, s: Settings, snap = false): Anchor | null {
  const f = artFrame(g, s);
  if (!f) return null;
  if (snap) {
    x = Math.round((x / f.px.x) * 2) / 2 * f.px.x;
    y = Math.round((y / f.px.y) * 2) / 2 * f.px.y;
  }
  const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e6) / 1e6;
  return { fx: clamp(x / f.w), fy: clamp(1 - y / f.h) };
}

/** The handles to draw for these settings (none for a clicker, which has no keychain or magnets). */
export function handlesOf(g: Grid, s: Settings): Handle[] {
  if (s.make !== 'model') return [];
  const out: Handle[] = [];
  const { hole } = s.keychain;
  if (s.keychain.type === 'hole') {
    const p = anchorToModel(hole.at, g, s);
    if (p) out.push({ kind: 'hole', i: 0, ...p, round: hole.style === 'round', size: hole.size });
  }
  const d = magnetSize(s).d;
  s.magnets.at.forEach((a, i) => {
    const p = anchorToModel(a, g, s);
    if (p) out.push({ kind: 'magnet', i, ...p, round: true, size: d });
  });
  return out;
}

const ghostGold = new THREE.MeshBasicMaterial({ color: '#d9a441', transparent: true, opacity: 0.45, depthTest: false });
const ghostMag = new THREE.MeshBasicMaterial({ color: '#e0715c', transparent: true, opacity: 0.35, depthTest: false });

/**
 * Flat see-through markers (the mockup's) lying on the model's top at `top` mm. They are never part of the model:
 * the viewport leaves them out of its size and placement.
 */
export function handleMeshes(list: Handle[], top: number): THREE.Mesh[] {
  return list.map((h) => {
    const t = h.kind === 'hole' ? 0.6 : 0.4;
    const geo = h.round
      ? new THREE.CylinderGeometry(h.size / 2, h.size / 2, t, 32).rotateX(Math.PI / 2)
      : new THREE.BoxGeometry(h.size, h.size, t);
    const m = new THREE.Mesh(geo, h.kind === 'hole' ? ghostGold : ghostMag);
    m.position.set(h.x, h.y, top + t / 2);
    m.renderOrder = h.kind === 'hole' ? 10 : 11;
    m.userData.handle = { kind: h.kind, i: h.i };
    return m;
  });
}

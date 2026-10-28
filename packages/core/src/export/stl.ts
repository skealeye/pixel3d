import type { Model, Part } from '../mesh';
import { initManifold } from '../manifold';

export type Mesh = Part['mesh'];

/** The model's printed objects in part order, each with its file/object name: `name`, or `name_front` etc. */
export function objectsOf(model: Model, name: string): { name: string; parts: Part[] }[] {
  const out: { name: string; object: Part['object']; parts: Part[] }[] = [];
  for (const p of model.parts) {
    let o = out.find((x) => x.object === p.object);
    if (!o) out.push((o = { name: p.object === 'main' ? name : `${name}_${p.object}`, object: p.object, parts: [] }));
    o.parts.push(p);
  }
  return out.map(({ name, parts }) => ({ name, parts }));
}

/** All the parts as one watertight body: a manifold union, so shared faces between colors disappear. */
export async function unionParts(parts: Part[]): Promise<Mesh> {
  const { Manifold, Mesh } = await initManifold();
  const solids = parts.map((p) => new Manifold(new Mesh({ numProp: 3, vertProperties: p.mesh.vertProperties, triVerts: p.mesh.triVerts })));
  const u = Manifold.union(solids);
  try {
    const m = u.getMesh();
    return { vertProperties: m.vertProperties, triVerts: m.triVerts };
  } finally {
    u.delete();
    for (const s of solids) s.delete();
  }
}

/** Binary STL of the given meshes, coordinates unchanged (mm). */
export function stlBytes(meshes: Mesh[]): Uint8Array {
  const n = meshes.reduce((k, m) => k + m.triVerts.length / 3, 0);
  const bytes = new Uint8Array(84 + 50 * n);
  bytes.set(new TextEncoder().encode('pixel3d binary STL, mm'));
  const dv = new DataView(bytes.buffer);
  dv.setUint32(80, n, true);
  let at = 84;
  for (const { vertProperties: v, triVerts: t } of meshes) {
    for (let i = 0; i < t.length; i += 3) {
      const a = 3 * t[i]!, b = 3 * t[i + 1]!, c = 3 * t[i + 2]!;
      const ux = v[b]! - v[a]!, uy = v[b + 1]! - v[a + 1]!, uz = v[b + 2]! - v[a + 2]!;
      const wx = v[c]! - v[a]!, wy = v[c + 1]! - v[a + 1]!, wz = v[c + 2]! - v[a + 2]!;
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const f of [nx, ny, nz, v[a]!, v[a + 1]!, v[a + 2]!, v[b]!, v[b + 1]!, v[b + 2]!, v[c]!, v[c + 1]!, v[c + 2]!]) {
        dv.setFloat32(at, f, true);
        at += 4;
      }
      at += 2; // attribute byte count, 0
    }
  }
  return bytes;
}

/**
 * Single-color binary STL, one file per printed object (`name.stl`, or `name_front.stl` / `name_back.stl`,
 * `name_cap.stl` / `name_body.stl`). Each file is one watertight body: the manifold union of that object's
 * parts, so a keychain ring with no base is joined to the outline. `mono` changes nothing here (STL has no color).
 */
export async function toSTL(model: Model, opts: { mono: boolean; name?: string }): Promise<{ name: string; bytes: Uint8Array }[]> {
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const o of objectsOf(model, opts.name ?? 'model')) {
    out.push({ name: `${o.name}.stl`, bytes: stlBytes([await unionParts(o.parts)]) });
  }
  return out;
}

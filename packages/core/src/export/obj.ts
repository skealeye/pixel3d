import type { Model, Part } from '../mesh';
import { DEFAULTS } from '../settings';
import { filamentSlots } from '../filaments';
import { objectsOf } from './stl';
import type { Mesh } from './stl';
import { num } from './xml';

export interface MeshFileOptions {
  mono: boolean;
  /** Mono color, #rrggbb; defaults to the settings default. */
  monoHex?: string;
  /** File and object name; halves etc. add `_front` / `_back`. Defaults to 'model'. */
  name?: string;
}

/** One part to write: its mesh unchanged (mm, Z up) and its material, an index into `colors`. */
export interface ColorPart { name: string; mat: number; mesh: Mesh }

/**
 * The model for a mesh file (OBJ, FBX): printed objects in part order, every part its own mesh at the model's own
 * coordinates (so halves and coupons sit apart, as on the 3MF plate), one material per distinct color as the 3MF
 * assigns filament slots. Mono: every part on one material in `monoHex`.
 */
export function colorScene(model: Model, opts: MeshFileOptions): { colors: string[]; objects: { name: string; parts: ColorPart[] }[] } {
  const colors = opts.mono ? [(opts.monoHex ?? DEFAULTS.export.monoColor).toLowerCase()] : filamentSlots(model.parts.map((p) => p.hex));
  const objects = objectsOf(model, opts.name ?? 'model').map((o) => ({
    name: o.name,
    parts: o.parts.map((p: Part) => ({ name: p.name, mat: opts.mono ? 0 : colors.indexOf(p.hex.toLowerCase()), mesh: p.mesh })),
  }));
  return { colors, objects };
}

/** A hex color as sRGB 0..1 components. */
export const rgb01 = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1e6) / 1e6) as [number, number, number];

const matName = (i: number) => `color_${i + 1}`;
/** An OBJ name: no whitespace, no `#`. */
const objName = (s: string) => s.replace(/#/g, '').replace(/\s+/g, '_');

/**
 * Wavefront OBJ plus its MTL: `name.obj` (one `o` per printed object, one `g` + `usemtl` per part, parts kept apart
 * so their colors survive) and `name.mtl` (one material per color, `Kd` in sRGB 0..1). mm, Z up. Deterministic.
 */
export function toOBJ(model: Model, opts: MeshFileOptions): { name: string; bytes: Uint8Array }[] {
  const name = opts.name ?? 'model';
  const { colors, objects } = colorScene(model, opts);
  const out: string[] = ['# pixel3d OBJ, mm, Z up', `mtllib ${name}.mtl`];
  let base = 1;
  for (const o of objects) {
    out.push(`o ${objName(o.name)}`);
    for (const p of o.parts) {
      const { vertProperties: v, triVerts: t } = p.mesh;
      out.push(`g ${objName(`${o.name}_${p.name}`)}`, `usemtl ${matName(p.mat)}`);
      for (let i = 0; i < v.length; i += 3) out.push(`v ${num(v[i]!)} ${num(v[i + 1]!)} ${num(v[i + 2]!)}`);
      for (let i = 0; i < t.length; i += 3) out.push(`f ${t[i]! + base} ${t[i + 1]! + base} ${t[i + 2]! + base}`);
      base += v.length / 3;
    }
  }
  const mtl: string[] = ['# pixel3d MTL'];
  colors.forEach((hex, i) => mtl.push('', `newmtl ${matName(i)}`, `# ${hex}`, `Kd ${rgb01(hex).join(' ')}`, 'Ka 0 0 0', 'Ks 0 0 0', 'd 1', 'illum 1'));
  const enc = new TextEncoder();
  return [
    { name: `${name}.obj`, bytes: enc.encode(out.join('\n') + '\n') },
    { name: `${name}.mtl`, bytes: enc.encode(mtl.join('\n') + '\n') },
  ];
}

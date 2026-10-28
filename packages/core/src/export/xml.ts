import type { Part } from '../mesh';

/** Shared 3MF XML pieces and the scene every slicer writer works from. */

type Mesh = Part['mesh'];

/** One part ready to write: its mesh in its object's own frame and its filament slot (1-based). */
export interface OutPart { name: string; hex: string; slot: number; mesh: Mesh }
/** One printed object: its parts, and where its frame sits on the plate (a translation, mm). */
export interface OutObject { name: string; parts: OutPart[]; at: [number, number, number] }
/** Everything a slicer writer needs. `colors[i]` is slot i + 1's color, #RRGGBB. */
export interface Scene { name: string; objects: OutObject[]; colors: string[]; pauseZ: number[] }
export type Files = Record<string, string>;

export const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
export const NS_BAMBU = 'http://schemas.bambulab.com/package/2021';
export const NS_PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
export const NS_SLIC3R = 'http://schemas.slic3r.org/3mf/2017/06';
export const REL_3DMODEL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A coordinate, mm, to the micron. */
const num = (v: number) => String(Math.round(v * 1e6) / 1e6 + 0);
/** A 3MF row-major 3x4 transform that only translates. */
export const translate = ([x, y, z]: readonly number[]) => `1 0 0 0 1 0 0 0 1 ${num(x!)} ${num(y!)} ${num(z!)}`;
export const IDENTITY = translate([0, 0, 0]);

/** A `<mesh>` element holding the given meshes as one (later meshes' indices offset past earlier vertices). */
export function meshXml(meshes: Mesh[], indent = '    '): string {
  const out: string[] = [`${indent}<mesh>`, `${indent} <vertices>`];
  for (const { vertProperties: v } of meshes) {
    for (let i = 0; i < v.length; i += 3) out.push(`${indent}  <vertex x="${num(v[i]!)}" y="${num(v[i + 1]!)}" z="${num(v[i + 2]!)}"/>`);
  }
  out.push(`${indent} </vertices>`, `${indent} <triangles>`);
  let base = 0;
  for (const { vertProperties: v, triVerts: t } of meshes) {
    for (let i = 0; i < t.length; i += 3) out.push(`${indent}  <triangle v1="${t[i]! + base}" v2="${t[i + 1]! + base}" v3="${t[i + 2]! + base}"/>`);
    base += v.length / 3;
  }
  out.push(`${indent} </triangles>`, `${indent}</mesh>`);
  return out.join('\n');
}
/** The 4x4 identity, as Bambu and Prusa write a part's `matrix`. */
export const MATRIX = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';

/** A relationships part with one 3D model relationship per target. */
export const relsXml = (targets: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${targets.map((t, i) => ` <Relationship Target="${t}" Id="rel-${i + 1}" Type="${REL_3DMODEL}"/>`).join('\n')}
</Relationships>
`;

/**
 * Where a slicer's per-layer pause goes for a pocket closing at `z`: just above it, so the pause falls before the
 * first layer printed over the pocket top, whatever the layer grid.
 */
export const pauseAt = (z: number) => String(Math.round((z + 0.01) * 1e4) / 1e4);

import { strToU8, zipSync } from 'fflate';
import type { Model, Part } from '../mesh';
import { DEFAULTS } from '../settings';
import { objectsOf, unionParts } from './stl';
import type { Mesh } from './stl';
import { bambuFiles } from './bambu';
import { prusaFiles } from './prusa';

export type Slicer = 'bambu' | 'orca' | 'prusa' | 'generic';
export interface ThreeMFOptions {
  slicer: Slicer;
  mono: boolean;
  /** Mono colour, #rrggbb; defaults to the settings default. */
  monoHex?: string;
  /** Pause heights (mm) for sealed magnets; defaults to the model's. */
  pauseZ?: number[];
  /** Object name; halves etc. add `_front` / `_back`. Defaults to 'model'. */
  name?: string;
}

/** One part ready to write: its mesh in its object's own frame and its filament slot (1-based). */
export interface OutPart { name: string; hex: string; slot: number; mesh: Mesh }
/** One printed object: its parts, and where its frame sits on the plate (a translation, mm). */
export interface OutObject { name: string; parts: OutPart[]; at: [number, number, number] }
/** Everything a slicer writer needs. `colours[i]` is slot i + 1's colour, #RRGGBB. */
export interface Scene { name: string; objects: OutObject[]; colours: string[]; pauseZ: number[] }
export type Files = Record<string, string>;

/** Bambu's 256 x 256 mm plate: the model is centred on it. */
export const PLATE_CENTRE: [number, number] = [128, 128];
const MTIME = new Date('2026-01-01T00:00:00Z');

export const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
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

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>
`;

/** A relationships part with one 3D model relationship per target. */
export const relsXml = (targets: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${targets.map((t, i) => ` <Relationship Target="${t}" Id="rel-${i + 1}" Type="${REL_3DMODEL}"/>`).join('\n')}
</Relationships>
`;

/** XY bounding-box centre of some meshes, and their lowest Z. */
function footprint(meshes: Mesh[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
  for (const { vertProperties: v } of meshes) for (let i = 0; i < v.length; i += 3) {
    x0 = Math.min(x0, v[i]!); x1 = Math.max(x1, v[i]!);
    y0 = Math.min(y0, v[i + 1]!); y1 = Math.max(y1, v[i + 1]!);
    z0 = Math.min(z0, v[i + 2]!);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, z0 };
}

const shift = (m: Mesh, dx: number, dy: number): Mesh => {
  const v = new Float32Array(m.vertProperties);
  for (let i = 0; i < v.length; i += 3) { v[i]! -= dx; v[i + 1]! -= dy; }
  return { vertProperties: v, triVerts: m.triVerts };
};

/**
 * Lay the model out for a 3MF: printed objects in part order, each part on a filament slot keyed by its
 * name (base, loop, or palette hex), so a base the same colour as a palette entry still gets its own slot and
 * halves share slots. Each object's frame is its own XY centre; together they sit centred on the plate.
 */
async function sceneOf(model: Model, opts: ThreeMFOptions): Promise<Scene> {
  const name = opts.name ?? 'model';
  const objects = objectsOf(model, name);
  const colours: string[] = [];
  const slots = new Map<string, number>();
  const slotOf = (key: string, hex: string) => {
    if (!slots.has(key)) { colours.push(hex.toUpperCase()); slots.set(key, colours.length); }
    return slots.get(key)!;
  };
  const monoHex = opts.monoHex ?? DEFAULTS.export.monoColour;
  const raw: { name: string; parts: OutPart[] }[] = [];
  for (const o of objects) {
    const parts = opts.mono
      ? [{ name: o.name, hex: monoHex, slot: slotOf('mono', monoHex), mesh: await unionParts(o.parts) }]
      : o.parts.map((p: Part) => ({ name: p.name, hex: p.hex, slot: slotOf(p.name, p.hex), mesh: p.mesh }));
    raw.push({ name: o.name, parts });
  }
  const all = footprint(raw.flatMap((o) => o.parts.map((p) => p.mesh)));
  const out: OutObject[] = raw.map((o) => {
    const f = footprint(o.parts.map((p) => p.mesh));
    return {
      name: o.name,
      parts: o.parts.map((p) => ({ ...p, mesh: shift(p.mesh, f.cx, f.cy) })),
      at: [f.cx - all.cx + PLATE_CENTRE[0], f.cy - all.cy + PLATE_CENTRE[1], 0],
    };
  });
  return { name, objects: out, colours, pauseZ: [...(opts.pauseZ ?? model.pauseZ)] };
}

/**
 * Generic 3MF (core spec + materials extension): one mesh object per part, coloured through
 * `<basematerials>` (one `<base>` per slot), and one assembly object per printed object.
 */
function genericFiles(scene: Scene): Files {
  let id = 2; // 1 is the basematerials group
  const res: string[] = [];
  const items: string[] = [];
  for (const o of scene.objects) {
    const ids = o.parts.map((p) => {
      res.push(` <object id="${id}" name="${esc(p.name)}" type="model" pid="1" pindex="${p.slot - 1}">\n${meshXml([p.mesh], '  ')}\n </object>`);
      return id++;
    });
    res.push(` <object id="${id}" name="${esc(o.name)}" type="model">\n  <components>\n${ids.map((i) => `   <component objectid="${i}"/>`).join('\n')}\n  </components>\n </object>`);
    items.push(` <item objectid="${id++}" transform="${translate(o.at)}"/>`);
  }
  const mats = scene.colours.map((c, i) => `  <base name="slot ${i + 1}" displaycolor="${c}"/>`).join('\n');
  return {
    '3D/3dmodel.model': `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}">
 <metadata name="Title">${esc(scene.name)}</metadata>
 <metadata name="Application">pixel3d</metadata>
 <resources>
 <basematerials id="1">
${mats}
 </basematerials>
${res.join('\n')}
 </resources>
 <build>
${items.join('\n')}
 </build>
</model>
`,
  };
}

/**
 * A 3MF of the model for one slicer: one object made of parts per printed object (halves: front and back),
 * parts in palette order with the base first. Bambu and Orca get Bambu project metadata (parts on filament
 * slots 1..N with their colours, magnet pauses), Prusa its volume config, anything else `<basematerials>`.
 * Mono: one part per object, the union of its parts, in `monoHex`.
 */
export async function to3MF(model: Model, opts: ThreeMFOptions): Promise<Uint8Array> {
  const scene = await sceneOf(model, opts);
  const files: Files = {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': relsXml(['/3D/3dmodel.model']),
    ...(opts.slicer === 'bambu' || opts.slicer === 'orca' ? bambuFiles(scene) : opts.slicer === 'prusa' ? prusaFiles(scene) : genericFiles(scene)),
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6, mtime: MTIME });
}

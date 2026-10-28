import { strToU8, zipSync } from 'fflate';
import type { Model, Part } from '../mesh';
import { DEFAULTS } from '../settings';
import { objectsOf, unionParts } from './stl';
import { filamentSlots } from '../filaments';
import type { Mesh } from './stl';
import { bambuFiles } from './bambu';
import { prusaFiles } from './prusa';
import { esc, meshXml, NS_CORE, relsXml, translate } from './xml';
import type { Files, OutObject, OutPart, Scene } from './xml';

export type { Files, OutObject, OutPart, Scene } from './xml';

export type Slicer = 'bambu' | 'orca' | 'prusa' | 'generic';
export interface ThreeMFOptions {
  slicer: Slicer;
  mono: boolean;
  /** Mono color, #rrggbb; defaults to the settings default. */
  monoHex?: string;
  /** Pause heights (mm) for sealed magnets; defaults to the model's. */
  pauseZ?: number[];
  /** Object name; halves etc. add `_front` / `_back`. Defaults to 'model'. */
  name?: string;
}

/** Bambu's 256 x 256 mm plate: the model is centered on it. */
export const PLATE_CENTRE: [number, number] = [128, 128];
const MTIME = new Date('2026-01-01T00:00:00Z');


const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>
`;


/** XY bounding-box center of some meshes. Z is left as built (min 0, seated by buildModel). */
function footprint(meshes: Mesh[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const { vertProperties: v } of meshes) for (let i = 0; i < v.length; i += 3) {
    x0 = Math.min(x0, v[i]!); x1 = Math.max(x1, v[i]!);
    y0 = Math.min(y0, v[i + 1]!); y1 = Math.max(y1, v[i + 1]!);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

const shift = (m: Mesh, dx: number, dy: number): Mesh => {
  const v = new Float32Array(m.vertProperties);
  for (let i = 0; i < v.length; i += 3) { v[i]! -= dx; v[i + 1]! -= dy; }
  return { vertProperties: v, triVerts: m.triVerts };
};

/**
 * Lay the model out for a 3MF: printed objects in part order, each part on its color's filament slot
 * (`filamentSlots`, which `filamentColors` also uses), so a base or loop the same color as a palette entry shares
 * that filament (R25) while staying its own part, and halves share slots. One color is one slot. Each object's
 * frame is its own XY center; together they sit centered on the plate.
 */
async function sceneOf(model: Model, opts: ThreeMFOptions): Promise<Scene> {
  const name = opts.name ?? 'model';
  const objects = objectsOf(model, name);
  const monoHex = opts.monoHex ?? DEFAULTS.export.monoColour;
  const slotList = opts.mono ? [monoHex.toLowerCase()] : filamentSlots(model.parts.map((p) => p.hex));
  const slotOf = (hex: string) => slotList.indexOf(hex.toLowerCase()) + 1;
  const raw: { name: string; parts: OutPart[] }[] = [];
  for (const o of objects) {
    const parts = opts.mono
      ? [{ name: o.name, hex: monoHex, slot: 1, mesh: await unionParts(o.parts) }]
      : o.parts.map((p: Part) => ({ name: p.name, hex: p.hex, slot: slotOf(p.hex), mesh: p.mesh }));
    raw.push({ name: o.name, parts });
  }
  const colours = slotList.map((h) => h.toUpperCase());
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
 * Generic 3MF (core spec + materials extension): one mesh object per part, colored through
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
 * slots 1..N with their colors, magnet pauses), Prusa its volume config, anything else `<basematerials>`.
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

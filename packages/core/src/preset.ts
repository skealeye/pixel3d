import { z } from 'zod';
import type { Edit } from './edits';
import type { Grid } from './grid';
import { hexDist2 } from './palette';
import { type Anchor, type Settings, DEFAULTS, hexSchema, settingsSchema } from './settings';

/** Largest RGB distance: sqrt(3 * 255^2). */
const MAX_RGB_DIST = 441.7;

type AnyObject = z.ZodObject<Record<string, z.ZodType>>;

/** Make every field of every nested object optional. Arrays, unions and tuples are replaced whole. */
function deepPartial(schema: z.ZodType): z.ZodType {
  if (!(schema instanceof z.ZodObject)) return schema;
  const shape = (schema as AnyObject).shape;
  const out: Record<string, z.ZodType> = {};
  for (const k of Object.keys(shape)) out[k] = deepPartial(shape[k]!).optional();
  return z.object(out).strict();
}

const colorRuleSchema = z.object({
  match: hexSchema,
  tolPct: z.number().min(0).max(100),
  height: z.number().min(0.2).max(20).optional(),
  recolor: hexSchema.optional(),
  delete: z.literal(true).optional(),
}).strict();

const presetSchema = z.object({
  version: z.literal(1),
  // both may be left out (R30): a hand-written {"version": 1} is the defaults
  settings: deepPartial(settingsSchema).default({}),
  colorRules: z.array(colorRuleSchema).default([]),
}).strict();

export type ColorRule = z.output<typeof colorRuleSchema>;
type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export interface Preset {
  version: 1;
  settings: DeepPartial<Settings>;
  colorRules: ColorRule[];
}

export class PresetError extends Error {
  /** Dotted path of the offending field, e.g. `settings.base.height`; '' for the document itself. */
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path || '(preset)'}: ${message}`);
    this.name = 'PresetError';
    this.path = path;
  }
}

/** Validate untrusted JSON. Throws `PresetError` for the first problem. `settings` and `colorRules` may be left out (R30). */
export function parsePreset(json: unknown): Preset {
  const r = presetSchema.safeParse(json);
  if (r.success) return r.data as Preset;
  const issue = r.error.issues[0]!;
  // Unknown keys are reported on their parent object.
  throw new PresetError(issue.path.map(String).join('.'), issue.message);
}

function merge<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (base && typeof base === 'object' && !Array.isArray(base) && over && typeof over === 'object' && !Array.isArray(over)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(over)) out[k] = merge(out[k], v);
    return out as T;
  }
  return over as T;
}

/** A preset merged over DEFAULTS. */
export function presetSettings(p: Preset): Settings {
  return merge(DEFAULTS, p.settings);
}

/** Color rules as edits for `g`'s (reduced) palette, with one readable `applied` line per edit (same index); `unmatched` lists rules that matched no color. */
export function colorRuleEdits(rules: ColorRule[], g: Grid): { edits: Edit[]; applied: string[]; unmatched: ColorRule[] } {
  const edits: Edit[] = [];
  const applied: string[] = [];
  const unmatched: ColorRule[] = [];
  for (const rule of rules) {
    const tol2 = ((rule.tolPct / 100) * MAX_RGB_DIST) ** 2;
    let hit = false;
    for (const { hex } of g.palette) {
      if (hexDist2(hex, rule.match) > tol2) continue;
      hit = true;
      if (rule.delete) {
        edits.push({ kind: 'delete', hex });
        applied.push(`${hex} → delete`);
        continue;
      }
      if (rule.height !== undefined) {
        edits.push({ kind: 'height', hex, h: rule.height });
        applied.push(`${hex} → height ${rule.height}`);
      }
      if (rule.recolor !== undefined) {
        edits.push({ kind: 'recolor', from: hex, to: rule.recolor });
        applied.push(`${hex} → recolor ${rule.recolor}`);
      }
    }
    if (!hit) unmatched.push(rule);
  }
  return { edits, applied, unmatched };
}

/**
 * Where an anchor lands, `{u, v}` in pixel units, `v` measured up from the bottom of the grid (cell (x, y-up) spans
 * [x, x+1]). An x,y anchor that falls on an opaque cell is used exactly, so the hole and magnets can sit part-way
 * across pixels (spec §4.7); one that falls off the art snaps to the nearest opaque cell center. The named anchors
 * (`top-center`, `top-left`) always land on the nearest opaque cell center, so they sit on the art, not on its edge.
 */
export function placeRelative(anchor: Anchor, g: Grid): { u: number; v: number } {
  const [fx, fy] = anchor === 'top-center' ? [0.5, 0] : anchor === 'top-left' ? [0, 0] : [anchor.fx, anchor.fy];
  let x0 = g.w, x1 = -1, y0 = g.h, y1 = -1;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.cells[y * g.w + x]! < 0) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return { u: g.w / 2, v: g.h / 2 };
  const tx = x0 + fx * (x1 - x0 + 1);
  const ty = y0 + fy * (y1 - y0 + 1); // measured down from the top
  if (typeof anchor === 'object') {
    const cx = Math.floor(tx), cy = Math.floor(ty);
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1 && g.cells[cy * g.w + cx]! >= 0) return { u: tx, v: g.h - ty };
  }
  let best = { x: x0, y: y0 }, bd = Infinity;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (g.cells[y * g.w + x]! < 0) continue;
    const d = (x + 0.5 - tx) ** 2 + (y + 0.5 - ty) ** 2;
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return { u: best.x + 0.5, v: g.h - (best.y + 0.5) };
}

/**
 * "Save as preset": the settings (minus `pixelMm`) plus color rules from this image's
 * height, recolor and delete edits. Paint and add edits are image-specific and not saved.
 */
export function presetFromState(settings: Settings, g: Grid, edits: Edit[]): Preset {
  const { pixelMm: _pixelMm, ...rest } = settings;
  const source = new Set(g.palette.map((c) => c.hex));
  const origin = new Map<string, string>(); // current color -> source color
  const rules = new Map<string, ColorRule>();
  const rule = (hex: string): ColorRule | undefined => {
    const orig = origin.get(hex) ?? hex;
    if (!source.has(orig)) return undefined;
    let r = rules.get(orig);
    if (!r) rules.set(orig, (r = { match: orig, tolPct: 0 }));
    return r;
  };
  for (const e of edits) {
    if (e.kind === 'height') { const r = rule(e.hex); if (r) r.height = e.h; }
    else if (e.kind === 'delete') { const r = rule(e.hex); if (r) r.delete = true; }
    else if (e.kind === 'recolor') {
      const r = rule(e.from);
      if (r) { r.recolor = e.to.toLowerCase(); origin.set(r.recolor, r.match); }
    }
  }
  return { version: 1, settings: rest, colorRules: [...rules.values()] };
}

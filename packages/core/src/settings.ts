import { z } from 'zod';
import type { HeightMode } from './heights';

/** Lowercase #rrggbb. Input may be upper case. */
export const hexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb').transform((s) => s.toLowerCase());

/** A position relative to the opaque bounding box; `fx`/`fy` are fractions measured from its top-left. */
const fraction = z.number().min(0).max(1);
export const anchorSchema = z.union([
  z.literal('top-center'),
  z.literal('top-left'),
  z.object({ fx: fraction, fy: fraction }).strict(),
]);
export type Anchor = 'top-center' | 'top-left' | { fx: number; fy: number };

const mm = (min: number, max: number) => z.number().min(min).max(max);
const height = mm(0.2, 20);
const quarter = z.number().int().min(0).max(3);

export const settingsSchema = z.object({
  size: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    keepAspect: z.boolean(),
    unit: z.enum(['mm', 'in']),
  }).strict(),
  /** Explicit pixel size in mm. When absent the mesh derives it from size / the opaque bounding box. Never saved in presets. */
  pixelMm: z.object({ x: z.number().positive(), y: z.number().positive() }).strict().optional(),
  background: z.object({ enabled: z.boolean(), tolPct: mm(0, 50) }).strict(),
  pixelate: z.object({
    enabled: z.union([z.boolean(), z.literal('auto')]),
    across: z.number().int().min(8).max(128),
    colors: z.number().int().min(2).max(16),
  }).strict(),
  colors: z.object({ max: z.number().int().min(2).max(16) }).strict(),
  heights: z.object({
    mode: z.enum(['uniform', 'random', 'brightness']),
    /** Default pixel height; used by `uniform`. */
    h: height,
    min: height,
    max: height,
    seed: z.number().int(),
    darkHigh: z.boolean(),
  }).strict(),
  base: z.object({ enabled: z.boolean(), height, color: hexSchema }).strict(),
  /** Round the stepped pixel edge of the generated shapes: the base, the outline ring and the clicker's backing and body. */
  smooth: z.boolean(),
  /** A ring round the art's outer silhouette, as tall as the lowest color (spec §4.7b). */
  outline: z.object({ on: z.boolean(), width: mm(0.5, 5), color: hexSchema }).strict(),
  inside: z.object({ mode: z.enum(['solid', 'shell', 'hollow']), wall: mm(0.8, 5) }).strict(),
  sides: z.object({
    mode: z.enum(['single', 'solid', 'halves']),
    heightsOn: z.enum(['both', 'top']),
  }).strict(),
  keychain: z.object({
    type: z.enum(['none', 'hole', 'loop']),
    hole: z.object({ style: z.enum(['round', 'square']), size: mm(2, 10), at: anchorSchema }).strict(),
    loop: z.object({
      style: z.enum(['round', 'pixel']),
      inner: z.number().positive(),
      outer: z.number().positive(),
      angle: mm(0, 359),
      color: hexSchema,
      /** The loop's thickness (halves: split between them; a clicker: never more than the body is tall). */
      thickness: mm(1, 10),
    }).strict(),
  }).strict(),
  magnets: z.object({
    size: z.union([
      z.enum(['8x3', '6x2', '10x3']),
      z.object({ d: z.number().positive(), h: z.number().positive() }).strict(),
    ]),
    position: z.enum(['bottom', 'center']),
    at: z.array(anchorSchema),
  }).strict(),
  /** Export orientation in quarter turns about X, Y, Z. */
  rotation: z.tuple([quarter, quarter, quarter]),
  export: z.object({
    format: z.enum(['stl', '3mf', 'obj', 'fbx']),
    slicer: z.enum(['bambu', 'orca', 'prusa', 'generic']),
    /** Export as one color (all height steps kept). */
    mono: z.boolean(),
    monoColor: hexSchema,
  }).strict(),
  make: z.enum(['model', 'clicker']),
  clicker: z.object({
    shape: z.enum(['outline', 'circle', 'square']),
    border: mm(1.5, 10),
    capHeight: mm(0.5, 4),
    /** Clearance between the cap and the well wall (per user reference, R22). */
    fitGap: mm(0.2, 1.5),
    switches: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    /** The cap's backing: the base color, or each art pixel's color running the full depth of the cap. */
    backing: z.enum(['base', 'art']),
    /** Where a keychain loop joins the body's side: at the bed, or halfway up the body. */
    loopAt: z.enum(['bottom', 'center']),
    /** The body's color; null prints it in the base color. */
    bodyColor: hexSchema.nullable(),
  }).strict(),
}).strict();

export type Settings = z.output<typeof settingsSchema>;

/** Mockup defaults (docs/mockups/app-mockup.html state object). Sizes are mm. */
export const DEFAULTS: Settings = {
  size: { width: 40, height: 40, keepAspect: true, unit: 'mm' },
  background: { enabled: true, tolPct: 10 },
  pixelate: { enabled: 'auto', across: 32, colors: 8 },
  colors: { max: 16 },
  heights: { mode: 'uniform', h: 1, min: 1, max: 4, seed: 42, darkHigh: true },
  base: { enabled: true, height: 2, color: '#2a2d33' },
  smooth: false,
  outline: { on: false, width: 1.5, color: '#000000' },
  inside: { mode: 'solid', wall: 1.2 },
  sides: { mode: 'single', heightsOn: 'both' },
  keychain: {
    type: 'none',
    hole: { style: 'round', size: 4, at: 'top-center' },
    loop: { style: 'round', inner: 4, outer: 8, angle: 0, color: '#2a2d33', thickness: 2 },
  },
  magnets: { size: '8x3', position: 'bottom', at: [] },
  rotation: [0, 0, 0],
  export: { format: '3mf', slicer: 'bambu', mono: false, monoColor: '#e8e4d8' },
  make: 'model',
  clicker: { shape: 'outline', border: 3, capHeight: 2, fitGap: 0.5, switches: 1, backing: 'base', loopAt: 'bottom', bodyColor: null },
};

/** The `HeightMode` that `applyHeightMode` expects, from the settings. */
export function heightModeOf(s: Settings): HeightMode {
  const { mode, h, min, max, seed, darkHigh } = s.heights;
  return mode === 'uniform' ? { mode, h } : mode === 'random' ? { mode, min, max, seed } : { mode, min, max, darkHigh };
}

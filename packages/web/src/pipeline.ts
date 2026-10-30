import {
  applyEdits, applyHeightMode, clampInt, detectScale, downsampleNearest, EXACT_COLORS, findCornerBg, heightModeOf,
  looksLikePixelArt, overCap, pixelate, PIXELATE_BG_TOL_PCT, reducePalette, removeBackground, toGrid,
  type BgHow, type Edit, type Grid, type Img, type Scale, type Settings,
} from '@pixel3d/core';

export { PIXELATE_BG_TOL_PCT };

/** A rectangle in full-resolution image pixels. */
export interface Rect { x: number; y: number; w: number; h: number }

/** A decoded image and the per-image choices that are not settings (they never go into presets). */
export interface Source {
  name: string;
  img: Img;
  scale: Scale;
  /** At most 64 colors and within the size cap after the upscale (core `looksLikePixelArt`). */
  pixelArt: boolean;
  /** Background color picked in the preview, or null to find it in the corners. */
  pick: string | null;
  /** Crop in full-resolution pixels, or null for the whole image. */
  crop: Rect | null;
  /** A canvas drawn from scratch in the Pixel Editor: never pixelated, and allowed to be empty. */
  blank?: boolean;
}

/** The size limits of a canvas drawn from scratch, pixels per side. */
export const CANVAS_MIN = 4, CANVAS_MAX = 128;

/** A fully transparent `w` × `h` pixel-art image, one image pixel per grid cell. */
export function blankSource(w: number, h: number): Source {
  return {
    name: 'New canvas', img: { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) },
    scale: { sx: 1, sy: 1, ox: 0, oy: 0 }, pixelArt: true, pick: null, crop: null, blank: true,
  };
}

/** What the pipeline worked out alongside the grid: the header line, the background swatch and the pixel mapping. */
export interface Meta {
  /** The grid before edits and heights: what edits replay onto (spec §4.10). */
  base: Grid;
  pixelated: boolean;
  /** Made with the background kept (Pick mode): a view-only grid that undo never stores. */
  showBg: boolean;
  /** Header line after the file name, e.g. `16 × 16 px, detected from a 4× upscale`. */
  info: string;
  bg: string | null;
  how: BgHow;
  /** The part of the full image the grid covers; grid cell (i, j) maps to `region.x + (i + .5) * region.w / grid.w`. */
  region: Rect;
  /** Colors in the image before the color count reduces them (at most 64). */
  colors: number;
}

// The cap, the pixelate background tolerance and the exact-color count come from core convert.ts (toReducedGrid),
// so the app and batch runs make the same grid.
const clamp = clampInt;

function opaque(img: Img): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! >= 128) return true;
  return false;
}

function cut(img: Img, r: Rect): Img {
  if (r.x === 0 && r.y === 0 && r.w === img.width && r.h === img.height) return img;
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) data.set(img.data.subarray(((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.w) * 4), y * r.w * 4);
  return { width: r.w, height: r.h, data };
}

/** The whole-cell area of the image: the scale offset and partial far cells dropped, as `downsampleNearest` does. */
function cellArea(img: Img, s: Scale): Rect {
  const w = Math.max(1, Math.floor((img.width - s.ox) / s.sx)), h = Math.max(1, Math.floor((img.height - s.oy) / s.sy));
  return { x: s.ox, y: s.oy, w: w * s.sx, h: h * s.sy };
}

/** A crop snapped inwards to whole upscale cells (at least one cell). */
function snapToCells(r: Rect, area: Rect, s: Scale): Rect {
  const c0 = Math.max(0, Math.ceil((r.x - area.x) / s.sx - 1e-6)), r0 = Math.max(0, Math.ceil((r.y - area.y) / s.sy - 1e-6));
  const c1 = Math.min(area.w / s.sx, Math.max(c0 + 1, Math.floor((r.x + r.w - area.x) / s.sx + 1e-6)));
  const r1 = Math.min(area.h / s.sy, Math.max(r0 + 1, Math.floor((r.y + r.h - area.y) / s.sy + 1e-6)));
  return { x: area.x + c0 * s.sx, y: area.y + r0 * s.sy, w: (c1 - c0) * s.sx, h: (r1 - r0) * s.sy };
}

const hex = (c: ArrayLike<number>) => '#' + [c[0]!, c[1]!, c[2]!].map((v) => v.toString(16).padStart(2, '0')).join('');

/** Clears the background, or with removal off reports what it would have used (for the swatch). */
function background(img: Img, on: boolean, tolPct: number, pick: string | null): { img: Img; bg: string | null; how: BgHow } {
  if (on) return removeBackground(img, { enabled: true, tolPct, ...(pick ? { pick } : {}) });
  if (pick) return { img, bg: pick, how: 'picked' };
  const c = findCornerBg(img, tolPct);
  if (c) return { img, bg: hex(c), how: 'corners' };
  const w = img.width, h = img.height, corners = [0, w - 1, (h - 1) * w, h * w - 1];
  return { img, bg: null, how: corners.some((i) => img.data[i * 4 + 3]! < 128) ? 'transparent' : 'none' };
}

/** Whether this source is pixelated with these settings: `auto` follows the image, and anything over the cap always is. */
export function isPixelated(src: Source, s: Settings): boolean {
  if (src.blank) return false;
  // the same test as convert(): the whole image (or the crop) against the cap
  const area = src.crop ?? { w: src.img.width, h: src.img.height };
  return overCap(area.w, area.h, src.scale) || (s.pixelate.enabled === 'auto' ? !src.pixelArt : s.pixelate.enabled);
}

export function upscaleText(s: Scale): string {
  if (s.sx === 1 && s.sy === 1) return '';
  return `, detected from a ${s.sx === s.sy ? s.sx : `${s.sx} × ${s.sy}`}× upscale`;
}

/** `dropped`: edits that no longer apply (their color or cell is gone). */
export type Result = { grid: Grid; meta: Meta; dropped: Edit[] } | { error: string };

/**
 * decode → scale → crop → background → (pixelate) → palette → heights → edits (spec §4.10).
 * `showBg` keeps the background (while the user picks it).
 */
export function computeGrid(src: Source, s: Settings, edits: Edit[], showBg = false): Result {
  const { img, scale } = src;
  const pixelated = isPixelated(src, s);
  const bgOn = s.background.enabled && !showBg;
  let art: Img, region: Rect, bg: { bg: string | null; how: BgHow };
  const tolPct = pixelated ? PIXELATE_BG_TOL_PCT : s.background.tolPct;
  if (pixelated) {
    region = src.crop ?? { x: 0, y: 0, w: img.width, h: img.height };
    // clear the background at full resolution first, so edge pixels don't average into a fringe
    const r = background(cut(img, region), bgOn, tolPct, src.pick);
    bg = r;
    if (!opaque(r.img)) return { error: `${src.name} is empty once the background is removed. Lower the tolerance.` };
    art = pixelate(r.img, { across: clamp(s.pixelate.across, 8, 128), colors: clamp(s.pixelate.colors, 2, 16) });
  } else {
    const area = cellArea(img, scale);
    region = src.crop ? snapToCells(src.crop, area, scale) : area;
    const native = downsampleNearest(cut(img, region), { sx: scale.sx, sy: scale.sy, ox: 0, oy: 0 });
    const r = background(native, bgOn, tolPct, src.pick);
    bg = r;
    art = r.img;
  }
  if (!opaque(art) && !src.blank) return { error: `${src.name} is empty once the background is removed. Lower the tolerance.` };
  const exact = toGrid(art, EXACT_COLORS);
  const base = reducePalette(exact, s.colors.max);
  const { grid, dropped } = applyEdits(applyHeightMode(base, heightModeOf(s)), edits);
  const info = `${grid.w} × ${grid.h} px` + (pixelated ? ', pixelated' : src.blank ? '' : upscaleText(scale));
  return { grid, dropped, meta: { base, pixelated, showBg, info, bg: bg.bg, how: bg.how, region, colors: exact.palette.length } };
}

/** The grid size pixelating gives at `across` pixels wide (as core `pixelate`: never wider than the region, aspect kept). */
export function pixelatedSize(src: Source, across: number): { w: number; h: number } {
  const r = src.crop ?? { w: src.img.width, h: src.img.height };
  const w = Math.max(1, Math.min(clamp(across, 8, 128), r.w));
  return { w, h: Math.max(1, Math.round((w * r.h) / r.w)) };
}

/** The full-resolution pixel under grid cell (i, j), as #rrggbb. */
export function colorAt(src: Source, meta: Meta, gridW: number, gridH: number, i: number, j: number): string {
  const { region } = meta;
  const x = Math.min(src.img.width - 1, Math.floor(region.x + ((i + 0.5) * region.w) / gridW));
  const y = Math.min(src.img.height - 1, Math.floor(region.y + ((j + 0.5) * region.h) / gridH));
  const k = (y * src.img.width + x) * 4;
  return hex(src.img.data.subarray(k, k + 3));
}

/** Grid cells [c0, c1) × [r0, r1) as a crop in full-resolution pixels. */
export function cellsToCrop(meta: Meta, gridW: number, gridH: number, c0: number, r0: number, c1: number, r1: number): Rect {
  const { region } = meta;
  const kx = region.w / gridW, ky = region.h / gridH;
  const x = Math.round(region.x + c0 * kx), y = Math.round(region.y + r0 * ky);
  return { x, y, w: Math.max(1, Math.round(region.x + c1 * kx) - x), h: Math.max(1, Math.round(region.y + r1 * ky) - y) };
}

/** Load-time facts about an image. */
export function describe(img: Img): { scale: Scale; pixelArt: boolean } {
  const scale = detectScale(img);
  return { scale, pixelArt: looksLikePixelArt(img, scale) };
}

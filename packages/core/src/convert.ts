import type { Img } from './image';
import { decodeImage } from './decode';
import { type Scale, detectScale, downsampleNearest } from './scale';
import { looksLikePixelArt, removeBackground } from './background';
import { pixelate } from './pixelate';
import type { Grid } from './grid';
import { reducePalette, toGrid } from './palette';
import { applyEdits } from './edits';
import { applyHeightMode } from './heights';
import { type Preset, colourRuleEdits, presetSettings } from './preset';
import { type Settings, DEFAULTS, heightModeOf } from './settings';
import { type Model, buildModel } from './mesh';
import { toSTL } from './export/stl';
import { to3MF } from './export/threemf';

export interface Report {
  /** The sanitised name the files are named after. */
  name: string;
  /** Final colours and heights, mm. */
  palette: { hex: string; height: number }[];
  /** Colour-rule edits that took effect, e.g. `#aabbcc → height 3`. */
  applied: string[];
  /** Colour-rule edits whose colour no longer existed, same wording. */
  dropped: string[];
  /** Overall bounding box, mm. */
  size: { x: number; y: number; z: number };
  pieces: number;
  warnings: string[];
  /** Output file names, in `files` order. */
  files: string[];
  /** Final grid size in cells, transparent cells included (pixelated: `across` wide). */
  grid: { w: number; h: number };
  /** A plain sentence when nothing could be made; `files` is then empty. */
  error?: string;
  /** Unexpected failures and unreadable files only: the underlying error's message and first stack lines. */
  detail?: string;
}

export interface ConvertResult { files: { name: string; bytes: Uint8Array }[]; report: Report }

/** Longest side, in native pixels, kept as pixel art; anything bigger is pixelated (spec §4.1). */
const CAP = 512;
/** Corner tolerance for the full-resolution background pass before pixelating: 40 RGB (spec §4.1). */
const PIXELATE_BG_TOL_PCT = (40 / 441.7) * 100;
/** Colours kept exactly before palette reduction merges the closest pairs. */
const EXACT_COLOURS = 64;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
/** Colours `inspect` lists, most frequent first. */
const INSPECT_COLOURS = 64;
const MAX_NAME = 100;

/** A plain sentence for the user, as opposed to an unexpected failure. `cause`, when set, becomes `Report.detail`. */
export class ConvertError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConvertError';
    this.cause = cause;
  }
}

/** An error's message and the first lines of its stack. */
function detailOf(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  return (e.stack ?? `${e.name}: ${e.message}`).split('\n').slice(0, 6).join('\n');
}

/**
 * A file name safe on every OS: no path separators, `:*?"<>|` or control characters; trimmed, no trailing dots
 * or spaces, at most 100 characters; Windows device names (`CON`, `COM1`…) get a `_`; `model` when nothing is left.
 */
export function safeName(name: string): string {
  const s = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME).replace(/[. ]+$/, '');
  if (!s) return 'model';
  return s.replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i, '$1_');
}

async function decode(bytes: Uint8Array): Promise<Img> {
  try {
    return await decodeImage(bytes);
  } catch (e) {
    throw new ConvertError('The file could not be read as an image (PNG, JPEG, GIF or WebP).', e);
  }
}

const opaqueCount = (img: Img) => {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! >= 128) n++;
  return n;
};

/** decode → scale → background → (pixelate) → palette reduction: the image half of spec §4.10. */
async function toReducedGrid(bytes: Uint8Array, s: Settings): Promise<{ grid: Grid; warnings: string[] }> {
  const img = await decode(bytes);
  if (img.width < 2 && img.height < 2) throw new ConvertError('The image is too small to convert: it is a single pixel.');
  if (!opaqueCount(img)) throw new ConvertError('The image is fully transparent, so there is nothing to convert.');
  const warnings: string[] = [];
  const scale = detectScale(img);
  const tooBig = Math.max(Math.round(img.width / scale.sx), Math.round(img.height / scale.sy)) > CAP;
  let doPixelate = s.pixelate.enabled === 'auto' ? !looksLikePixelArt(img, scale) : s.pixelate.enabled;
  if (tooBig) {
    doPixelate = true;
    warnings.push(`The image is larger than ${CAP} px, so it was pixelated.`);
  }
  let art: Img;
  if (doPixelate) {
    // clear the background at full resolution first, so edge pixels don't average into a fringe
    const bg = removeBackground(img, { enabled: s.background.enabled, tolPct: PIXELATE_BG_TOL_PCT });
    if (!opaqueCount(bg.img)) throw new ConvertError('The image is empty once the background is removed.');
    art = pixelate(bg.img, { across: clamp(s.pixelate.across, 8, 128), colours: clamp(s.pixelate.colours, 2, 16) });
  } else {
    art = removeBackground(downsampleNearest(img, scale), s.background).img;
  }
  if (!opaqueCount(art)) throw new ConvertError('The image is empty once the background is removed.');
  return { grid: reducePalette(toGrid(art, EXACT_COLOURS), s.colours.max), warnings };
}

/**
 * The export step of `convert`: the model as files for `s.export`, named after `name` (used as given; pass it through
 * `safeName` first). The web app's Export calls this on its own grid, so its bytes equal a batch run's. Deterministic.
 */
export async function exportModel(model: Model, s: Settings, name: string): Promise<{ name: string; bytes: Uint8Array }[]> {
  const ex = s.export;
  return ex.format === 'stl'
    ? toSTL(model, { mono: ex.mono, name })
    : [{ name: `${name}.3mf`, bytes: await to3MF(model, { slicer: ex.slicer, mono: ex.mono, monoHex: ex.monoColour, pauseZ: model.pauseZ, name }) }];
}

/**
 * The one entry point for the CLI, HTTP API, MCP server and web export: the fixed pipeline of spec §4.10
 * (decode → scale → background → palette → height mode → colour rules → mesh → booleans → export).
 * Never throws: any failure comes back as `report.error` with no files.
 */
export async function convert(bytes: Uint8Array, preset: Preset, name: string): Promise<ConvertResult> {
  const report: Report = {
    name: 'model', palette: [], applied: [], dropped: [], size: { x: 0, y: 0, z: 0 }, pieces: 0, warnings: [], files: [], grid: { w: 0, h: 0 },
  };
  try {
    const base = (report.name = safeName(name));
    const settings = presetSettings(preset);
    const { grid: reduced, warnings } = await toReducedGrid(bytes, settings);
    report.warnings.push(...warnings);

    // colour rules match the reduced palette and win over the height mode, so they go on after it
    const { edits, applied, unmatched } = colourRuleEdits(preset.colourRules, reduced);
    const { grid, dropped } = applyEdits(applyHeightMode(reduced, heightModeOf(settings)), edits);
    const gone = new Set(dropped);
    edits.forEach((e, i) => (gone.has(e) ? report.dropped : report.applied).push(applied[i]!));
    for (const r of unmatched) report.warnings.push(`Colour rule ${r.match} matched no colour.`);
    report.palette = grid.palette.map(({ hex, height }) => ({ hex, height }));
    report.grid = { w: grid.w, h: grid.h };

    const model = await buildModel(grid, settings);
    if (!model.parts.length) throw new ConvertError('The image is empty once the background is removed.');
    report.size = model.size;
    report.pieces = model.pieces;
    report.warnings.push(...model.warnings);
    if (model.pieces > 1) report.warnings.push(`${model.pieces} separate pieces`);

    const files = await exportModel(model, settings, base);
    report.files = files.map((f) => f.name);
    return { files, report };
  } catch (e) {
    const known = e instanceof ConvertError;
    const msg = known ? e.message : `The conversion failed: ${e instanceof Error ? e.message : String(e)}`;
    const error = /[.!?]$/.test(msg) ? msg : `${msg}.`;
    const cause = known ? e.cause : e;
    return { files: [], report: { ...report, files: [], error, ...(cause !== undefined ? { detail: detailOf(cause) } : {}) } };
  }
}

export interface InspectResult {
  width: number;
  height: number;
  scale: Scale;
  /** The 64 most frequent colours, most frequent first. */
  palette: { hex: string; count: number }[];
  /** Distinct opaque colours in all. */
  colourCount: number;
  looksLikePixelArt: boolean;
}

/**
 * The native-resolution grid (after scale detection and default background removal): size, scale and colours by count.
 * Throws a `ConvertError` with a plain sentence when the bytes are not a readable image.
 */
export async function inspect(bytes: Uint8Array): Promise<InspectResult> {
  const img = await decode(bytes);
  const scale = detectScale(img);
  const art = removeBackground(downsampleNearest(img, scale), DEFAULTS.background).img;
  const counts = new Map<string, number>();
  const d = art.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 128) continue;
    const hex = '#' + [d[i]!, d[i + 1]!, d[i + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return {
    width: art.width,
    height: art.height,
    scale,
    palette: [...counts].sort((a, b) => b[1] - a[1]).slice(0, INSPECT_COLOURS).map(([hex, count]) => ({ hex, count })),
    colourCount: counts.size,
    looksLikePixelArt: looksLikePixelArt(img, scale),
  };
}

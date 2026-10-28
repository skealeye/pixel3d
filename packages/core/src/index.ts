// Not runnable by raw Node (extensionless imports, .ts entry): core is consumed only via Vitest, Vite and an esbuild-bundled CLI.
import pkg from '../../../package.json' with { type: 'json' };

export type { RGBA, Img } from './image';
export { decodeImage, ImageTooLargeError, MAX_SIDE, MAX_MEGAPIXELS } from './decode';
export { detectScale, downsampleNearest } from './scale';
export type { Scale } from './scale';
export { findCornerBg, removeBackground, looksLikePixelArt } from './background';
export type { BgOptions, BgResult, BgHow } from './background';
export { pixelate } from './pixelate';
export type { PixelateOptions } from './pixelate';

export type { Grid, PaletteEntry } from './grid';
export { toGrid, reducePalette } from './palette';
export { applyEdits } from './edits';
export type { Edit } from './edits';
export { applyHeightMode } from './heights';
export type { HeightMode } from './heights';
export { pieces, cornerTouches } from './pieces';

export const VERSION: string = pkg.version;

export { DEFAULTS, settingsSchema, heightModeOf } from './settings';
export type { Settings, Anchor } from './settings';
export { parsePreset, presetSettings, colorRuleEdits, placeRelative, presetFromState, PresetError } from './preset';
export type { Preset, ColorRule } from './preset';
export { buildModel, opaqueBox, pixelSize } from './mesh';
export { filamentColors, filamentSlots } from './filaments';
export type { Model, Part } from './mesh';
export { MX, TRAVEL_MARGIN, CAP_ROOF, MIN_ART, MIN_WALL, FIT_STEPS, capThickness, buildClicker, clickerLevels, fitTest } from './clicker';
export { edgeAtAngle, loopSolid, holeCutter, magnetCutters, insideCutter, MAGNETS, magnetSize } from './features';
export type { Frame, Edge, Side } from './features';
export { initManifold } from './manifold';
export { toSTL } from './export/stl';
export { to3MF } from './export/threemf';
export type { ThreeMFOptions, Slicer } from './export/threemf';
export type { ManifoldToplevel } from './manifold';
export { convert, exportModel, inspect, safeName, emptyReport, overCap, clampInt, CAP, PIXELATE_BG_TOL_PCT, EXACT_COLORS, ConvertError } from './convert';
export type { Report, ConvertResult, InspectResult } from './convert';

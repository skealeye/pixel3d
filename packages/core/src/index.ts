// Not runnable by raw Node (extensionless imports, .ts entry): core is consumed only via Vitest, Vite and an esbuild-bundled CLI.
import pkg from '../../../package.json' with { type: 'json' };

export type { RGBA, Img } from './image';
export { decodeImage } from './decode';
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
export { parsePreset, resolvePreset, placeRelative, presetFromState, PresetError } from './preset';
export type { Preset, ColourRule } from './preset';
export { buildModel } from './mesh';
export type { Model, Part } from './mesh';
export { edgeAtAngle, loopSolid, holeCutter, magnetCutters, insideCutter } from './features';
export type { Frame, Edge, Side } from './features';
export { initManifold } from './manifold';
export type { ManifoldToplevel } from './manifold';

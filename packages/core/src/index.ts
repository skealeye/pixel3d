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

export const VERSION: string = pkg.version;

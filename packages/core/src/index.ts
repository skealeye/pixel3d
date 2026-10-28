import pkg from '../../../package.json' with { type: 'json' };

export type { RGBA, Img } from './image';
export { decodeImage } from './decode';
export { detectScale, downsampleNearest } from './scale';
export type { Scale } from './scale';

export const VERSION: string = pkg.version;

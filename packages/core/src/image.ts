export type RGBA = Uint8ClampedArray;

export interface Img {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: RGBA;
}

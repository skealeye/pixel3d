/** Square brush sizes of the Pixel Editor. */
export const BRUSHES = [1, 2, 3, 5] as const;
export type Brush = (typeof BRUSHES)[number];

/** The most colors an image holds. */
export const PALETTE_MAX = 16;

/** Cells a brush of `size` covers when the pointer is on cell (x, y): the cell is the footprint's top-left. */
export function footprint(x: number, y: number, size: Brush): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) out.push({ x: x + i, y: y + j });
  return out;
}

/** Colors offered in the Pixel Editor beside the image's own and the favorites. */
export const COMMON_COLORS = [
  '#000000', '#3a3a3a', '#7a7a7a', '#bdbdbd', '#ffffff', '#d62828', '#f77f00', '#fcd34d',
  '#2f9e44', '#12a4a4', '#1c6dd0', '#7048e8', '#f06595', '#7b4a2a', '#e8b98a', '#5b3a1e',
];

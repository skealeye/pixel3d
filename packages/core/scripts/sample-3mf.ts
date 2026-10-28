// Writes Bambu 3MFs of the potion fixture for a manual check in Bambu Studio: `npm run sample-3mf`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildModel, decodeImage, DEFAULTS, detectScale, downsampleNearest, to3MF, toGrid } from '../src/index';

const img = await decodeImage(new Uint8Array(readFileSync(new URL('../test/fixtures/potion.png', import.meta.url))));
const grid = toGrid(downsampleNearest(img, detectScale(img)), 16);
const out = new URL('../../../out/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [file, mode] of [['potion-bambu.3mf', 'single'], ['potion-bambu-halves.3mf', 'halves']] as const) {
  const model = await buildModel(grid, { ...DEFAULTS, sides: { ...DEFAULTS.sides, mode } });
  const bytes = await to3MF(model, { slicer: 'bambu', mono: false, name: 'potion' });
  writeFileSync(new URL(file, out), bytes);
  console.log(`out/${file}: ${model.parts.length} parts, ${bytes.length} bytes`);
}

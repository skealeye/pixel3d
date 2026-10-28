import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyHeightMode, buildModel, convert, decodeImage, detectScale, downsampleNearest, exportModel, heightModeOf, parsePreset, presetSettings, reducePalette, removeBackground, toGrid } from '../src/index';
import type { Preset } from '../src/index';

const potion = new Uint8Array(readFileSync(new URL('./fixtures/potion.png', import.meta.url)));

/** The grid convert() makes for the potion with these settings (pixel art, no color rules). */
async function gridOf(p: Preset) {
  const s = presetSettings(p);
  const img = await decodeImage(potion);
  const art = removeBackground(downsampleNearest(img, detectScale(img)), s.background).img;
  return applyHeightMode(reducePalette(toGrid(art, 64), s.colours.max), heightModeOf(s));
}

describe('exportModel (the web Export path)', () => {
  const cases: [string, unknown][] = [
    ['bambu 3MF, rotated', { rotation: [1, 0, 0], base: { height: 3 } }],
    ['prusa 3MF, one color', { export: { slicer: 'prusa', mono: true, monoColour: '#112233' } }],
    ['STL halves', { sides: { mode: 'halves' }, export: { format: 'stl' } }],
    ['clicker 3MF', { make: 'clicker' }],
    ['clicker STL', { make: 'clicker', export: { format: 'stl' } }],
  ];
  for (const [label, settings] of cases) {
    it(`gives convert()'s files byte for byte: ${label}`, async () => {
      const preset = parsePreset({ version: 1, settings, colourRules: [] });
      const ref = await convert(potion, preset, 'potion');
      expect(ref.report.error).toBeUndefined();
      const s = presetSettings(preset);
      const files = await exportModel(await buildModel(await gridOf(preset), s), s, 'potion');
      expect(files.map((f) => f.name)).toEqual(ref.report.files);
      files.forEach((f, i) => expect(Buffer.from(f.bytes).equals(Buffer.from(ref.files[i]!.bytes))).toBe(true));
    }, 60_000);
  }

  it('is deterministic: two runs give the same bytes', async () => {
    const preset = parsePreset({ version: 1, settings: {}, colourRules: [] });
    const [a, b] = [await convert(potion, preset, 'potion'), await convert(potion, preset, 'potion')];
    expect(Buffer.from(a.files[0]!.bytes).equals(Buffer.from(b.files[0]!.bytes))).toBe(true);
  }, 60_000);
});

import { readFileSync } from 'node:fs';
import UPNG from 'upng-js';
import { beforeAll, describe as group, expect, it } from 'vitest';
import { buildModel, convert, decodeImage, exportModel, initManifold, parsePreset, presetSettings } from '@pixel3d/core';
import { computeGrid, describe, type Source } from '../src/pipeline';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`../../core/test/fixtures/${n}`, import.meta.url)));

/** The web app's Export for these bytes and preset settings: the app's own grid, then core's buildModel + exportModel. */
async function appExport(bytes: Uint8Array, settings: unknown, name: string) {
  const preset = parsePreset({ version: 1, settings, colorRules: [] });
  const s = presetSettings(preset);
  const img = await decodeImage(bytes);
  const src: Source = { name, img, ...describe(img), pick: null, crop: null };
  const r = computeGrid(src, s, []);
  if ('error' in r) throw new Error(r.error);
  return { grid: r.grid, files: await exportModel(await buildModel(r.grid, s), s, name), preset };
}

/** A 2× upscaled two-color stripe pattern, `w` × 40 px (odd widths end in a partial cell). */
function upscaled(w: number): Uint8Array {
  const px = new Uint8Array(w * 40 * 4);
  for (let y = 0; y < 40; y++) for (let x = 0; x < w; x++) {
    const on = ((x >> 1) + (y >> 1)) % 3 === 0;
    px.set(on ? [200, 40, 40, 255] : [30, 30, 160, 255], (y * w + x) * 4);
  }
  return new Uint8Array(UPNG.encode([px.buffer as ArrayBuffer], w, 40, 0));
}

beforeAll(async () => { await initManifold(); });

group('web pipeline vs convert() (UI/batch parity)', () => {
  const cases: [string, () => Uint8Array, unknown][] = [
    ['potion', () => fixture('potion.png'), {}],
    ['gradient photo (the pixelate path)', () => fixture('gradient-photo.png'), {}],
    ['gradient photo, 50 across, 5 colors', () => fixture('gradient-photo.png'), { pixelate: { across: 50, colors: 5 } }],
    ['offset grid', () => fixture('offset-grid.png'), {}],
    ['1025 px wide 2× upscale, pixelate off (the 512 px cap edge)', () => upscaled(1025), { pixelate: { enabled: false } }],
  ];
  for (const [label, bytes, settings] of cases) {
    it(`gives convert()'s bytes: ${label}`, async () => {
      const app = await appExport(bytes(), settings, 'x');
      const ref = await convert(bytes(), app.preset, 'x');
      expect(ref.report.error).toBeUndefined();
      expect([app.grid.w, app.grid.h]).toEqual([ref.report.grid.w, ref.report.grid.h]);
      expect(app.files.map((f) => f.name)).toEqual(ref.report.files);
      app.files.forEach((f, i) => expect(Buffer.from(f.bytes).equals(Buffer.from(ref.files[i]!.bytes))).toBe(true));
    }, 60_000);
  }
});

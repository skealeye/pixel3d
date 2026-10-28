import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { test as base, expect, type Download, type Page } from '@playwright/test';
import { convert, decodeImage, parsePreset, placeRelative, type Settings as CoreSettings } from '../../../core/src/index';
import { computeGrid, describe } from '../../src/pipeline';
import { batchSnippets } from '../../src/snippets';

const fixture = (name: string) => readFileSync(new URL(`../../../core/test/fixtures/${name}`, import.meta.url));

/** Every test fails on an uncaught page error or a console error. */
const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await use(page);
    expect(errors).toEqual([]);
  },
});

type Settings = Record<string, unknown> & { pixelMm?: unknown; export: { format: string; slicer: string; mono: boolean; monoColour: string } };
interface Snap { settings: Settings; undo: number; edits: unknown[]; grid: { palette: { hex: string; height: number }[] } | null }
interface View { shown: 'none' | 'preview' | 'model'; materials: number }
type Hook = { snapshot(): Snap; viewport(): View };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.snapshot());
const view = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.viewport());
const seg = (page: Page, key: string, v: string) => page.locator(`.seg[data-key=${key}] button[data-v="${v}"]`);
const row = (page: Page, hex: string) => page.locator('#pal li', { has: page.locator(`.hex:text-is("${hex}")`) });
const bytesOf = async (dl: Download) => new Uint8Array(readFileSync(await dl.path()));
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

async function loadPotion(page: Page) {
  await page.goto('/?test');
  await page.locator('#fileIn').setInputFiles({ name: 'potion.png', mimeType: 'image/png', buffer: fixture('potion.png') });
  await expect(page.locator('#fileInfo')).toHaveText('potion.png 16 × 16 px, detected from a 4× upscale');
  await expect.poll(async () => (await view(page)).shown).toBe('model');
}

/** Batch and API → Save preset: the downloaded preset text. */
async function savePreset(page: Page, file = 'potion.json'): Promise<string> {
  await page.locator('#openBatch').click();
  await expect(page.locator('#batch')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#savePreset').click()]);
  expect(dl.suggestedFilename()).toBe(file);
  await expect(page.locator('#batch')).toBeHidden();
  await expect(page.locator('.toast')).toHaveText(`Saved ${file}`);
  return strFromU8(await bytesOf(dl));
}

/** Export → Export file: the download. */
async function exportFile(page: Page): Promise<Download> {
  if (!(await page.locator('#exportPop').isVisible())) await page.locator('#exportBtn').click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator('#export').click()]);
  return dl;
}

/** A few settings and a color height, so the parity check covers base, keychain, rotation and color rules. */
async function customize(page: Page) {
  await page.locator('#baseH').fill('3');
  await page.locator('#baseH').press('Enter');
  await seg(page, 'key', 'hole').click();
  await page.locator('#edge').click();
  const hex = (await snap(page)).grid!.palette[0]!.hex;
  await row(page, hex).locator('input[type=range]').fill('2.5');
  await expect.poll(async () => (await snap(page)).grid!.palette[0]!.height).toBe(2.5);
}

test.describe('export', () => {
  test('Export file gives the bytes convert() gives with the saved preset (3MF, Bambu)', async ({ page }) => {
    await loadPotion(page);
    await customize(page);
    const preset = parsePreset(JSON.parse(await savePreset(page)));
    expect(preset.colourRules).toHaveLength(1);
    // On edge reached the preset, and it changes the file: a lost rotation on both sides would not pass
    expect(preset.settings.rotation).toEqual([1, 0, 0]);
    const flat = await convert(new Uint8Array(fixture('potion.png')), parsePreset({ ...preset, settings: { ...preset.settings, rotation: [0, 0, 0] } }), 'potion');
    const dl = await exportFile(page);
    expect(dl.suggestedFilename()).toBe('potion.3mf');
    const ref = await convert(new Uint8Array(fixture('potion.png')), preset, 'potion');
    expect(ref.report.error).toBeUndefined();
    expect(same(await bytesOf(dl), ref.files[0]!.bytes)).toBe(true);
    expect(same(await bytesOf(dl), flat.files[0]!.bytes)).toBe(false);
    await expect(page.locator('.toast')).toHaveText('Exported potion.3mf, filaments 1 to 8 assigned for Bambu Studio.');
  });

  test('two STL files download as a zip, each equal to convert()', async ({ page }) => {
    await loadPotion(page);
    await seg(page, 'sides', 'halves').click();
    await page.locator('#exportBtn').click();
    await seg(page, 'format', 'stl').click();
    await expect(page.locator('#slicerRow')).toBeHidden();
    await page.locator('#name').fill('my potion');
    await expect(page.locator('#summary')).toContainText('my potion_front.stl and my potion_back.stl, ');
    const dl = await exportFile(page);
    expect(dl.suggestedFilename()).toBe('my potion.zip');
    const files = unzipSync(await bytesOf(dl));
    const preset = parsePreset(JSON.parse(await savePreset(page)));
    const ref = await convert(new Uint8Array(fixture('potion.png')), preset, 'my potion');
    expect(Object.keys(files)).toEqual(['my potion_front.stl', 'my potion_back.stl']);
    for (const f of ref.files) expect(same(files[f.name]!, f.bytes)).toBe(true);
  });

  test('a clicker exports cap and body: one 3MF with two objects, or two STLs', async ({ page }) => {
    test.setTimeout(60_000); // three clicker builds: the view's, and one per export
    await loadPotion(page);
    await seg(page, 'make', 'clicker').click();
    const preset = parsePreset(JSON.parse(await savePreset(page)));
    const dl = await exportFile(page);
    expect(dl.suggestedFilename()).toBe('potion.3mf');
    const ref = await convert(new Uint8Array(fixture('potion.png')), preset, 'potion');
    expect(same(await bytesOf(dl), ref.files[0]!.bytes)).toBe(true);
    const cfg = strFromU8(unzipSync(await bytesOf(dl))['Metadata/model_settings.config']!);
    expect([...cfg.matchAll(/<object id="\d+">\s*<metadata key="name" value="([^"]+)"/g)].map((m) => m[1])).toEqual(['potion_cap', 'potion_body']);
    await page.locator('#exportBtn').click();
    await seg(page, 'format', 'stl').click();
    // the summary gives the printed parts' size (cap beside body), not the assembled view's
    await expect(page.locator('#summary')).toContainText('potion_cap.stl and potion_body.stl, ');
    await expect(page.locator('#summary')).toContainText(' mm cap and body, as printed');
    const sz = ref.report.size;
    await expect(page.locator('#summary')).toContainText(`${sz.x.toFixed(1)} × ${sz.y.toFixed(1)} × ${sz.z.toFixed(1)} mm`);
    const zip = unzipSync(await bytesOf(await exportFile(page)));
    expect(Object.keys(zip)).toEqual(['potion_cap.stl', 'potion_body.stl']);
  });

  test('the summary line shows the files, filament count and dimensions', async ({ page }) => {
    await loadPotion(page);
    await page.locator('#exportBtn').click();
    await expect(page.locator('#exportPop')).toBeVisible();
    await expect(page.locator('#exportBtn')).toHaveClass(/\bon\b/);
    await expect(page.locator('#name')).toHaveValue('potion');
    const dims = (await page.locator('#dims').textContent())!.replace(/\s+/g, ' ').trim();
    expect(dims).toMatch(/^40\.0 × 53\.3 × \d+\.\d mm one piece$/);
    await expect(page.locator('#summary')).toHaveText(`potion.3mf, 8 filaments, ${dims}`);
    await seg(page, 'format', 'stl').click();
    await expect(page.locator('#summary')).toHaveText(`potion.stl, 8 filaments, ${dims}`);
    await seg(page, 'colourMode', 'mono').click();
    await expect(page.locator('#monoRow')).toBeVisible();
    await expect(page.locator('#summary')).toHaveText(`potion.stl, one filament, ${dims}`);
    await page.locator('#name').fill('ghost');
    await expect(page.locator('#summary')).toHaveText(`ghost.stl, one filament, ${dims}`);
    // a click outside closes it; Esc too
    await page.locator('#fileInfo').click();
    await expect(page.locator('#exportPop')).toBeHidden();
    await page.locator('#exportBtn').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#exportPop')).toBeHidden();
  });

  test('One color exports one part, in the print color, and the preview shows it', async ({ page }) => {
    await loadPotion(page);
    await page.locator('#exportBtn').click();
    await seg(page, 'colourMode', 'mono').click();
    await page.locator('#monoColor').fill('#336699');
    expect((await snap(page)).settings.export).toMatchObject({ mono: true, monoColour: '#336699' });
    await expect.poll(async () => (await view(page)).materials).toBe(1);
    const files = unzipSync(await bytesOf(await exportFile(page)));
    const cfg = strFromU8(files['Metadata/model_settings.config']!);
    expect(cfg.match(/<part /g)).toHaveLength(1);
    expect(strFromU8(files['Metadata/project_settings.config']!)).toContain('#336699');
    await expect(page.locator('.toast')).toHaveText('Exported potion.3mf in one color.');
    await page.locator('#exportBtn').click();
    await seg(page, 'colourMode', 'full').click();
    await expect.poll(async () => (await view(page)).materials).toBeGreaterThan(1);
  });

  test('a base the same color as an art color shares its filament (R25): footer, summary, toast and 3MF', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('#fcount')).toHaveText('8 filaments');
    const art = (await snap(page)).grid!.palette[2]!.hex;
    await page.locator('#baseColor').fill(art);
    await expect(page.locator('#fcount')).toHaveText('7 filaments');
    await page.locator('#exportBtn').click();
    await expect(page.locator('#summary')).toContainText('potion.3mf, 7 filaments, ');
    const files = unzipSync(await bytesOf(await exportFile(page)));
    await expect(page.locator('.toast')).toHaveText('Exported potion.3mf, filaments 1 to 7 assigned for Bambu Studio.');
    const cfg = strFromU8(files['Metadata/model_settings.config']!);
    // each <part> block: its name, then its extruder
    const parts = cfg.split('<part ').slice(1).map((b) => ({ name: /key="name" value="([^"]+)"/.exec(b)![1], extruder: /key="extruder" value="(\d+)"/.exec(b)![1] }));
    const ex = (name: string) => parts.find((p) => p.name === name)!.extruder;
    expect(parts.map((p) => p.name)).toContain('base');
    expect(ex('base')).toBe(ex(art));
    expect((JSON.parse(strFromU8(files['Metadata/project_settings.config']!)) as { filament_colour: string[] }).filament_colour).toHaveLength(7);
    await page.locator('#baseColor').fill('#123456');
    await expect(page.locator('#fcount')).toHaveText('8 filaments');
  });

  test('changing the background keeps the pixel size (spec §4.2, R29), and export still equals convert()', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#fileIn').setInputFiles({ name: 'eye.png', mimeType: 'image/png', buffer: fixture('eye-on-white.png') });
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    const before = await snap(page);
    await page.locator('#removeBg').uncheck();
    await expect.poll(async () => (await snap(page)).undo).toBe(before.undo + 1);
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    const after = await snap(page);
    // the box is now the whole image: the same pixel size, so Width grows to fit it, in one undo step
    expect(after.settings.pixelMm).toEqual(before.settings.pixelMm);
    expect(after.undo).toBe(before.undo + 1);
    const size = (s: Snap) => s.settings.size as { width: number; height: number };
    expect(size(after).width).toBeGreaterThan(size(before).width);
    // the readout rounds; the setting keeps the exact size, so the saved preset reproduces the pixel size
    await expect(page.locator('#w')).toHaveValue(size(after).width.toFixed(1));
    const preset = parsePreset(JSON.parse(await savePreset(page, 'eye.json')));
    const ref = await convert(new Uint8Array(fixture('eye-on-white.png')), preset, 'eye');
    expect(same(await bytesOf(await exportFile(page)), ref.files[0]!.bytes)).toBe(true);
    await page.keyboard.press('Control+z');
    const back = await snap(page);
    expect(back.settings.pixelMm).toEqual(before.settings.pixelMm);
    expect(size(back).width).toBe(size(before).width);
  });

  test('a background change keeps the hole on the same spot of the art; redoing it after undo agrees', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#fileIn').setInputFiles({ name: 'eye.png', mimeType: 'image/png', buffer: fixture('eye-on-white.png') });
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    await seg(page, 'key', 'hole').click();
    const before = await snap(page);
    await page.locator('#removeBg').uncheck();
    await expect.poll(async () => (await snap(page)).undo).toBe(before.undo + 1);
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    const off = await snap(page);
    expect(off.settings.pixelMm).toEqual(before.settings.pixelMm);
    // where the hole sits on the art, in grid cells, worked out by core from each state's grid and anchor
    const img = await decodeImage(new Uint8Array(fixture('eye-on-white.png')));
    const spot = (s: Snap) => {
      const settings = s.settings as unknown as CoreSettings;
      const r = computeGrid({ name: 'eye.png', img, ...describe(img), pick: null, crop: null }, settings, []);
      if ('error' in r) throw new Error(r.error);
      return placeRelative(settings.keychain.hole.at, r.grid);
    };
    const [a, b] = [spot(before), spot(off)];
    expect(b.u).toBeCloseTo(a.u, 6);
    expect(b.v).toBeCloseTo(a.v, 6);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await snap(page)).settings.pixelMm).toEqual(before.settings.pixelMm);
    await page.locator('#removeBg').uncheck();
    await expect.poll(async () => (await snap(page)).undo).toBe(before.undo + 1);
    const again = await snap(page);
    expect(again.settings.pixelMm).toEqual(before.settings.pixelMm);
    expect((again.settings as unknown as CoreSettings).keychain.hole.at).toEqual((off.settings as unknown as CoreSettings).keychain.hole.at);
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    const preset = parsePreset(JSON.parse(await savePreset(page, 'eye.json')));
    const ref = await convert(new Uint8Array(fixture('eye-on-white.png')), preset, 'eye');
    expect(same(await bytesOf(await exportFile(page)), ref.files[0]!.bytes)).toBe(true);
  });

  test('Add color with nothing painted leaves the filament count alone', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('#fcount')).toHaveText('8 filaments');
    await page.locator('#addColour').click();
    await expect.poll(async () => (await snap(page)).grid!.palette.length).toBe(8);
    await expect(page.locator('#fcount')).toHaveText('8 filaments');
    await page.locator('#exportBtn').click();
    await expect(page.locator('#summary')).toContainText('potion.3mf, 8 filaments, ');
  });

  test('a failed export says why and Export works again', async ({ page }) => {
    await loadPotion(page);
    await page.evaluate(() => (window as unknown as { __pixel3d: { failNextExport(): void } }).__pixel3d.failNextExport());
    await page.locator('#exportBtn').click();
    await page.locator('#export').click();
    await expect(page.locator('.toast')).toHaveText("Couldn't export: forced failure (test)");
    await expect(page.locator('#exportBtn')).toBeEnabled();
    expect((await exportFile(page)).suggestedFilename()).toBe('potion.3mf');
  });

  test('a new version offers Reload (PWA prompt)', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#updateToast')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __pixel3d: { needRefresh(): void } }).__pixel3d.needRefresh());
    await expect(page.locator('#updateToast')).toContainText('A new version is ready.');
    await expect(page.locator('#updateReload')).toHaveText('Reload');
  });

  test('Export is disabled until an image is open', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#exportBtn')).toBeDisabled();
    await expect(page.locator('#openBatch')).toBeEnabled();
  });
});

test.describe('presets and batch', () => {
  test('Save preset, then Load preset restores the settings and color heights in one undo step', async ({ page }) => {
    await loadPotion(page);
    await customize(page);
    const text = await savePreset(page);
    const saved = await snap(page);
    // a fresh page: everything back to the defaults
    await loadPotion(page);
    const fresh = await snap(page);
    expect(fresh.settings).not.toEqual(saved.settings);
    await page.locator('#openBatch').click();
    await page.locator('#presetIn').setInputFiles({ name: 'potion.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.locator('.toast')).toHaveText('Loaded potion.json');
    await expect(page.locator('#batch')).toBeHidden();
    const loaded = await snap(page);
    const { pixelMm: _a, ...want } = saved.settings;
    const { pixelMm: _b, ...got } = loaded.settings;
    expect(got).toEqual(want);
    expect(loaded.grid!.palette).toEqual(saved.grid!.palette);
    expect(loaded.undo).toBe(fresh.undo + 1);
    await page.keyboard.press('Control+z');
    expect((await snap(page)).settings).toEqual(fresh.settings);
  });

  test('an image name with spaces gives a preset file and commands that run unquoted', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#fileIn').setInputFiles({ name: 'my potion (2).png', mimeType: 'image/png', buffer: fixture('potion.png') });
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    await page.locator('#openBatch').click();
    await expect(page.locator('#cli')).toHaveText(batchSnippets('my_potion_2'));
    await expect(page.locator('#cli')).toContainText('--preset my_potion_2.json');
    await page.locator('#closeBatch').click();
    await savePreset(page, 'my_potion_2.json');
  });

  test('a bad preset file is refused with the reason', async ({ page }) => {
    await loadPotion(page);
    const before = await snap(page);
    await page.locator('#openBatch').click();
    await page.locator('#presetIn').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"settings":{"base":{"height":99}},"colourRules":[]}') });
    await expect(page.locator('.toast')).toContainText("Couldn't load bad.json: settings.base.height");
    expect((await snap(page)).settings).toEqual(before.settings);
  });

  test('the Batch dialog shows the mockup text, working CLI, HTTP and Python commands, and the preset', async ({ page }) => {
    await loadPotion(page);
    await page.locator('#openBatch').click();
    await expect(page.locator('#batch h3')).toHaveText('Batch and API');
    await expect(page.locator('#batch p')).toHaveText('Save these settings as a preset, then convert a whole folder from the command line, from Python over the local API, or from Claude through the MCP tools. Your color heights become color rules.');
    await expect(page.locator('#cli')).toHaveText(batchSnippets('potion'));
    for (const cmd of ['px3d convert ./sprites --out ./models --preset potion.json', 'px3d serve --port 7300', 'curl ', 'python examples/python/convert.py']) {
      await expect(page.locator('#cli')).toContainText(cmd);
    }
    const shown = JSON.parse((await page.locator('#presetJson').textContent())!);
    expect(parsePreset(shown).version).toBe(1);
    await page.locator('#closeBatch').click();
    await expect(page.locator('#batch')).toBeHidden();
    expect(JSON.parse(await savePreset(page))).toEqual(shown);
  });
});

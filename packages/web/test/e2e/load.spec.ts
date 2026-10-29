import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';

const pkg = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as { version: string };
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

const POTION = 'potion.png 16 × 16 px, detected from a 4× upscale';
const EYE = 'eye-on-white.png 10 × 6 px, detected from a 4× upscale';
const EMPTY = 'Open an image, or drop one anywhere on the window';

interface Snap { name: string | null; grid: { w: number; h: number; opaque: number; palette: { hex: string }[] } | null; settings: { background: { tolPct: number; enabled: boolean }; pixelate: { enabled: boolean | 'auto'; across: number } }; undo: number; redo: number; zoom: number }
interface View { shown: 'none' | 'preview' | 'model'; cut: boolean; materials: number; clipped: number; buildError: string | null; grid: { on: boolean; color: string; opacity: number }; xray: { opacity: number | null; clear: number }; renders: number; size: { x: number; y: number; z: number } | null }
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: { snapshot(): Snap } }).__pixel3d.snapshot());
const view = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: { viewport(): View } }).__pixel3d.viewport());
const opaque = async (page: Page) => (await snap(page)).grid!.opaque;
/** Load eye-on-white and return how many cells are left once its white background is removed. */
async function loadEye(page: Page) {
  await loadFile(page, 'eye-on-white.png');
  await expect(page.locator('#fileInfo')).toHaveText(EYE);
  const n = await opaque(page);
  expect(n).toBeLessThan(60);
  return n;
}
async function startPick(page: Page) {
  await page.locator('#pickBg').click();
  await expect(page.locator('#pickBg')).toHaveClass(/\bon\b/);
  await expect.poll(() => opaque(page)).toBe(60);
}
async function pickLeftEdge(page: Page) {
  const b = (await page.locator('#src').boundingBox())!;
  await page.locator('#src').click({ position: { x: 4, y: b.height / 2 } });
  await expect(page.locator('#bgInfo')).toHaveText('Picked by you.');
}

async function open(page: Page) {
  await page.goto('/?test');
  await expect(page.locator('#fileInfo')).toHaveText(EMPTY);
}
async function loadFile(page: Page, name: string) {
  await page.locator('#fileIn').setInputFiles({ name, mimeType: 'image/png', buffer: fixture(name) });
}
/** Builds a DataTransfer holding the fixture inside the page. */
async function withFile(page: Page, name: string, fn: string) {
  await page.evaluate(({ bytes, name, fn }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
    // eslint-disable-next-line no-new-func
    new Function('dt', fn)(dt);
  }, { bytes: [...fixture(name)], name, fn });
}

test.describe('loading', () => {
  test('file input', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    const s = await snap(page);
    expect(s.grid).toMatchObject({ w: 16, h: 16 });
  });

  test('drop, with the full-window overlay while dragging', async ({ page }) => {
    await open(page);
    const zone = page.locator('.dropzone');
    await expect(zone).toBeHidden();
    await withFile(page, 'potion.png', `document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));`);
    await expect(zone).toBeVisible();
    await expect(zone).toHaveText('Drop an image to load it');
    const box = await zone.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 1400, height: 900 });
    await withFile(page, 'potion.png', `document.body.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true, cancelable: true }));`);
    await expect(zone).toBeHidden();
    await withFile(page, 'potion.png', `
      document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));`);
    await expect(zone).toBeHidden();
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
  });

  test('paste', async ({ page }) => {
    await open(page);
    await withFile(page, 'potion.png', `document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));`);
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
  });

  test('URL field', async ({ page }) => {
    await page.route('**/remote/sprites/potion.png', (r) => r.fulfill({ body: fixture('potion.png'), contentType: 'image/png' }));
    await open(page);
    await page.locator('#url').fill('http://localhost:5173/remote/sprites/potion.png');
    await page.locator('#url').press('Enter');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
  });

  test('a file that is not an image shows a toast and changes nothing', async ({ page }) => {
    await open(page);
    await page.locator('#fileIn').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('.toast')).toHaveText("That file is not an image. Use PNG, JPEG, GIF or WebP.");
    await expect(page.locator('#fileInfo')).toHaveText(EMPTY);
    expect((await snap(page)).undo).toBe(0);
  });

  test('gradient photo turns Pixelate on by itself', async ({ page }) => {
    await open(page);
    await loadFile(page, 'gradient-photo.png');
    await expect(page.locator('#fileInfo')).toHaveText('gradient-photo.png 32 × 32 px, pixelated');
    await expect(page.locator('#pixelate')).toBeChecked();
    await expect(page.locator('#pixW')).toHaveValue('32');
    await expect(page.locator('#pixColors')).toHaveValue('8');
    expect((await snap(page)).grid!.palette.length).toBeLessThanOrEqual(8);
    await page.locator('#pixW').fill('16');
    await page.locator('#pixW').press('Enter');
    await expect(page.locator('#fileInfo')).toHaveText('gradient-photo.png 16 × 16 px, pixelated');
  });

  test('pixel art leaves Pixelate off and hides its rows', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    await expect(page.locator('#pixelate')).not.toBeChecked();
    await expect(page.locator('#pixRows')).toBeHidden();
  });
});

test.describe('model', () => {
  test('a failed build shows a toast and keeps the preview', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as { __pixel3d: { failNextBuild(): void } }).__pixel3d.failNextBuild());
    await loadFile(page, 'potion.png');
    await expect(page.locator('.toast')).toHaveText("Couldn't build the model: forced failure (test)");
    expect(await view(page)).toMatchObject({ shown: 'preview', buildError: 'forced failure (test)' });
    await expect(page.locator('.dims')).toHaveText('40.0 × 53.3 × 3.0 mm preview only, the model could not be built');
    // the next build succeeds and clears the flag
    await page.locator('#bgTol').fill('12');
    await page.locator('#bgTol').press('Enter');
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    expect((await view(page)).buildError).toBeNull();
    await expect(page.locator('.dims')).toHaveText('40.0 × 53.3 × 3.0 mm one piece');
  });

  test('preview then the core model, with the size readout', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('.dims')).toHaveText('40.0 × 53.3 × 3.0 mm one piece');
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    const v = await view(page);
    expect(v.size!.x).toBeCloseTo(40, 3);
    expect(v.size!.y).toBeCloseTo(53.333, 2);
    expect(v.size!.z).toBeCloseTo(3, 3);
    await expect(page.locator('#health')).toHaveText('● Watertight');
    await expect(page.locator('#fcount')).toHaveText('8 filaments');
  });

  test('cut view and grid options', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await page.locator('#cutBtn').click();
    await expect(page.locator('#cutBtn')).toHaveClass(/\bon\b/);
    await expect(page.locator('.note')).toHaveText('Cut view. Gold is solid material. Empty space shows what is hollow.');
    await expect.poll(async () => (await view(page)).cut).toBe(true);
    // every material in use is clipped by the cut plane
    const on = await view(page);
    expect(on.materials).toBeGreaterThan(0);
    expect(on.clipped).toBe(on.materials);
    await page.locator('#cutBtn').click();
    await expect.poll(async () => (await view(page)).clipped).toBe(0);
    expect((await view(page)).cut).toBe(false);
    await expect(page.locator('.note')).toBeHidden();

    await page.locator('#gridBtn').click();
    await expect(page.locator('#gridPop')).toBeVisible();
    await page.locator('#gridOn').uncheck();
    await page.locator('#gridOpacity').fill('40');
    await expect(page.locator('#gridOpacityV')).toHaveText('40%');
    expect((await view(page)).grid).toMatchObject({ on: false, opacity: 0.4 });
  });

  test('X-ray makes the model see-through at the chosen opacity', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    expect((await view(page)).xray).toEqual({ opacity: null, clear: 0 });
    await page.locator('#xrayBtn').click();
    await expect(page.locator('#xrayBtn')).toHaveClass(/\bon\b/);
    await expect(page.locator('#xrayPop')).toBeVisible();
    const on = await view(page);
    expect(on.xray.opacity).toBeCloseTo(0.3, 5);
    expect(on.xray.clear).toBeGreaterThan(0);
    await page.locator('#xrayOpacity').fill('60');
    await expect(page.locator('#xrayOpacityV')).toHaveText('60%');
    expect((await view(page)).xray.opacity).toBeCloseTo(0.6, 5);
    await page.locator('#xrayOn').uncheck();
    await expect.poll(async () => (await view(page)).xray).toEqual({ opacity: null, clear: 0 });
    await expect(page.locator('#xrayBtn')).not.toHaveClass(/\bon\b/);
  });
});

test.describe('undo', () => {
  test('undo after a load restores the previous image; redo brings it back', async ({ page }) => {
    await open(page);
    await expect(page.locator('#undo')).toBeDisabled();
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    await loadFile(page, 'eye-on-white.png');
    await expect(page.locator('#fileInfo')).toHaveText(EYE);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    expect((await snap(page)).grid).toMatchObject({ w: 16, h: 16 });
    await page.keyboard.press('Control+y');
    await expect(page.locator('#fileInfo')).toHaveText(EYE);
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    await expect(page.locator('#fileInfo')).toHaveText(EMPTY);
    await expect(page.locator('#undo')).toBeDisabled();
    expect((await view(page)).shown).toBe('none');
    await page.keyboard.press('Control+Shift+Z');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
  });

  test('history is capped at 50 steps', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    for (let i = 0; i < 55; i++) await page.locator('#pixelate').click();
    expect((await snap(page)).undo).toBe(50);
  });

  test('Esc closes the grid popover and cancels Pick and Crop', async ({ page }) => {
    await open(page);
    await page.locator('#gridBtn').click();
    await expect(page.locator('#gridPop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#gridPop')).toBeHidden();

    const cleared = await loadEye(page);
    await startPick(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pickBg')).not.toHaveClass(/\bon\b/);
    await expect.poll(() => opaque(page)).toBe(cleared);

    await page.locator('#crop').click();
    await expect(page.locator('#crop')).toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#crop')).not.toHaveClass(/\bon\b/);
  });

  test('a change that fails keeps redo and the oldest step', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    // a full history plus one redo step
    for (let i = 0; i < 52; i++) await page.locator('#pixelate').click();
    await page.keyboard.press('Control+z');
    const before = await snap(page);
    expect(before).toMatchObject({ undo: 49, redo: 1 });
    // a crop to one transparent cell can't make a model, so it changes nothing
    await page.locator('#crop').click();
    const b = (await page.locator('#src').boundingBox())!;
    await page.mouse.move(b.x + 2, b.y + 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('.toast')).toHaveText('potion.png is empty once the background is removed. Lower the tolerance.');
    const after = await snap(page);
    expect(after).toMatchObject({ undo: 49, redo: 1 });
    expect(after.grid).toEqual(before.grid);
    await page.keyboard.press('Control+y');
    expect(await snap(page)).toMatchObject({ undo: 50, redo: 0 });
  });

  test('a change that fails with a full history keeps the oldest step', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    for (let i = 0; i < 52; i++) await page.locator('#pixelate').click();
    expect((await snap(page)).undo).toBe(50);
    await page.locator('#crop').click();
    const b = (await page.locator('#src').boundingBox())!;
    await page.mouse.move(b.x + 2, b.y + 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('.toast')).toHaveText('potion.png is empty once the background is removed. Lower the tolerance.');
    expect((await snap(page)).undo).toBe(50);
  });
});

test.describe('image panel', () => {
  test('panning the image, with the left or middle button, never scrolls the side panel', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await open(page);
    await loadFile(page, 'potion.png');
    const src = page.locator('#src'), aside = page.locator('aside.left');
    const b = (await src.boundingBox())!;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
    // the panel is scrolled part way, with the image still on screen
    await aside.evaluate((el) => { el.scrollTop = Math.min(40, el.scrollHeight - el.clientHeight); });
    const top0 = await aside.evaluate((el) => el.scrollTop);
    const b2 = (await src.boundingBox())!;
    const x = b2.x + b2.width / 2, y = b2.y + Math.min(b2.height / 2, 200);
    for (const button of ['left', 'middle'] as const) {
      await page.mouse.move(x, y);
      await page.mouse.down({ button });
      for (let k = 1; k <= 10; k++) await page.mouse.move(x, y + k * 40);
      await page.mouse.up({ button });
      expect(await aside.evaluate((el) => el.scrollTop), button).toBe(top0);
      expect(await page.evaluate(() => getSelection()?.toString() ?? ''), button).toBe('');
    }
  });
});

test.describe('undo while picking', () => {
  test('pick a color, then undo: removal is back on and the background is removed again', async ({ page }) => {
    await open(page);
    const cleared = await loadEye(page);
    await startPick(page);
    await pickLeftEdge(page);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#bgInfo')).toHaveText('Found in the corners.');
    await expect(page.locator('#removeBg')).toBeChecked();
    await expect(page.locator('#pickBg')).not.toHaveClass(/\bon\b/);
    expect(await opaque(page)).toBe(cleared);
    await page.keyboard.press('Control+y');
    await expect(page.locator('#bgInfo')).toHaveText('Picked by you.');
    expect(await opaque(page)).toBe(cleared);
  });

  test('load mid-pick, then undo', async ({ page }) => {
    await open(page);
    const cleared = await loadEye(page);
    await startPick(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#fileInfo')).toHaveText(EYE);
    await expect(page.locator('#pickBg')).not.toHaveClass(/\bon\b/);
    expect(await opaque(page)).toBe(cleared);
  });

  test('turn Remove background off mid-pick, then undo', async ({ page }) => {
    await open(page);
    const cleared = await loadEye(page);
    await startPick(page);
    await page.locator('#removeBg').uncheck();
    await expect(page.locator('#pickBg')).not.toHaveClass(/\bon\b/);
    expect(await opaque(page)).toBe(60);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#removeBg')).toBeChecked();
    expect(await opaque(page)).toBe(cleared);
  });
});

test.describe('background', () => {
  test('Tolerance is fixed while pixelating', async ({ page }) => {
    await open(page);
    await loadFile(page, 'gradient-photo.png');
    await expect(page.locator('#pixelate')).toBeChecked();
    await expect(page.locator('#bgTolR')).toBeDisabled();
    await expect(page.locator('#bgTol')).toBeDisabled();
    await expect(page.locator('#tolHint')).toHaveText('Fixed while pixelating.');
    // R27: it looks disabled, shows the tolerance in force (40 RGB, about 9%), and says why in the row and a tooltip
    await expect(page.locator('#bgTol')).toHaveValue('9');
    await expect(page.locator('#bgTolR')).toHaveValue('9');
    for (const id of ['#bgTolR', '#bgTol']) {
      await expect(page.locator(id)).toHaveCSS('cursor', 'not-allowed');
      await expect(page.locator(id)).toHaveAttribute('title', 'Fixed while pixelating. Turn off Pixelate to adjust it.');
      expect(Number(await page.locator(id).evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(1);
    }
    expect(await page.locator('#bgTolR').evaluate((e) => getComputedStyle(e).accentColor)).not.toBe('rgb(217, 164, 65)');
    // the note sits in the slider's own row
    expect(await page.locator('#tolHint').evaluate((e) => e.parentElement!.querySelector('#bgTolR') !== null)).toBe(true);
    await page.locator('#pixelate').uncheck();
    await expect(page.locator('#bgTolR')).toBeEnabled();
    await expect(page.locator('#tolHint')).toBeHidden();
    await expect(page.locator('#bgTolR')).not.toHaveAttribute('title', /./);
    // a real drag moves it
    const before = await page.locator('#bgTol').inputValue();
    const b = (await page.locator('#bgTolR').boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#bgTol')).not.toHaveValue(before);
  });

  test('swatch, tolerance and Pick', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#bgInfo')).toHaveText('This image is already transparent.');
    await expect(page.locator('#bgSw')).toBeHidden();

    await loadFile(page, 'eye-on-white.png');
    await expect(page.locator('#fileInfo')).toHaveText(EYE);
    await expect(page.locator('#bgSw')).toBeVisible();
    await expect(page.locator('#bgSw')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('#bgInfo')).toHaveText('Found in the corners.');
    // the white around the art goes; the enclosed white eye stays
    const cleared = (await snap(page)).grid!;
    expect(cleared.opaque).toBeLessThan(60);
    expect(cleared.palette.map((p) => p.hex)).toContain('#ffffff');

    await page.locator('#bgTolR').fill('20');
    await expect(page.locator('#bgTol')).toHaveValue('20');
    expect((await snap(page)).settings.background.tolPct).toBe(20);

    await page.locator('#pickBg').click();
    await expect(page.locator('#pickBg')).toHaveClass(/\bon\b/);
    await expect(page.locator('.toast')).toHaveText('Click the background color in the image.');
    // the background shows again while picking
    await expect.poll(async () => (await snap(page)).grid!.opaque).toBe(60);
    const src = page.locator('#src');
    const b = (await src.boundingBox())!;
    await src.click({ position: { x: 4, y: b.height / 2 } });
    await expect(page.locator('#bgInfo')).toHaveText('Picked by you.');
    await expect(page.locator('#pickBg')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#bgSw')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect((await snap(page)).grid!.opaque).toBe(cleared.opaque);

    await page.locator('#removeBg').uncheck();
    await expect(page.locator('#bgRows')).toBeHidden();
    expect((await snap(page)).grid!.opaque).toBe(60);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#removeBg')).toBeChecked();
    expect((await snap(page)).grid!.opaque).toBe(cleared.opaque);
  });
});

test.describe('image panel', () => {
  test('Expand, Shrink and the divider', async ({ page }) => {
    await open(page);
    const left = page.locator('aside.left');
    expect((await left.boundingBox())!.width).toBeCloseTo(330, 0);
    await page.locator('#expand').click();
    await expect(page.locator('#expand')).toHaveText('Shrink');
    expect((await left.boundingBox())!.width).toBeCloseTo(1400 * 0.45, 0);
    await page.locator('#expand').click();
    await expect(page.locator('#expand')).toHaveText('Expand');
    const r = (await page.locator('#resizer').boundingBox())!;
    await page.mouse.move(r.x + 2, r.y + 100);
    await page.mouse.down();
    await page.mouse.move(r.x + 150, r.y + 100, { steps: 4 });
    await page.mouse.up();
    expect((await left.boundingBox())!.width).toBeGreaterThan(450);
    await expect(page.locator('#expand')).toHaveText('Shrink');
  });

  test('zoom with the wheel, reset with a double click', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await page.locator('#src').hover();
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await snap(page)).zoom).toBeGreaterThan(1);
    await page.locator('#src').dblclick();
    expect((await snap(page)).zoom).toBe(1);
  });

  test('crop, then undo it', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    await page.locator('#crop').click();
    await expect(page.locator('#crop')).toHaveClass(/\bon\b/);
    const b = (await page.locator('#src').boundingBox())!;
    const cell = b.width / 16;
    await page.mouse.move(b.x + cell * 0.5, b.y + cell * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + cell * 7.5, b.y + cell * 9.5, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#fileInfo')).toHaveText('potion.png 8 × 10 px, detected from a 4× upscale');
    await expect(page.locator('#crop')).not.toHaveClass(/\bon\b/);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
  });
});

test.describe('layout', () => {
  test('the footer shows the version', async ({ page }) => {
    await open(page);
    await expect(page.locator('footer')).toContainText(`v${pkg.version}`);
  });

  test('960 px and below stacks the panels', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await open(page);
    const main = (await page.locator('main').boundingBox())!;
    const left = (await page.locator('aside.left').boundingBox())!;
    const right = (await page.locator('aside.right').boundingBox())!;
    expect(left.y).toBeGreaterThanOrEqual(main.y + main.height - 1);
    expect(right.y).toBeGreaterThanOrEqual(left.y + left.height - 1);
    for (const b of [main, left, right]) expect(b.width).toBeGreaterThan(850);
    // stacked panels show their whole content; the page scrolls instead
    for (const side of ['aside.left', 'aside.right']) {
      expect(await page.locator(side).evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
    }
    await expect(page.locator('#resizer')).toBeHidden();
  });

  test('the 3D canvas is resized and redrawn in the same frame as its container', async ({ page }) => {
    await open(page);
    await loadFile(page, 'potion.png');
    await expect(page.locator('#fileInfo')).toHaveText(POTION);
    await page.evaluate(() => {
      const main = document.querySelector('main')!, canvas = document.querySelector<HTMLCanvasElement>('#view')!;
      const w = window as unknown as { __rz: { ok: boolean; widths: number[]; renders: number[] }; __pixel3d: { viewport(): { renders: number } } };
      w.__rz = { ok: true, widths: [], renders: [] };
      // observers run in creation order, so this one sees the state the app's observer left behind
      new ResizeObserver(() => {
        const dpr = devicePixelRatio;
        const okNow = canvas.width === Math.floor(main.clientWidth * dpr) && canvas.height === Math.floor(main.clientHeight * dpr);
        w.__rz.ok &&= okNow;
        w.__rz.widths.push(main.clientWidth);
        w.__rz.renders.push(w.__pixel3d.viewport().renders);
      }).observe(main);
    });
    await page.locator('#expand').click();
    await page.setViewportSize({ width: 1200, height: 800 });
    const rz = await page.evaluate(() => new Promise<{ ok: boolean; widths: number[]; renders: number[]; frame: boolean }>((res) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const main = document.querySelector('main')!, canvas = document.querySelector<HTMLCanvasElement>('#view')!;
        const w = window as unknown as { __rz: { ok: boolean; widths: number[]; renders: number[] } };
        res({ ...w.__rz, frame: canvas.width === Math.floor(main.clientWidth * devicePixelRatio) });
      }));
    }));
    expect(rz.ok).toBe(true);
    expect(rz.frame).toBe(true);
    expect(new Set(rz.widths).size).toBeGreaterThanOrEqual(2);
    // every resize after the first observation rendered a frame
    for (let i = 1; i < rz.renders.length; i++) expect(rz.renders[i]!).toBeGreaterThan(rz.renders[i - 1]!);
  });
});

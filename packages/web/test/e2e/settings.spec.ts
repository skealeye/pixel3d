import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';

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

type Anchor = 'top-center' | 'top-left' | { fx: number; fy: number };
interface Settings {
  size: { width: number; height: number; keepAspect: boolean; unit: 'mm' | 'in' };
  pixelMm?: { x: number; y: number };
  base: { enabled: boolean; height: number; color: string };
  inside: { mode: string; wall: number };
  sides: { mode: string; heightsOn: string };
  keychain: { type: string; hole: { style: string; size: number; at: Anchor }; loop: { style: string; angle: number; color: string } };
  magnets: { size: string; position: string; at: Anchor[] };
  rotation: [number, number, number];
}
interface Snap { settings: Settings; undo: number }
type Box = { min: [number, number, number]; max: [number, number, number] };
interface View {
  shown: 'none' | 'preview' | 'model'; cut: boolean; size: { x: number; y: number; z: number } | null;
  bounds: Box | null; handles: { kind: string; x: number; y: number }[]; gridStep: number;
}
type Hook = { snapshot(): Snap; viewport(): View };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.snapshot());
const settings = async (page: Page) => (await snap(page)).settings;
const view = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.viewport());
const seg = (page: Page, key: string, v: string) => page.locator(`.seg[data-key=${key}] button[data-v="${v}"]`);

async function loadPotion(page: Page) {
  await page.goto('/?test');
  await page.locator('#fileIn').setInputFiles({ name: 'potion.png', mimeType: 'image/png', buffer: fixture('potion.png') });
  await expect(page.locator('#fileInfo')).toHaveText('potion.png 16 × 16 px, detected from a 4× upscale');
}
const model = (page: Page) => expect.poll(async () => (await view(page)).shown).toBe('model');

/** Page position of the middle of the 3D view. */
async function viewCenter(page: Page) {
  const b = (await page.locator('#view').boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe('model settings', () => {
  test('the settings column has the mockup sections in order', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('aside.right section > h2')).toHaveText([/^Make/, /^Size/, /^Base/, /^Outline/, /^Inside/, /^Sides/, /^Keychain/, /^Magnets/, /^Orientation/]);
  });

  test('every size control is a slider plus a number box', async ({ page }) => {
    await page.goto('/?test');
    const pair = async (id: string, min: string, max: string) => {
      const row = page.locator('.sl', { has: page.locator(`#${id}`) });
      await expect(row.locator('input[type=range]')).toHaveAttribute('min', min);
      await expect(row.locator('input[type=range]')).toHaveAttribute('max', max);
      await expect(page.locator(`#${id}`)).toHaveClass(/\bnum\b/);
    };
    await pair('w', '5', '200');
    await pair('h', '5', '200');
    await pair('baseH', '0.5', '8');
    await seg(page, 'bottom', 'shell').click();
    await pair('wall', '0.8', '5');
    await seg(page, 'key', 'hole').click();
    await pair('holeD', '2', '10');
    await seg(page, 'key', 'loop').click();
    await pair('loopAngle', '0', '359');
    await pair('loopIn', '2', '10');
    await pair('loopOut', '4', '16');
    // a typed size wins over the stored pixel size
    await page.locator('#baseH').fill('3.5');
    await page.locator('#baseH').press('Enter');
    expect((await settings(page)).base.height).toBe(3.5);
  });

  test('width typed with the aspect lock sets the height and a new pixel size; one undo step', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('#w')).toHaveValue('40.0');
    await expect(page.locator('#h')).toHaveValue('53.3');
    const before = await snap(page);
    await page.locator('#w').fill('30');
    await page.locator('#w').press('Enter');
    await expect(page.locator('#h')).toHaveValue('40.0');
    const s = await snap(page);
    expect(s.settings.size).toMatchObject({ width: 30, height: 40 });
    expect(s.settings.pixelMm!.x).toBeCloseTo(2.5, 6);
    expect(s.undo).toBe(before.undo + 1);
    await page.locator('#lock').uncheck();
    await page.locator('#h').fill('60');
    await page.locator('#h').press('Enter');
    await expect(page.locator('#w')).toHaveValue('30.0');
    expect((await settings(page)).size).toMatchObject({ width: 30, height: 60, keepAspect: false });
  });

  test('favorites: save, use, right-click remove; they survive a reload', async ({ page }) => {
    await page.goto('/?test');
    const favs = () => page.locator('#baseFavs [data-c]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.c));
    expect(await favs()).toEqual(['#2a2d33', '#f2efe6', '#111111', '#d9a441', '#3d6fb6']);
    await page.locator('#baseColor').fill('#123456');
    expect((await settings(page)).base.color).toBe('#123456');
    await page.locator('#baseFavs .star').click();
    await expect(page.locator('.toast')).toHaveText('Saved to favorites.');
    expect(await favs()).toEqual(['#123456', '#2a2d33', '#f2efe6', '#111111', '#d9a441']);
    await expect(page.locator('#baseFavs [data-c="#123456"]')).toHaveClass(/\bcur\b/);
    await page.locator('#baseFavs [data-c="#f2efe6"]').click();
    expect((await settings(page)).base.color).toBe('#f2efe6');
    await expect(page.locator('#baseColor')).toHaveValue('#f2efe6');
    await page.locator('#baseFavs [data-c="#111111"]').click({ button: 'right' });
    expect(await favs()).toEqual(['#123456', '#2a2d33', '#f2efe6', '#d9a441']);
    await expect(page.locator('#baseFavs .fav.empty')).toHaveCount(1);
    await page.reload();
    expect(await favs()).toEqual(['#123456', '#2a2d33', '#f2efe6', '#d9a441']);
  });

  test('Shell turns Cut view on and shows the wall', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('#wallRow')).toBeHidden();
    await expect(page.locator('#bottomHint')).toHaveText('Filled all the way through.');
    await seg(page, 'bottom', 'shell').click();
    await expect(seg(page, 'bottom', 'shell')).toHaveClass(/\bon\b/);
    await expect(page.locator('#cutBtn')).toHaveClass(/\bon\b/);
    expect((await view(page)).cut).toBe(true);
    await expect(page.locator('#wallRow')).toBeVisible();
    await expect(page.locator('#bottomHint')).toHaveText('Hollow inside with a closed floor, to save filament and weight. Use Cut view to see inside.');
    expect((await settings(page)).inside.mode).toBe('shell');
  });

  test("core's warnings show in the note: too thin to hollow out", async ({ page }) => {
    await loadPotion(page);
    await seg(page, 'bottom', 'shell').click();
    // a 2 mm base under 1 mm pixels with 1.5 mm walls leaves no room for a cavity
    await page.locator('#wall').fill('1.5');
    await page.locator('#wall').press('Enter');
    await expect(page.locator('#note .warn')).toHaveText('Too thin to hollow out. Make the base thicker or the wall thinner.');
    await expect(page.locator('#note')).toContainText('Cut view.');
    await page.locator('#wall').fill('0.8');
    await page.locator('#wall').press('Enter');
    await page.locator('#baseH').fill('5');
    await page.locator('#baseH').press('Enter');
    await expect(page.locator('#note .warn')).toHaveCount(0);
  });

  test('Halves disables Shell and Hollow; Double sided allows Shell only', async ({ page }) => {
    await page.goto('/?test');
    await seg(page, 'bottom', 'hollow').click();
    await seg(page, 'sides', 'solid').click();
    await expect(seg(page, 'bottom', 'hollow')).toBeDisabled();
    await expect(seg(page, 'bottom', 'shell')).toBeEnabled();
    expect((await settings(page)).inside.mode).toBe('solid');
    await seg(page, 'bottom', 'shell').click();
    await seg(page, 'sides', 'halves').click();
    await expect(seg(page, 'bottom', 'shell')).toBeDisabled();
    await expect(seg(page, 'bottom', 'hollow')).toBeDisabled();
    expect((await settings(page)).inside.mode).toBe('solid');
    await expect(page.locator('#bottomHint')).toHaveText('Halves stay solid so the glue faces are flat.');
    await expect(page.locator('#applyRow')).toBeVisible();
    await expect(page.locator('#hoBoth')).toHaveText('Both halves');
    await expect(page.locator('#hoTop')).toHaveText('Front half only');
    await seg(page, 'sides', 'single').click();
    await expect(page.locator('#applyRow')).toBeHidden();
    await expect(seg(page, 'bottom', 'hollow')).toBeEnabled();
  });

  test('Double sided shows the note recommending Two halves', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#sidesHint')).toHaveText('Pixels on the front only. Prints flat with no supports.');
    await seg(page, 'sides', 'solid').click();
    await expect(page.locator('#sidesHint')).toContainText('Pixels on both faces in one piece. Needs supports when printed flat.');
    await expect(page.locator('#sidesHint')).toContainText('Two halves');
    await expect(page.locator('#hoTop')).toHaveText('Top side only');
  });

  test('hole: the Square option exists; dragging the marker moves the hole but not the model', async ({ page }) => {
    await loadPotion(page);
    await seg(page, 'key', 'hole').click();
    await expect(page.locator('#keyHint')).toHaveText('Drag the gold marker on the model to move the hole. It cuts through every layer.');
    await seg(page, 'holeStyle', 'square').click();
    expect((await settings(page)).keychain.hole.style).toBe('square');
    await model(page);
    const before = await view(page);
    const h = before.handles.find((x) => x.kind === 'hole')!;
    expect(h).toBeTruthy();
    const undo = (await snap(page)).undo;
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(h.x + i * 8, h.y + i * 12);
      const mid = await view(page);
      expect(mid.bounds!.min[2]).toBeCloseTo(before.bounds!.min[2], 6);
      expect(mid.bounds!.max[2]).toBeCloseTo(before.bounds!.max[2], 6);
    }
    await page.mouse.up();
    const s = await snap(page);
    expect(typeof s.settings.keychain.hole.at).toBe('object');
    expect(s.undo).toBe(undo + 1);
    await model(page);
    const after = await view(page);
    expect(after.bounds!.min[2]).toBeCloseTo(before.bounds!.min[2], 6);
    expect(after.bounds!.max[2]).toBeCloseTo(before.bounds!.max[2], 6);
    expect(after.size!.z).toBeCloseTo(before.size!.z, 6);
  });

  test('the hole marker follows the pointer smoothly over the art, not cell to cell (spec §4.7)', async ({ page }) => {
    await loadPotion(page);
    await seg(page, 'key', 'hole').click();
    await model(page);
    const h = (await view(page)).handles.find((x) => x.kind === 'hole')!;
    // start well inside the art: one cell (2.5 mm) is many screen pixels, so snapping would show as steps
    const start = { x: h.x, y: h.y + 60 };
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y, { steps: 4 });
    const at = async () => (await view(page)).handles.find((x) => x.kind === 'hole')!;
    const first = await at();
    const seen: number[] = [];
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(start.x + i * 3, start.y);
      const p = await at();
      seen.push(p.x - first.x);
      expect(Math.abs(p.y - first.y)).toBeLessThan(1.5);
    }
    await page.mouse.up();
    // every 3 px pointer step moves the marker about 3 px (snapping would hold it still, then jump a whole cell)
    seen.forEach((dx, i) => expect(Math.abs(dx - (i + 1) * 3), `step ${i + 1}: ${seen.join(', ')}`).toBeLessThan(1.5));
  });

  test('loop: Position slider at 60°; the loop color row appears only with no base', async ({ page }) => {
    await loadPotion(page);
    await seg(page, 'key', 'loop').click();
    await page.locator('#loopAngleR').fill('60');
    await expect(page.locator('#loopAngle')).toHaveValue('60');
    expect((await settings(page)).keychain.loop.angle).toBe(60);
    await model(page);
    await expect(page.locator('#loopColRows')).toBeHidden();
    await expect(page.locator('#keyHint')).toHaveText('The loop uses the base color.');
    await page.locator('#baseOn').uncheck();
    await expect(page.locator('#baseRows')).toBeHidden();
    await expect(page.locator('#loopColRows')).toBeVisible();
    await expect(page.locator('#loopFavs [data-c]')).toHaveCount(5);
    await expect(page.locator('#keyHint')).toHaveText('Move the slider to slide the loop around the edge.');
    await page.locator('#loopFavs [data-c="#d9a441"]').click();
    expect((await settings(page)).keychain.loop.color).toBe('#d9a441');
    // the hole is kept at least 2 mm smaller than the outside
    await page.locator('#loopIn').fill('9');
    await page.locator('#loopIn').press('Enter');
    await expect(page.locator('#loopOut')).toHaveValue('11.0');
  });

  test('place a magnet with a click; Esc cancels', async ({ page }) => {
    await loadPotion(page);
    await model(page);
    await expect(page.locator('#magCount')).toHaveText('0 placed');
    await page.locator('#placeMag').click();
    await expect(page.locator('#mode')).toBeVisible();
    await expect(page.locator('#mode')).toHaveText('Click the model to place a magnet. Press Esc to cancel.');
    const c = await viewCenter(page);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('#mode')).toBeHidden();
    await expect(page.locator('#magCount')).toHaveText('1 placed');
    await expect(page.locator('#magList li')).toHaveCount(1);
    const at = (await settings(page)).magnets.at;
    expect(at).toHaveLength(1);
    expect(at[0]).toMatchObject({ fx: expect.any(Number), fy: expect.any(Number) });
    // Esc leaves placement mode, and the next click places nothing
    await page.locator('#placeMag').click();
    await expect(page.locator('#mode')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mode')).toBeHidden();
    await page.mouse.click(c.x, c.y);
    expect((await settings(page)).magnets.at).toHaveLength(1);
    // remove one by one, and Clear all
    await page.locator('#magList .del').click();
    await expect(page.locator('#magCount')).toHaveText('0 placed');
    await page.keyboard.press('Control+z');
    await expect(page.locator('#magCount')).toHaveText('1 placed');
    await page.locator('#clearMag').click();
    await expect(page.locator('#magCount')).toHaveText('0 placed');
  });

  test('the magnet readout shows the material left above and below the pocket', async ({ page }) => {
    await loadPotion(page);
    await page.locator('#baseH').fill('5');
    await page.locator('#baseH').press('Enter');
    await seg(page, 'magPos', 'center').click();
    await model(page);
    await page.locator('#placeMag').click();
    const c = await viewCenter(page);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('#magCount')).toHaveText('1 placed');
    // 8 × 3 mm sealed in a 5 mm base under 1 mm pixels: 1 mm below the pocket, 5 + 1 - 4 = 2 mm above it
    await expect(page.locator('#magRead')).toHaveText('Material left: 1.0 mm below the pocket, 2.0 mm above it.');
    await expect(page.locator('#magHint')).toHaveText('Sealed inside. The print pauses at this layer so you can drop the magnet in.');
    await seg(page, 'magPos', 'bottom').click();
    await expect(page.locator('#magRead')).toHaveText('Material left: none below (the pocket is open), 3.0 mm above it.');
    await page.locator('#magSize').selectOption('10x3');
    await page.locator('#baseH').fill('2');
    await page.locator('#baseH').press('Enter');
    await expect(page.locator('#magHint')).toHaveText('A 10 × 3 mm magnet needs about 3.6 mm here. Make the base thicker or pick a smaller magnet.');
    // the panel shows the thin-base warning, so the note doesn't repeat it
    await model(page);
    await page.waitForTimeout(1000); // past the 250 ms debounce and the build
    await expect(page.locator('#note .warn')).toHaveCount(0);
    // sealed, but the base is thinner than the magnet: the pocket sits on the bed, open
    await seg(page, 'magPos', 'center').click();
    await expect(page.locator('#magRead')).toHaveText('Material left: none below (the pocket is open), 0.0 mm above it.');
    await seg(page, 'sides', 'halves').click();
    await expect(page.locator('#magPosRow')).toBeHidden();
  });

  test('rotate X twice, then Flat, resets', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('#rotLabel')).toHaveText('Flat');
    const rx = page.locator('button[data-rot="0"]');
    await rx.click();
    await rx.click();
    expect((await settings(page)).rotation).toEqual([2, 0, 0]);
    await expect(page.locator('#rotLabel')).toHaveText('X 180°, Y 0°, Z 0°');
    await page.locator('button[data-rot="2"]').click();
    expect((await settings(page)).rotation).toEqual([2, 0, 1]);
    await page.locator('#edge').click();
    expect((await settings(page)).rotation).toEqual([1, 0, 0]);
    // on edge, the model stands up: its height is the art's height
    await expect.poll(async () => (await view(page)).size?.z ?? 0).toBeCloseTo(53.3, 0);
    await page.locator('#flat').click();
    expect((await settings(page)).rotation).toEqual([0, 0, 0]);
    await expect(page.locator('#rotLabel')).toHaveText('Flat');
    await expect.poll(async () => (await view(page)).size?.z ?? 0).toBeCloseTo(3, 3);
  });

  test('inches update the size readouts and the grid labels; core still receives mm', async ({ page }) => {
    await loadPotion(page);
    await model(page);
    await expect(page.locator('#gridScale')).toHaveText('Grid 10 mm');
    expect((await view(page)).gridStep).toBe(10);
    await seg(page, 'unit', 'in').click();
    expect((await settings(page)).size.unit).toBe('in');
    await expect(page.locator('#w')).toHaveValue('1.57');
    await expect(page.locator('#h')).toHaveValue('2.10');
    await expect(page.locator('.sl', { has: page.locator('#w') }).locator('.unit')).toHaveText('in');
    await expect(page.locator('#dims b')).toHaveText('1.57 × 2.10 × 0.12 in');
    await expect(page.locator('#gridScale')).toHaveText('Grid 0.5 in');
    expect((await view(page)).gridStep).toBeCloseTo(12.7, 6);
    await page.locator('#w').fill('2');
    await page.locator('#w').press('Enter');
    await expect(page.locator('#w')).toHaveValue('2.00');
    expect((await settings(page)).size.width).toBeCloseTo(50.8, 6);
    await expect.poll(async () => { const v = await view(page); return v.shown === 'model' ? v.size!.x : 0; }).toBeCloseTo(50.8, 3);
    await seg(page, 'unit', 'mm').click();
    await expect(page.locator('#w')).toHaveValue('50.8');
    await expect(page.locator('#gridScale')).toHaveText('Grid 10 mm');
  });
});

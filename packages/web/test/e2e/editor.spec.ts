import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';
import UPNG from 'upng-js';

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

interface Snap { grid: { w: number; h: number; opaque: number; palette: { hex: string; height: number }[] } | null; edits: { kind: string }[]; undo: number }
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: { snapshot(): Snap } }).__pixel3d.snapshot());
const opaque = async (page: Page) => (await snap(page)).grid!.opaque;
const hexes = async (page: Page) => (await snap(page)).grid!.palette.map((p) => p.hex);

const POTION_CELLS = 130;

async function load(page: Page, name: string, buffer: Buffer) {
  await page.goto('/?test');
  await page.locator('#fileIn').setInputFiles({ name, mimeType: 'image/png', buffer });
  await expect(page.locator('#fileInfo')).toContainText(name);
}
const loadPotion = (page: Page) => load(page, 'potion.png', fixture('potion.png'));

/** 16 distinct colors in a pattern with no upscale, inside a transparent border. */
function sixteen() {
  const N = 40, px = new Uint8Array(N * N * 4);
  for (let y = 4; y < N - 4; y++) for (let x = 4; x < N - 4; x++) {
    const k = (x * 7 + y * 13) % 16;
    px.set([(k * 53) % 256, (k * 97 + 40) % 256, (k * 151 + 90) % 256, 255], (y * N + x) * 4);
  }
  return Buffer.from(UPNG.encode([px.buffer as ArrayBuffer], N, N, 0));
}

const ed = (page: Page) => page.locator('#editor');
const openEditor = async (page: Page) => { await page.locator('#editPixels').click(); await expect(ed(page)).toBeVisible(); };
const chip = (page: Page, group: 'Image' | 'Common' | 'Favs', hex: string) => page.locator(`#ed${group} [data-c="${hex}"]`);

/** Page position of the middle of grid cell (i, j) on a canvas, unzoomed. */
async function cell(page: Page, canvas: string, i: number, j: number) {
  const b = (await page.locator(canvas).boundingBox())!;
  const g = (await snap(page)).grid!;
  const c = b.width / Math.max(g.w, g.h);
  return { x: b.x + (b.width - g.w * c) / 2 + (i + 0.5) * c, y: b.y + (b.height - g.h * c) / 2 + (j + 0.5) * c };
}
async function clickCell(page: Page, i: number, j: number, canvas = '#edSrc') {
  const p = await cell(page, canvas, i, j);
  await page.mouse.click(p.x, p.y);
}

test.describe('pixel editor', () => {
  test('Edit pixels opens the window; Esc closes it; the viewer has no Paint or Erase', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('.seg[data-key=tool]')).toHaveCount(0);
    await openEditor(page);
    await page.keyboard.press('Escape');
    await expect(ed(page)).toBeHidden();
    await openEditor(page);
    await page.locator('#edDone').click();
    await expect(ed(page)).toBeHidden();
  });

  test('Edit pixels with no image does not open and says why', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#editPixels').click();
    await expect(ed(page)).toBeHidden();
    await expect(page.locator('.toast')).toHaveText('Open an image first.');
  });

  test('a click in the viewer picks the color under it', async ({ page }) => {
    await loadPotion(page);
    await clickCell(page, 7, 9, '#src');
    await expect(page.locator('#pal li', { hasText: '#7a4fd6' })).toHaveClass(/\bsel\b/);
  });

  test('paint with an image color; erase; one stroke is one undo step', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Image', '#2b2135').click();
    await expect(chip(page, 'Image', '#2b2135')).toHaveClass(/\bcur\b/);
    await clickCell(page, 1, 8);
    expect(await opaque(page)).toBe(POTION_CELLS + 1);
    const undo = (await snap(page)).undo;
    const a = await cell(page, '#edSrc', 1, 10), b = await cell(page, '#edSrc', 1, 13);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    expect(await opaque(page)).toBe(POTION_CELLS + 5);
    expect((await snap(page)).undo).toBe(undo + 1);
    await page.keyboard.press('Control+z');
    expect(await opaque(page)).toBe(POTION_CELLS + 1);
    await page.locator('#editor [data-tool=erase]').click();
    await clickCell(page, 1, 8);
    expect(await opaque(page)).toBe(POTION_CELLS);
  });

  test('a 3 × 3 brush paints nine cells; at the image edge it stays inside the grid', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Image', '#2b2135').click();
    await page.locator('#editor [data-brush="3"]').click();
    await clickCell(page, 0, 0);
    expect(await opaque(page)).toBe(POTION_CELLS + 9);
    await page.locator('#editor [data-brush="5"]').click();
    const before = (await snap(page)).undo;
    await clickCell(page, 15, 15);
    expect((await snap(page)).undo).toBe(before + 1);
    expect((await snap(page)).grid!.w).toBe(16);
  });

  test('Add color adds it at the pixel height, selects it, and adding it again does nothing', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    const undo0 = (await snap(page)).undo;
    await page.locator('#edHex').fill('#12ab34');
    await page.locator('#edAddBtn').click();
    expect(await hexes(page)).toContain('#12ab34');
    expect((await snap(page)).grid!.palette.find((p) => p.hex === '#12ab34')!.height).toBe(1);
    await expect(chip(page, 'Image', '#12ab34')).toHaveClass(/\bcur\b/);
    expect((await snap(page)).undo).toBe(undo0 + 1);
    await page.locator('#edAddBtn').click();
    expect((await snap(page)).undo).toBe(undo0 + 1);
    await clickCell(page, 1, 8);
    expect(await opaque(page)).toBe(POTION_CELLS + 1);
  });

  test('a common color that is new joins the image when chosen', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Common', '#d62828').click();
    expect(await hexes(page)).toContain('#d62828');
    await clickCell(page, 1, 8);
    expect(await opaque(page)).toBe(POTION_CELLS + 1);
  });

  test('at 16 colors a new color is refused and nothing is painted', async ({ page }) => {
    await load(page, 'sixteen.png', sixteen());
    expect(await hexes(page)).toHaveLength(16);
    await openEditor(page);
    const undo = (await snap(page)).undo;
    await chip(page, 'Common', '#d62828').click();
    await expect(page.locator('.toast')).toHaveText('An image holds at most 16 colors.');
    expect(await hexes(page)).toHaveLength(16);
    expect((await snap(page)).undo).toBe(undo);
  });

  test('favorites: save the selected color, use it, and it survives a reload', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Image', '#9c6b3e').click();
    await page.locator('#edFavs .star').click();
    await expect(chip(page, 'Favs', '#9c6b3e')).toBeVisible();
    await page.reload();
    await page.locator('#fileIn').setInputFiles({ name: 'potion.png', mimeType: 'image/png', buffer: fixture('potion.png') });
    await expect(page.locator('#fileInfo')).toContainText('potion.png');
    await openEditor(page);
    await expect(chip(page, 'Favs', '#9c6b3e')).toBeVisible();
  });

  test('the pick tool selects the color of the cell; B, E, I and the bracket keys switch tool and brush', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await page.keyboard.press('i');
    await expect(page.locator('#editor [data-tool=pick]')).toHaveClass(/\bon\b/);
    await clickCell(page, 7, 9);
    await expect(chip(page, 'Image', '#7a4fd6')).toHaveClass(/\bcur\b/);
    await page.keyboard.press('e');
    await expect(page.locator('#editor [data-tool=erase]')).toHaveClass(/\bon\b/);
    await page.keyboard.press('b');
    await expect(page.locator('#editor [data-tool=paint]')).toHaveClass(/\bon\b/);
    await page.keyboard.press(']');
    await expect(page.locator('#editor [data-brush="2"]')).toHaveClass(/\bon\b/);
    await page.keyboard.press('[');
    await expect(page.locator('#editor [data-brush="1"]')).toHaveClass(/\bon\b/);
  });
});

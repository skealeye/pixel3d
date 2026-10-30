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

  test('Edit pixels with no image opens a size chooser; a preset starts a blank canvas that can be drawn on', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#editPixels').click();
    await expect(ed(page)).toBeVisible();
    await expect(page.locator('#edNew')).toBeVisible();
    await page.locator('#edNew [data-size="16"]').click();
    await expect(page.locator('#edSrc')).toBeVisible();
    await expect(page.locator('#fileInfo')).toHaveText('New canvas 16 × 16 px');
    const g0 = (await snap(page)).grid!;
    expect([g0.w, g0.h, g0.opaque, g0.palette.length]).toEqual([16, 16, 0, 0]);
    await expect(page.locator('#fcount')).toHaveText('0 filaments');
    await expect(page.locator('#exportBtn')).toBeDisabled();
    // the first pixel brings in the brush color, at a pixel size that keeps the model about 40 mm across
    await clickCell(page, 3, 3);
    const g1 = (await snap(page)).grid!;
    expect([g1.opaque, g1.palette.map((p) => p.hex)]).toEqual([1, ['#000000']]);
    await expect(page.locator('.dims')).toContainText('2.5 × 2.5');
    await expect(page.locator('#exportBtn')).toBeEnabled();
    // erasing it again leaves an empty canvas
    await page.locator('#editor [data-tool=erase]').click();
    await clickCell(page, 3, 3);
    expect((await snap(page)).grid!.opaque).toBe(0);
    expect((await snap(page)).grid!.palette).toEqual([]);
    await expect(page.locator('#fcount')).toHaveText('0 filaments');
    await expect(page.locator('#exportBtn')).toBeDisabled();
  });

  test('a custom canvas size is clamped to 4 to 128', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#editPixels').click();
    await page.locator('#edNewW').fill('100');
    await page.locator('#edNewH').fill('20');
    await page.locator('#edCreate').click();
    await expect(page.locator('#fileInfo')).toHaveText('New canvas 100 × 20 px');
    await page.locator('#edDone').click();
    await page.locator('#undo').click();
    await expect(page.locator('#fileInfo')).toContainText('Open an image');
    await page.locator('#editPixels').click();
    await page.locator('#edNewW').fill('3');
    await page.locator('#edNewH').fill('200');
    await page.locator('#edCreate').click();
    await expect(page.locator('#fileInfo')).toHaveText('New canvas 4 × 128 px');
  });

  test('Resize canvas keeps the drawing that still fits, and undo brings the rest back', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#editPixels').click();
    await page.locator('#edNew [data-size="16"]').click();
    await clickCell(page, 2, 2);
    await clickCell(page, 12, 12);
    expect((await snap(page)).grid!.opaque).toBe(2);
    await page.locator('#edRW').fill('8');
    await page.locator('#edRH').fill('8');
    await page.locator('#edResize').click();
    const g = (await snap(page)).grid!;
    expect([g.w, g.h, g.opaque]).toEqual([8, 8, 1]);
    await page.locator('#edUndo').click();
    const u = (await snap(page)).grid!;
    expect([u.w, u.h, u.opaque]).toEqual([16, 16, 2]);
  });

  test('loading a photo while the chooser is up shows the photo', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#editPixels').click();
    await expect(page.locator('#edNew')).toBeVisible();
    await page.locator('#fileIn').setInputFiles({ name: 'potion.png', mimeType: 'image/png', buffer: fixture('potion.png') });
    await expect(page.locator('#edSrc')).toBeVisible();
    await expect(page.locator('#edNew')).toBeHidden();
    await expect(page.locator('#edResize')).toHaveCount(0);
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
    // centred on the cell: (2, 2) covers 1–3 in both directions
    await clickCell(page, 2, 2);
    expect(await opaque(page)).toBe(POTION_CELLS + 9);
    // in the corner only the four cells inside the grid are painted
    await clickCell(page, 0, 0);
    expect(await opaque(page)).toBe(POTION_CELLS + 9 + 4 - 1);
    await page.locator('#editor [data-brush="5"]').click();
    const before = (await snap(page)).undo;
    await clickCell(page, 15, 15);
    expect((await snap(page)).undo).toBe(before + 1);
    expect((await snap(page)).grid!.w).toBe(16);
  });

  test('opening and closing the editor leaves the viewer picture centred, and clears the highlighted color', async ({ page }) => {
    await loadPotion(page);
    const b = (await page.locator('#src').boundingBox())!;
    const mid = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.wheel(0, -1000);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x + 150, mid.y + 100, { steps: 4 });
    await page.mouse.up();
    await openEditor(page);
    await chip(page, 'Common', '#d62828').click();
    await page.locator('#edDone').click();
    await expect(page.locator('#pal li.sel')).toHaveCount(0);
    // a quarter cell inside cell (8, 8), clear of the grid line at the centre
    const rgb = await page.locator('#src').evaluate((c: HTMLCanvasElement) => {
      const k = c.width / c.getBoundingClientRect().width;
      return [...c.getContext('2d')!.getImageData(Math.round((c.getBoundingClientRect().width / 2 + c.getBoundingClientRect().width / 64) * k), Math.round((c.getBoundingClientRect().height / 2 + c.getBoundingClientRect().height / 64) * k), 1, 1).data.slice(0, 3)];
    });
    expect(rgb).toEqual([0x7a, 0x4f, 0xd6]);
  });

  test('a new color is in the image only while a pixel uses it', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    const undo0 = (await snap(page)).undo;
    await page.locator('#edNewBtn').click();
    await page.locator('#edHex').fill('#12ab34');
    await page.locator('#edHex').press('Enter');
    // chosen, not yet in the image
    expect(await hexes(page)).not.toContain('#12ab34');
    await expect(page.locator('#edImage [data-c="#12ab34"]')).toHaveCount(0);
    expect((await snap(page)).undo).toBe(undo0);
    // the first pixel brings it in, at the pixel height, in that stroke's one undo step
    await clickCell(page, 1, 8);
    expect(await hexes(page)).toContain('#12ab34');
    expect((await snap(page)).grid!.palette.find((p) => p.hex === '#12ab34')!.height).toBe(1);
    await expect(chip(page, 'Image', '#12ab34')).toHaveClass(/\bcur\b/);
    expect((await snap(page)).undo).toBe(undo0 + 1);
    // erasing its only pixel takes it out again; painting it again brings it back
    await page.locator('#editor [data-tool=erase]').click();
    await clickCell(page, 1, 8);
    expect(await hexes(page)).not.toContain('#12ab34');
    await expect(page.locator('#edImage [data-c="#12ab34"]')).toHaveCount(0);
    await page.locator('#editor [data-tool=paint]').click();
    await clickCell(page, 1, 8);
    expect(await hexes(page)).toContain('#12ab34');
  });

  test('Pick puts the color of the pixel in the wheel, and changing it recolors that color in the image', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await page.keyboard.press('i');
    await clickCell(page, 7, 9);
    await expect(page.locator('#edHex')).toHaveValue('#7a4fd6');
    await expect(chip(page, 'Image', '#7a4fd6')).toHaveClass(/\bcur\b/);
    const undo0 = (await snap(page)).undo;
    await page.locator('#edHex').fill('#123456');
    await page.locator('#edHex').press('Enter');
    expect(await hexes(page)).toContain('#123456');
    expect(await hexes(page)).not.toContain('#7a4fd6');
    expect((await snap(page)).undo).toBe(undo0 + 1);
    await expect(chip(page, 'Image', '#123456')).toHaveClass(/\bcur\b/);
    await page.locator('#edUndo').click();
    expect(await hexes(page)).toContain('#7a4fd6');
    expect(await hexes(page)).not.toContain('#123456');
  });

  test('dragging the wheel is one undo step', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Image', '#9c6b3e').click();
    const before = await snap(page);
    const b = (await page.locator('#edWheel').boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.75, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.2, { steps: 3 });
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.5, { steps: 3 });
    await page.mouse.up();
    const after = await snap(page);
    expect(after.undo).toBe(before.undo + 1);
    expect(after.grid!.palette).toHaveLength(before.grid!.palette.length);
    expect(after.grid!.palette.map((p) => p.hex)).not.toContain('#9c6b3e');
    expect(after.edits.filter((e) => e.kind === 'recolor')).toHaveLength(1);
    expect(after.grid!.opaque).toBe(before.grid!.opaque);
  });

  test('New color: the wheel changes only the brush until a pixel is painted', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Image', '#9c6b3e').click();
    const before = await snap(page);
    await page.locator('#edNewBtn').click();
    const b = (await page.locator('#edWheel').boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.75, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3, { steps: 3 });
    await page.mouse.up();
    const after = await snap(page);
    expect(after.undo).toBe(before.undo);
    expect(after.grid!.palette).toEqual(before.grid!.palette);
    await clickCell(page, 1, 8);
    expect((await snap(page)).grid!.palette).toHaveLength(before.grid!.palette.length + 1);
  });

  test('entering the hex of another image color merges into it, with one notice', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Image', '#4e2f9e').click();
    await page.locator('#edHex').fill('#7a4fd6');
    await page.locator('#edHex').press('Enter');
    await expect(page.locator('.toast')).toHaveText('Merged into the matching color.');
    expect(await hexes(page)).toHaveLength(6);
    expect(await hexes(page)).not.toContain('#4e2f9e');
  });

  test('a brightness drag that ends where it began still ends the gesture', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Image', '#9c6b3e').click();
    const slider = page.locator('#edBright');
    const b = (await slider.boundingBox())!;
    const v = Number(await slider.inputValue());
    const x = b.x + 6 + (b.width - 12) * (v / 100), y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y, { steps: 3 });
    await page.mouse.move(x, y, { steps: 3 });
    await page.mouse.up();
    // a later gesture on another color must recolor that color, not the first
    await chip(page, 'Image', '#2b2135').click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 3 });
    await page.mouse.up();
    const h = await hexes(page);
    expect(h).toContain('#9c6b3e');
    expect(h).not.toContain('#2b2135');
  });

  test('on a blank canvas the pixel height setting gives the drawn colors their height', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#editPixels').click();
    await page.locator('#edNew [data-size="16"]').click();
    await clickCell(page, 3, 3);
    await page.locator('#edDone').click();
    await page.locator('#defH').fill('2.5');
    await page.locator('#defH').press('Enter');
    await expect.poll(async () => (await snap(page)).grid!.palette.map((p) => p.height)).toEqual([2.5]);
  });

  test('a common color that is new joins the image with its first pixel', async ({ page }) => {
    await loadPotion(page);
    await openEditor(page);
    await chip(page, 'Common', '#d62828').click();
    expect(await hexes(page)).not.toContain('#d62828');
    await clickCell(page, 1, 8);
    expect(await hexes(page)).toContain('#d62828');
    expect(await opaque(page)).toBe(POTION_CELLS + 1);
  });

  test('at 16 colors a new color is refused and nothing is painted', async ({ page }) => {
    await load(page, 'sixteen.png', sixteen());
    expect(await hexes(page)).toHaveLength(16);
    await openEditor(page);
    const undo = (await snap(page)).undo;
    await chip(page, 'Common', '#d62828').click();
    await clickCell(page, 0, 0);
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

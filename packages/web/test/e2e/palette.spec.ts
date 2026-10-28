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

type Edit = { kind: string; [k: string]: unknown };
interface Snap {
  grid: { w: number; h: number; opaque: number; palette: { hex: string; height: number }[] } | null;
  settings: { size: { width: number; height: number }; pixelMm?: { x: number; y: number }; colours: { max: number };
    heights: { mode: string; h: number; min: number; max: number; seed: number } };
  edits: Edit[]; undo: number;
}
interface View { shown: 'none' | 'preview' | 'model'; size: { x: number; y: number; z: number } | null }
type Hook = { snapshot(): Snap; viewport(): View; latency(): number[] };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.snapshot());
const view = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.viewport());
const latency = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.latency());
const hexes = async (page: Page) => (await snap(page)).grid!.palette.map((p) => p.hex);
const heights = async (page: Page) => (await snap(page)).grid!.palette.map((p) => p.height);
const opaque = async (page: Page) => (await snap(page)).grid!.opaque;

/** Potion's colours with their pixel counts: 130 opaque cells, one piece, no corner-only contact. */
const POTION = ['#7a4fd6', '#2b2135', '#bfd9e6', '#4e2f9e', '#9c6b3e', '#b394f2', '#f4fbff'];
const CELLS = 130;
/** Potion's heights in Random mode with seed 42, range 1–4 (core applyHeightMode). */
const SEEDED = [2.8, 2.3, 3.6, 3, 1.5, 2.6, 1.8];

async function loadPotion(page: Page) {
  await page.goto('/?test');
  await page.locator('#fileIn').setInputFiles({ name: 'potion.png', mimeType: 'image/png', buffer: fixture('potion.png') });
  await expect(page.locator('#fileInfo')).toHaveText('potion.png 16 × 16 px, detected from a 4× upscale');
}

const row = (page: Page, hex: string) => page.locator('#pal li', { hasText: hex });
const tool = (page: Page, v: 'select' | 'paint' | 'erase') => page.locator(`.seg[data-key=tool] button[data-v=${v}]`);

/** Page position of the middle of grid cell (i, j) in the source preview, unzoomed. Scrolls the preview into view. */
async function cell(page: Page, i: number, j: number, dx = 0.5, dy = 0.5) {
  await page.locator('#src').scrollIntoViewIfNeeded();
  const b = (await page.locator('#src').boundingBox())!;
  const g = (await snap(page)).grid!;
  const c = b.width / Math.max(g.w, g.h);
  return { x: b.x + (b.width - g.w * c) / 2 + (i + dx) * c, y: b.y + (b.height - g.h * c) / 2 + (j + dy) * c };
}
async function clickCell(page: Page, i: number, j: number) {
  const p = await cell(page, i, j);
  await page.mouse.click(p.x, p.y);
}

test.describe('colours and heights', () => {
  test('a height slider updates the preview in under 50 ms, then the model', async ({ page }) => {
    await loadPotion(page);
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    const slider = row(page, '#2b2135').locator('input[type=range]');
    await expect(slider).toHaveAttribute('aria-label', 'Height of #2b2135');
    for (const h of ['2', '2.5', '3']) await slider.fill(h);
    await expect(row(page, '#2b2135').locator('.hv')).toHaveText('3.0 mm');
    const s = await snap(page);
    expect(s.grid!.palette.find((p) => p.hex === '#2b2135')!.height).toBe(3);
    expect(s.edits).toEqual([{ kind: 'height', hex: '#2b2135', h: 3 }]);
    const times = await latency(page);
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (const t of times) expect(t).toBeLessThan(50);
    await expect(page.locator('.dims')).toHaveText('40.0 × 53.3 × 5.0 mm one piece');
    await expect.poll(async () => { const v = await view(page); return v.shown === 'model' ? v.size!.z : 0; }).toBeCloseTo(5, 3);
  });

  test('recolour onto an existing colour merges the two; onto a new one renames it', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('#pcount')).toHaveText('7 of 7');
    await row(page, '#4e2f9e').locator('input[type=color]').fill('#7a4fd6');
    await expect(page.locator('.toast')).toHaveText('Merged into the matching colour.');
    expect(await hexes(page)).toEqual(POTION.filter((h) => h !== '#4e2f9e'));
    expect(await opaque(page)).toBe(CELLS);
    await expect(page.locator('#pcount')).toHaveText('6 of 7');
    await row(page, '#9c6b3e').locator('input[type=color]').fill('#123456');
    expect(await hexes(page)).toContain('#123456');
    expect(await hexes(page)).not.toContain('#9c6b3e');
    expect((await snap(page)).edits).toEqual([
      { kind: 'recolour', from: '#4e2f9e', to: '#7a4fd6' },
      { kind: 'recolour', from: '#9c6b3e', to: '#123456' },
    ]);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await hexes(page)).toEqual(POTION);
  });

  test('delete a colour, add one and paint with it, select picks a colour', async ({ page }) => {
    await loadPotion(page);
    await row(page, '#f4fbff').locator('.del').click();
    await expect(page.locator('.toast')).toHaveText('Colour deleted. Its pixels now use the nearest colour.');
    expect(await hexes(page)).toEqual(POTION.slice(0, 6));
    expect(await opaque(page)).toBe(CELLS);
    await page.locator('#addColour').click();
    expect(await hexes(page)).toContain('#e0715c');
    await expect(row(page, '#e0715c')).toHaveClass(/\bsel\b/);
    await expect(tool(page, 'paint')).toHaveClass(/\bon\b/);
    await clickCell(page, 7, 0);
    const g = (await snap(page)).grid!;
    expect(g.palette.findIndex((p) => p.hex === '#e0715c')).toBeGreaterThan(-1);
    expect(await opaque(page)).toBe(CELLS);
    // Select picks the colour under the pointer
    await tool(page, 'select').click();
    await clickCell(page, 7, 9);
    await expect(row(page, '#7a4fd6')).toHaveClass(/\bsel\b/);
    // Erase empties a cell
    await tool(page, 'erase').click();
    await clickCell(page, 7, 9);
    expect(await opaque(page)).toBe(CELLS - 1);
  });

  test('a drag-paint stroke is one undo step', async ({ page }) => {
    await loadPotion(page);
    await row(page, '#2b2135').locator('.sw').click();
    await expect(tool(page, 'paint')).toHaveClass(/\bon\b/);
    const undo = (await snap(page)).undo;
    const a = await cell(page, 1, 8), b = await cell(page, 1, 12);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    expect(await opaque(page)).toBe(CELLS + 5);
    expect((await snap(page)).undo).toBe(undo + 1);
    await page.keyboard.press('Control+z');
    expect(await opaque(page)).toBe(CELLS);
  });

  test('paint outside the outline: Width grows from 40 to 46.7, the pixel size is unchanged', async ({ page }) => {
    await loadPotion(page);
    const before = await snap(page);
    expect(before.settings.size.width).toBe(40);
    expect(before.settings.pixelMm!.x).toBeCloseTo(40 / 12, 6);
    await row(page, '#2b2135').locator('.sw').click();
    await clickCell(page, 1, 8);
    await clickCell(page, 14, 8);
    const after = await snap(page);
    expect(after.settings.size.width).toBe(46.7);
    expect(after.settings.pixelMm).toEqual(before.settings.pixelMm);
    await expect(page.locator('.dims')).toHaveText('46.7 × 53.3 × 3.0 mm one piece');
    await expect.poll(async () => (await view(page)).size?.x).toBeCloseTo(46.667, 2);
  });

  test('Restore colours brings back deleted and recoloured colours and keeps the heights', async ({ page }) => {
    await loadPotion(page);
    await row(page, '#2b2135').locator('input[type=range]').fill('4');
    await row(page, '#9c6b3e').locator('.del').click();
    await row(page, '#bfd9e6').locator('input[type=color]').fill('#123456');
    expect(await hexes(page)).toHaveLength(6);
    await page.locator('#restoreCols').click();
    await expect(page.locator('.toast')).toHaveText('Original colours restored. Your heights were kept.');
    expect(await hexes(page)).toEqual(POTION);
    const g = (await snap(page)).grid!;
    expect(g.palette.find((p) => p.hex === '#2b2135')!.height).toBe(4);
    expect(g.palette.find((p) => p.hex === '#7a4fd6')!.height).toBe(1);
    await page.keyboard.press('Control+z');
    expect(await hexes(page)).toHaveLength(6);
  });

  test('Reload image drops every edit, keeps the height mode and applies it again, and can be undone', async ({ page }) => {
    await loadPotion(page);
    await page.locator('.seg[data-key=heightMode] button[data-v=random]').click();
    await row(page, '#2b2135').locator('input[type=range]').fill('6');
    await row(page, '#2b2135').locator('.sw').click();
    await clickCell(page, 1, 8);
    await row(page, '#f4fbff').locator('.del').click();
    const edited = await snap(page);
    expect(edited.edits).toHaveLength(3);
    await page.locator('#reloadImg').click();
    await expect(page.locator('.toast')).toHaveText('Image reloaded. Press Ctrl+Z to undo.');
    const s = await snap(page);
    expect(s.edits).toEqual([]);
    expect(s.settings.heights.mode).toBe('random');
    expect(s.grid!.opaque).toBe(CELLS);
    expect(s.grid!.palette.map((p) => p.hex)).toEqual(POTION);
    // the seeded random heights again: the 6 mm height edit is gone
    expect(s.grid!.palette.map((p) => p.height)).toEqual(SEEDED);
    await expect(page.locator('.seg[data-key=heightMode] button[data-v=random]')).toHaveClass(/\bon\b/);
    await page.keyboard.press('Control+z');
    expect((await snap(page)).edits).toEqual(edited.edits);
  });

  test('a floating pixel: two pieces, a red outline and Remove strays, which can be undone', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('#health')).toHaveText('● Watertight');
    await row(page, '#2b2135').locator('.sw').click();
    await clickCell(page, 0, 0);
    await expect(page.locator('#health')).toHaveText('▲ 2 separate pieces');
    await expect(page.locator('#health')).toHaveClass('bad');
    await expect(page.locator('.dims .warn')).toHaveText('2 separate pieces');
    await expect(page.locator('#note')).toContainText(
      "2 separate pieces. 1 stray pixel (outlined in red in the image) don't share an edge with the rest, so they would print as loose parts. Paint pixels to connect them, or remove them.");
    await expect(page.locator('#note')).not.toContainText('corner');
    // the stray's red outline, just inside its cell edge
    const box = (await page.locator('#src').boundingBox())!;
    const p = await cell(page, 0, 0, 0, 0.5);
    const rgb = await page.locator('#src').evaluate((c: HTMLCanvasElement, at) => {
      const k = c.width / c.getBoundingClientRect().width;
      return [...c.getContext('2d')!.getImageData(Math.round(at.x * k), Math.round(at.y * k), 1, 1).data.slice(0, 3)];
    }, { x: p.x - box.x + 1, y: p.y - box.y });
    expect(rgb).toEqual([0xe0, 0x71, 0x5c]);
    await page.locator('#removeStrays').click();
    await expect(page.locator('.toast')).toHaveText('Stray pixels removed. Press Ctrl+Z to undo.');
    await expect(page.locator('#health')).toHaveText('● Watertight');
    await expect(page.locator('#removeStrays')).toHaveCount(0);
    expect(await opaque(page)).toBe(CELLS);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#health')).toHaveText('▲ 2 separate pieces');
    expect(await opaque(page)).toBe(CELLS + 1);
  });

  test('a pixel touching only at a corner is a stray and the note says why', async ({ page }) => {
    await loadPotion(page);
    await row(page, '#2b2135').locator('.sw').click();
    await clickCell(page, 1, 7);
    await expect(page.locator('#health')).toHaveText('▲ 2 separate pieces');
    await expect(page.locator('#note')).toContainText("Pixels that touch only at a corner don't count as joined.");
  });

  test('Randomize with seed 42 is stable', async ({ page }) => {
    await loadPotion(page);
    await page.locator('.seg[data-key=heightMode] button[data-v=random]').click();
    await expect(page.locator('#seed')).toHaveValue('42');
    const seeded = SEEDED;
    expect(await heights(page)).toEqual(seeded);
    await page.locator('#reroll').click();
    await expect(page.locator('#seed')).not.toHaveValue('42');
    expect(await heights(page)).not.toEqual(seeded);
    await page.locator('#seed').fill('42');
    await page.locator('#seed').press('Enter');
    expect(await heights(page)).toEqual(seeded);
    await page.locator('.seg[data-key=heightMode] button[data-v=uniform]').click();
    await expect(page.locator('#defH')).toHaveValue('1.0');
    await page.locator('#defH').fill('2.5');
    await page.locator('#defH').press('Enter');
    await expect.poll(() => heights(page)).toEqual(POTION.map(() => 2.5));
  });

  test('the colour count merges the closest pair; deleted colours can be restored', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('#colMax')).toHaveValue('16');
    await page.locator('#colMax').fill('6');
    await page.locator('#colMax').press('Enter');
    // #f4fbff (2 pixels) is closest to #bfd9e6 and merges into it
    await expect.poll(() => hexes(page)).toEqual(POTION.slice(0, 6));
    expect(await opaque(page)).toBe(CELLS);
    await expect(page.locator('#pcount')).toHaveText('6 of 7');
    await row(page, '#b394f2').locator('.del').click();
    expect(await hexes(page)).toEqual(POTION.slice(0, 5));
    await page.locator('#restoreCols').click();
    expect(await hexes(page)).toEqual(POTION);
    await expect(page.locator('#colMax')).toHaveValue('16');
  });

  test('a height for a colour that no longer exists is dropped with a notice', async ({ page }) => {
    await loadPotion(page);
    await row(page, '#f4fbff').locator('input[type=range]').fill('5');
    await page.locator('#colMax').fill('6');
    await page.locator('#colMax').press('Enter');
    await expect(page.locator('.toast')).toHaveText('Edits that no longer apply were removed.');
    expect((await snap(page)).edits).toEqual([]);
    await page.locator('#colMax').blur();
    await page.keyboard.press('Control+z');
    expect((await snap(page)).edits).toEqual([{ kind: 'height', hex: '#f4fbff', h: 5 }]);
  });

  test('cropping drops painted pixels outside the crop, with a notice', async ({ page }) => {
    await loadPotion(page);
    await row(page, '#2b2135').locator('.sw').click();
    await clickCell(page, 0, 0);
    await clickCell(page, 1, 8);
    await page.locator('#crop').click();
    const a = await cell(page, 1, 1), b = await cell(page, 8, 10);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#fileInfo')).toHaveText('potion.png 8 × 10 px, detected from a 4× upscale');
    await expect(page.locator('.toast')).toHaveText('Painted pixels outside the crop were removed.');
    expect((await snap(page)).edits).toEqual([{ kind: 'paint', x: 0, y: 7, hex: '#2b2135' }]);
    await page.keyboard.press('Control+z');
    expect((await snap(page)).edits).toHaveLength(2);
    expect((await snap(page)).grid!.w).toBe(16);
  });

  test('a painted pixel that falls off the grid is dropped with a notice', async ({ page }) => {
    await loadPotion(page);
    await page.locator('#pixelate').check();
    await expect(page.locator('#fileInfo')).toHaveText('potion.png 32 × 32 px, pixelated');
    await page.locator('#pal li .sw').first().click();
    await clickCell(page, 30, 30);
    expect((await snap(page)).edits).toHaveLength(1);
    await page.locator('#pixelate').uncheck();
    await expect(page.locator('.toast')).toHaveText('Edits that no longer apply were removed.');
    expect((await snap(page)).edits).toEqual([]);
  });

  test('toggling Pixelate keeps the width: it sets a new pixel size', async ({ page }) => {
    await loadPotion(page);
    await expect(page.locator('.dims')).toHaveText('40.0 × 53.3 × 3.0 mm one piece');
    await expect(page.locator('#colMax')).toBeVisible();
    await page.locator('#pixelate').check();
    await expect(page.locator('#fileInfo')).toHaveText('potion.png 32 × 32 px, pixelated');
    expect((await snap(page)).settings.size.width).toBe(40);
    await expect(page.locator('.dims')).toContainText('40.0 ×');
    // the colour count hides while Pixelate shows its own Colours slider
    await expect(page.locator('#colMax')).toBeHidden();
    await page.locator('#pixelate').uncheck();
    await expect(page.locator('#fileInfo')).toHaveText('potion.png 16 × 16 px, detected from a 4× upscale');
    expect((await snap(page)).settings.size.width).toBe(40);
    await expect(page.locator('.dims')).toHaveText('40.0 × 53.3 × 3.0 mm one piece');
  });

  test('Pixels across moves painted pixels onto the resampled grid', async ({ page }) => {
    await loadPotion(page);
    await page.locator('#pixelate').check();
    await expect(page.locator('#fileInfo')).toHaveText('potion.png 32 × 32 px, pixelated');
    await page.locator('#pal li .sw').first().click();
    const hex = (await snap(page)).grid!.palette[0]!.hex;
    await clickCell(page, 3, 5);
    expect((await snap(page)).edits).toEqual([{ kind: 'paint', x: 3, y: 5, hex }]);
    await page.locator('#pixW').fill('16');
    await page.locator('#pixW').press('Enter');
    await expect(page.locator('#fileInfo')).toHaveText('potion.png 16 × 16 px, pixelated');
    expect((await snap(page)).edits).toEqual([{ kind: 'paint', x: 1, y: 2, hex }]);
    await page.locator('#pixW').fill('64');
    await page.locator('#pixW').press('Enter');
    await expect(page.locator('#fileInfo')).toHaveText('potion.png 64 × 64 px, pixelated');
    expect((await snap(page)).edits).toEqual([{ kind: 'paint', x: 6, y: 10, hex }]);
  });
});

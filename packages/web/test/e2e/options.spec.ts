import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { test as base, expect, type Page } from '@playwright/test';
import UPNG from 'upng-js';

// v0.2.35 (user request 2026-10-28): no strays UI on a clicker, the cap backing color, Smooth edges and Outline.

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

interface Settings {
  make: 'model' | 'clicker'; smooth: boolean; outline: { on: boolean; width: number; color: string };
  clicker: { backing: 'base' | 'art' }; base: { color: string };
}
interface Snap { settings: Settings; grid: { palette: { hex: string; height: number }[] } | null }
interface View { shown: 'none' | 'preview' | 'model'; parts: string[]; buildError: string | null; size: { x: number; y: number; z: number } | null }
type Hook = { snapshot(): Snap; viewport(): View; latency(): number[]; failNextBuild(): void };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.snapshot());
const settings = async (page: Page) => (await snap(page)).settings;
const view = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.viewport());
const latency = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.latency());
const failNextBuild = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.failNextBuild());
const seg = (page: Page, key: string, v: string) => page.locator(`.seg[data-key=${key}] button[data-v="${v}"]`);
const row = (page: Page, hex: string) => page.locator('#pal li', { hasText: hex });
const model = async (page: Page) => { const v = await view(page); return v.shown === 'model' ? v.parts : null; };

async function loadPotion(page: Page) {
  await page.goto('/?test');
  await page.locator('#fileIn').setInputFiles({ name: 'potion.png', mimeType: 'image/png', buffer: fixture('potion.png') });
  await expect(page.locator('#fileInfo')).toHaveText('potion.png 16 × 16 px, detected from a 4× upscale');
  await expect.poll(async () => (await view(page)).shown).toBe('model');
}

/** Paint the top-left cell with a palette color: a stray pixel, well away from the art. */
async function paintStray(page: Page) {
  await page.locator('.seg[data-key=tool] button[data-v=paint]').click();
  await row(page, '#2b2135').locator('.sw').click();
  await page.locator('#src').scrollIntoViewIfNeeded();
  const b = (await page.locator('#src').boundingBox())!;
  const c = b.width / 16;
  await page.mouse.click(b.x + c / 2, b.y + c / 2);
}

test.describe('clicker pieces', () => {
  test('a clicker shows no stray pixel outline, note or Remove strays, and no grid piece count while it builds', async ({ page }) => {
    await loadPotion(page);
    await paintStray(page);
    await expect(page.locator('#removeStrays')).toBeVisible();
    await expect(page.locator('#health')).toHaveText('▲ 2 separate pieces');
    await seg(page, 'make', 'clicker').click();
    // at once, before the clicker model arrives
    await expect(page.locator('#removeStrays')).toHaveCount(0);
    await expect(page.locator('#health')).not.toHaveText(/separate pieces/);
    await expect(page.locator('#note')).not.toContainText('stray');
    // no red outline round the stray cell in the image
    const b = (await page.locator('#src').boundingBox())!;
    const rgb = await page.locator('#src').evaluate((c: HTMLCanvasElement, at) => {
      const k = c.width / c.getBoundingClientRect().width;
      return [...c.getContext('2d')!.getImageData(Math.round(at.x * k), Math.round(at.y * k), 1, 1).data.slice(0, 3)];
    }, { x: b.width / 16 / 2 - b.width / 32 + 1.5, y: b.width / 32 });
    expect(rgb).not.toEqual([0xe0, 0x71, 0x5c]);
    // once built, any split is named by object, never as stray pixels
    await expect.poll(async () => (await model(page))?.some((p) => p.startsWith('cap:')) ?? false).toBe(true);
    await expect(page.locator('#removeStrays')).toHaveCount(0);
    await expect(page.locator('#health')).not.toHaveText(/separate pieces/);
    await expect(page.locator('#note')).not.toContainText('stray');
    // back to a flat model, the strays UI returns
    await seg(page, 'make', 'model').click();
    await expect(page.locator('#removeStrays')).toBeVisible();
  });
});

test.describe('cap backing', () => {
  test('Cap backing: Base color / Art colors sets clicker.backing; Art colors leaves no base-colored cap part', async ({ page }) => {
    await loadPotion(page);
    await seg(page, 'make', 'clicker').click();
    await expect(page.locator('#clkSec .row', { hasText: 'Cap backing' })).toBeVisible();
    await expect(seg(page, 'clkBacking', 'base')).toHaveText('Base color');
    await expect(seg(page, 'clkBacking', 'art')).toHaveText('Art colors');
    await expect(seg(page, 'clkBacking', 'base')).toHaveClass(/\bon\b/);
    await expect.poll(async () => (await model(page))?.includes('cap:base') ?? false).toBe(true);
    const fil = Number((await page.locator('#fcount').textContent())!.split(' ')[0]);
    await seg(page, 'clkBacking', 'art').click();
    expect((await settings(page)).clicker.backing).toBe('art');
    await expect(page.locator('#clkBackingHint')).toHaveText("Each art color runs the full depth of the cap, so the cap has no base color. Spots that aren't art take the nearest art color.");
    await expect.poll(async () => { const p = await model(page); return p ? p.includes('cap:base') : true; }).toBe(false);
    expect((await model(page))!).toContain('body:base');
    // the base color is still the body's, so the filament count is unchanged
    await expect(page.locator('#fcount')).toHaveText(`${fil} filaments`);
    await page.keyboard.press('Control+z');
    expect((await settings(page)).clicker.backing).toBe('base');
  });
});

test.describe('smooth edges', () => {
  test('Smooth edges sits in the Base section with its hint, and stays when the base is off', async ({ page }) => {
    await loadPotion(page);
    const sec = page.locator('aside.right section', { has: page.locator('h2', { hasText: /^Base/ }) });
    await expect(sec.locator('label.check', { hasText: 'Smooth edges' })).toBeVisible();
    await expect(sec.locator('#smoothHint')).toHaveText('Rounds the stepped pixel edge of the base, outline and clicker body. The art keeps its pixels.');
    const before = (await view(page)).size!;
    await page.locator('#smooth').check();
    expect((await settings(page)).smooth).toBe(true);
    // the base reaches half a pixel past the art all round
    await expect.poll(async () => { const v = await view(page); return v.shown === 'model' ? v.size!.x : 0; }).toBeGreaterThan(before.x + 1);
    await page.locator('#baseOn').uncheck();
    await expect(page.locator('#smooth')).toBeVisible();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect((await settings(page)).smooth).toBe(false);
  });

  test('with Smooth edges and Outline on, a height slider still updates the preview in under 50 ms', async ({ page }) => {
    await loadPotion(page);
    await page.locator('#smooth').check();
    await page.locator('#outlineOn').check();
    await expect.poll(async () => (await model(page))?.includes('main:outline') ?? false).toBe(true);
    const slider = row(page, '#2b2135').locator('input[type=range]');
    for (const h of ['2', '2.5', '3']) await slider.fill(h);
    await expect(row(page, '#2b2135').locator('.hv')).toHaveText('3.0 mm');
    const times = await latency(page);
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (const t of times) expect(t, times.join(', ')).toBeLessThan(50);
    console.log(`potion, smooth + outline, height slider: ${times.map((t) => t.toFixed(1)).join(', ')} ms`);
  });

  test('...and on a 128 × 128, 16-color sprite (spec §7)', async ({ page }) => {
    const N = 128, px = new Uint8Array(N * N * 4);
    for (let y = 4; y < N - 4; y++) for (let x = 4; x < N - 4; x++) {
      const k = (x * 7 + y * 13) % 16;
      px.set([(k * 53) % 256, (k * 97 + 40) % 256, (k * 151 + 90) % 256, 255], (y * N + x) * 4);
    }
    const png = Buffer.from(UPNG.encode([px.buffer as ArrayBuffer], N, N, 0));
    await page.goto('/?test');
    await page.locator('#smooth').check();
    await page.locator('#outlineOn').check();
    await page.locator('#fileIn').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('#fileInfo')).toHaveText('big.png 128 × 128 px');
    await expect.poll(async () => (await model(page))?.includes('main:outline') ?? false, { timeout: 20_000 }).toBe(true);
    const hex = (await snap(page)).grid!.palette[0]!.hex;
    const slider = row(page, hex).locator('input[type=range]');
    for (const h of ['2', '2.5', '3', '3.5', '4', '4.5']) await slider.fill(h);
    await expect(row(page, hex).locator('.hv')).toHaveText('4.5 mm');
    const times = await latency(page);
    expect(times.length).toBeGreaterThanOrEqual(6);
    // the suite runs fully parallel (see palette.spec.ts): the typical move under 50 ms, none far off it
    const sorted = [...times].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]!, times.join(', ')).toBeLessThan(50);
    expect(sorted.at(-1)!, times.join(', ')).toBeLessThan(100);
    console.log(`128 x 128, smooth + outline, height slider: ${times.map((t) => t.toFixed(1)).join(', ')} ms`);
  });
});

test.describe('outline', () => {
  test('the Outline section comes right after Base, with Width and Color shown while it is on', async ({ page }) => {
    await page.goto('/?test');
    const h2 = page.locator('aside.right section > h2');
    const names = (await h2.allTextContents()).map((t) => t.trim().split(/\s/)[0]);
    expect(names.indexOf('Outline')).toBe(names.indexOf('Base') + 1);
    await expect(page.locator('#outlineRows')).toHaveCount(0);
    await page.locator('#outlineOn').check();
    await expect(page.locator('#outlineW')).toHaveValue('1.5');
    await expect(page.locator('#outlineColor')).toHaveValue('#000000');
    await expect(page.locator('#outlineFavs')).toBeVisible();
    await expect(page.locator('#outlineHint')).toHaveText('A border round the outside of the art, as tall as its lowest color.');
    // inches are display only
    await seg(page, 'unit', 'in').click();
    await expect(page.locator('#outlineW')).toHaveValue('0.06');
    await page.locator('#outlineW').fill('0.1');
    await page.locator('#outlineW').press('Enter');
    expect((await settings(page)).outline.width).toBeCloseTo(2.54, 6);
  });

  test('turning Outline on adds an outline part to the preview, the model and the 3MF, and a filament', async ({ page }) => {
    await loadPotion(page);
    const fil = Number((await page.locator('#fcount').textContent())!.split(' ')[0]);
    // keep the preview up: the next build fails, so what shows is the fast preview
    await failNextBuild(page);
    await page.locator('#outlineOn').check();
    await expect.poll(async () => (await view(page)).buildError).not.toBeNull();
    let v = await view(page);
    expect(v.shown).toBe('preview');
    expect(v.parts).toContain('main:outline');
    expect(v.parts).toContain('main:base');
    // then a real build: the model has it too, and the preview's size matched it
    const previewSize = v.size!;
    await page.locator('#outlineW').fill('2');
    await page.locator('#outlineW').press('Enter');
    await expect.poll(async () => (await model(page))?.includes('main:outline') ?? false).toBe(true);
    v = await view(page);
    expect(v.size!.x).toBeCloseTo(previewSize.x + 1, 1);
    await expect(page.locator('#fcount')).toHaveText(`${fil + 1} filaments`);
    // the outline in the same color as the base shares its filament
    await page.locator('#outlineColor').fill((await settings(page)).base.color);
    await expect(page.locator('#fcount')).toHaveText(`${fil} filaments`);
    await page.locator('#exportBtn').click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator('#export').click()]);
    const zip = unzipSync(new Uint8Array(readFileSync(await dl.path())));
    expect(strFromU8(zip['Metadata/model_settings.config']!)).toContain('value="outline"');
  });

  test('Outline on a clicker goes round the cap', async ({ page }) => {
    await loadPotion(page);
    await seg(page, 'make', 'clicker').click();
    await page.locator('#outlineOn').check();
    await expect.poll(async () => (await model(page))?.includes('cap:outline') ?? false).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
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

type Vec3 = [number, number, number];
type Box = { min: Vec3; max: Vec3 };
interface Clicker { view: 'assembled' | 'apart'; at: number; rest: number; cap: Box; body: Box; ghosts: number }
interface Settings {
  make: 'model' | 'clicker';
  clicker: { shape: string; border: number; capHeight: number; fitGap: number; switches: number };
  rotation: [number, number, number];
}
interface Snap { settings: Settings; undo: number }
interface View {
  shown: 'none' | 'preview' | 'model'; cut: boolean; clipped: number; materials: number; clicker: Clicker | null;
  size: { x: number; y: number; z: number } | null; handles: { kind: string }[]; camera: Vec3;
}
type Hook = { snapshot(): Snap; viewport(): View };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.snapshot());
const settings = async (page: Page) => (await snap(page)).settings;
const view = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: Hook }).__pixel3d.viewport());
const clicker = async (page: Page) => (await view(page)).clicker;
const seg = (page: Page, key: string, v: string) => page.locator(`.seg[data-key=${key}] button[data-v="${v}"]`);

async function loadPotion(page: Page) {
  await page.goto('/?test');
  await page.locator('#fileIn').setInputFiles({ name: 'potion.png', mimeType: 'image/png', buffer: fixture('potion.png') });
  await expect(page.locator('#fileInfo')).toHaveText('potion.png 16 × 16 px, detected from a 4× upscale');
}

/** Load the potion, pick Clicker, and wait for the clicker model. */
async function loadClicker(page: Page) {
  await loadPotion(page);
  await seg(page, 'make', 'clicker').click();
  await expect.poll(async () => (await clicker(page))?.view ?? null).toBe('assembled');
}

const center = (b: Box): [number, number] => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];

test.describe('keycap clicker', () => {
  test('Make: Flat model / Clicker is the first control in the right panel', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('aside.right section').first().locator('h2')).toHaveText('Make');
    await expect(page.locator('aside.right .seg').first()).toHaveAttribute('data-key', 'make');
    await expect(seg(page, 'make', 'model')).toHaveText('Flat model');
    await expect(seg(page, 'make', 'clicker')).toHaveText('Clicker');
    await expect(seg(page, 'make', 'model')).toHaveClass(/\bon\b/);
    await expect(page.locator('#makeHint')).toHaveText('A flat pixel model: keychain, magnet, fridge magnet or display piece.');
    await expect(page.locator('#clkSec')).toHaveCount(0);
    await seg(page, 'make', 'clicker').click();
    expect((await settings(page)).make).toBe('clicker');
    await expect(page.locator('#makeHint')).toHaveText('Your art becomes a key cap that clicks on a mechanical keyboard switch (Cherry MX style). Prints as two parts: the cap and a body that holds the switch.');
    // the Clicker settings show directly below Make
    await expect(page.locator('aside.right section > h2')).toHaveText([/^Make/, /^Clicker/, /^Size/, /^Base/, /^Inside/, /^Sides/, /^Keychain/, /^Magnets/, /^Orientation/]);
  });

  test('Clicker grays out Sides, Inside, Keychain, Magnets and Orientation with "Not used on a clicker"', async ({ page }) => {
    await page.goto('/?test');
    const sec = (name: string) => page.locator('aside.right section', { has: page.locator('h2', { hasText: new RegExp(`^${name}`) }) });
    // Orientation too (R24): a clicker always prints flat
    const off = ['Inside', 'Sides', 'Keychain', 'Magnets', 'Orientation'], on = ['Make', 'Size', 'Base'];
    for (const n of [...off, ...on]) await expect(sec(n)).not.toHaveClass(/\boff\b/);
    await seg(page, 'make', 'clicker').click();
    for (const n of off) {
      await expect(sec(n)).toHaveClass(/\boff\b/);
      expect(await sec(n).locator('h2').evaluate((h) => getComputedStyle(h, '::after').content)).toBe('"Not used on a clicker"');
    }
    for (const n of [...on, 'Clicker']) await expect(sec(n)).not.toHaveClass(/\boff\b/);
    await seg(page, 'make', 'model').click();
    for (const n of off) await expect(sec(n)).not.toHaveClass(/\boff\b/);
  });

  test('clicker settings: mockup controls, spec ranges, one undo step each; Make is undoable', async ({ page }) => {
    await loadPotion(page);
    const u0 = (await snap(page)).undo;
    await seg(page, 'make', 'clicker').click();
    expect((await snap(page)).undo).toBe(u0 + 1);
    await expect(seg(page, 'clkShape', 'outline')).toHaveClass(/\bon\b/);
    await expect(page.locator('.seg[data-key=clkShape] button')).toHaveText(['Outline', 'Circle', 'Square']);
    await expect(page.locator('.seg[data-key=clkSwitches] button')).toHaveText(['1', '2', '3']);
    await expect(page.locator('.seg[data-key=clkView] button')).toHaveText(['Apart (as printed)', 'Assembled']);
    const pair = async (id: string, min: string, max: string, value: string) => {
      const row = page.locator('.sl', { has: page.locator(`#${id}`) });
      await expect(row.locator('input[type=range]')).toHaveAttribute('min', min);
      await expect(row.locator('input[type=range]')).toHaveAttribute('max', max);
      await expect(page.locator(`#${id}`)).toHaveValue(value);
    };
    await pair('clkBorder', '1.5', '10', '3.0');
    await pair('clkProud', '0.5', '4', '2.0');
    await pair('clkTol', '0.2', '1.5', '0.50');
    await seg(page, 'clkShape', 'circle').click();
    await seg(page, 'clkSwitches', '2').click();
    await page.locator('#clkTol').fill('0.8');
    await page.locator('#clkTol').press('Enter');
    await page.locator('#clkBorder').fill('20');
    await page.locator('#clkBorder').press('Enter');
    const s = await snap(page);
    expect(s.settings.clicker).toEqual({ shape: 'circle', border: 10, capHeight: 2, fitGap: 0.8, switches: 2 });
    expect(s.undo).toBe(u0 + 5);
    await expect(page.locator('#clkHint')).toContainText('Needs 2 MX-style switches. Press each switch into the body from above until it sits on the step, then push the cap on.');
    await expect(page.locator('#clkHint')).toContainText('even with Base off');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
    expect((await settings(page)).clicker.border).toBe(3);
  });

  test('Assembled is the default view; Apart puts the cap beside the body', async ({ page }) => {
    await loadClicker(page);
    await expect(seg(page, 'clkView', 'assembled')).toHaveClass(/\bon\b/);
    await expect(page.locator('#dims')).toContainText('assembled, switch at rest');
    let c = (await clicker(page))!;
    // the cap sits over the body, lifted onto the switch, with a see-through stand-in switch
    const [cx, cy] = center(c.cap), [bx, by] = center(c.body);
    expect(Math.abs(cx - bx)).toBeLessThan(0.01);
    expect(Math.abs(cy - by)).toBeLessThan(0.01);
    expect(c.cap.min[2]).toBeCloseTo(c.rest, 3);
    expect(c.cap.min[2]).toBeGreaterThan(5);
    expect(c.ghosts).toBeGreaterThan(0);
    expect(c.body.min[2]).toBeCloseTo(0, 3);
    await seg(page, 'clkView', 'apart').click();
    await expect.poll(async () => (await clicker(page))!.view).toBe('apart');
    await expect(page.locator('#dims')).toContainText('cap and body');
    await expect(page.locator('#pressRow')).toBeHidden();
    c = (await clicker(page))!;
    expect(c.cap.min[0]).toBeGreaterThan(c.body.max[0]);
    expect(c.cap.min[2]).toBeCloseTo(0, 3);
    expect(c.body.min[2]).toBeCloseTo(0, 3);
    expect(c.ghosts).toBe(0);
    // the view is not a setting: no undo step, and it isn't saved
    expect((await settings(page)) as unknown as Record<string, unknown>).not.toHaveProperty('clkView');
  });

  test('holding Press moves the cap down 4 mm and releasing returns it', async ({ page }) => {
    await loadClicker(page);
    const rest = (await clicker(page))!.cap.min[2];
    const press = page.locator('#clkPress');
    await expect(press).toHaveText('Press');
    await press.hover();
    await page.mouse.down();
    await expect.poll(async () => (await clicker(page))!.cap.min[2], { timeout: 3000 }).toBeCloseTo(rest - 4, 1);
    // the model stays put on the bed while the cap moves
    expect((await clicker(page))!.body.min[2]).toBeCloseTo(0, 3);
    await page.mouse.up();
    await expect.poll(async () => (await clicker(page))!.cap.min[2], { timeout: 3000 }).toBeCloseTo(rest, 1);
    // and holding Space does the same
    // the Press button keeps focus after the click, and Space still presses
    await expect(press).toBeFocused();
    await page.keyboard.down('Space');
    await expect.poll(async () => (await clicker(page))!.cap.min[2], { timeout: 3000 }).toBeCloseTo(rest - 4, 1);
    await page.keyboard.up('Space');
    await expect.poll(async () => (await clicker(page))!.cap.min[2], { timeout: 3000 }).toBeCloseTo(rest, 1);
  });

  test('Cut view works in Assembled; a clicker is never rotated', async ({ page }) => {
    await loadPotion(page);
    await page.locator('[data-rot="0"]').click();
    await seg(page, 'make', 'clicker').click();
    await expect.poll(async () => (await clicker(page))?.view ?? null).toBe('assembled');
    // the rotation setting stays, but the clicker shows (and is built) flat
    expect((await settings(page)).rotation).toEqual([1, 0, 0]);
    const c = (await clicker(page))!;
    expect(c.body.max[2] - c.body.min[2]).toBeLessThan(c.body.max[0] - c.body.min[0]);
    await page.locator('#cutBtn').click();
    await expect.poll(async () => (await view(page)).clipped).toBeGreaterThan(0);
    let v = await view(page);
    expect(v.clipped).toBe(v.materials);
    // and in Apart
    await seg(page, 'clkView', 'apart').click();
    await expect.poll(async () => (await clicker(page))!.view).toBe('apart');
    v = await view(page);
    expect(v.clipped).toBeGreaterThan(0);
    expect(v.clipped).toBe(v.materials);
  });

  test('Flat model → Clicker → Flat model, and undo/redo across Make, restore each view', async ({ page }) => {
    await loadPotion(page);
    await seg(page, 'key', 'hole').click();
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    const flat = await view(page);
    expect(flat.handles.length).toBe(1);
    await seg(page, 'make', 'clicker').click();
    await expect.poll(async () => (await clicker(page))?.view ?? null).toBe('assembled');
    expect((await view(page)).handles).toEqual([]);
    // the clicker is framed for its own size, and the flat model gets its framing back
    await expect.poll(async () => (await view(page)).camera).not.toEqual(flat.camera);
    // a new body shape refits too
    const assembled = (await view(page)).camera;
    await page.locator('#clkBorder').fill('10');
    await page.locator('#clkBorder').press('Enter');
    await seg(page, 'clkShape', 'circle').click();
    await expect.poll(async () => (await view(page)).camera[0]).toBeGreaterThan(assembled[0]);
    // back to the default clicker, so undo below steps across Make
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await settings(page)).clicker).toMatchObject({ shape: 'outline', border: 3 });
    await expect(page.locator('aside.right section.off')).toHaveCount(5);
    await seg(page, 'make', 'model').click();
    await expect.poll(async () => (await view(page)).clicker).toBeNull();
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    // to 0.1 mm: orbit damping leaves tiny float noise
    const r1 = (v: Vec3) => v.map((n) => Math.round(n * 10) / 10);
    await expect.poll(async () => r1((await view(page)).camera)).toEqual(r1(flat.camera));
    const back = await view(page);
    expect(back.size).toEqual(flat.size);
    expect(back.handles.length).toBe(1);
    await expect(page.locator('aside.right section.off')).toHaveCount(0);
    // undo goes back to the clicker, a second undo to the flat model; redo returns the clicker
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await clicker(page))?.view ?? null).toBe('assembled');
    await expect(page.locator('aside.right section.off')).toHaveCount(5);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await view(page)).clicker).toBeNull();
    await expect.poll(async () => (await view(page)).shown).toBe('model');
    expect((await view(page)).size).toEqual(flat.size);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await clicker(page))?.view ?? null).toBe('assembled');
    expect((await settings(page)).make).toBe('clicker');
  });

  test('the fit-test export is offered and downloads one STL per coupon', async ({ page }) => {
    await page.goto('/?test');
    await seg(page, 'make', 'clicker').click();
    const btn = page.locator('#fitTest');
    await expect(btn).toHaveText('Download fit test');
    const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
    expect(dl.suggestedFilename()).toBe('pixel3d_fit_test.zip');
    const files = unzipSync(new Uint8Array(readFileSync(await dl.path())));
    expect(Object.keys(files).sort()).toEqual(['fit_test_socket_+0.00.stl', 'fit_test_socket_+0.10.stl', 'fit_test_socket_-0.10.stl', 'fit_test_stem.stl']);
    for (const f of Object.values(files)) expect(new DataView(f.buffer, f.byteOffset).getUint32(80, true)).toBeGreaterThan(12);
  });
});

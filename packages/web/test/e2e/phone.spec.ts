import { test as base, expect, type Page } from '@playwright/test';

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

interface Snap { grid: { w: number; h: number } | null; settings: { colors: { max: number } } }
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: { snapshot(): Snap } }).__pixel3d.snapshot());

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('a phone gets the sketchpad on a new 32 x 32 canvas with 8 colors', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.locator('.left')).toHaveCount(0);
    await expect(page.locator('.right')).toHaveCount(0);
    await expect(page.locator('#phSrc')).toBeVisible();
    const s = await snap(page);
    expect(s.grid).toMatchObject({ w: 32, h: 32 });
    expect(s.settings.colors.max).toBe(8);
  });

  test('the tabs switch between drawing and the 3D view', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#tab3d').click();
    const box = await page.locator('#view').boundingBox();
    expect(box!.width).toBeGreaterThan(380);
    expect(box!.height).toBeGreaterThan(600);
    await expect(page.locator('#phSrc')).toBeHidden();
    await page.locator('#tabDraw').click();
    await expect(page.locator('#phSrc')).toBeVisible();
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('a big window keeps the PC layout', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#phone')).toHaveCount(0);
    await expect(page.locator('.left')).toBeVisible();
  });
});

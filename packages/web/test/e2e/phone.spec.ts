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

interface Snap { grid: { w: number; h: number; opaque: number } | null; settings: { colors: { max: number } } }
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

  test('Save PNG downloads the drawing at one pixel per cell, empty cells transparent', async ({ page }) => {
    await page.goto('/?test');
    await page.evaluate(() => (window as unknown as { __pixel3d: { setTool(t: string, hex: string): void } }).__pixel3d.setTool('paint', '#ff0000'));
    const b = (await page.locator('#phSrc').boundingBox())!;
    const g = (await snap(page)).grid!;
    const c = b.width / Math.max(g.w, g.h);
    const at = (i: number, j: number) => ({ x: b.x + (b.width - g.w * c) / 2 + (i + 0.5) * c, y: b.y + (b.height - g.h * c) / 2 + (j + 0.5) * c });
    for (const [i, j] of [[3, 4], [5, 4]] as const) { const p = at(i, j); await page.mouse.click(p.x, p.y); }
    await expect.poll(async () => (await snap(page)).grid!.opaque).toBe(2);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#savePng').click()]);
    expect(dl.suggestedFilename()).toBe('pixel-art.png');
    const bytes = (await dl.createReadStream().then((s) => new Promise<Buffer>((res) => { const a: Buffer[] = []; s.on('data', (d) => a.push(d)); s.on('end', () => res(Buffer.concat(a))); }))).toString('base64');
    const px = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
      return { w: img.width, h: img.height, painted: d(3, 4), painted2: d(5, 4), empty: d(4, 4) };
    }, bytes);
    expect([px.w, px.h]).toEqual([g.w, g.h]);
    expect(px.painted).toEqual([255, 0, 0, 255]);
    expect(px.painted2).toEqual([255, 0, 0, 255]);
    expect(px.empty[3]).toBe(0);
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

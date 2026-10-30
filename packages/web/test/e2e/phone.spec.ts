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

interface Snap { grid: { w: number; h: number; opaque: number; palette: { hex: string }[] } | null; settings: { colors: { max: number } }; undo: number; zoom: number }
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: { snapshot(): Snap } }).__pixel3d.snapshot());

type Hook = { setTool(t: string, hex: string): void };
/** Choose the brush color (the color slots come later); the tool buttons then pick the tool. */
const color = (page: Page, hex: string) => page.evaluate((h) => (window as unknown as { __pixel3d: Hook }).__pixel3d.setTool('select', h), hex);

/** Page position of the middle of grid cell (i, j) on #phSrc, unzoomed. */
async function cell(page: Page, i: number, j: number) {
  const b = (await page.locator('#phSrc').boundingBox())!;
  const g = (await snap(page)).grid!;
  const c = b.width / Math.max(g.w, g.h);
  return { x: b.x + (b.width - g.w * c) / 2 + (i + 0.5) * c, y: b.y + (b.height - g.h * c) / 2 + (j + 0.5) * c };
}
async function tap(page: Page, i: number, j: number) {
  const p = await cell(page, i, j);
  await page.mouse.click(p.x, p.y);
}
/** The canvas pixel (RGBA) under cell (i, j). */
async function pixelAt(page: Page, i: number, j: number) {
  const p = await cell(page, i, j);
  const b = (await page.locator('#phSrc').boundingBox())!;
  return page.evaluate(({ x, y }) => {
    const cv = document.getElementById('phSrc') as HTMLCanvasElement;
    return [...cv.getContext('2d')!.getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data];
  }, { x: p.x - b.x, y: p.y - b.y });
}
const opaque = async (page: Page) => (await snap(page)).grid!.opaque;

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Paint paints a tapped cell and Erase clears it', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tap(page, 5, 5);
    expect(await opaque(page)).toBe(1);
    await page.locator('#phTool-erase').click();
    await tap(page, 5, 5);
    expect(await opaque(page)).toBe(0);
  });

  test('Pick takes the color of the tapped cell', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tap(page, 2, 2);
    await color(page, '#0000ff');
    await page.locator('#phTool-paint').click();
    await tap(page, 4, 2);
    await page.locator('#phTool-pick').click();
    await tap(page, 2, 2);
    await page.locator('#phTool-paint').click();
    await tap(page, 6, 2);
    expect((await pixelAt(page, 6, 2)).slice(0, 3)).toEqual([255, 0, 0]);
  });

  test('Undo reverts the last stroke and is disabled when there is nothing to undo', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tap(page, 5, 5);
    await expect(page.locator('#phUndo')).toBeEnabled();
    await page.locator('#phUndo').click();
    expect(await opaque(page)).toBe(0);
    while ((await snap(page)).undo > 0) await page.locator('#phUndo').click();
    await expect(page.locator('#phUndo')).toBeDisabled();
  });

  test('the brush popup paints 3 x 3 and closes after choosing', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await expect(page.locator('#phBrush')).toContainText('1×1');
    await page.locator('#phBrush').click();
    await expect(page.locator('#phBrushPop')).toBeVisible();
    await expect(page.locator('#phBrushPop [data-brush]')).toHaveCount(4);
    await page.locator('#phBrushPop [data-brush="3"]').click();
    await expect(page.locator('#phBrushPop')).toHaveCount(0);
    await expect(page.locator('#phBrush')).toContainText('3×3');
    await tap(page, 10, 10);
    expect(await opaque(page)).toBe(9);
  });

  test('a tap outside a popup closes it', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#phBrush').click();
    await page.mouse.click(195, 100);
    await expect(page.locator('#phBrushPop')).toHaveCount(0);
    await page.locator('#phGear').click();
    await expect(page.locator('#phSettings')).toBeVisible();
    await page.mouse.click(5, 300);
    await expect(page.locator('#phSettings')).toHaveCount(0);
  });

  test('Settings: canvas size keeps the top-left of the drawing; the size boxes resize', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tap(page, 3, 3);
    await tap(page, 20, 20);
    await page.locator('#phGear').click();
    await page.locator('#phSize [data-size="16"]').click();
    let g = (await snap(page)).grid!;
    expect([g.w, g.h, g.opaque]).toEqual([16, 16, 1]);
    await page.locator('#phW').fill('24');
    await page.locator('#phH').fill('8');
    await page.locator('#phResize').click();
    g = (await snap(page)).grid!;
    expect([g.w, g.h, g.opaque]).toEqual([24, 8, 1]);
    await page.locator('#phDone').click();
    await expect(page.locator('#phSettings')).toHaveCount(0);
  });

  test('Settings: Most colors stops at the colors in use and at 16', async ({ page }) => {
    await page.goto('/?test');
    for (const [i, hex] of ['#ff0000', '#00ff00', '#0000ff'].entries()) {
      await color(page, hex);
      await page.locator('#phTool-paint').click();
      await tap(page, i + 2, 2);
    }
    await page.locator('#phGear').click();
    await expect(page.locator('#phColors')).toHaveText('8');
    for (let k = 0; k < 8; k++) await page.locator('#phColorsMinus').click({ force: true });
    await expect(page.locator('#phColors')).toHaveText('3');
    expect((await snap(page)).settings.colors.max).toBe(3);
    await expect(page.locator('#phColorsMinus')).toBeDisabled();
    for (let k = 0; k < 16; k++) await page.locator('#phColorsPlus').click({ force: true });
    await expect(page.locator('#phColors')).toHaveText('16');
    await expect(page.locator('#phColorsPlus')).toBeDisabled();
  });

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

test.describe('phone colors', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  const palette = async (page: Page) => (await snap(page)).grid!.palette.map((p) => p.hex);
  const filled = (page: Page) => page.locator('#phSlots .slot:not(.empty)');
  /** Choose the brush color with the test hook, switch to Paint and tap a cell. */
  async function paintAt(page: Page, hex: string, i: number, j: number) {
    await color(page, hex);
    await page.locator('#phTool-paint').click();
    await tap(page, i, j);
  }
  /** Drag over #phSquare / #phHue from one fraction of its box to another (fractions outside 0..1 leave the box). */
  async function drag(page: Page, id: string, from: [number, number], to: [number, number]) {
    const b = (await page.locator(id).boundingBox())!;
    const pt = ([fx, fy]: [number, number]) => [b.x + b.width * fx, b.y + b.height * fy] as const;
    await page.mouse.move(...pt(from));
    await page.mouse.down();
    await page.mouse.move(...pt([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), { steps: 3 });
    await page.mouse.move(...pt(to), { steps: 3 });
    await page.mouse.up();
  }

  test('one slot per allowed color: filled ones show the palette, the rest are empty', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#phSlots .slot')).toHaveCount(8);
    await expect(filled(page)).toHaveCount(0);
    await paintAt(page, '#ff0000', 2, 2);
    await expect(filled(page)).toHaveCount(1);
    await expect(page.locator('#phSlots .slot.empty')).toHaveCount(7);
    await expect(filled(page).first()).toHaveAttribute('data-c', '#ff0000');
  });

  test('tapping a filled slot makes it the brush color and switches to Paint', async ({ page }) => {
    await page.goto('/?test');
    await paintAt(page, '#ff0000', 2, 2);
    await paintAt(page, '#0000ff', 4, 2);
    await page.locator('#phTool-erase').click();
    await filled(page).first().tap();
    await expect(filled(page).first()).toHaveClass(/cur/);
    await expect(page.locator('#phTool-paint')).toHaveClass(/on/);
    await tap(page, 6, 2);
    expect((await pixelAt(page, 6, 2)).slice(0, 3)).toEqual([255, 0, 0]);
  });

  test('dragging the square recolors every pixel of the color as one undo step', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    for (const i of [2, 4, 6]) await tap(page, i, 2);
    const undo0 = (await snap(page)).undo;
    await drag(page, '#phSquare', [0.5, 0.5], [-0.5, -0.5]);
    expect(await palette(page)).toEqual(['#ffffff']);
    expect(await opaque(page)).toBe(3);
    expect((await pixelAt(page, 4, 2)).slice(0, 3)).toEqual([255, 255, 255]);
    expect((await snap(page)).undo).toBe(undo0 + 1);
    await page.locator('#phUndo').click();
    expect(await palette(page)).toEqual(['#ff0000']);
  });

  test('the hue strip changes the hue and keeps saturation and brightness', async ({ page }) => {
    await page.goto('/?test');
    await paintAt(page, '#ff0000', 2, 2);
    await drag(page, '#phHue', [0.05, 0.5], [1 / 3, 0.5]);
    expect(await palette(page)).toEqual(['#00ff00']);
    await expect(page.locator('#phPatch')).toHaveCSS('background-color', 'rgb(0, 255, 0)');
  });

  test('an empty slot makes a new color: it joins the image when a pixel is painted with it', async ({ page }) => {
    await page.goto('/?test');
    await paintAt(page, '#ff0000', 2, 2);
    await page.locator('#phSlots .slot.empty').first().tap();
    await drag(page, '#phSquare', [0.5, 0.5], [-0.5, -0.5]);
    expect(await palette(page)).toEqual(['#ff0000']);
    await tap(page, 4, 2);
    expect(await palette(page)).toEqual(['#ff0000', '#ffffff']);
    await expect(filled(page)).toHaveCount(2);
  });

  test('tapping an empty slot and not painting adds nothing', async ({ page }) => {
    await page.goto('/?test');
    await paintAt(page, '#ff0000', 2, 2);
    await page.locator('#phSlots .slot.empty').first().tap();
    await drag(page, '#phSquare', [0.5, 0.5], [0.8, 0.3]);
    expect(await palette(page)).toEqual(['#ff0000']);
    await expect(filled(page)).toHaveCount(1);
  });

  test('a new color past the Most colors limit is refused with a visible message', async ({ page }) => {
    await page.goto('/?test');
    for (const [i, hex] of ['#ff0000', '#00ff00', '#0000ff'].entries()) await paintAt(page, hex, i + 2, 2);
    await page.locator('#phGear').click();
    for (let k = 0; k < 8; k++) await page.locator('#phColorsMinus').click({ force: true });
    await page.locator('#phDone').click();
    await paintAt(page, '#ffff00', 8, 2);
    expect(await palette(page)).toHaveLength(3);
    const note = page.getByRole('status').filter({ hasText: 'An image holds at most 3 colors.' });
    await expect(note).toBeVisible();
    const b = (await note.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    expect(b.y + b.height).toBeLessThanOrEqual(844);
  });

  test('a color with no pixels left leaves its slot', async ({ page }) => {
    await page.goto('/?test');
    await paintAt(page, '#ff0000', 2, 2);
    await paintAt(page, '#0000ff', 4, 2);
    await expect(filled(page)).toHaveCount(2);
    await page.locator('#phTool-erase').click();
    await tap(page, 2, 2);
    expect(await palette(page)).toEqual(['#0000ff']);
    await expect(filled(page)).toHaveCount(1);
    await expect(page.locator('#phSlots .slot.empty')).toHaveCount(7);
  });
});

test.describe('phone gestures', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  type Pt = { x: number; y: number };
  /** Real multi-touch through the DevTools protocol: each call lists every finger still down, the touch id is its index
   * unless given. */
  async function fingers(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    return (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: (Pt & { id?: number })[] = []) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, k) => ({ x: p.x, y: p.y, id: p.id ?? k })) });
  }
  /** Move the fingers from `from` to `to` in a few steps. */
  async function slide(touch: Awaited<ReturnType<typeof fingers>>, from: Pt[], to: Pt[], steps = 6) {
    for (let s = 1; s <= steps; s++) await touch('touchMove', from.map((p, k) => ({ x: p.x + ((to[k]!.x - p.x) * s) / steps, y: p.y + ((to[k]!.y - p.y) * s) / steps })));
  }
  const red = async (page: Page, i: number, j: number) => (await pixelAt(page, i, j)).slice(0, 3).join() === '255,0,0';

  test('one finger with Paint paints a line of cells and never zooms or pans', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const touch = await fingers(page);
    const a = await cell(page, 2, 10), b = await cell(page, 12, 10);
    await touch('touchStart', [a]);
    await slide(touch, [a], [b]);
    await touch('touchEnd');
    expect(await opaque(page)).toBe(11);
    expect((await snap(page)).zoom).toBe(1);
    expect(await red(page, 2, 10)).toBe(true);
    expect(await red(page, 12, 10)).toBe(true);
    expect(await red(page, 13, 10)).toBe(false);
  });

  test('a one-finger tap paints one cell', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const touch = await fingers(page);
    await touch('touchStart', [await cell(page, 5, 5)]);
    await touch('touchEnd');
    expect(await opaque(page)).toBe(1);
  });

  test('a one-finger tap with Pick takes the color', async ({ page }) => {
    await page.goto('/?test');
    const touch = await fingers(page);
    const tapAt = async (i: number, j: number) => { await touch('touchStart', [await cell(page, i, j)]); await touch('touchEnd'); };
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tapAt(2, 2);
    await color(page, '#0000ff');
    await page.locator('#phTool-paint').click();
    await tapAt(4, 2);
    await page.locator('#phTool-pick').click();
    await tapAt(2, 2);
    await page.locator('#phTool-paint').click();
    await tapAt(6, 2);
    expect(await red(page, 6, 2)).toBe(true);
  });

  test('a two-finger spread zooms in and paints nothing', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const undo0 = (await snap(page)).undo;
    const touch = await fingers(page);
    const from = [await cell(page, 14, 16), await cell(page, 18, 16)], to = [await cell(page, 8, 16), await cell(page, 24, 16)];
    await touch('touchStart', from);
    await slide(touch, from, to);
    await touch('touchEnd');
    const s = await snap(page);
    expect(s.zoom).toBeGreaterThan(1);
    expect(s.grid!.opaque).toBe(0);
    expect(s.undo).toBe(undo0);
  });

  test('a second finger mid-stroke keeps the cells so far, paints no more and only then moves the canvas', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const undo0 = (await snap(page)).undo;
    const touch = await fingers(page);
    const a = await cell(page, 2, 10), b = await cell(page, 6, 10), c = await cell(page, 20, 20);
    await touch('touchStart', [a]);
    await slide(touch, [a], [b]);
    // pointer moves are delivered with the next frame
    await expect.poll(() => opaque(page)).toBe(5);
    await touch('touchStart', [b, c]);
    // the second finger is down but has not moved: same cells, same place
    expect(await opaque(page)).toBe(5);
    expect((await snap(page)).zoom).toBe(1);
    expect(await red(page, 4, 10)).toBe(true);
    expect(await red(page, 7, 10)).toBe(false);
    // the first finger keeps going, away from the second: that is now a pinch (zoom in), not paint
    await slide(touch, [b, c], [await cell(page, 1, 4), c]);
    await expect.poll(async () => (await snap(page)).zoom).toBeGreaterThan(1);
    await touch('touchEnd');
    const s = await snap(page);
    expect(s.grid!.opaque).toBe(5);
    expect(s.undo).toBe(undo0 + 1);
  });

  test('the finger left after a pinch neither paints nor moves the canvas', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const touch = await fingers(page);
    const from = [await cell(page, 14, 16), await cell(page, 18, 16)], to = [await cell(page, 10, 16), await cell(page, 22, 16)];
    await touch('touchStart', from);
    await slide(touch, from, to);
    // the fingers went from 4 cells apart to 12
    await expect.poll(async () => (await snap(page)).zoom).toBeCloseTo(3);
    const zoom = (await snap(page)).zoom, before = await pixelAt(page, 4, 4);
    // lift the second finger, then drag the first
    await touch('touchEnd', [{ ...to[1]!, id: 1 }]);
    await slide(touch, [to[0]!], [await cell(page, 4, 4)]);
    await page.waitForTimeout(200);
    expect(await opaque(page)).toBe(0);
    expect((await snap(page)).zoom).toBe(zoom);
    expect(await pixelAt(page, 4, 4)).toEqual(before);
    await touch('touchEnd');
    expect(await opaque(page)).toBe(0);
  });

  test('pinching back to zoom 1 puts the canvas back where it was', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const touch = await fingers(page);
    await touch('touchStart', [await cell(page, 5, 5)]);
    await touch('touchEnd');
    // spread off-centre, so the zoom also pans
    const from = [await cell(page, 4, 24), await cell(page, 8, 24)], wide = [await cell(page, 0, 20), await cell(page, 14, 28)];
    await touch('touchStart', from);
    await slide(touch, from, wide);
    await expect.poll(async () => (await snap(page)).zoom).toBeGreaterThan(1);
    await expect.poll(() => red(page, 5, 5)).toBe(false);
    const near = [await cell(page, 6, 24), await cell(page, 7, 24)];
    await slide(touch, wide, near);
    await touch('touchEnd');
    expect((await snap(page)).zoom).toBe(1);
    expect(await red(page, 5, 5)).toBe(true);
    expect(await red(page, 6, 5)).toBe(false);
    expect(await opaque(page)).toBe(1);
  });
});

test.describe('phone landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });

  test('the Draw tab fits: the canvas and the tool row are inside the screen', async ({ page }) => {
    await page.goto('/?test');
    for (const sel of ['#phSrc', '#phTool-paint', '#phBrush']) {
      const b = (await page.locator(sel).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(844);
      expect(b.y + b.height).toBeLessThanOrEqual(390);
    }
    const c = (await page.locator('#phSrc').boundingBox())!;
    expect(c.width).toBeGreaterThan(200);
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

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

interface Snap { name: string | null; edits: number; grid: { w: number; h: number; opaque: number; palette: { hex: string }[] } | null; settings: { colors: { max: number } }; undo: number; redo: number; zoom: number; tool: string }
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: { snapshot(): Snap } }).__pixel3d.snapshot());

type Hook = { setTool(t: string, hex: string): void };
/** Choose the brush color (the color slots come later); the tool buttons then pick the tool. */
const color = (page: Page, hex: string) => page.evaluate((h) => (window as unknown as { __pixel3d: Hook }).__pixel3d.setTool('select', h), hex);

/** Page position of the middle of grid cell (i, j) on #phSrc (or another source canvas), unzoomed. */
async function cell(page: Page, i: number, j: number, canvas = '#phSrc') {
  const b = (await page.locator(canvas).boundingBox())!;
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

type Pt = { x: number; y: number };
/** Real multi-touch through the DevTools protocol: each call lists every finger still down, the touch id is its index
 * unless given. */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', pts: (Pt & { id?: number })[] = []) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, k) => ({ x: p.x, y: p.y, id: p.id ?? k })) });
}
/** Move the fingers from `from` to `to` in a few steps. */
async function slide(touch: Awaited<ReturnType<typeof fingers>>, from: Pt[], to: Pt[], steps = 6) {
  for (let s = 1; s <= steps; s++) await touch('touchMove', from.map((p, k) => ({ x: p.x + ((to[k]!.x - p.x) * s) / steps, y: p.y + ((to[k]!.y - p.y) * s) / steps })));
}

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
    // undoing everything never undoes the canvas itself
    expect((await snap(page)).grid).toMatchObject({ w: 32, h: 32 });
  });

  test('a fresh canvas has nothing to undo', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#phSrc')).toBeVisible();
    const s = await snap(page);
    expect([s.undo, s.redo]).toEqual([0, 0]);
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
    // the cell inside the new size stays where it was; the one outside is gone
    expect((await pixelAt(page, 3, 3)).slice(0, 3)).toEqual([255, 0, 0]);
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

  type View = { shown: string; renders: number; camera: [number, number, number] };
  const view = (page: Page) => page.evaluate(() => (window as unknown as { __pixel3d: { viewport(): View } }).__pixel3d.viewport());
  const dist = (c: View['camera']) => Math.hypot(c[0], c[1], c[2]);
  const orbitMoved = (a: View['camera'], b: View['camera']) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** Paint a few cells on Draw, then open the 3D tab. */
  async function open3d(page: Page) {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    for (const i of [4, 5, 6, 7]) await tap(page, i, 8);
    await page.locator('#tab3d').click();
    await expect.poll(async () => (await view(page)).shown).toBe('model');
  }

  test('the 3D tab fills the screen and shows only the model', async ({ page }) => {
    await open3d(page);
    const b = (await page.locator('#view').boundingBox())!;
    const m = (await page.locator('#phMain').boundingBox())!;
    expect([b.x, b.y, b.width, b.height]).toEqual([m.x, m.y, m.width, m.height]);
    expect(b.width).toBe(390);
    for (const id of ['resetView', 'gridBtn', 'xrayBtn', 'cutBtn', 'gridPop', 'xrayPop', 'resizer', 'note', 'mode', 'dims', 'gridScale']) await expect(page.locator('#' + id)).toBeHidden();
  });

  test('3D tab: one finger orbits the model', async ({ page }) => {
    await open3d(page);
    const touch = await fingers(page);
    const before = (await view(page)).camera;
    const a = { x: 195, y: 400 }, b = { x: 125, y: 440 };
    await touch('touchStart', [a]);
    await slide(touch, [a], [b]);
    await touch('touchEnd');
    await expect.poll(async () => orbitMoved(before, (await view(page)).camera)).toBeGreaterThan(5);
    // an orbit turns the camera around the model: the distance stays
    expect(dist((await view(page)).camera)).toBeCloseTo(dist(before), 0);
  });

  test('3D tab: a two-finger pinch zooms', async ({ page }) => {
    await open3d(page);
    const touch = await fingers(page);
    const d0 = dist((await view(page)).camera);
    const from = [{ x: 175, y: 400 }, { x: 215, y: 400 }], to = [{ x: 75, y: 400 }, { x: 315, y: 400 }];
    await touch('touchStart', from);
    await slide(touch, from, to);
    await touch('touchEnd');
    await expect.poll(async () => dist((await view(page)).camera)).toBeLessThan(d0 * 0.8);
  });

  test('back on Draw the drawing and its zoom are kept and painting works', async ({ page }) => {
    await open3d(page);
    await page.locator('#tabDraw').click();
    expect(await opaque(page)).toBe(4);
    const touch = await fingers(page);
    const from = [await cell(page, 14, 16), await cell(page, 18, 16)], to = [await cell(page, 8, 16), await cell(page, 24, 16)];
    await touch('touchStart', from);
    await slide(touch, from, to);
    await touch('touchEnd');
    const zoom = (await snap(page)).zoom;
    expect(zoom).toBeGreaterThan(1);
    await page.locator('#tab3d').click();
    await page.locator('#tabDraw').click();
    expect((await snap(page)).zoom).toBe(zoom);
    await touch('touchStart', [await cell(page, 14, 16)]);
    await touch('touchEnd');
    expect(await opaque(page)).toBe(5);
  });

  test('the hidden 3D view stops rendering on Draw and catches up when shown', async ({ page }) => {
    await open3d(page);
    await page.locator('#tabDraw').click();
    await page.waitForTimeout(300);
    const r0 = (await view(page)).renders;
    await tap(page, 10, 10);
    await page.waitForTimeout(500);
    expect((await view(page)).renders).toBe(r0);
    await page.locator('#tab3d').click();
    await expect.poll(async () => (await view(page)).renders).toBeGreaterThan(r0);
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

test.describe('phone resize', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  async function drawTwo(page: Page) {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tap(page, 3, 3);
    await tap(page, 5, 3);
  }

  test('rotating to landscape keeps the sketchpad and the drawing', async ({ page }) => {
    await drawTwo(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.locator('#phSrc')).toBeVisible();
    expect(await opaque(page)).toBe(2);
  });

  test('mid-drawing rotation keeps the undo history', async ({ page }) => {
    await drawTwo(page);
    const undo0 = (await snap(page)).undo;
    await page.setViewportSize({ width: 844, height: 390 });
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await snap(page)).undo).toBe(undo0);
    await page.locator('#phUndo').click();
    expect(await opaque(page)).toBe(1);
  });

  test('a big window shows the PC layout with the drawing; back to a phone returns the sketchpad without a second canvas', async ({ page }) => {
    await drawTwo(page);
    const before = await snap(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.locator('#phone')).toHaveCount(0);
    await expect(page.locator('.left')).toBeVisible();
    const pc = await snap(page);
    expect(pc.grid).toEqual(before.grid);
    expect(pc.name).toBe(before.name);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#phone')).toBeVisible();
    const back = await snap(page);
    expect(back.grid).toEqual(before.grid);
    expect(back.undo).toBe(before.undo);
    expect(back.edits).toEqual(before.edits);
    await page.locator('#phUndo').click();
    expect(await opaque(page)).toBe(1);
  });

  test('the 3D tab frames the model the first time it opens', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    // a full-size drawing: two strokes that span the whole 32 x 32 canvas
    for (const [a, b] of [[[0, 0], [31, 0]], [[0, 0], [0, 31]]] as const) {
      const p = await cell(page, a[0], a[1]), q = await cell(page, b[0], b[1]);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(q.x, q.y, { steps: 12 });
      await page.mouse.up();
    }
    await page.locator('#tab3d').click();
    type V = { shown: string; ndc: { min: number[]; max: number[] } };
    const view = () => page.evaluate(() => (window as unknown as { __pixel3d: { viewport(): V } }).__pixel3d.viewport());
    await expect.poll(async () => (await view()).shown).toBe('model');
    const n = (await view()).ndc;
    expect(n.min[0]).toBeGreaterThanOrEqual(-1);
    expect(n.min[1]).toBeGreaterThanOrEqual(-1);
    expect(n.max[0]).toBeLessThanOrEqual(1);
    expect(n.max[1]).toBeLessThanOrEqual(1);
    // fills a reasonable part of the screen's width
    expect(n.max[0]! - n.min[0]!).toBeGreaterThan(0.3);
  });
});

test.describe('phone state', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  /** Drop or paste the fixture image on the page. */
  async function give(page: Page, how: 'drop' | 'paste') {
    await page.evaluate(({ bytes, how }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'potion.png', { type: 'image/png' }));
      if (how === 'paste') document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      else for (const t of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { bytes: [...fixture('potion.png')], how });
  }

  test('the phone starts in Paint: a first one-finger drag draws and does not move the canvas', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#phSrc')).toBeVisible();
    expect((await snap(page)).tool).toBe('paint');
    const touch = await fingers(page);
    const a = await cell(page, 2, 10), b = await cell(page, 12, 10);
    await touch('touchStart', [a]);
    await slide(touch, [a], [b]);
    await touch('touchEnd');
    expect(await opaque(page)).toBe(11);
    expect((await snap(page)).zoom).toBe(1);
    // unpanned: the painted cells are drawn where the unzoomed layout puts them
    expect((await pixelAt(page, 2, 10))[3]).toBe(255);
    expect((await pixelAt(page, 12, 10))[3]).toBe(255);
    expect((await pixelAt(page, 13, 10))[3]).not.toBe(255);
  });

  test('a phone never builds the PC layout first', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { sawPc: boolean };
      w.sawPc = false;
      new MutationObserver(() => { if (document.querySelector('aside.left, aside.right')) w.sawPc = true; })
        .observe(document, { childList: true, subtree: true });
    });
    await page.goto('/?test');
    await expect(page.locator('#phSrc')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { sawPc: boolean }).sawPc)).toBe(false);
  });

  test('phone to PC goes back to the viewer: Select, and a click on the viewer canvas paints nothing', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tap(page, 3, 3);
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.locator('.left')).toBeVisible();
    expect((await snap(page)).tool).toBe('select');
    const p = await cell(page, 10, 10, '#src');
    await page.mouse.click(p.x, p.y);
    expect(await opaque(page)).toBe(1);
  });

  test('PC with the Pixel Editor open, then a phone: the editor closes and Paint is on', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/?test');
    await page.locator('#editPixels').click();
    await expect(page.locator('#editor')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.locator('#editor')).toBeHidden();
    expect(await page.locator('#editor').evaluate((d: HTMLDialogElement) => d.open)).toBe(false);
    expect((await snap(page)).tool).toBe('paint');
  });

  for (const how of ['drop', 'paste'] as const) {
    test(`a ${how === 'drop' ? 'dropped' : 'pasted'} image on a phone leaves the drawing alone`, async ({ page }) => {
      await page.goto('/?test');
      await color(page, '#ff0000');
      await page.locator('#phTool-paint').click();
      await tap(page, 3, 3);
      const before = await snap(page);
      await give(page, how);
      await page.waitForTimeout(800);
      const after = await snap(page);
      expect(after.name).toBe(before.name);
      expect(after.grid).toEqual(before.grid);
      await expect(page.locator('.dropzone')).toBeHidden();
    });
  }

  test('a photo loaded on a PC: the phone Settings offer no canvas size', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/?test');
    await page.locator('#fileIn').setInputFiles({ name: 'potion.png', mimeType: 'image/png', buffer: fixture('potion.png') });
    await expect(page.locator('#fileInfo')).toContainText('potion.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#phGear').click();
    for (const n of [16, 32, 48, 64]) await expect(page.locator(`#phSize [data-size="${n}"]`)).toBeDisabled();
    for (const id of ['#phW', '#phH', '#phResize']) await expect(page.locator(id)).toBeDisabled();
  });

  test('after Pick on Draw, the 3D tab shows every color normally', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tap(page, 3, 3);
    await color(page, '#0000ff');
    await page.locator('#phTool-paint').click();
    await tap(page, 4, 3);
    await page.locator('#phTool-pick').click();
    await tap(page, 3, 3);
    await page.locator('#tab3d').click();
    type V = { shown: string; highlight: { hex: string | null; dim: number } };
    const view = () => page.evaluate(() => (window as unknown as { __pixel3d: { viewport(): V } }).__pixel3d.viewport());
    await expect.poll(async () => (await view()).shown).toBe('model');
    const h = (await view()).highlight;
    expect(h.hex).toBeNull();
    expect(h.dim).toBe(0);
  });

  test('a cancelled touch paints nothing', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const touch = await fingers(page);
    await touch('touchStart', [await cell(page, 5, 5)]);
    await touch('touchCancel');
    await page.waitForTimeout(300);
    expect(await opaque(page)).toBe(0);
    expect((await snap(page)).undo).toBe(0);
  });

  test('two quick taps while zoomed in paint two cells and keep the zoom', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const b = (await page.locator('#phSrc').boundingBox())!;
    // zoom about the canvas centre, which keeps the pan at 0
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await snap(page)).zoom).toBeGreaterThan(1.5);
    const z = (await snap(page)).zoom, c = (b.width / 32) * z;
    // either side of the line between cells 16 and 17 of row 16: close enough for the browser to see a double tap
    const edge = b.x + b.width / 2 + c, y = b.y + b.height / 2 + c / 2;
    const touch = await fingers(page);
    await touch('touchStart', [{ x: edge - 2, y }]);
    await touch('touchEnd');
    await touch('touchStart', [{ x: edge + 2, y }]);
    await touch('touchEnd');
    await page.waitForTimeout(300);
    expect(await opaque(page)).toBe(2);
    expect((await snap(page)).zoom).toBe(z);
  });

  test('Resize ignores an empty size box and shows the real size afterwards', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#phGear').click();
    await page.locator('#phW').fill('');
    await page.locator('#phResize').click();
    expect((await snap(page)).grid).toMatchObject({ w: 32, h: 32 });
    await expect(page.locator('#phW')).toHaveValue('32');
    await page.locator('#phW').fill('500');
    await page.locator('#phResize').click();
    expect((await snap(page)).grid).toMatchObject({ w: 128, h: 32 });
    await expect(page.locator('#phW')).toHaveValue('128');
  });

  test('growing the canvas keeps the drawing at the same cells', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await page.locator('#phGear').click();
    await page.locator('#phSize [data-size="16"]').click();
    await page.locator('#phDone').click();
    await tap(page, 3, 3);
    await tap(page, 15, 15);
    await page.locator('#phGear').click();
    await page.locator('#phW').fill('24');
    await page.locator('#phH').fill('24');
    await page.locator('#phResize').click();
    await page.locator('#phDone').click();
    const g = (await snap(page)).grid!;
    expect([g.w, g.h, g.opaque]).toEqual([24, 24, 2]);
    for (const [i, j] of [[3, 3], [15, 15]] as const) expect((await pixelAt(page, i, j)).slice(0, 3)).toEqual([255, 0, 0]);
    expect((await pixelAt(page, 20, 20))[3]).not.toBe(255);
  });

  test('a second finger on the color square mid-drag adds no second undo step', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    await tap(page, 3, 3);
    const undo0 = (await snap(page)).undo;
    const sq = (await page.locator('#phSquare').boundingBox())!;
    const p = (fx: number, fy: number) => ({ x: sq.x + sq.width * fx, y: sq.y + sq.height * fy });
    const touch = await fingers(page);
    await touch('touchStart', [p(0.5, 0.5)]);
    await slide(touch, [p(0.5, 0.5)], [p(0.3, 0.3)]);
    await touch('touchStart', [p(0.3, 0.3), p(0.8, 0.8)]);
    await slide(touch, [p(0.3, 0.3), p(0.8, 0.8)], [p(0.2, 0.2), p(0.9, 0.6)]);
    await touch('touchEnd');
    await page.waitForTimeout(100);
    expect((await snap(page)).undo).toBe(undo0 + 1);
  });
});

test.describe('phone top bar', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Save PNG is a styled button you can read', async ({ page }) => {
    await page.goto('/?test');
    const css = await page.locator('#savePng').evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, fg: c.color }; });
    const lum = (c: string) => { const [r, g, b] = c.match(/\d+/g)!.map((v) => { const x = +v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
    const [hi, lo] = [lum(css.bg), lum(css.fg)].sort((x, y) => y - x);
    expect((hi! + 0.05) / (lo! + 0.05)).toBeGreaterThan(4.5);
  });

  test('tapping an empty color slot leaves no other slot outlined', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#phTool-paint').click();
    await tap(page, 3, 3);
    await expect(page.locator('#phSlots .slot.cur')).toHaveCount(1);
    await page.locator('#phSlots .slot.empty').first().click();
    await expect(page.locator('#phSlots .slot.cur')).toHaveCount(1);
    await expect(page.locator('#phSlots .slot.empty.cur')).toHaveCount(1);
  });

  test('the Draw / 3D switch is in the top bar, so the canvas has the screen below it', async ({ page }) => {
    await page.goto('/?test');
    const bar = (await page.locator('#phTop').boundingBox())!;
    for (const id of ['#tabDraw', '#tab3d', '#phReset', '#savePng', '#phUndo', '#phGear']) {
      const b = (await page.locator(id).boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(bar.y);
      expect(b.y + b.height).toBeLessThanOrEqual(bar.y + bar.height);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    await expect(page.locator('#phMain ~ #phTabs, #phone > #phTabs')).toHaveCount(0);
    const main = (await page.locator('#phMain').boundingBox())!;
    expect(main.y + main.height).toBeGreaterThan(844 - 2);
    await page.locator('#tab3d').click();
    await expect(page.locator('#phReset')).toBeDisabled();
    await page.locator('#tabDraw').click();
    await expect(page.locator('#phReset')).toBeEnabled();
  });

  test('Reset view puts the canvas back to unzoomed and centred', async ({ page }) => {
    await page.goto('/?test');
    await page.locator('#phTool-paint').click();
    const touch = await fingers(page);
    const from = [await cell(page, 14, 16), await cell(page, 18, 16)], to = [await cell(page, 4, 12), await cell(page, 28, 12)];
    await touch('touchStart', from);
    await slide(touch, from, to);
    await touch('touchEnd');
    await expect.poll(async () => (await snap(page)).zoom).toBeGreaterThan(1);
    await page.locator('#phReset').click();
    expect((await snap(page)).zoom).toBe(1);
    // centred again: the whole 32 x 32 grid fits inside the canvas box
    const box = (await page.locator('#phSrc').boundingBox())!;
    const first = await cell(page, 0, 0), last = await cell(page, 31, 31);
    expect(first.x).toBeGreaterThanOrEqual(box.x);
    expect(last.x).toBeLessThanOrEqual(box.x + box.width);
    expect(first.y).toBeGreaterThanOrEqual(box.y);
    expect(last.y).toBeLessThanOrEqual(box.y + box.height);
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

test.describe('phone fill and autosave', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Fill floods the joined empty region in one undo step, and stops at a wall', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#ff0000');
    await page.locator('#phTool-paint').click();
    const g = (await snap(page)).grid!;
    for (let j = 0; j < g.h; j++) await tap(page, 5, j); // a wall splitting the canvas
    const walled = await opaque(page);
    const before = (await snap(page)).undo;
    await color(page, '#0000ff');
    await page.locator('#phTool-fill').click();
    await tap(page, 2, 2);
    expect(await opaque(page)).toBe(walled + 5 * g.h); // columns 0-4 only
    expect((await snap(page)).undo).toBe(before + 1);
    await page.locator('#phUndo').click();
    expect(await opaque(page)).toBe(walled);
  });

  test('the drawing and its settings come back after a reload', async ({ page }) => {
    await page.goto('/?test');
    await color(page, '#00aa00');
    await page.locator('#phTool-paint').click();
    await tap(page, 3, 4);
    await tap(page, 6, 7);
    await expect.poll(async () => (await snap(page)).grid!.opaque).toBe(2);
    await page.waitForTimeout(600);
    await page.reload();
    await expect.poll(async () => (await snap(page)).grid?.opaque).toBe(2);
    expect((await snap(page)).undo).toBe(0);
  });
});

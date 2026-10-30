# Phone Sketchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-sized screen gets its own layout: draw pixels on a blank canvas, peek at them in 3D, save a PNG.

**Architecture:** `App.svelte` shows a new `PhoneApp.svelte` instead of the PC panels when `ui.phone` is true (a `matchMedia` rule). The phone reuses the PC editor's state and actions (`newCanvas`, `resizeCanvas`, `paintCells`, `recolorLive`, `setBrush`, `undo`) and the existing `SourceCanvas` and `ViewportPane`. New pieces are the phone shell, a color square plus hue strip, touch gestures on the canvas and a PNG writer.

**Tech Stack:** Svelte 5 runes, three.js viewport, vitest (`packages/web/test/*.test.ts`), Playwright e2e (touch, 390 × 844 viewport via `test.use`).

**Spec:** `docs/superpowers/specs/2026-10-30-phone-sketchpad-design.md`

## Global Constraints

- The PC layout must not change: every existing test passes untouched, at 1400 × 900.
- Phone layout rule: `(max-width: 700px), (max-height: 500px)`.
- No hex box, no favorites, no common colors, no Redo on the phone.
- A new phone drawing: 32 × 32, 8 colors. Canvas side 4 to 128, colors 2 to 16 (`CANVAS_MIN`, `CANVAS_MAX`, `PALETTE_MAX`).
- Settings: Most colors cannot go below the colors the drawing already uses.
- Save PNG: one image pixel per cell, empty cells transparent, file `pixel-art.png`.
- One finger draws; two fingers pinch-zoom and move the canvas; drawing never moves the canvas and moving never draws.
- Version bumps to 0.2.61 (`package.json`, `package-lock.json`); commit subjects start `v0.2.61:`.

## Review Focus

- A phone held sideways (short screen) still gets the phone layout, and rotating mid-drawing keeps the drawing.
- A second finger landing mid-stroke must not leave a stray painted pixel or move the canvas while painting.
- Save PNG on an empty drawing: saves a fully transparent image, no crash.
- Lowering Most colors below the colors in use is refused; growing the canvas keeps the drawing top-left.
- Tapping an empty slot, then leaving without painting, adds no color to the image.
- Resizing the window across 700 px swaps layouts without losing the drawing.

---

### Task 1: Phone shell, detection and tabs

**Files:**
- Create: `packages/web/src/phone.ts`, `packages/web/src/phone/PhoneApp.svelte`, `packages/web/test/phone.test.ts`, `packages/web/test/e2e/phone.spec.ts`
- Modify: `packages/web/src/state.svelte.ts` (`ui.phone: boolean`, `ui.tab: 'draw' | '3d'`), `packages/web/src/App.svelte`, `packages/web/src/app.css`

**Interfaces:**
- Produces: `isPhone(width: number, height: number): boolean`; `PHONE_QUERY` string; `ui.phone`, `ui.tab`; `PhoneApp.svelte` with element ids `#phone`, `#tabDraw`, `#tab3d`.

- [x] **Step 1: Tests.** Unit: `isPhone(390, 844)` true, `isPhone(844, 390)` true, `isPhone(701, 501)` false, `isPhone(700, 900)` true. E2E (`test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })`): `/?test` shows `#phone`, hides `.left` and `.right`, snapshot grid is 32 × 32 with 8 colors allowed, `#tab3d` click shows `#view` filling the screen and `#tabDraw` goes back. A second test at 1400 × 900 has no `#phone`.
- [x] **Step 2:** Run both, confirm they fail.
- [x] **Step 3:** `isPhone` and the effect in `App.svelte` setting `ui.phone` from `matchMedia(PHONE_QUERY)` (the parked branch's effect is the model: `git show phone-layout:packages/web/src/App.svelte`). When it turns on and there is no source, call `newCanvas(32, 32, 8)`. `PhoneApp` renders the top bar, the two tab buttons and the active tab; the PC `Header`, panels and `Footer` are not rendered while `ui.phone`.
- [x] **Step 4:** Run tests, confirm pass, plus the full suite.
- [x] **Step 5:** Tick this task's boxes, commit `v0.2.61: phone shell`.

### Task 2: Save PNG

**Files:**
- Create: `packages/web/src/png.ts`, `packages/web/test/png.test.ts`
- Modify: `PhoneApp.svelte` (button `#savePng`), `packages/web/test/e2e/phone.spec.ts`

**Interfaces:**
- Produces: `gridRgba(g: Grid): Uint8ClampedArray` (w·h·4, opaque cells in their palette color, empty cells alpha 0); `savePng(): Promise<void>` downloading `pixel-art.png`.

- [x] **Step 1: Tests.** Unit: a 2 × 1 grid with one `#ff0000` cell and one empty gives `[255,0,0,255, 0,0,0,0]`; an all-empty grid gives all zeros. E2E: paint two cells, click `#savePng`, wait for the download, decode its bytes: width/height equal the canvas, the painted cell is opaque with the right color.
- [x] **Step 2:** Run, confirm fail.
- [x] **Step 3:** `gridRgba` plus `savePng` (draw into a `canvas`, `toBlob('image/png')`, download through an `<a download>` link).
- [x] **Step 4:** Run, confirm pass.
- [x] **Step 5:** Tick, commit `v0.2.61: phone Save PNG`.

### Task 3: Draw tab tools, brush popup and settings popup

**Files:**
- Modify: `PhoneApp.svelte` (or split into `phone/DrawTab.svelte`, `phone/SettingsPopup.svelte`, `phone/BrushPopup.svelte`), `app.css`, `phone.spec.ts`

**Interfaces:**
- Consumes: `newCanvas`, `resizeCanvas`, `setting`, `undo`, `ui.tool`, `ui.brush`, `BRUSHES`, `maxColors`.
- Produces ids: `#phTool-paint|erase|pick`, `#phUndo`, `#phBrush` and `#phBrushPop [data-brush]`, `#phGear` and `#phSettings` with `#phSize [data-size=16|32|48|64]`, `#phW`, `#phH`, `#phColorsMinus`, `#phColorsPlus`, `#phColors` (the value).

- [ ] **Step 1: E2E tests.** Paint tool paints a tapped cell; Erase clears it; Pick sets the current color to that cell's; Undo reverts the last stroke and disables when nothing to undo; brush popup 3 × 3 paints nine cells and closes after choosing; Settings: size 16 resizes to 16 × 16 keeping a painted top-left cell; `#phColorsMinus` stops at the number of colors in use; plus reaches 16 and stops.
- [ ] **Step 2:** Run, confirm fail.
- [ ] **Step 3:** Build the controls on the existing actions; the popups close on Done or a tap outside.
- [ ] **Step 4:** Run, confirm pass.
- [ ] **Step 5:** Tick, commit `v0.2.61: phone tools and popups`.

### Task 4: Color square, hue strip and slots

**Files:**
- Create: `packages/web/src/panels/ColorSquare.svelte`
- Modify: `PhoneApp.svelte`, `phone.spec.ts`; add to `packages/web/test/color.test.ts` if new pure helpers are added to `color.ts`

**Interfaces:**
- Produces: `ColorSquare` with props `{ value: string; oninput: (hex: string) => void; onstart: () => void; onend: () => void }`, same gesture contract as `ColorWheel`; ids `#phSquare`, `#phHue`, `#phPatch`; slots `#phSlots .slot` (filled) and `.slot.empty`.

- [ ] **Step 1: E2E tests.** Tap a filled slot: it becomes current. Dragging in `#phSquare` on a filled color recolors every pixel of it in one undo step. Tapping an empty slot then dragging the square then painting adds the color; tapping an empty slot and not painting leaves the palette unchanged. At the Most colors limit a new color is refused with a visible message. A color with no pixels leaves its slot.
- [ ] **Step 2:** Run, confirm fail.
- [ ] **Step 3:** `ColorSquare`: saturation on x, brightness on y, hue strip beneath, using `hsvToHex`/`hexToHsv`; wire as `PixelEditor` wires the wheel (`recolorLive` when the current color is in the image and `ui.newColor` is off). Refusal messages show in the phone (toasts are visible there; there is no dialog).
- [ ] **Step 4:** Run, confirm pass.
- [ ] **Step 5:** Tick, commit `v0.2.61: phone color picker`.

### Task 5: Touch gestures on the canvas

**Files:**
- Modify: `packages/web/src/panels/SourceCanvas.svelte`, `phone.spec.ts`

**Interfaces:**
- Consumes: the existing `drag` and `pan` state, `ui.zoom`.
- Produces: with two touch pointers down, the canvas pinch-zooms (`ui.zoom`, 1 to 16) and moves (`pan`); a one-finger touch with Paint or Erase draws and never pans; a touch-action that stops the browser scrolling or zooming the page.

- [ ] **Step 1: E2E tests** (Playwright touch via CDP `Input.dispatchTouchEvent` or pointer events): one-finger drag paints a line of cells without changing `zoom`; a two-finger spread raises `zoom` above 1 and paints nothing; a second finger landing mid-stroke leaves the stroke's cells so far and the canvas unmoved until the stroke would end; pinch back to 1 returns pan to 0.
- [ ] **Step 2:** Run, confirm fail.
- [ ] **Step 3:** Track active pointers by id; a second pointer cancels the paint or pan drag and starts a pinch (distance for zoom, midpoint for pan, zoom about the midpoint as the wheel handler does). PC mouse behavior is unchanged: keep the existing wheel, pan and Select rules for `pointerType !== 'touch'`.
- [ ] **Step 4:** Run, confirm pass; the full PC suite must still pass.
- [ ] **Step 5:** Tick, commit `v0.2.61: phone touch gestures`.

### Task 6: 3D tab

**Files:**
- Modify: `PhoneApp.svelte`, `ViewportPane.svelte` (a phone mode that hides `.vtools`, `.note`, `.dims`, `.mode`), `app.css`, `phone.spec.ts`

**Interfaces:**
- Consumes: `ui.phone`, the existing viewport orbit and zoom.
- Produces: with `ui.phone` the 3D tab shows only the model; no Reset view, Grid, X-ray, Cut view, strays or size readout.

- [ ] **Step 1: E2E tests.** The 3D tab shows `#view` at the full phone size, none of `#resetView`, `#gridBtn`, `#xrayBtn`, `#cutBtn` is visible; after painting, the preview model exists (snapshot or `#view` not empty); returning to Draw keeps the drawing and its zoom.
- [ ] **Step 2:** Run, confirm fail.
- [ ] **Step 3:** Give the tab the viewport and hide the extras with `body.phone` rules (or the `ui.phone` flag). Orbit and zoom stay as the viewport already does them with touch.
- [ ] **Step 4:** Run, confirm pass.
- [ ] **Step 5:** Tick, commit `v0.2.61: phone 3D tab`.

### Task 7: Rotation, resize across the breakpoint, README, version

**Files:**
- Modify: `packages/web/test/e2e/phone.spec.ts`, `README.md` (one paragraph), `package.json`, `package-lock.json`

- [ ] **Step 1: E2E tests.** Resizing the viewport from 390 × 844 to 844 × 390 keeps `#phone` and the drawing; from 390 × 844 to 1400 × 900 swaps to the PC layout with the drawing kept in the viewer; back again returns to `#phone` without a second blank canvas.
- [ ] **Step 2:** Run, confirm fail or pass; fix what fails (the startup blank canvas must only be made when there is no source).
- [ ] **Step 3:** README paragraph on the phone sketchpad; version 0.2.61.
- [ ] **Step 4:** `npm run typecheck`, `npm test`, `npm run test:e2e`; all green except the known flaky `load.spec.ts` "a failed build" test, which must pass alone.
- [ ] **Step 5:** Tick, commit `v0.2.61: phone sketchpad`.

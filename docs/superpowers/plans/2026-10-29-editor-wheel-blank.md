# Color Wheel, Unused Colors and Blank Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the user chose inline execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a color wheel to the Pixel Editor, make colors exist only while a pixel uses them, and let the editor start from a blank canvas.

**Architecture:** Core's `applyEdits` prunes zero-pixel colors at the end of a batch. The brush color (`ui.sel`) becomes independent of the palette: painting with a color not in the image adds it in the same undo step. A canvas-drawn HSV wheel edits the brush color, and recolors the image color live (one undo step per drag) unless "New color" mode is on. A blank canvas is a transparent `Source` flagged `blank`, which the pipeline allows to be empty.

**Tech Stack:** Svelte 5 runes, TypeScript, vitest (`packages/core/test`, `packages/web/test`), Playwright (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-10-29-pixel-editor-design.md` (see "Addendum, 2026-10-29").

## Global Constraints

- **Version:** bump to **0.2.60** (`package.json`, `package-lock.json` lines 3 and 9). Commit subjects start `v0.2.60: `, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Branch:** `editor-wheel`. **Do not push and do not merge to master**; the user decides when to release.
- **Color cap:** 16 (`PALETTE_MAX`); painting a 17th color is refused with the toast `An image holds at most 16 colors.` and paints nothing.
- **Blank canvas size:** 4–128 per side; presets 16, 32, 48, 64. Pixel size fixed at creation: `settings.pixelMm = { x: mm, y: mm }` with `mm = settings.size.width / max(w, h)`.
- **Resize canvas:** anchored top-left, anything cut off dropped, one undo step, blank canvases only.
- **Image info line:** `New canvas W × H px`.
- Existing suites stay green: `npm run typecheck`, `npm test`, `npm run test:e2e`.

## Review Focus

- Erase the last pixel of a color, then paint with it again: the color returns at the current default height; undo/redo across both.
- Wheel drag onto a hex that is already in the image (twin): no crash, one undo step, a "Merged" toast only when the drag ends.
- Blank canvas painted then fully erased: empty 3D view, 0 filaments, Export disabled, no console errors.
- Resize smaller than the drawing, then undo: the drawing returns.
- Edit pixels with no image, then loading a photo: the editor shows the photo, not the blank-canvas chooser.

---

### Task 1: Core prunes colors with no pixels

**Files:**
- Modify: `packages/core/src/grid.ts`, `packages/core/src/edits.ts`
- Test: `packages/core/test/edits.test.ts`

**Interfaces:**
- Produces: `export function pruneUnused(g: Grid): void` in `grid.ts` (removes palette entries no cell uses, remapping cells; keeps at least nothing special: an all-empty grid ends with an empty palette). `applyEdits` calls it on its copy once, after the loop.

- [x] **Step 1: Tests.** In `edits.test.ts`, change "add appends at 1 mm unless it exists" so a lone `add` returns a palette without the new color; add: painting over a color's only pixel removes it and renumbers cells; `paint hex:null` on a color's only pixel removes it; `[add X, height X 3, paint(0,0,X)]` in one batch keeps X at height 3; a color with pixels is kept.
- [x] **Step 2:** Run `npx vitest run packages/core/test/edits.test.ts`. Expected: new tests FAIL.
- [x] **Step 3:** Implement `pruneUnused` (single pass, build the remap) and call it at the end of `applyEdits`.
- [x] **Step 4:** Run `npm test`. Expected: all pass (fix any other core test that relied on an unused color persisting, by updating it).
- [x] **Step 5:** Commit `v0.2.60: core: colors with no pixels leave the palette`.

### Task 2: The brush color is independent of the palette

**Files:**
- Modify: `packages/web/src/actions.svelte.ts`, `packages/web/src/panels/PixelEditor.svelte`, `packages/web/src/panels/PalettePanel.svelte` (hint text only if needed)
- Modify tests: `packages/web/test/e2e/editor.spec.ts`, `palette.spec.ts`, `export.spec.ts`

**Interfaces:**
- Consumes: `PALETTE_MAX`.
- Produces: `paintHex(): string | null` returns `ui.sel` whenever it is `#rrggbb` (else the first palette color, else null). `paintCells` paints with it: when the hex is not in `app.grid.palette` and not erasing, it refuses at `PALETTE_MAX` colors (toast, returns 0) and otherwise appends `{kind:'height', hex, h: app.settings.heights.h}` to the same `addEdits` batch (one undo step). `useColor(hex: string): boolean` and `addCustomColor` are replaced by `setBrush(hex: string): void` (lowercases, sets `ui.sel`, no edit, no undo); keep `useColor = setBrush`-style call sites compiling. `ui.newColor: boolean` is added to `state.svelte.ts` (false; "the wheel changes only the brush").

- [x] **Step 1: Tests (editor.spec.ts).** Replace "Add color adds it…" with: choosing the hex `#12ab34` in `#edHex` + `#edAddBtn` (still present until Task 3) leaves the palette and undo count unchanged and `#edImage` without that color; painting one cell then adds it with height 1 in exactly one undo step and shows it in `#edImage`; erasing that only pixel removes it from `#edImage`; painting it again restores it. Change "a common color that is new joins the image when chosen" to: not in `#edImage` until painted. At 16 colors a first stroke with a new common color shows the toast and changes nothing. Update the `palette.spec.ts` "delete a color, add one and paint with it" test and `export.spec.ts` "Add color with nothing painted leaves the filament count alone" (palette length stays 7, `8 filaments` unchanged, still passing).
- [x] **Step 2:** Run `npx playwright test -c packages/web editor palette export`. Expected: the changed tests FAIL.
- [x] **Step 3:** Implement the actions change; chips and `#edAddBtn` call `setBrush`; `PixelEditor`'s `cur` is `ui.sel` when valid (it need not be in the palette), and `#edImage` chips come from the (now pruned) palette.
- [x] **Step 4:** Run `npm run typecheck`, `npm test`, `npm run test:e2e`. Expected: PASS.
- [x] **Step 5:** Commit `v0.2.60: brush color is independent of the palette`.

### Task 3: Color wheel and live recolor

**Files:**
- Create: `packages/web/src/color.ts`, `packages/web/test/color.test.ts`, `packages/web/src/panels/ColorWheel.svelte`
- Modify: `packages/web/src/actions.svelte.ts` (`recolorLive`), `packages/web/src/panels/PixelEditor.svelte`, `packages/web/src/app.css`, `packages/web/test/e2e/editor.spec.ts`

**Interfaces:**
- Produces in `color.ts`: `hexToHsv(hex: string): { h: number; s: number; v: number }` (h 0–360, s and v 0–1) and `hsvToHex(h: number, s: number, v: number): string` (lowercase `#rrggbb`), round-tripping every hex within one unit per channel.
- Produces in `actions.svelte.ts`: `recolorLive(from: string): { set(to: string): void; end(): void }`. `from` is the color's hex at drag start. It calls `pushUndo()` once, remembers `G0 = app.grid`, `E0 = app.edits`; each `set(to)` re-applies from the baseline (`applyEdits(G0, [{kind:'recolor', from, to}])`, `app.edits = [...E0, edit]`, or `E0` when `to === from`), moves `ui.sel` with it, and updates size via the same `fitSize` path `addEdits` uses (export a small helper if needed); `end()` toasts `Merged into the matching color.` only if the final `to` was an existing color.
- `ColorWheel.svelte` props: `{ value: string; oninput: (hex: string) => void; onstart?: () => void; onend?: () => void }`. A canvas hue/saturation disc (`#edWheel`), a brightness slider (`#edBright`), and the hex box `#edHex`; pointer drag on the disc and slider calls `onstart` then `oninput` per move then `onend`.
- Editor behavior: the wheel shows `ui.sel`. On drag: if `ui.newColor` is false and `ui.sel` is a palette color, drive `recolorLive`; otherwise only `ui.sel = hex`. `#edAddBtn` is replaced by `#edNewBtn` ("New color") which sets `ui.newColor = true`; `ui.newColor` is cleared when a chip is chosen, Pick selects a color, or a stroke paints with the brush.

- [x] **Step 1: Tests.** `color.test.ts`: round trip for `#000000`, `#ffffff`, `#e0715c`, `#12ab34`; `hsvToHex(0,1,1) === '#ff0000'`; `hexToHsv('#00ff00').h === 120`. `editor.spec.ts`: picking a pixel with Pick puts its color in `#edHex` (value) and highlights its chip; typing `#123456` in `#edHex` + Enter on a color in the image recolors it everywhere (palette contains it, old hex gone) in one undo step, and Ctrl+Z restores; dragging `#edWheel` (mouse down, three moves, up) is one undo step; with `#edNewBtn` clicked the wheel does not change the palette; entering an existing image color's hex merges and toasts once at the end.
- [x] **Step 2:** Run both test files. Expected: FAIL.
- [x] **Step 3:** Implement `color.ts`, `recolorLive`, `ColorWheel.svelte`, wire into `PixelEditor.svelte` (wheel at the bottom of the right column; remove the native `#edColor`), CSS.
- [x] **Step 4:** Run `npm run typecheck`, `npm test`, `npm run test:e2e`. Expected: PASS.
- [x] **Step 5:** Commit `v0.2.60: Pixel Editor color wheel, live recolor`.

### Task 4: Blank canvas and Resize canvas

**Files:**
- Modify: `packages/web/src/pipeline.ts` (`Source.blank?: boolean`; `computeGrid` skips the two "empty" errors for a blank source), `packages/web/src/actions.svelte.ts` (`newCanvas`, `resizeCanvas`, `openEditor` allowed with no image), `packages/web/src/panels/PixelEditor.svelte` (size chooser and Resize canvas), `packages/web/src/panels/ExportPopover.svelte` (disable Export on an empty grid), `packages/web/src/app.css`
- Modify: `packages/web/src/Footer.svelte` or wherever the piece health is shown (an empty grid says `Empty` instead of Watertight, only if the existing text would be wrong), `packages/web/src/panels/ImagePanel.svelte` (nothing, unless Edit pixels is disabled with no image)
- Test: `packages/web/test/e2e/editor.spec.ts`; `packages/web/test/pipeline.test.ts` if a pure test fits

**Interfaces:**
- Produces: `export function blankSource(w: number, h: number): Source` in `pipeline.ts` = `{ name: 'New canvas', img: { width: w, height: h, data: new Uint8ClampedArray(w*h*4) }, scale: { sx: 1, sy: 1, ox: 0, oy: 0 }, pixelArt: true, pick: null, crop: null, blank: true }` (match the exact `Source` field names in the file). `newCanvas(w: number, h: number): void` (clamps to 4–128, one `change()`: source, `edits = []`, `settings.background.enabled = false`, `settings.pixelMm = {x: mm, y: mm}` with `mm = settings.size.width / max(w,h)`, then `ui.sel` stays). `resizeCanvas(w: number, h: number): void` (blank only; rebuilds the blank `Source` at the new size, keeps `pixelMm`, filters paint edits outside the new bounds, other edits unchanged; one `change()`).
- Info line `New canvas W × H px`: set wherever `meta.info` is built for a blank source.
- `openEditor()` no longer requires an image; with `!app.source` the editor body shows the size chooser (`#edNew`: preset buttons `[data-size="16|32|48|64"]`, custom `#edNewW` `#edNewH`, `#edNewBtn2`... use ids `#edCreate` for the create button) in place of the canvas; creating it shows the canvas. If an image gets loaded while the chooser is up, the chooser disappears (the condition is `!app.source`).
- Resize canvas controls in the editor (shown only when `app.source?.blank`): `#edRW`, `#edRH`, `#edResize`.

- [x] **Step 1: Tests (editor.spec.ts).** Edit pixels with no image opens the editor with `#edNew` visible and no toast; choosing preset 16 shows `#edSrc`, `#fileInfo` reads `New canvas 16 × 16 px`, the grid is 16 × 16 with 0 opaque, no console errors; painting a cell with a chip color (add via wheel/common) makes 1 opaque pixel, `.dims` shows a model size, then erasing it again leaves 0 opaque, `#fcount` reads `0 filaments` and `#exportBtn` is disabled; custom 100 × 20 works, 3 or 200 are clamped to 4 / 128; Resize to 8 × 8 keeps cells inside and drops the others, Ctrl+Z brings them back; with no image, loading a photo via `#fileIn` while the editor is open replaces the chooser with the photo's canvas.
- [x] **Step 2:** Run `npx playwright test -c packages/web editor`. Expected: FAIL.
- [x] **Step 3:** Implement. Run the app once to check `computeGrid`/`recompute` accept the blank source, that `fitSize` keeps `pixelMm` on the first stroke (model about 40/16 mm per pixel), and that an empty grid shows an empty 3D view.
- [x] **Step 4:** Run `npm run typecheck`, `npm test`, `npm run test:e2e`. Expected: PASS.
- [x] **Step 5:** Commit `v0.2.60: Pixel Editor: blank canvas and Resize canvas`.

### Task 5: Release prep (local only)

**Files:**
- Modify: `package.json`, `package-lock.json` (0.2.60), `README.md` (Pixel editor paragraph: wheel, New color, start from a blank canvas), this plan and the spec addendum (ticks)

- [x] **Step 1:** Bump the version; update the README paragraph.
- [x] **Step 2:** Run `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build:web`. Expected: all PASS (the parallel-load flakes on `load.spec` "failed build" and `export.spec` "two STL files" may need a rerun in isolation).
- [x] **Step 3:** Screenshot the editor with the wheel and the blank-canvas chooser and look at them at 1400×900.
- [x] **Step 4:** Commit `v0.2.60: editor wheel and blank canvas`. **Do not merge and do not push.**

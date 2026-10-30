# Pixel Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pixel Editor window (brush sizes, add color, palette of image/common/favorite colors) and turn the Pixel Viewer's Paint into a color picker.

**Architecture:** The editor is a native `<dialog>` (like `BatchDialog.svelte`) with a blurred backdrop, holding a second `SourceCanvas` and its own palette/tool UI. It reuses the existing global state: opening it sets `ui.tool = 'paint'`, closing sets `ui.tool = 'select'`, so `PaletteRow`, `ViewportPane` highlighting and the stroke/undo code work unchanged. The viewer loses its Paint/Erase buttons and is always in `select` mode (drag pans, click picks the color, which is the picker).

**Tech Stack:** Svelte 5 runes, TypeScript, vitest (`packages/web/test/*.test.ts`), Playwright (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-10-29-pixel-editor-design.md`

## Global Constraints

- **Version:** bump to **0.2.59** (root `package.json` and `package-lock.json`); every commit subject starts `v0.2.59: `. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Branch:** work on `pixel-editor` off master. `phone-layout` stays parked, untouched.
- **Brush sizes:** 1, 2, 3, 5 (square). Even sizes anchor on the cell under the cursor and extend right and down.
- **Color cap:** hard 16 per image (`PALETTE_MAX`), the Colors slider is ignored. A 17th is refused with the toast `An image holds at most 16 colors.`
- **Favorites:** one shared list, key `px3d.favs`, now 12 slots, newest first. Base/Outline/Clicker panels keep showing the first 5.
- **New color height:** `app.settings.heights.h` (as `addColor` does today).
- **Shortcuts in the editor:** B paint, E erase, I pick, `[` / `]` brush smaller/larger. Ignored while typing (`typing()` in `App.svelte`).
- **One drag = one undo step** (existing `stroke()` behavior). The existing desktop e2e suite must stay green after migration.
- Tests run with `npm test`, `npm run test:e2e`, `npm run typecheck`.

## Review Focus

- Brush footprint near/over the image edge: cells outside the grid are skipped, no crash, no stray edits.
- Painting with a chip color that is not in the image while at 16 colors: refused with the toast, nothing painted, selection unchanged.
- Add color of a hex already in the palette: just selects it, no duplicate edit, no undo step.
- Esc and Done both close the editor and return `ui.tool` to `select`; Esc inside the color/hex input does not close without a second press (native dialog behavior is acceptable).
- Opening the editor with no image loaded: button disabled/toast `Open an image first.`
- Undo/redo (Ctrl+Z / Ctrl+Y) work while the editor is open and update its canvas.

---

### Task 1: Pure helpers and state

**Files:**
- Create: `packages/web/src/brush.ts`
- Create: `packages/web/test/brush.test.ts`
- Modify: `packages/web/src/state.svelte.ts` (the `ui` object)

**Interfaces:**
- Produces: `export const BRUSHES = [1, 2, 3, 5] as const; export type Brush = (typeof BRUSHES)[number]`; `export function footprint(x: number, y: number, size: Brush): { x: number; y: number }[]` (row-major, anchor top-left of the footprint at `(x, y)`, so size 1 is `[{x,y}]`, size 2 covers x..x+1, y..y+1); `export const COMMON_COLORS: string[]` (16 lowercase `#rrggbb`: black, white, 4 greys, red, orange, yellow, green, teal, blue, purple, pink, brown, skin); `export const PALETTE_MAX = 16`.
- Produces: `ui.editor: boolean` (false) and `ui.brush: Brush` (1).

- [x] **Step 1: Write `brush.test.ts`**: `footprint(3,4,1)` equals `[{x:3,y:4}]`; `footprint(3,4,2)` has 4 cells and spans x 3–4, y 4–5; `footprint(0,0,5)` has 25 distinct cells; `COMMON_COLORS` has 16 unique values all matching `/^#[0-9a-f]{6}$/`.
- [x] **Step 2:** Run `npx vitest run packages/web/test/brush.test.ts`. Expected: FAIL (module missing).
- [x] **Step 3:** Implement `brush.ts`; add `editor: false` and `brush: 1 as Brush` to `ui` with a one-line doc comment each.
- [x] **Step 4:** Run the test again. Expected: PASS.
- [x] **Step 5:** Commit `v0.2.59: pixel editor: brush footprints and editor state`.

### Task 2: Color actions

**Files:**
- Modify: `packages/web/src/actions.svelte.ts`

**Interfaces:**
- Consumes: `PALETTE_MAX` from Task 1.
- Produces: `export function addCustomColor(hex: string): boolean` (lowercases; if already in the palette: sets `ui.sel`, returns true, no edit; if palette is at `PALETTE_MAX`: toast, returns false; else one undo step with `{kind:'add', hex}` plus a `height` edit when `heights.h !== 1`, sets `ui.sel`, returns true). `export function useColor(hex: string): boolean` (same as `addCustomColor`; the name used by palette chips). Existing `addColor()` now calls `addCustomColor('#e0715c')` and keeps setting `ui.tool = 'paint'` only when it did not come from the editor (it keeps its current behavior; Task 5 changes the viewer button).

- [ ] **Step 1:** Implement the two functions; refactor `addColor` to use `addCustomColor`.
- [ ] **Step 2:** Run `npm run typecheck` and `npx playwright test -c packages/web palette` (existing tests; nothing may change yet). Expected: PASS.
- [ ] **Step 3:** Commit `v0.2.59: pixel editor: add and use custom colors`.

### Task 3: Favorites with 12 slots

**Files:**
- Modify: `packages/web/src/panels/Favorites.svelte`
- Modify: `packages/web/test/e2e/settings.spec.ts` (the favorites test at ~line 103)

**Interfaces:**
- Produces: `Favorites` gains an optional prop `slots?: number` (default 5) controlling how many boxes render; storage keeps up to 12 (`slice(0, 12)`, load accepts up to 12; a saved list of 5 simply has empty tail). Existing id/`data-c`/`.star`/`.cur` hooks unchanged.

- [ ] **Step 1:** In `settings.spec.ts`, extend the favorites test: after saving six more distinct colors via `#baseFavs .star` the Base panel still shows only the first 5 (`#baseFavs [data-c]` count 5). Run it. Expected: FAIL (list is capped at 5 and the sixth save drops one).
- [ ] **Step 2:** Implement the 12-slot storage and the `slots` prop.
- [ ] **Step 3:** Run `npx playwright test -c packages/web settings options`. Expected: PASS.
- [ ] **Step 4:** Commit `v0.2.59: favorites hold 12, panels show 5`.

### Task 4: Canvas brush support

**Files:**
- Modify: `packages/web/src/panels/SourceCanvas.svelte`

**Interfaces:**
- Consumes: `footprint`, `ui.brush`.
- Produces: `SourceCanvas` accepts `let { id = 'src' }: { id?: string } = $props()` and puts it on the `<canvas>`. In `down` and `move`, the cells given to `stroke()` are each cell expanded with `footprint(x, y, ui.brush)` (deduplicated). A hover cell state is tracked on `pointermove` (and cleared on `pointerleave`); while `ui.tool` is `paint` or `erase` and the pointer is over the grid, `draw()` outlines the footprint in gold (`#d9a441`), clipped to the grid.

- [ ] **Step 1:** Add a case to `palette.spec.ts` ("a 2×2 brush paints four cells in one undo step"): set `ui.brush` through the Playwright hook (`page.evaluate`) or, once Task 5 exists, the editor button; for now call it via the existing `window.__pixel3d` hook if it exposes `ui`, otherwise add a test-only `brush` setter to `hook.ts` (same style as the other fields). Click one empty cell near the potion; expect `opaque` up by 4 and `undo` up by 1. Run it. Expected: FAIL.
- [ ] **Step 2:** Implement the expansion, the `id` prop and the hover outline.
- [ ] **Step 3:** Run `npx playwright test -c packages/web palette`. Expected: PASS (existing brush-1 behavior unchanged).
- [ ] **Step 4:** Commit `v0.2.59: canvas: brush sizes and hover outline`.

### Task 5: The Pixel Editor window and the viewer changes

**Files:**
- Create: `packages/web/src/panels/PixelEditor.svelte`
- Modify: `packages/web/src/App.svelte` (mount `<PixelEditor />`; Esc handling and B/E/I/[ ] shortcuts when `ui.editor`)
- Modify: `packages/web/src/panels/ImagePanel.svelte` (remove the Paint/Erase `seg`, keep Crop, add `Edit pixels` button `#editPixels`)
- Modify: `packages/web/src/panels/PaletteRow.svelte` (swatch always selects/clears: the viewer is always in select mode; fix title/aria text)
- Modify: `packages/web/src/panels/PalettePanel.svelte` (`#addColor` button now opens the editor; hint text updated)
- Modify: `packages/web/src/app.css` (editor window and `dialog.editor::backdrop { backdrop-filter: blur(6px); background: #0006 }`)
- Modify: `packages/web/test/e2e/palette.spec.ts`, `options.spec.ts`, `export.spec.ts` (migrate)
- Create: `packages/web/test/e2e/editor.spec.ts`

**Interfaces:**
- Consumes: `addCustomColor`, `useColor`, `COMMON_COLORS`, `BRUSHES`, `Favorites` (`slots={12}`, id `edFavs`), `SourceCanvas id="edSrc"`.
- Produces: `openEditor()` / `closeEditor()` exported from `actions.svelte.ts`: open sets `ui.editor = true`, `ui.tool = 'paint'`, `ui.zoom = 1` (toast `Open an image first.` and no-op when `!app.grid`); close sets `ui.editor = false`, `ui.tool = 'select'`, `ui.zoom = 1`, and is also called from the dialog's `onclose`.
- Editor DOM hooks (used by tests): `dialog#editor`; tool buttons `#editor [data-tool=paint|erase|pick]` (pick = internal `select`); brush buttons `#editor [data-brush=1|2|3|5]`; `#edAdd` (native color input `#edColor` + text `#edHex` + button `#edAddBtn`); chips `#edImage [data-c]`, `#edCommon [data-c]`, `#edFavs [data-c]` (current one has class `cur`); `#edUndo`, `#edRedo`, `#edDone`; canvas `#edSrc`.

Layout of the window: tools and brush sizes in a left column; `#edSrc` in the middle, filling the window; right column with the three chip groups and the add-color row; Done in the header. The window is about 90vw × 85vh. Chips are click-to-use (`useColor`); in Favorites, the star saves the current `ui.sel`.

- [ ] **Step 1: Write `editor.spec.ts`** (helpers copied from `palette.spec.ts`, canvas id `#edSrc`; `cell()` takes the canvas selector):
  - `Edit pixels` opens `#editor`; Esc closes it and `ui.tool` is back to select (viewer has no Paint button: `.seg[data-key=tool]` count 0).
  - viewer click on a potion cell marks that color's `#pal li` as `sel` (the picker).
  - editor: pick `#2b2135` from `#edImage`, paint cell (1,8): opaque +1; with brush 3 a click paints 9 cells; edge click at cell (0,0) with brush 5 does not error.
  - `#edHex` = `#12ab34` + Add: palette gains it with the right height, `ui.sel` is it, one undo step; adding it again adds no undo step.
  - common chip not in the image paints and adds the color; at 16 colors it shows the toast `An image holds at most 16 colors.` and paints nothing (use a 16-color generated image like the one in `palette.spec.ts`).
  - favorite: Save in `#edFavs` stores `ui.sel`; survives reload.
  - eyedropper (`pick`) click selects the cell's color; keyboard `b`, `e`, `i`, `]` switch tool/brush; Ctrl+Z undoes a stroke with the editor open.
  - `Edit pixels` with no image shows the toast and does not open.
- [ ] **Step 2:** Run `npx playwright test -c packages/web editor`. Expected: FAIL.
- [ ] **Step 3:** Implement `PixelEditor.svelte` (`<dialog class="editor" id="editor">`, `showModal()` in an `$effect` on `ui.editor`, as `BatchDialog.svelte` does), `openEditor`/`closeEditor`, the App wiring, CSS, and the viewer changes listed above.
- [ ] **Step 4:** Migrate the existing tests: in `palette.spec.ts` and `options.spec.ts`, every `tool(page, 'paint'|'erase')` stroke now runs inside the open editor (helper `openEditor(page)`; `cell()` and `clickCell()` take the canvas selector and default to `#src`; brush choice via `#edImage [data-c]` in place of `#pal .sw`); the `#addColor` tests in `palette.spec.ts` and `export.spec.ts:327` use the editor's add-color; `tool(page, 'select')` assertions drop (the viewer is always select). Preserve each test's intent and assertions on edits, opaque count and undo.
- [ ] **Step 5:** Run `npx playwright test -c packages/web` (whole suite) and `npm test` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 6:** Commit `v0.2.59: Pixel Editor window, viewer Paint becomes a color picker`.

### Task 6: Release

**Files:**
- Modify: `package.json`, `package-lock.json` (0.2.59), `README.md` (a short Pixel Editor paragraph; refresh `docs/images/example.png` only if the viewer's look changed enough to matter)
- Modify: this plan and the spec (tick boxes)

- [ ] **Step 1:** Bump the version; add the README paragraph.
- [ ] **Step 2:** Run `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build:web`. Expected: all PASS.
- [ ] **Step 3:** Visual check with the app running: open the editor on `examples/potion.png` and look at the blur, the layout at 1400×900, and a stroke with brush 3.
- [ ] **Step 4:** Commit `v0.2.59: pixel editor release`; then `git branch -f master pixel-editor`, `git switch master`, re-run the suites, `git push origin master`, delete `pixel-editor`.

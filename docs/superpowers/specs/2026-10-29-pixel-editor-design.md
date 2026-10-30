# Three modes and a Pixel Editor — design

## Why

Painting today is clumsy. To paint you scroll down to the colors list, pick (or add) a color, scroll back up to the picture, and paint one pixel at a time. There is no brush size, no way to add a color that isn't already in the image, and no palette of common or favorite colors. The user wants a proper pixel editor, and a clearer split between looking at the picture, editing it and viewing it in 3D.

## The three modes

The screen stays as it is: the Pixel Viewer (image and colors list) on the left, the 3D Viewer (preview and settings) on the right. Both work on the same image. The **Pixel Editor** is a third part: an **Edit pixels** button on the Pixel Viewer opens it as a large window on top of the app, with the app behind it blurred. Closing it (Done, Esc) returns to the app. Edits show in the 3D view when it closes (live behind the blur if cheap). Undo/redo is shared. The image is on screen when it first loads, as now.

### Pixel Viewer (the current left-hand view)
- Looks and works as it does now, plus an **Edit pixels** button: the image, select, crop, the image options and the colors list with heights.
- The **Paint tool becomes a color picker**: click a pixel in the picture and its color becomes the selected color. No scrolling down to the colors list.
- The viewer no longer paints. Painting and erasing live in the Pixel Editor.
- Anything that needs a custom color is done in the editor (see Add color).

### Pixel Editor (new, a window over the app)
The image large in the middle, tools down one side, color on the other. Nothing needs scrolling.
- **Tools:** Paint, Erase, Eyedropper (pick from the picture), plus Undo/Redo and zoom/pan.
- **Brush size:** 1×1, 2×2, 3×3, 5×5 (square brush; my call — see below).
- **Add color:** a color picker plus hex entry. The new color joins the image's palette and is selected as the brush.
- **Palette panel:**
  - *Image colors* — the colors already in the image (what the viewer's list shows).
  - *Common colors* — a fixed set of about 16 (black, white, greys, primaries, skin tones, brown).
  - *Favorites* — colors the user saves, kept in the browser between visits.
- Painting with a color that isn't yet in the image adds it to the image palette (subject to the color limit, see below).

### 3D Viewer
Unchanged: the 3D preview, orbit, X-ray, Cut, grid, and the right-hand settings panels (size, base, outline, clicker and so on).

## Platforms

PC first. The phone layout (parked on branch `phone-layout`, based on v0.2.58) is revisited afterwards. On the phone the intent is that it offers **Pixel Viewer and Pixel Editor**, with 3D preview as before and the "open on PC for the full experience" notice. Not part of this work beyond not making it harder.

## Goals
- Pick a color from the picture in one click.
- Add any color, and keep favorites, without leaving the picture.
- Paint with larger brushes.
- All existing desktop behavior, exports and tests keep working.

## Non-goals
- Layers, selections-to-move, fill bucket, shapes, or animation. (A flood-fill is the likeliest next addition; not now.)
- Painting in the 3D view.
- Changes to the 3D model generation or export.

## Anti-goal
A new mode that makes the common job slower, or that needs the user to switch modes just to pick a color. The picker must stay in the Pixel Viewer.

## Constraints
- Svelte 5 + the existing state (`app`, `ui`, `paintCells`, undo stack); build on them. The Paint/Erase code in `SourceCanvas.svelte` and the `Favorites` storage are reused, not rewritten.
- Palette limit: an image has at most 16 colors (`colors.max`). Adding a 17th is refused with a message, not silently merged.
- The `Favorites` component holds five slots shared by Base/Outline/Clicker. The editor needs more room, so favorites grow (my call: 12 slots; the other panels keep showing the first 5).

## My calls (change any of these)
1. Square brushes only, sizes 1, 2, 3, 5. No round brush.
2. The editor is a modal window over the app (background blurred), opened from an Edit pixels button in the Pixel Viewer, not a header mode switch.
3. Common colors are a fixed list, not editable.
4. Favorites go to 12 slots and stay in `localStorage` under the existing key, backward compatible with the saved five.
5. The viewer's Paint/Erase buttons go away; Select, Crop and the new picker remain.
6. Keyboard shortcuts in the editor (B paint, E erase, I eyedropper, [ and ] brush size) — included, easy to drop.

## More calls, from the builder check (mine, change any)
7. **Color limit:** the editor ignores the Colors slider (that only steers automatic reduction when an image loads) and caps at a hard 16. Colors added in the editor are recorded as edits, so undo/redo, reload-replay and "Restore colors" treat them like any other edit.
8. **Height of a new color:** the current default pixel height (`heights.h`), as `addColor` does today. Heights are still changed in the viewer's colors list.
9. **Shared state:** the selected color (`ui.sel`) is shared by all modes, so a pick in the viewer is the brush in the editor. The picker is a fourth viewer tool beside Select and Crop; it replaces Paint and Erase there.
10. **Favorites:** one list shared with Base/Outline/Clicker (newest first; those panels show the first 5). A saved list of 5 gains 7 empty slots.
11. **Brushes:** even sizes anchor on the pixel under the cursor and extend right and down. A hover outline previews the footprint. One drag is one undo step, as today.
12. **Editing grid:** the editor paints the same pixel grid the viewer shows, not the source image's raw pixels.

## Left to the builder
Exact layout and styling, the common-color list, the color-picker control (native `<input type="color">` is acceptable), tests (existing e2e plus new ones for the picker, brush sizes, add color and favorites), version bump and README update.

## Addendum, 2026-10-29: color wheel, unused colors, drawing from scratch

Requested after trying v0.2.59. The user chose the options marked (user); the rest are my calls.

### Color wheel
- The bottom right of the editor is a **color wheel**: hue/saturation disc, a brightness slider and a hex box, replacing the native color input. (user)
- The wheel always shows the **brush color**. Picking a pixel with Pick, or choosing any chip, puts that color in the wheel. (user)
- Moving the wheel while the brush color is **in the image recolors every pixel of it**, as one undo step per drag. (user)
- A **New color** button replaces Add: the wheel then changes only the brush (a color not yet in the image) until it is painted with, or another color is chosen. (my call)

### Colors exist only while a pixel uses them
- A color with no pixels is not in the image: it is not in the editor's Image colors, the viewer's colors list, the color count or the export. (user)
- Selecting or adding a color only sets the brush. The color joins the image with the first pixel painted in it, in the same undo step as that stroke, at the current default pixel height. Painting a 17th color is refused with the existing toast.
- Erasing or painting over the last pixel of a color removes it. Enforced in core's `applyEdits` (prune at the end of the batch).

### Drawing with no photo
- **Edit pixels** with no image opens the editor on a size choice: 16, 32, 48 or 64 square, or a custom width × height (4–128 each). It then shows a blank canvas. (user: size picker)
- The model's pixel size is fixed at creation as `Width ÷ the larger side`, so the model starts about 40 mm across (my call).
- The editor has **Resize canvas** (width × height, drawing kept, anchored top-left, anything cut off is dropped), as one undo step. (user: resizable later) Only for a canvas started blank; a loaded photo is shrunk with Crop as before.
- An empty canvas shows an empty 3D view, 0 filaments, and Export is disabled until a pixel is painted.
- The image line reads `New canvas 32 × 32 px`. Pixels across / Pixelate stay for photos only.

### Left to the builder
Wheel rendering (canvas, HSV), keyboard behaviour of the wheel, the size choice layout.

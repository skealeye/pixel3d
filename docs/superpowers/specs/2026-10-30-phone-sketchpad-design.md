# Phone sketchpad: design

Date: 2026-10-30. Status: draft for review.

## Intent

On a phone, pixel3d is a **sketchpad**. The user draws pixel art, glances at it in 3D, and saves a plain PNG to the phone. They move that PNG to the PC themselves (cloud drive, email, messaging, cable) and carry on there with the full app. The phone does not export models, change print settings, or load photos.

The moment it serves: an idea away from the PC. Draw it on the phone, finish it at the desk.

## Goals

- A phone-sized screen gets its own simple layout automatically. No switch to the PC layout, no setting.
- Draw tab: draw with one finger, pick colors, undo, save PNG.
- 3D tab: look at the drawing in 3D (orbit and zoom only).
- The UI is as simple as possible: few controls, big touch targets, no hex codes, no numbers where a tap will do.

## Non-goals and anti-goals

- No photo or file loading, no Pixelate, crop, background removal, heights, filaments, clicker, export or print settings on the phone.
- No autosave, share sheet, account or sync. The phone saves a PNG file and nothing else. (Decided by the user: "move it myself".)
- The PC layout must not change. A narrow desktop window is not a phone: the phone layout is for phone-sized screens (see Detection).
- No hex code, no favorites, no common-colors grid on the phone.

## How it works (decided with the user)

### Start

The page opens straight into a blank canvas. The first screen is **not** a chooser. [My call: default 32 × 32 with 8 colors, matching the PC's new-canvas defaults of 8 colors; the user can change both in Settings.]

### Two tabs (bottom bar): Draw and 3D

**Draw tab**, top to bottom:
- Top bar: gear (Settings), Undo, **Save PNG**. [My call: Redo is not shown; Undo only keeps it simple.]
- The canvas.
- Tool row: Paint, Erase, Pick, and a brush button that opens the brush popup.
- Color slots: one slot per allowed color; empty slots are dashed; the current color is outlined.
- Color picker (lower portion): a **square** (drag to set how pale/dark and how strong) plus a **hue strip** beneath it, and a patch showing the current color. No hex box, no brightness bar.

**3D tab**: the whole screen shows the drawing in 3D. Orbit by dragging, zoom by pinching. Nothing else. A quick peek, then back to Draw.
[My call: the phone has no height or filament controls, so the drawing gets the PC's default settings (default height mode and pixel height) and the 3D view looks as it does on the PC. The user can change those on the PC after moving the PNG.]

### Colors

- Tap a filled slot: it becomes the current color, and the square and strip move to it. Changing the picker recolors every pixel of that color (same behavior as the PC wheel).
- Tap an empty slot: the picker starts a new color there. It joins the image when a pixel is painted with it.
- A color with no pixels leaves its slot (as on the PC).
- The limit is the Most colors setting; a new color is refused at the limit with a short message.
- [My call: Settings does not let Most colors go below the number of colors the drawing already uses; the minus button stops there.]

### Popups

- **Settings** (gear): canvas size (16, 32, 48, 64 or width × height, 4 to 128) and Most colors (2 to 16). Changing the size of a canvas that already has drawing resizes it, anchored top-left, as on the PC. [My call: reuse the PC's resize rules.]
- **Brush** (button on the tool row): 1×1, 2×2, 3×3, 5×5, the same sizes and footprints as the PC.

### Gestures on the canvas

One finger draws (Paint or Erase) or picks (Pick). Two fingers pinch to zoom and drag to move the canvas. Drawing never moves the canvas, and moving the canvas never draws.

### Save PNG

The button downloads the drawing to the phone as a PNG, one image pixel per cell, empty cells transparent. [My call on the format: 1 pixel per cell is exactly what the PC app loads back as pixel art. Name: `pixel-art.png`; a number is added when saved again if the browser needs one.] The user moves the file to the PC and opens it there with the PC app's Open image.

## Detection

The phone layout is on when the screen is phone-sized: a narrow screen (up to 700 px wide) or a short screen (up to 500 px high, for a phone held sideways), the rule the parked branch used. [My call: keep that rule. Open question for the builder: whether to also require a touch screen so a small desktop window keeps the PC layout. The user wants it automatic and has not asked for anything finer.]

## Reuse

- The PC editor already has what the phone needs: blank canvas, Paint/Erase/Pick, brush footprints, recolor-by-picker, color limit, resize, undo. Reuse those actions and state, not copies of them.
- The 3D view is the existing viewport, given the whole screen on the 3D tab with the PC's other controls hidden.
- The parked `phone-layout` branch (based on v0.2.58) was a photo-oriented layout (Image and Preview tabs). Its detection rule and tab idea carry over; its image-editing screen does not. Rebuild on current `master`; do not merge the old branch.

## Left to the builder

Visual styling (use the app's existing look), touch target sizes, how the square and strip are drawn, how the two-finger gesture is detected, the PNG file naming detail, and tests (unit for the PNG rendering; Playwright with a phone-sized viewport and touch for the layout).

## Version

New app version on release; say which version carries the change.

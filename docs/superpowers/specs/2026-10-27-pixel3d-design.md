# pixel3d — Design

Date: 2026-10-27 · Status: draft, awaiting approval · App version starts at 0.1.0

## 1. Intent

Turn pixel art images into 3D-printable models quickly, either one at a time in a polished app or in batches without a UI, driven by Python or Claude.

The reference is https://oct0f1sh.github.io/PixelArtTo3D/ (source: github.com/oct0f1sh/PixelArtTo3D). The user likes almost all of it. pixel3d keeps its feature set, fixes its bugs, and adds what it lacks:

1. **Height per colour.** Each palette colour can sit at a different height.
2. **Colour editing.** Recolour a palette entry, or paint individual pixels.
3. **Two-sided models.** Either one solid piece or two flat-backed halves to glue together.
4. **Headless batch API.** A CLI, a local HTTP API and an MCP server.

Success means the user can drop in a sprite, adjust heights and colours, and get a clean, watertight STL/3MF that slices without repair. It also means they can point Claude or a Python script at a folder and get the same quality output for every file.

## 2. Goals, non-goals, anti-goals

**Goals**
- Feature parity with the reference app (see §4), minus its bugs (§4.9).
- The four new features above.
- Fast and snappy, with a professional feel. Edits update the 3D preview immediately on typical sprites (≤128×128).
- Identical output from the UI and the headless paths for the same image and settings.

**Non-goals (v1)**
- Converting non-pixel-art photos into relief or lithophane models.
- A cloud service, accounts or server-side storage. Everything runs locally or in the browser.
- A full pixel-art editor: no layers, selection tools or animation.
- Native desktop packaging (Tauri/Electron). This is a possible later step; v1 is installable as a PWA.

**Anti-goals (failure even if it "works")**
- Models that need repair in the slicer: non-manifold edges, gaps between colour bodies, or floating parts.
- Batch output that differs from what the UI would produce for the same preset.
- A sluggish UI, such as a visible delay on every slider move.
- Exported colours that don't match what the preview shows (the reference app's base-colour bug).

## 3. Decided "how" (Claude's calls; user delegated: "whatever is fast, snappy and feels professional")

- **TypeScript monorepo** with three parts:
  - `core`: a pure engine with no DOM. Image → pixel grid → colours → heights → mesh → STL/3MF bytes.
  - `web`: the app, built with Vite and Three.js.
  - `cli`: Node, providing the CLI, HTTP API and MCP server.
- **Same core everywhere.** The browser and Node run identical code. Image decoding is the only platform-specific piece, passed in as an adapter.
- **manifold-3d (WASM)** for boolean operations such as holes, magnet pockets and joining the keychain loop. It runs in both the browser and Node.
- **Hosting:** GitHub Pages for the web app, installable as a PWA. The repo is public on GitHub.
- **Version** shown in the app footer and `px3d --version`. It starts at 0.1.0 and is bumped on every update.

## 4. Features

### 4.1 Input (parity)
- Drag-and-drop anywhere on the window (a full-window "Drop an image to load it" overlay appears while dragging), the Open image button, paste from the clipboard, or a URL. Accepts PNG, JPG, WebP and GIF (first frame). Loading a new image can be undone.
- Upscaled pixel art is detected automatically and shrunk back to native resolution. This includes different X and Y scales and a grid offset.
- Pixels with alpha < 128 become transparent.
- **Size cap raised from 256 to 512 px** on the longest side for pixel art. Larger images are pixelated (below) instead of refused.
- **Pixelate (new):** turns a photo, drawing or smooth artwork into pixel art.
  - Turned on automatically when the image doesn't look like pixel art: more than 64 distinct colours, or larger than the cap after upscale detection. It can also be toggled by hand for any loaded image.
  - **Pixels across** (8–128, default 32): the image is shrunk to this width by area averaging, with height following the aspect ratio.
  - **Colours** (2–16, default 8): the shrunk pixels are reduced with seeded k-means, so the same image and settings always give the same palette.
  - A solid background colour (all four corners within a tolerance of 40) is cleared at full resolution before shrinking, so edge pixels don't pick up a blended fringe.
  - Both sliders update the model live. Pixelate settings are part of presets, so batch runs can convert photos too.
- Crop tool, a source preview with zoom and pan, and a pixel-grid overlay.
- **The image panel can be enlarged:** an Expand/Shrink button (about 45% of the window) and a draggable divider between the panel and the 3D view.

### 4.2 Background removal (parity)
- An on/off toggle, on by default.
  - The background colour is found automatically when all four corners match within the tolerance. Otherwise the user can **Pick** it: removal switches off so the background shows, and the user clicks it in the image preview. The colour is read from the original image. A swatch shows the colour and how it was chosen: found in the corners, picked, or none found.
  - **Tolerance** runs 0–50 % (default 10 %) of the full RGB distance.
  - Removal is a **flood fill from the image edge**: only background touching the edge is cleared, so the same colour inside the art (eye whites, highlights) stays.
  - When pixelating, removal runs at full resolution before shrinking, so edge pixels don't blend into a fringe.
  - Changing any background setting keeps the pixel size, the hole and the magnets.
- Only background connected to the image edges is removed.

### 4.3 Palette (parity + new)
- Reduce to N colours by merging the closest pair. Delete a colour (its pixels go to the nearest remaining colour) and restore deleted colours.
- Each palette row shows a swatch, hex code, **height slider** and actions.
- **Recolour (new):** pick a palette entry and choose a new colour. Every pixel of that colour changes, and the entry keeps its height. If the new colour matches an existing entry, the two entries merge.
- **Paint (new):** pick a palette entry, then click or drag on the source preview to paint pixels with it.
  - An eraser makes pixels transparent.
  - An "add colour" button creates a new palette entry to paint with.
  - Painting a pixel into a previously empty spot extends the model.
- Undo and redo (50 steps) cover all palette, paint and height edits.
- **Restore colours:** brings back the original colours and pixels after deletes or recolours, and keeps the heights set for colours that still exist.
- **Reload image:** returns to the original image, undoing all colour, paint and height edits. Both actions can be undone.

### 4.4 Heights (new)
- Each colour has a height, measured from the top of the base, or from the bed if there is no base. The range is 0.2–20 mm.
- Every colour starts at the global default pixel height.
- **Randomize** sets every colour to a random height between a min and a max the user chooses. A seed field is available, so results can be reproduced.
- **Height modes** (in the UI and presets):
  - `uniform`: all colours the same.
  - `random`: within min and max, using the seed.
  - `brightness`: darker is lower or higher (a toggle), mapped onto min–max.
  - Sliders then adjust individual colours.
- Merged and deleted colours take on the height of the colour they become.
- In `uniform` mode, a single "pixel height" slider sets every colour.

### 4.5 Geometry & size (parity)
- Width and height of the model's outline, in mm or inches, each set with a **slider plus a number box**.
  - "Keep aspect ratio" is on by default. Turned off, width and height scale independently, so pixels become rectangles.
  - **Pixel size stays fixed while editing.** Width and height set the size of one pixel in mm. Painting or erasing pixels outside the current outline grows or shrinks the model and updates the Width and Height readouts; the model is never rescaled to fit. Moving a size slider, loading an image, or changing Pixels across sets a new pixel size.
- Every size and thickness control in the app (base, wall, hole, loop, pixel height) is a slider with a number box.
- Optional base with its own height and colour. The base follows the pixel outline. Base settings are hidden while the base is off.
- **Favourite colours:** five slots, saved in the browser.
  - Click a slot to use that colour. "Save" adds the current colour. Right-click a slot to remove it.
  - The same favourites row appears wherever a model colour is chosen: the base, and the loop when there is no base.
- **The base colour is exported correctly** (bug fix).
- **Inside (new; the UI calls it "Inside", not "Bottom"):** `solid` (default), `shell` or `hollow`. *(Confirmed by the user.)*
  - `shell`: the inside is hollowed out to save filament and weight. A closed bottom skin and side walls of a set thickness remain.
  - `hollow`: as `shell`, but the bottom is left open, like an upside-down tray.
  - Wall and floor thickness: 0.8–5 mm.
  - Not available for `halves`, where the flat glue faces must stay solid. Double sided allows `shell` only, since it has no flat bottom.
  - A warning appears when the model is too thin to hollow out.
  - **Cut view:** a viewport toggle that slices the model through the middle of a pixel row. Solid cut faces show in gold and empty space stays empty, so `shell`, `hollow` and magnet pockets can be seen. It switches on automatically the first time `shell` or `hollow` is picked.

### 4.6 Two-sided (new)
A setting with three values, labelled in the UI as **One side / Double sided / Two halves**:
- `single`: the reference behaviour, with pixels on one face.
- `solid` (Double sided): one piece.
  - The base is in the middle and pixel layers are built on both faces.
  - The back pixels sit directly behind the front ones, so the outlines line up. Seen from behind, the art therefore reads as a mirror image; this can't be avoided, because the outline itself is mirrored when seen from behind.
- `halves`: two models exported together, the front and the back. The back's art is mirrored in the file, so once it is flipped and glued its outline matches the front. Each half lies flat side down on the bed.
- **Colour heights apply to** (shown for Double sided and Two halves): `both` (default) or `top`.
  - With `top`, only the up-facing side (Double sided) or the front half (Two halves) uses per-colour heights.
  - The other side uses the uniform pixel height.
  - Each half gets half the base thickness, so the glued result equals the `solid` version.
  - Magnet pockets open onto the glue face and are mirrored on the two halves, so the magnet is hidden inside once the halves are glued. *(Claude's call.)*
  - For export: one 3MF with two plates or objects, or two STL files (`name_front`, `name_back`).
- **Halves join with** (shown for Two halves): **Glue** (default) or **Magnets (clicker)**.
  - Clicker: a fidget toy. The two halves are not glued; magnet pairs hold them face to face, and pulling them apart and letting go makes them snap back with a click.
  - Turning it on with no magnets placed auto-places two pairs, as far apart as the art allows along its long side with at least 1 mm of plastic around each. With fewer than two pairs a warning asks for more, since two are needed for the halves to line up.
  - Pockets are either **Open on face** (flush with the inside face, magnet pressed in, faces meet flat) or **Sealed under face** (0.4 mm skin, 3MF pause at the layer that closes the pocket). The magnet count reads as pairs, for example "2 pairs, 4 magnets".
  - The UI reminds the user about polarity: let each pair snap together first, then press them in without flipping either, so the halves attract.

### 4.7 Keychain (parity, reworked)
- **Hole:** **Round** (a cylinder) or **Square** (a square prism), 2–10 mm across, cut with a true boolean subtraction. It is not snapped to the pixel grid, so it can cut part-way through pixels. A flat gold marker on the model's top surface is dragged to move it. It cuts through every layer: base, pixels, and both faces or halves. Moving the hole never moves or lifts the model: handles are not counted in the model's size or position.
- **Loop:** a ring joined to the model's outside edge. Its place is a **Position slider from 0 to 359°** (0° is straight up, clockwise). It is not dragged. The engine walks outwards from the shape's centre at that angle and attaches the loop to the outward-facing pixel edge where it leaves the shape. Inner and outer diameter settings.
  - Colour: the base colour when there is a base. Otherwise there is a loop colour setting with favourites.
  - Two styles: **Rounded loop**, a smooth ring, and **Pixel loop**, a square frame with a square hole that matches the blocky art. Both styles use the exact Hole and Outside sizes in mm and scale smoothly; they are not built from whole art pixels, so the hole is always centred whatever the sizes.
  - The loop is **merged into one watertight body** with the base, or with the full outline when there is no base, in both STL and 3MF.
- Loop thickness equals the base thickness, or the lowest colour height when there is no base. *(Claude's call.)*
- The keychain works in all two-sided modes. In `halves`, the loop or hole is split across both halves, with each half getting half the thickness, so the glued loop is full thickness.

### 4.8 Magnets, viewer, export, misc (parity)
- **Magnet pockets** are real cut-outs (boolean subtraction) in the model, with presets plus a custom size. Each pocket is a true cylinder matching the magnet, not a stack of whole pixels.
  - **Pocket in bottom:** open on the bed face, so the magnet is pressed in after printing.
  - **Sealed in centre:** an enclosed pocket inside the base. The 3MF includes a pause at the layer that closes the pocket, so the magnet can be dropped in during the print.
  - Double sided always uses the sealed pocket. Glued halves always use pockets open on the glue face; clicker halves offer open or sealed (see 4.6).
  - A readout shows the material left above and below the pocket.
  - "Place a magnet" enters placement mode: click the model to drop one, or press Esc to cancel. Placed magnets can be dragged and removed one by one, and there is a Clear all.
  - A warning appears when the base is too thin for the chosen magnet.
- **Viewer:** orbit, zoom, pan, reset, and a grid in mm or inches. **Grid options:** show or hide, colour, and opacity (0–100%).
- **Single colour (new):** an export choice of All colours or One colour, with a colour picker.
  - One colour keeps all the height steps but exports the model as one body.
  - The preview shows it in the chosen colour.
  - It applies to both STL and 3MF.
- **STL:** single colour, binary.
- **3MF:** multi-colour, built as **one object made of parts**, one part per colour plus the base, so the slicer keeps it together as a single model. Colour layers are **merged flush with the base**, with no 0.02 mm gap that depends on the slicer to close it.
  - **Bambu Studio (primary, tested by the user):** write `Metadata/model_settings.config` so each part opens already assigned to filament slot 1..N, in palette order, with the filament colours set. Opening the file should need no manual filament assignment.
  - **OrcaSlicer:** reuses the Bambu metadata format.
  - **PrusaSlicer:** write `Slic3r_PE_model.config` with per-part extruder assignment.
  - **Other slicers:** standard 3MF colour data as a fallback.
  - Export has a slicer target setting (default Bambu Studio). Only Bambu Studio is checked by hand; the others are done as well as possible from their published formats.
- **Rotate (new):** an export orientation setting.
  - Rotate in 90° steps about X, Y and Z, with shortcuts for "flat" and "on edge".
  - The model is always placed so its lowest point sits on the bed (Z=0), and the preview shows the result.
  - The setting is included in presets.
  - The two-sided `solid` model defaults to flat, with a note recommending `halves` for the cleanest finish.
- Resizable panels, a mobile layout and keyboard shortcuts.
- **Export lives in the top bar:** an Export button opens a panel with All colours / One colour, format, slicer, file name and a summary line (files, filament count, dimensions). The settings column scrolls on its own, with nothing pinned to the bottom.
- **The 3D view must not flicker while the window or panels are resized:** it redraws in the same frame as the resize.

### 4.9 Reference-app bugs that must not carry over
- The base colour is ignored on export.
- The floating ring is missing from STL and is not joined to the model.
- An empty base object is exported when the base is off.
- A slicer-dependent gap between colour layers and the base.
- The 256 px cap.

### 4.10 Pipeline order and edit state *(Claude's calls)*
- **Fixed order:** decode → detect pixel scale → crop → background removal → palette reduction → colour rules / recolours / deletes → paint edits → heights → mesh → booleans → export.
- **Edits are an ordered list on top of the source image**, not changes baked into it.
  - When an earlier setting changes (crop, tolerance, colour count), the edits are replayed.
  - A recolour or height edit whose colour no longer exists is dropped, and a short notice says so.
  - Painted pixels outside a new crop are dropped.
- **Colour rules match the reduced palette**, the same colours the user sees in the UI, using the tolerance.
- **"Save as preset"** turns this image's per-colour heights, recolours and deletes into colour rules automatically. Painted pixels are specific to one image and are not saved into presets.
- **Islands and corner contact:**
  - Pixels that touch only at a corner are separated by a tiny gap, as in the reference, so the art is unchanged.
  - Pixels are joined only when they share an edge. The base follows the pixel outline, so it doesn't join separate islands either.
  - More than one piece is a **warning**, never "Watertight":
    - the status bar shows "▲ N separate pieces" in red, and so does the size readout;
    - a viewport note explains why (and mentions corner-only contact when there is any);
    - every piece except the largest is outlined in red in the image preview;
    - a **Remove strays** button keeps the largest piece and deletes the rest, and can be undone.
  - Export is still allowed, since loose parts can be intentional. Batch runs report the piece count per file.
  - The keychain loop attaches to the island nearest the click.
- **Image decoding:** the same pure-JS decoders are used in both the browser and Node, so batch output matches the UI exactly.

## 5. Presets

- A preset is a versioned JSON file. The UI can **save the current settings as a preset** and load one.
- **General rules** apply to any image: colour count, background removal, size, base, two-sided mode, which side the colour heights apply to, keychain (type, style, sizes), magnets, height mode with its min, max and seed, rotation, export format, and single-colour on or off.
- **Colour rules** apply only when an image contains that colour:
  - match by hex with a tolerance;
  - then `height`, `recolour`, or `delete`.
- Colour rules override general rules.
- Placement of the keychain and magnets in presets is relative: `top-center`, `top-left`, or x,y as fractions of the bounding box. The engine snaps that position to the nearest valid outline or interior point.

## 6. Headless API

All three interfaces call the same core function: `convert(image, preset) → { files, report }`.

- **CLI:** `px3d convert <files|globs|dir> --preset p.json --out dir [--format stl|3mf] [--overrides ...]`.
  - Writes one file per image, or two for `halves`.
  - Writes a `report.json` listing, per image: the palette found, the rules applied, the final heights, the output paths and any error.
  - One bad image doesn't stop the batch. The exit code is non-zero if any image failed.
- **HTTP API:** `px3d serve --port 7300`, bound to localhost by default.
  - `POST /convert`: multipart image and preset, returns the file or a zip.
  - `POST /batch`: returns a job id; `GET /jobs/:id` gives the status and report.
  - `GET /health`.
  - An OpenAPI doc so Python clients are easy to write.
- **MCP server:** `px3d mcp`.
  - Tools: `convert_image`, `convert_folder`, `inspect_image` (returns the palette and dimensions so Claude can write colour rules) and `list_presets`.
- **Python:** no separate SDK in v1. A short example script in `examples/` calls the CLI or HTTP API.

## 7. Quality bar / acceptance

- Every exported mesh is manifold, checked by an automated test using manifold-3d. This covers: single, solid and halves; hole and loop; magnets; base on and off; corner-touching pixels.
- **Golden-file tests:** fixed sprites + presets give stable output (by mesh stats or hash). CLI output equals the output from the core library called directly.
- A 3MF from a fixture opens in **Bambu Studio** (manual check by the user) as one model, with each colour already on its own filament slot and the correct colours, including the base. Orca and Prusa output is checked by automated tests of the metadata structure only.
- Performance: changing a height slider on a 128×128 sprite updates the preview within about 1 frame budget (<50 ms). A batch of 100 64×64 sprites finishes in under 30 s on the user's PC.

## 8. Left to the builder

- Mesh strategy (greedy meshing or per-pixel faces), as long as the output is watertight and fast enough.
- The UI component approach, styling and layout details, within "professional and snappy". Use the reference layout as a starting point.
- The internal format for the undo history, the exact preset schema field names, and the monorepo tooling.
- Whether the web app runs mesh generation in a Web Worker.

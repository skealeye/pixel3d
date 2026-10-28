# pixel3d — Design

Date: 2026-10-27 · Status: approved 2026-10-28 (keycap clicker §4.6b has open bugs the user will raise) · Mockup v0.1.x; app starts at 0.2.0

## 1. Intent

Turn pixel art images into 3D-printable models quickly, either one at a time in a polished app or in batches without a UI, driven by Python or Claude.

US spelling throughout, including code and preset keys (R28).

The reference is https://oct0f1sh.github.io/PixelArtTo3D/ (source: github.com/oct0f1sh/PixelArtTo3D). The user likes almost all of it. pixel3d keeps its feature set, fixes its bugs, and adds what it lacks:

1. **Height per color.** Each palette color can sit at a different height.
2. **Color editing.** Recolor a palette entry, or paint individual pixels.
3. **Two-sided models.** Either one solid piece or two flat-backed halves to glue together.
4. **Headless batch API.** A CLI, a local HTTP API and an MCP server.

Success means the user can drop in a sprite, adjust heights and colors, and get a clean, watertight STL/3MF that slices without repair. It also means they can point Claude or a Python script at a folder and get the same quality output for every file.

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
- Models that need repair in the slicer: non-manifold edges, gaps between color bodies, or floating parts.
- Batch output that differs from what the UI would produce for the same preset.
- A sluggish UI, such as a visible delay on every slider move.
- Exported colors that don't match what the preview shows (the reference app's base-color bug).

## 3. Decided "how" (Claude's calls; user delegated: "whatever is fast, snappy and feels professional")

- **TypeScript monorepo** with three parts:
  - `core`: a pure engine with no DOM. Image → pixel grid → colors → heights → mesh → STL/3MF bytes.
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
  - Turned on automatically when the image doesn't look like pixel art: more than 64 distinct colors, or larger than the cap after upscale detection. It can also be toggled by hand for any loaded image.
  - **Pixels across** (8–128, default 32): the image is shrunk to this width by area averaging, with height following the aspect ratio.
  - **Colors** (2–16, default 8): the shrunk pixels are reduced with seeded k-means, so the same image and settings always give the same palette.
  - A solid background color (all four corners within a tolerance of 40) is cleared at full resolution before shrinking, so edge pixels don't pick up a blended fringe.
  - Both sliders update the model live. Pixelate settings are part of presets, so batch runs can convert photos too.
- Crop tool, a source preview with zoom and pan, and a pixel-grid overlay.
- **The image panel can be enlarged:** an Expand/Shrink button (about 45% of the window) and a draggable divider between the panel and the 3D view.

### 4.2 Background removal (parity)
- An on/off toggle, on by default.
  - The background color is found automatically when all four corners match within the tolerance. Otherwise the user can **Pick** it: removal switches off so the background shows, and the user clicks it in the image preview. The color is read from the original image. A swatch shows the color and how it was chosen: found in the corners, picked, or none found.
  - **Tolerance** runs 0–50 % (default 10 %) of the full RGB distance.
  - Removal is a **flood fill from the image edge**: only background touching the edge is cleared, so the same color inside the art (eye whites, highlights) stays.
  - When pixelating, removal runs at full resolution before shrinking, so edge pixels don't blend into a fringe.
  - Changing any background setting keeps the pixel size, the hole and the magnets.
- Only background connected to the image edges is removed.

### 4.3 Palette (parity + new)
- Reduce to N colors by merging the closest pair. Delete a color (its pixels go to the nearest remaining color) and restore deleted colors.
- Each palette row shows a swatch, hex code, **height slider** and actions.
- **Recolor (new):** pick a palette entry and choose a new color. Every pixel of that color changes, and the entry keeps its height. If the new color matches an existing entry, the two entries merge.
- **Paint (new):** pick a palette entry, then click or drag on the source preview to paint pixels with it.
  - An eraser makes pixels transparent.
  - An "add color" button creates a new palette entry to paint with.
  - Painting a pixel into a previously empty spot extends the model.
- Undo and redo (50 steps) cover all palette, paint and height edits.
- **Restore colors:** brings back the original colors and pixels after deletes or recolors, and keeps the heights set for colors that still exist.
- **Reload image:** returns to the original image, undoing all color, paint and height edits. Both actions can be undone.

### 4.4 Heights (new)
- Each color has a height, measured from the top of the base, or from the bed if there is no base. The range is 0.2–20 mm.
- Every color starts at the global default pixel height.
- **Randomize** sets every color to a random height between a min and a max the user chooses. A seed field is available, so results can be reproduced.
- **Height modes** (in the UI and presets):
  - `uniform`: all colors the same.
  - `random`: within min and max, using the seed.
  - `brightness`: darker is lower or higher (a toggle), mapped onto min–max.
  - Sliders then adjust individual colors.
- Merged and deleted colors take on the height of the color they become.
- In `uniform` mode, a single "pixel height" slider sets every color.

### 4.5 Geometry & size (parity)
- Width and height of the model's outline, in mm or inches, each set with a **slider plus a number box**.
  - "Keep aspect ratio" is on by default. Turned off, width and height scale independently, so pixels become rectangles.
  - **Pixel size stays fixed while editing.** Width and height set the size of one pixel in mm. Painting or erasing pixels outside the current outline grows or shrinks the model and updates the Width and Height readouts; the model is never rescaled to fit. Moving a size slider, loading an image, or changing Pixels across sets a new pixel size.
- Every size and thickness control in the app (base, wall, hole, loop, pixel height) is a slider with a number box.
- Optional base with its own height and color. The base follows the pixel outline. Base settings are hidden while the base is off.
- **Smooth edges** (user request 2026-10-28; review fixes 0.2.36): a checkbox in the Base section, off by default, shown even with the base off. It rounds the stepped pixel edge of the shapes the app generates: the flat model's base (and the halves' bases and the Inside wall that follow it), the outline ring (§4.7b), and the clicker's cap backing, well and body footprint. The art's pixel columns always stay pixel-shaped.
  - Method: the traced outline is grown by half a pixel with round joins and closed at half a pixel (round joins), then simplified. The result always contains the art, so no art pixel overhangs the base, and the base reaches half a pixel past the art. A clicker's well is the smoothed cap outline grown by the fit gap, so it clears the cap by at least the fit gap everywhere.
  - A keychain loop moves out by the base's margin (the larger of the outline width and the smoothing margin) so it still sits on the edge. With no base and no outline, a flat model has nothing to smooth.
- **Favorite colors:** five slots, saved in the browser.
  - Click a slot to use that color. "Save" adds the current color. Right-click a slot to remove it.
  - The same favorites row appears wherever a model color is chosen: the base, and the loop when there is no base.
- **The base color is exported correctly** (bug fix).
- **Inside (new; the UI calls it "Inside", not "Bottom"):** `solid` (default), `shell` or `hollow`. *(Confirmed by the user.)*
  - `shell`: the inside is hollowed out to save filament and weight. A closed bottom skin and side walls of a set thickness remain.
  - `hollow`: as `shell`, but the bottom is left open, like an upside-down tray.
  - Wall and floor thickness: 0.8–5 mm.
  - Not available for `halves`, where the flat glue faces must stay solid. Double sided allows `shell` only, since it has no flat bottom.
  - A warning appears when the model is too thin to hollow out.
  - **Cut view:** a viewport toggle that slices the model through the middle of a pixel row. Solid cut faces show in gold and empty space stays empty, so `shell`, `hollow` and magnet pockets can be seen. It switches on automatically the first time `shell` or `hollow` is picked.
  - **X-ray:** a viewport toggle that makes the model see-through, with an opacity slider (5–90 %, default 30 %), so holes, pockets, hollows and the clicker's switch seats show from outside. A highlighted color (Select) stays solid. View-only, not saved (user request 2026-10-28).

### 4.6 Two-sided (new)
A setting with three values, labeled in the UI as **One side / Double sided / Two halves**:
- `single`: the reference behavior, with pixels on one face.
- `solid` (Double sided): one piece.
  - The base is in the middle and pixel layers are built on both faces.
  - The back pixels sit directly behind the front ones, so the outlines line up. Seen from behind, the art therefore reads as a mirror image; this can't be avoided, because the outline itself is mirrored when seen from behind.
- `halves`: two models exported together, the front and the back. The back's art is mirrored in the file, so once it is flipped and glued its outline matches the front. Each half lies flat side down on the bed.
- **Color heights apply to** (shown for Double sided and Two halves): `both` (default) or `top`.
  - With `top`, only the up-facing side (Double sided) or the front half (Two halves) uses per-color heights.
  - The other side uses the uniform pixel height.
  - Each half gets half the base thickness, so the glued result equals the `solid` version.
  - Magnet pockets open onto the glue face and are mirrored on the two halves, so the magnet is hidden inside once the halves are glued. *(Claude's call.)*
  - For export: one 3MF with two plates or objects, or two STL files (`name_front`, `name_back`).

### 4.6b Keycap clicker (new)
A fidget clicker in the style of the Vostok Labs Clicker Generator (user's reference): the art becomes a key cap that clips onto a real **Cherry MX style keyboard switch**, and a printed body holds the switch. Pressing the cap gives a real keyboard click. No magnets are involved.
- Chosen with a **Make: Flat model / Clicker** switch at the very top of the settings panel, so it can't be missed. Choosing Clicker shows the Clicker settings directly below it. Inside, Sides, Magnets and Orientation are hidden. Keychain stays: a clicker's keychain is a loop on the body, sticking out at the bed as thick as the base (capped at the body's height), in the base color, placed by the loop's angle around the body, at a chosen Height: Bottom (on the bed, default) or Center (halfway up the body; needs supports). Hole is disabled, because it would cut into the switch (user request 2026-10-28). Size, Base, colors and heights still apply to the cap.
- **Two printed parts** *(geometry per user reference, R22: the user's print-verified cutters `partsref.obj` and finished `Skull.obj`; measured in `.superpowers/sdd/2026-10-28-pixel3d/clicker-reference.md`)*:
  - **Cap:** a solid, art-shaped cap: a backing in the base color (the base height, but at least 4.55 mm: the 3.35 mm pocket plus a 1.2 mm roof; with Base off it is still there) with the art's color heights on top. Interior holes in the art are filled in the backing. *(User request 2026-10-28:)* art made of separate islands gets one backing: islands are bridged by a close (grow by r, shrink by r, round joins) with the smallest r, in 0.25 mm steps up to 3 mm, that makes the backing one piece. The body's footprint follows the bridged backing. The art pixels themselves never change. Its flat underside has, per switch, a **pocket** (a rounded square tapering from 14.5 mm at the mouth to 14.0 mm, 3.35 mm deep) round a **5.8 mm round stem** flush with the underside, and an **MX cross socket 4.27 × 1.22 mm, 3.35 mm deep** in the stem. It prints underside down, art up; the only overhang is the small pocket ceiling.
  - **Body:** the footprint, with a **well** shaped like the cap's outline (bridged, smoothed, with any ring; the art's holes filled) plus the fit gap. Below the well floor, per switch: a **20.0 mm** rounded-square lead-in, a **19.0 mm** rounded-square column 3.0 mm tall round the switch's top housing, and a blind **14.1 × 14.56 mm press-fit shaft** (14.56 on the clip axis) 8.38 mm deep for the lower housing and pins, over a 1.2 mm floor. There is no plate: the switch rests on the 14.1 → 19.0 step (the seat). With the cap seated on the switch at rest (stem tip 11.6 above the seat), the well floor sits 4.0 mm of travel plus a 0.4 mm margin below the cap (seat + 3.85). The body prints underside down: every step widens upward, so it needs no supports (the reference prints its body rim down only because its underside is sculpted).
- **Settings:**
  - **Cap backing** (user request 2026-10-28): Base color (default) or Art colors. With Art colors the cap has no base color: each art pixel's color runs the full depth of the cap, from its underside to that pixel's top, and the pocket, stem and cross socket are cut through all colors. Backing that isn't art (filled holes, bridges between islands, the smoothed margin) takes the color of the nearest art pixel; with an outline ring, the backing outside the art's silhouette takes the outline color. The art's top surface and the per-color heights are unchanged. The body still prints in the base color, so the filament count is the art colors plus the body's (fewer when the base color matches an art color).
  - **Body shape:** Outline (default; the cap's outline (bridged, smoothed, with any ring) grown by the border, keeping the pixel look unless smoothed), Circle or Square (rounded corners).
  - **Border:** 1.5–10 mm, default 3. The body's wall beyond the well (the cap's outline plus fit gap); never less than 1.2 mm round each switch's lead-in.
  - **Cap height:** 0.5–4 mm, default 2. How far the cap's backing stands above the body's rim at rest.
  - **Fit gap:** 0.2–1.5 mm, default 0.5. The clearance between the cap and the well wall (per user reference, R22: the working print has about 0.6–1.4).
  - **Switches:** 1, 2 or 3 (default 1). Multiple switches are spaced at keyboard pitch (19.05 mm) along the art's long side, centered.
  - **View:** Assembled (default) or Apart (as printed, cap beside the body). Assembled shows the cap seated in the body on a see-through stand-in switch. Cut view works in both.
  - **Press preview** (Assembled only): hold the Press button, or hold Space, and the cap and the switch stem travel the full 4 mm down and spring back on release. A short click sound plays at the actuation point (2 mm) on the way down and again on the way up.
- **Warnings:** art smaller than the pocket plus a 1.5 mm wall each side (17.5 mm) can't cover the switch, and so can't art that leaves part of that 17.5 mm square over any switch uncovered. *(User request 2026-10-28:)* pieces are counted per printed object (`pieceCounts: { cap, body }`; `pieces` stays the larger), and a split is named: "The cap is in 3 pieces. Move the islands closer together or join them." (the body's warning adds "or pick Circle or Square for the body shape"). This only shows when islands are still apart after a 3 mm bridge. A clicker never shows the stray-pixel outline, note or Remove strays, nor the grid's own piece count while its model builds. The hint states how many switches are needed and how to assemble it: press the switch into the body from above until it sits on the step, then push the cap on.
- **Export:** the cap and body as two objects in one 3MF (the cap multi-color, the body in the base color), or two STLs (`name_cap`, `name_body`).
- **Fit:** the switch numbers above come from the user's print-verified reference (R22). A small **fit-test** export holds a stem coupon (the cap's pocket, stem and cross) and three shaft coupons at the shaft size −0.1, 0 and +0.1 mm (`socket_-0.10`, `socket_+0.00`, `socket_+0.10`, laid out in that order and notched 1, 2 and 3 times), so the user can check the press fit on their own printer before printing a full clicker. The user prints on a Bambu printer and can test this.
- Presets include all clicker settings, so batch runs can produce clickers.

### 4.7 Keychain (parity, reworked)
- **Hole:** **Round** (a cylinder) or **Square** (a square prism), 2–10 mm across, cut with a true boolean subtraction. It is not snapped to the pixel grid, so it can cut part-way through pixels. A flat gold marker on the model's top surface is dragged to move it. It cuts through every layer: base, pixels, and both faces or halves. Moving the hole never moves or lifts the model: handles are not counted in the model's size or position.
- **Loop:** a ring joined to the model's outside edge. Its place is a **Position slider from 0 to 359°** (0° is straight up, clockwise). It is not dragged. The engine walks outwards from the shape's center at that angle and attaches the loop to the outward-facing pixel edge where it leaves the shape. Inner and outer diameter settings.
  - Color: the base color when there is a base. Otherwise there is a loop color setting with favorites.
  - Two styles: **Rounded loop**, a smooth ring, and **Pixel loop**, a square frame with a square hole that matches the blocky art. Both styles use the exact Hole and Outside sizes in mm and scale smoothly; they are not built from whole art pixels, so the hole is always centered whatever the sizes.
  - The loop is **merged into one watertight body** with the base, or with the full outline when there is no base, in both STL and 3MF.
- Loop thickness equals the base thickness, or the lowest color height when there is no base. *(Claude's call.)*
- The keychain works in all two-sided modes. In `halves`, the loop or hole is split across both halves, with each half getting half the thickness, so the glued loop is full thickness.

### 4.7b Outline (new; user request 2026-10-28)
- A ring around the art's outer edge, in its own color. It follows only the outer edge: the art's interior holes stay open (on a flat model the base, the ring and the Inside cavity all keep them; a clicker's backing fills them as before). Settings: on/off (default off), **Width** 0.5–5 mm (default 1.5; slider plus number box, mm or inches) and **Color** (default black, with favorites). The Outline section sits right after Base.
- It follows the pixels (a mitered offset, square corners), or is rounded with Smooth edges (§4.5). Separate islands each get their own ring; rings closer than twice the width merge.
- **Height:** the art's lowest color height above the base, so it reads as a border, not a wall. *(Claude's call: the user's suggestion kept; anything taller would hide low art at its edge, anything lower would leave a step under the art's edge.)*
- **Flat model:** it sits on the base, and the base grows outward to hold it. With no base it stands on the bed beside the art, flush with it, so the two are one piece. Double sided puts it on both faces; Two halves mirrors it on the back half like the art. A keychain loop moves out by the ring width, so the ring never runs into its hole. Inside (shell, hollow) hollows under the art and the ring.
- **Clicker:** it goes round the cap, on the backing. The cap backing grows to include it, and so do the body's well and footprint. With Art colors backing, the backing under the ring is the outline color.
- It is its own part named `outline`, after the art colors. It counts as a filament and shares a slot when its color matches an art, base or loop color (R25).

### 4.8 Magnets, viewer, export, misc (parity)
- **Magnet pockets** are real cut-outs (boolean subtraction) in the model, with presets plus a custom size. Each pocket is a true cylinder matching the magnet, not a stack of whole pixels.
  - **Pocket in bottom:** open on the bed face, so the magnet is pressed in after printing.
  - **Sealed in center:** an enclosed pocket inside the base. The 3MF includes a pause at the layer that closes the pocket, so the magnet can be dropped in during the print.
  - Double sided always uses the sealed pocket. Halves always use pockets open on the glue face.
  - A readout shows the material left above and below the pocket.
  - "Place a magnet" enters placement mode: click the model to drop one, or press Esc to cancel. Placed magnets can be dragged and removed one by one, and there is a Clear all.
  - A warning appears when the base is too thin for the chosen magnet.
- **Viewer:** orbit, zoom, pan, reset, and a grid in mm or inches. **Grid options:** show or hide, color, and opacity (0–100%).
- **Single color (new):** an export choice of All colors or One color, with a color picker.
  - One color keeps all the height steps but exports the model as one body.
  - The preview shows it in the chosen color.
  - It applies to both STL and 3MF.
- **STL:** single color, binary.
- **3MF:** multi-color, built as **one object made of parts**, one part per color plus the base, so the slicer keeps it together as a single model. Color layers are **merged flush with the base**, with no 0.02 mm gap that depends on the slicer to close it.
  - **Bambu Studio (primary, tested by the user):** write `Metadata/model_settings.config` so each part opens already assigned to filament slot 1..N, in palette order, with the filament colors set. Opening the file should need no manual filament assignment.
  - **OrcaSlicer:** reuses the Bambu metadata format.
  - **PrusaSlicer:** write `Slic3r_PE_model.config` with per-part extruder assignment.
  - **Other slicers:** standard 3MF color data as a fallback.
  - A base or loop whose color equals an art color shares its filament slot (R25).
  - Export has a slicer target setting (default Bambu Studio). Only Bambu Studio is checked by hand; the others are done as well as possible from their published formats.
- **Rotate (new):** an export orientation setting.
  - Rotate in 90° steps about X, Y and Z, with shortcuts for "flat" and "on edge".
  - The model is always placed so its lowest point sits on the bed (Z=0), and the preview shows the result.
  - The setting is included in presets.
  - The two-sided `solid` model defaults to flat, with a note recommending `halves` for the cleanest finish.
- Resizable panels, a mobile layout and keyboard shortcuts.
- **Export lives in the top bar:** an Export button opens a panel with All colors / One color, format, slicer, file name and a summary line (files, filament count, dimensions). The settings column scrolls on its own, with nothing pinned to the bottom.
- **The 3D view must not flicker while the window or panels are resized:** it redraws in the same frame as the resize.

### 4.9 Reference-app bugs that must not carry over
- The base color is ignored on export.
- The floating ring is missing from STL and is not joined to the model.
- An empty base object is exported when the base is off.
- A slicer-dependent gap between color layers and the base.
- The 256 px cap.

### 4.10 Pipeline order and edit state *(Claude's calls)*
- **Fixed order:** decode → detect pixel scale → crop → background removal → palette reduction → color rules / recolors / deletes → paint edits → heights → mesh → booleans → export.
- **Edits are an ordered list on top of the source image**, not changes baked into it.
  - When an earlier setting changes (crop, tolerance, color count), the edits are replayed.
  - A recolor or height edit whose color no longer exists is dropped, and a short notice says so.
  - Painted pixels outside a new crop are dropped.
- **Color rules match the reduced palette**, the same colors the user sees in the UI, using the tolerance.
- **"Save as preset"** turns this image's per-color heights, recolors and deletes into color rules automatically. Painted pixels are specific to one image and are not saved into presets.
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
- **General rules** apply to any image: color count, background removal, size, base, two-sided mode, which side the color heights apply to, keychain (type, style, sizes), magnets, height mode with its min, max and seed, rotation, export format, and single-color on or off.
- **Color rules** apply only when an image contains that color:
  - match by hex with a tolerance;
  - then `height`, `recolor`, or `delete`.
- Color rules override general rules.
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
  - Tools: `convert_image`, `convert_folder`, `inspect_image` (returns the palette and dimensions so Claude can write color rules) and `list_presets`.
- **Python:** no separate SDK in v1. A short example script in `examples/` calls the CLI or HTTP API.

## 7. Quality bar / acceptance

- Every exported mesh is manifold, checked by an automated test using manifold-3d. This covers: single, solid and halves; hole and loop; magnets; base on and off; corner-touching pixels; clicker cap and body (each shape, 1–3 switches).
- **Golden-file tests:** fixed sprites + presets give stable output (by mesh stats or hash). CLI output equals the output from the core library called directly.
- A 3MF from a fixture opens in **Bambu Studio** (manual check by the user) as one model, with each color already on its own filament slot and the correct colors, including the base. Orca and Prusa output is checked by automated tests of the metadata structure only.
- Performance: changing a height slider on a 128×128 sprite updates the preview within about 1 frame budget (<50 ms). A batch of 100 64×64 sprites finishes in under 30 s on the user's PC.

## 8. Left to the builder

- Mesh strategy (greedy meshing or per-pixel faces), as long as the output is watertight and fast enough.
- The UI component approach, styling and layout details, within "professional and snappy". Use the reference layout as a starting point.
- The internal format for the undo history, the exact preset schema field names, and the monorepo tooling.
- Whether the web app runs mesh generation in a Web Worker.

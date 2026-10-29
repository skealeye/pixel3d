# Clicker reference analysis (partsref.obj + Skull.obj)

Date: 2026-10-28. Read-only analysis. Scripts: `C:\Users\skeal\AppData\Local\Temp\claude\Z--Git\b4a902d6-8a44-4d18-9e93-3443a77fb0fa\scratchpad\objref\` (`parse.mjs`, `slice.mjs`, `loops.mjs`, `skull.mjs`, `gap.mjs`, `scan.mjs`, `diff.mjs`, `orient*.mjs`, `m3f.mjs`), using manifold-3d 3.5.4 from `Z:\Git\pixel3d\node_modules`.

Inputs:
- `Z:\3D_Print\ClickerParts\partsref.obj` (two groups, Maya export);
- `Z:\3D_Print\ClickerParts\*.3mf` (the same tools as originally downloaded from MakerWorld 1388810, "Negative modifiers to make clicker fidget toys");
- `Z:\3D_Print\SkullClicker\Skull.obj` and `Skull.3mf` (finished clicker that prints and works, per the user), plus `SkullBase.obj` (an earlier body).

## 0. Units and axes

- The OBJ header says "centimeters", but that is Maya's stock header. The values are mm. The bottom tool is 20.000 x 19.996 x 12.382 and the top tool is 14.52 x 14.50. The MakerWorld 3MFs, which are always in mm, hold the same meshes with identical X/Y sizes. In cm the cap pocket would be 145 mm wide, which is not plausible.
- The OBJ is Y-up (Maya). All heights below are the OBJ's Y, called Z here. The pieces share one axis at X = 0, Y = -0.1165 (Maya Z), to within 0.01 mm.

## 1. The pieces in partsref.obj

| group | bbox (mm, Z-up) | volume | watertight | components | what it is |
|---|---|---|---|---|---|
| `Top Clicker` (TopSG, white) | X -7.260..7.260, Y -7.366..7.134, Z 21.151..24.514 (14.52 x 14.50 x 3.362) | 554.80 mm³ | yes: 0 non-manifold edges, consistent winding, manifold status NoError | 2: a tube, genus 1, 524.78 mm³; a "+" prism, genus 0, 30.02 mm³ | **Cap cutter** (negative). It carves the switch pocket and the cross socket into the cap's underside and leaves a round stem behind. |
| `Clicker Bottom` (BottomSG, black) | X -9.994..10.006, Y -10.111..9.885, Z 5.534..17.916 (20.00 x 20.00 x 12.382) | 3132.56 mm³ | yes, same checks | 1, genus 0 | **Body cutter** (negative). It is the switch socket: a stepped housing pocket plus a blind shaft for the lower housing and pins. |

Neither piece is a positive insert. Both are subtracted (confirmed by the Skull, §5).

### 1a. Cap cutter ("Top Clicker"), all prismatic between Z 21.151 and 24.514
- **Outer wall (the pocket):** a rounded square, corner radius about 4.1 mm (4 facets per corner), tapered.
  - At Z 21.151 (pocket mouth, the cap underside): 14.518 x 14.499.
  - At Z 24.514 (pocket ceiling): 13.998 x 13.978.
  - That is 0.26 mm per side over 3.36 mm, a draft of about 4.4°, with the mouth wider.
- **Inner hole of the tube, which becomes the cap stem:** round and slightly lumpy (about 100 facets), 5.787 x 5.790. Its area is 26.21 mm², so the equivalent diameter is **5.78**.
- **Cross prism, which becomes the cross socket:** both arms are **4.272 / 4.267 long x 1.220 wide**, with no taper and sharp corners. It runs the full height, so the **socket is 3.36 deep**. It opens at the stem end and its end is level with the pocket ceiling.
- The original MakerWorld version (`cross+clicker+top.3mf`) is **3.00 mm tall**, with the 14.52 face on top. In partsref the user stretched it in height to **3.362** (x1.12) and flipped it so the wide end is the mouth. X/Y did not change.

### 1b. Body cutter ("Clicker Bottom"), three prismatic tiers
| Z (partsref) | height | section | role |
|---|---|---|---|
| 16.916..17.916 | 1.00 | 20.000 x 19.996, rounded corners (about 4 mm) | lead-in / top step, flush with the well floor |
| 13.917..16.916 | 3.00 | 19.005 x 19.010, rounded corners (about 3 mm) | **column clearance around the switch's top housing** |
| 5.534..13.917 | 8.383 | **14.106 x 14.560** rectangle, 0.11 corner chamfers | shaft for the lower housing and pins. Its top step (Z 13.917) is the **seat / plate-top equivalent**. |

- **There is no 1.5 mm plate.** The switch's top-housing flange sits on the 14.1 -> 19.0 step.
- The lower housing goes into a straight 14.1 x 14.56 shaft. The extra 0.56 (about 0.28 per side) is on the Y axis, the clip axis. The clips press against the shaft wall, so this is a **friction/press fit, not a snap under a plate**.
- **Depth below the seat:** 8.383, which is 5.0 housing + 3.3 pins + 0.08. The shaft is blind: it is closed by the art's material.
- Original 3MFs: "facing up" and "facing down" are the same 108-face mesh flipped, for bodies printed rim-up or rim-down.

### 1c. Assembled Z in partsref
- Cap cutter bottom (cap underside) is at 21.151. Body cutter top (well floor) is at 17.916. The gap is **3.235**.
- Relative to the seat (13.917):
  - well floor +4.0;
  - cap underside / stem end +7.23;
  - socket ceiling +10.60.

## 2. Functional dimensions (partsref; the Skull values in §5 take priority)
- **Switch opening:** 14.106 (X) x 14.560 (Y, clip axis), a straight shaft, no plate. The "plate thickness" is effectively the whole 8.38 shaft wall.
- **Depth below the seat:** 8.383 (blind).
- **Column clearance above the seat:** 19.0 square for 3.0 mm, then 20.0 square for the last 1.0 mm. The well floor is +4.0 above the seat.
- **Cap stem:** 5.78 round. Its end is flush with the cap underside, so there is no separate stem standing proud of a skirt.
- **Cross socket:** 4.27 x 1.22, 3.36 deep (3.00 in the original tool).
- **Skirt / pocket:** there is no skirt. The cap is solid apart from a 14.0 -> 14.5 tapered rounded-square pocket, 3.36 deep, around the stem.
- **Travel gap:** cap underside to well floor is 3.24 in the modeled pose (§5 explains why the real rest is probably about 1 mm higher, giving about 4.27).
- **Clips / alignment:** none, apart from these:
  - the cross itself;
  - the 4.4° pocket draft;
  - rounded tier corners;
  - the 20.0 lead-in step.

  Nothing keys the cap rotationally except the cross. Both cutters are coaxial.

## 3. The user's workflow (confirmed in Skull.obj)
1. Model the art as two solids:
   - a **cap**, the upper part of the sculpt, with a flat underside;
   - a **body**, the lower part, with a sculpted **well** that the cap drops into with clearance. The well is modeled by hand, not cut by a tool.
2. **Cap:** subtract `Top Clicker`, with its wide face flush with the cap underside (in the Skull it sits 0.012 below it). This leaves:
   - the 5.78 stem;
   - the cross socket;
   - the 14.0-14.5 pocket.
3. **Body:** subtract `Clicker Bottom`, with its top face flush with the well floor (in the Skull it sits about 0.02 above it). This leaves:
   - the 20/19 housing steps;
   - the blind 14.1 x 14.56 shaft.
4. **Nothing is unioned.** The output is two separate watertight objects.
5. **Print:**
   - cap underside down on the bed;
   - body upside down, rim on the bed.

   See §5.

## 4. Comparison with ours (clicker.ts as read 2026-10-28, spec §4.6b)
Ours, relative to the plate top P: floor 1.2, column `15.6 + 2*fitGap` (16.2 at 0.3) below and above the plate, 1.5 plate with a 14.0 square hole, well floor P+3.4, stem bottom P+7.8, socket ceiling P+11.6, backing underside P+12.3, `TRAVEL_MARGIN` 0.4.

| feature | reference (Skull-verified where marked *) | ours | matters? |
|---|---|---|---|
| switch hole | 14.10 x 14.56 straight shaft *| 14.0 x 14.0 in a 1.5 plate | yes: the ref is a print-verified press fit; ours is an untested snap fit |
| plate | none; the seat is a step *| 1.5 plate, with a 16.2 column below it | medium |
| depth below the seat | 8.38, blind *| 1.5 + 8.5 = 10.0, plus a 1.2 floor | low (both clear 8.3) |
| column above the seat | **19.0 for 3.0, then 20.0 for 1.0** *| **16.2 (15.6 + 2x0.3)** for 3.4 | **yes**: the ref gives about 1.7 per side round the housing; ours gives 0.3 |
| well floor above the seat | +3.98 *| +3.4 | low |
| cap underside / stem end above the seat | +7.22 modeled (+8.25 if seated on an 11.6 stem tip) | stem end +7.8 | low |
| travel room (stem end to floor) | 3.25 modeled; 4.27 riding on the tip | 4.4 (4.0 + 0.4) | ok either way |
| cap stem | **5.78** round, flush with the cap underside, 3.35 long *| 5.5 round, 4.5 long | medium |
| cross socket | **4.27 x 1.22**, both arms *| 4.1 x 1.3 | **yes**: the ref is 0.17 longer and 0.08 narrower; the narrower width is what grips |
| socket depth | **3.35** (the original tool was 3.0) *| 3.8 | medium |
| cap underside | **solid**; only a 14.0->14.5 rounded-square pocket (r about 4, 4.4° draft) 3.35 deep around the stem *| 1.2 skirt ring at the outline plus stems; a 17.6 square void per switch; the backing underside is otherwise open | **yes, the biggest one** |
| bridge under the cap backing | **none.** The cap prints underside-down. The only bridge is the pocket ceiling, 3.35 up, about 4.1 from the wall to the stem *| the whole backing inside the skirt bridges, with spans up to the art width | **yes** |
| cap-to-well side clearance | 1.27-1.39 over the lower 2.5 mm, falling to a 0.34 minimum near the rim *(sculpted)*. The user widened the well 0.1-0.15 per side between SkullBase and Skull *| fitGap 0.3 (outline offset, uniform) | yes: 0.3 is tighter than anything in the working print |
| body print orientation | rim down (upside down) *| underside down | low |
| floor under the shaft | 5.56 (just the art's thickness) *| 1.2 | none |

## 5. Skull.obj (print-verified)
`Skull.obj` has two groups. Each is one watertight shell (manifold status NoError, genus 0), and they do not intersect in the assembled pose (intersection volume 0.0000).

- **`polySurface2` = body:** 33.25 x 35.58 x 25.87 (Z -0.068..25.802), 10962.9 mm³.
  - Its cut faces (material `lambert5SG`, 218 tris) span X -9.994..10.006, Y -10.111..9.885, Z 5.557..17.916. That is exactly the body cutter's footprint.
- **`polySurface1` = cap:** 26.6 x 27.0 x 14.80 (Z 21.163..35.966), 5043.6 mm³.
  - Its cut faces (`empty_5SG4`, 498 tris) span X -7.259..7.259, Y -7.366..7.133, Z 21.163..24.514. That is exactly the cap cutter's footprint.
- **Separate objects:** yes. `Skull.3mf` holds 9 body copies on plate 1 and 4 caps on plate 2. Only `normal_part`s are present, so the booleans were done in Maya, not in the slicer.
- **What was subtracted:**
  - the cap cutter from the cap;
  - the body cutter from the body.
- **What was unioned:** nothing.
- **Where the pieces sit relative to the art:**
  - **Cap cutter:** its mouth is flush with the cap's flat underside, 0.012 below it.
  - **Body cutter:** in the Skull its tiers sit at 5.557 / 13.940 / 16.939, which is 0.023 higher than in partsref. Its top overlaps the hand-modeled well floor at 17.916, so the 20.0 tier is 0.98 deep.
  - Both cutters are centered on the same axis.
- **Body profile:**
  - **Well:** 27.36 x 26.91 at the floor (Z 17.92), 27.6 x 27.7 at Z 22, 27.8 x 28.3 at Z 24.8, then flaring at the rim (Z 25.80). The well is **7.88 deep**.
  - **Pocket below the well floor:** 20.0 for 0.98, 19.0 for 3.0, then the 14.1 x 14.56 shaft 8.38 deep down to Z 5.557.
  - **Material under the shaft:** 5.6 mm.
  - **Wall round the well:** about 1.6 at the rim to 3.5 lower down.
- **Cap profile:**
  - **Outside:** a flat underside 24.4 x 24.7, sculpted above.
  - **Pocket:** 14.48 -> 14.0, 3.35 deep.
  - **Stem:** 5.78. Its end is flush with the underside.
  - **Cross socket:** 4.27 x 1.22, 3.35 deep.
  - **Solid cap above the pocket ceiling:** 11.45 thick.
- **Art thickness:**
  - assembled height 36.03;
  - cap 14.80;
  - body 25.87;
  - the cap sits 4.64 into the well at rest.
- **Assembled Z (seat = 13.940):**
  - well floor +3.98;
  - cap underside +7.22;
  - socket ceiling +10.57.
  - The modeled gap from the cap underside to the well floor is **3.25**.
  - If the MX stem tip really is 11.6 above the plate (our `MX.above`), the cross bottoms out in the 3.35 socket and the cap rides 1.03 higher. That makes the real gap **4.27**, i.e. 4.0 travel + 0.27 margin, which matches our 4.0 + 0.4 approach.
  - Either way it is well past the 2.0 actuation.
- **Side clearance cap-to-well, assembled (min radial gap per slice):**

  | Z | 21.7 | 22.2 | 22.7 | 23.2 | 23.7 | 24.2 | 24.7 | 25.2 | 25.7 |
  |---|---|---|---|---|---|---|---|---|---|
  | gap (mm) | 1.39 | 1.37 | 1.37 | 1.37 | 1.28 | 0.89 | 0.56 | 0.34 | 0.73 |

  If the cap rides about 1 mm higher, the narrow 0.34 band moves above the rim, so the effective clearance is about 0.6-1.4.
- **Iteration evidence:** `SkullBase.obj` (an earlier body) had 37.8 mm³ more material, all in the well between Z 16.94 and 24.01. The final well is wider by:
  - 0.29 x 0.28 at the floor;
  - 0.19 x 0.19 at Z 20;
  - 0.10 x 0.09 at Z 22;
  - nothing from Z 24 up.

  The user loosened the lower well.
- **Print orientation (from the `Skull.3mf` transforms):**
  - **Cap:** raw +Y maps to +Z, so it prints **underside on the bed, art up**. The only overhang is the pocket ceiling at 3.35: a 14 mm rounded square round a 5.78 stem, bridging about 4.1 mm.
  - **Body:** raw +Y maps to -Z, so it prints **upside down, rim on the bed**. The well floor at 7.9 becomes a ceiling, an annulus from the 27.4 well in to the 20.0 step, about 3.7 per side. The shaft end (14.1 x 14.56) becomes a bridge 20.3 above the bed.

## 6. Differences to adopt, most important first
1. **Solid cap with a small pocket instead of a skirt and a bridged backing.** Make the cap underside flat and solid (the art's full footprint, printed underside down). Per switch, cut:
   - a pocket that tapers from 14.5 at the mouth to 14.0 at the ceiling, a rounded square (r about 4), 3.35 deep;
   - leaving a 5.8 round stem flush with the underside, with the cross socket through it.

   This removes the large backing bridge, which is our biggest printability risk, and matches what prints.
2. **Widen the column above the plate to 19.0 (3.0 tall) plus a 20.0 lead-in (about 1.0) up to the well floor.** At 15.6 + 2*fitGap, the column hugs the housing with 0.3 per side. The reference gives about 1.7.
3. **Cross socket 4.27 x 1.22 (both arms), about 3.35 deep (fit-test range 3.0-3.8).** This replaces 4.1 x 1.3 x 3.8. Keep the fit-test coupon so the user can tune width ±0.05.
4. **Cap-to-well clearance:** raise the default fitGap from 0.3 to about 0.5, and allow up to about 1.5. The working print has 0.6-1.4 effective, and the user loosened it between versions. Optionally add a draft so the well opens upward.
5. **Switch socket:** offer or switch to the reference press fit, a straight 14.1 x 14.56 shaft (the 14.56 on the clip axis), 8.4 deep below a seat step, with no separate 1.5 plate and no 15.6 under-column. It is simpler to print in either orientation and it is print-verified. If we keep the snap plate, still widen the cut to about 14.1 and fit-test it.
6. **Z stack:** keep the well floor at about seat +4.0 (ours is +3.4, which is fine). Keep the stem end at about seat +7.8 with 4.0 + 0.3-0.4 to the floor. The reference agrees once the cap rides on the 11.6 stem tip.
7. **Stem diameter 5.8 (ours 5.5) and stem length:** the stem need only be as long as the pocket depth (3.35), not 4.5. Low priority.
8. **Body print orientation:** optional. The reference prints rim-down; ours prints underside-down. Both are fine. Note it in the hints only if we adopt the blind shaft (5).

## Fit test result (2026-10-29)

The user printed the fit test (Bambu, 0.4 mm nozzle) with the shaft at the reference's 14.1 x 14.56. All three
coupons held a switch; the -0.10 coupon (one notch) was the nice snug fit. The body's shaft is now 14.0 x 14.46
(`MX.shaft`), and the fit test's steps are taken from that size.

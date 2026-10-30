<script lang="ts">
  import { change, live, recompute, stopPicking, app, toast, ui } from '../state.svelte';
  import { loadUrl } from '../load';
  import type { Edit } from '@pixel3d/core';
  import { openEditor, reloadImage, scalePaint } from '../actions.svelte';
  import { PIXELATE_BG_TOL_PCT, pixelatedSize } from '../pipeline';
  import SourceCanvas from './SourceCanvas.svelte';
  import Slider from './Slider.svelte';

  let url = $state('');
  const s = $derived(app.settings);
  const meta = $derived(app.meta);
  const loaded = $derived(!!app.source);
  const showBgRows = $derived(s.background.enabled || ui.picking);
  const bgText = $derived(
    !meta || meta.how === 'transparent' ? 'This image is already transparent.'
      : meta.how === 'picked' ? 'Picked by you.'
      : meta.how === 'corners' ? 'Found in the corners.'
      : 'None found. Use Pick to choose one.',
  );

  function toggleWide() {
    ui.wide = !ui.wide;
    ui.left = ui.wide ? Math.round(innerWidth * 0.45) : 330;
  }

  function toggleCrop() {
    if (!loaded) { toast('Open an image first.'); return; }
    ui.cropping = !ui.cropping;
    if (ui.cropping) { ui.picking && stopPicking(); toast('Drag over the image to crop it. Press Esc to cancel.'); }
  }

  function removeBg(on: boolean) {
    ui.picking = false;
    if (!loaded) { s.background.enabled = on; toast('This image already has a transparent background.'); return; }
    change(() => { s.background.enabled = on; });
  }

  // Pick: show the background again, then click it in the image
  function pick() {
    if (!loaded) { toast('Open an image first.'); return; }
    ui.cropping = false;
    if (ui.picking) return stopPicking();
    ui.picking = true;
    recompute();
    toast('Click the background color in the image.');
  }

  function setPixelate(box: HTMLInputElement) {
    const on = box.checked;
    if (!loaded) { box.checked = false; toast('Open an image first, then pixelate it.'); return; }
    // a new grid resolution sets a new pixel size (spec §4.5)
    change(() => { s.pixelate.enabled = on; delete s.pixelMm; });
  }

  const pixelated = () => !!meta?.pixelated;
  // pixelating clears the background at a fixed tolerance (as batch runs do), so the slider only works on pixel art
  const tol = live(() => s.background.tolPct, (v) => (s.background.tolPct = v), () => !pixelated());
  // a new pixel count sets a new pixel size (spec §4.5) and moves painted pixels onto the resampled grid, scaled
  // from the grid and edits as they were when the drag began (not cumulatively)
  let before: { edits: Edit[]; w: number; h: number } | null = null;
  const acrossLive = live(() => s.pixelate.across, (v) => {
    s.pixelate.across = v;
    delete s.pixelMm;
    if (!before || !app.source) return;
    const n = pixelatedSize(app.source, v);
    app.edits = scalePaint(before.edits, 0, 0, n.w / before.w, n.h / before.h);
  }, pixelated);
  const across = {
    begin: () => { before = app.grid && { edits: app.edits, w: app.grid.w, h: app.grid.h }; acrossLive.begin(); },
    set: acrossLive.set,
  };
  const colors = live(() => s.pixelate.colors, (v) => (s.pixelate.colors = v), pixelated);
</script>

<section>
  <h2>Image
    <button class="btn small" id="reloadImg" title="Undo every edit and go back to the original image" onclick={reloadImage}>Reload image</button><button class="btn small" id="expand" onclick={toggleWide}>{ui.wide ? 'Shrink' : 'Expand'}</button>
  </h2>
  <SourceCanvas />
  <div class="tools">
    <button class="btn primary" id="editPixels" title="Paint, erase and add colors in the Pixel Editor" onclick={openEditor}>Edit pixels</button>
    <button class="btn" id="crop" class:on={ui.cropping} onclick={toggleCrop}>Crop</button>
  </div>
  <form class="row" onsubmit={(e) => { e.preventDefault(); void loadUrl(url).then((ok) => { if (ok) url = ''; }); }}>
    <input id="url" type="url" placeholder="Or paste an image URL" aria-label="Image URL" bind:value={url}>
    <button class="btn small" type="submit">Load</button>
  </form>
  <label class="check"><input type="checkbox" id="removeBg" checked={s.background.enabled} onchange={(e) => removeBg(e.currentTarget.checked)}> Remove background</label>
  <div id="bgRows" style:display={showBgRows ? '' : 'none'}>
    <div class="row">
      <label for="pickBg">Background</label>
      <span class="bgsw" id="bgSw" style:background={meta?.bg ?? 'transparent'} style:display={meta?.bg ? '' : 'none'}></span>
      <span class="bginfo" id="bgInfo">{bgText}</span>
      <button class="btn small" id="pickBg" class:on={ui.picking} title="Click, then click the background in the image" onclick={pick}>Pick</button>
    </div>
    <!-- R27: while pixelating the tolerance in force is fixed (spec §4.1); show that value, dimmed, with the reason in the row -->
    <Slider id="bgTol" label="Tolerance" min={0} max={50} value={meta?.pixelated ? Math.round(PIXELATE_BG_TOL_PCT) : s.background.tolPct} unit="%"
      disabled={!!meta?.pixelated} title={meta?.pixelated ? 'Fixed while pixelating. Turn off Pixelate to adjust it.' : undefined}
      note={meta?.pixelated ? { id: 'tolHint', text: 'Fixed while pixelating.' } : undefined} {...tol} />
    <p class="hint">Only background touching the image edge is removed, so the same color inside the art stays.</p>
  </div>
  <label class="check"><input type="checkbox" id="pixelate" disabled={!!app.source?.blank} checked={!!meta?.pixelated} onchange={(e) => setPixelate(e.currentTarget)}> Pixelate: turn a photo or drawing into pixel art</label>
  <div id="pixRows" style:display={meta?.pixelated ? '' : 'none'}>
    <Slider id="pixW" label="Pixels across" min={8} max={128} value={s.pixelate.across} unit="px" {...across} />
    <Slider id="pixColors" label="Colors" min={2} max={16} value={s.pixelate.colors} hold="#pal" {...colors} />
  </div>
</section>

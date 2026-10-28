<script lang="ts">
  import { change, pushUndo, recompute, app, toast, ui } from '../state.svelte';
  import { loadUrl } from '../load';
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

  function reload() {
    if (!app.source) { toast('Open an image first.'); return; }
    const src = app.source;
    if (change(() => { app.edits = []; app.source = { ...src, crop: null }; })) toast('Image reloaded. Press Ctrl+Z to undo.');
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
    toast('Click the background colour in the image.');
  }
  function stopPicking() { ui.picking = false; recompute(); }

  function setPixelate(box: HTMLInputElement) {
    const on = box.checked;
    if (!loaded) { box.checked = false; toast('Open an image first, then pixelate it.'); return; }
    change(() => { s.pixelate.enabled = on; });
  }

  /** Slider changes: one undo step per drag. Pixelate sliders only matter while pixelating. */
  const live = (apply: (v: number) => void, when = () => true) => ({
    begin: () => { if (loaded && when()) pushUndo(); },
    set: (v: number) => { apply(v); if (loaded && when()) recompute(); },
  });
  const tol = live((v) => (s.background.tolPct = v));
  const across = live((v) => (s.pixelate.across = v), () => !!meta?.pixelated);
  const colours = live((v) => (s.pixelate.colours = v), () => !!meta?.pixelated);
</script>

<section>
  <h2>Image
    <button class="btn small" id="reloadImg" title="Undo every edit and go back to the original image" onclick={reload}>Reload image</button><button class="btn small" id="expand" onclick={toggleWide}>{ui.wide ? 'Shrink' : 'Expand'}</button>
  </h2>
  <SourceCanvas />
  <div class="tools">
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
    <Slider id="bgTol" label="Tolerance" min={0} max={50} value={s.background.tolPct} unit="%" {...tol} />
    <p class="hint">Only background touching the image edge is removed, so the same colour inside the art stays.</p>
  </div>
  <label class="check"><input type="checkbox" id="pixelate" checked={!!meta?.pixelated} onchange={(e) => setPixelate(e.currentTarget)}> Pixelate: turn a photo or drawing into pixel art</label>
  <div id="pixRows" style:display={meta?.pixelated ? '' : 'none'}>
    <Slider id="pixW" label="Pixels across" min={8} max={128} value={s.pixelate.across} unit="px" {...across} />
    <Slider id="pixColours" label="Colours" min={2} max={16} value={s.pixelate.colours} {...colours} />
  </div>
</section>

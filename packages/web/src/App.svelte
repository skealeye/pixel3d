<script lang="ts">
  import { VERSION } from '@pixel3d/core';
  import { redo, app, ui, undo, stopPicking } from './state.svelte';
  import { listen } from './load';
  import { register } from './hook';
  import { latencies } from './perf';
  import Header from './Header.svelte';
  import ImagePanel from './panels/ImagePanel.svelte';
  import PalettePanel from './panels/PalettePanel.svelte';
  import ClickerPanel from './panels/ClickerPanel.svelte';
  import SizePanel from './panels/SizePanel.svelte';
  import BasePanel from './panels/BasePanel.svelte';
  import InsidePanel from './panels/InsidePanel.svelte';
  import SidesPanel from './panels/SidesPanel.svelte';
  import KeychainPanel from './panels/KeychainPanel.svelte';
  import MagnetsPanel from './panels/MagnetsPanel.svelte';
  import OrientationPanel from './panels/OrientationPanel.svelte';
  import ViewportPane from './viewport/ViewportPane.svelte';
  import Footer from './Footer.svelte';
  import Toast from './Toast.svelte';
  import UpdatePrompt from './UpdatePrompt.svelte';

  let dragging = $state(false);

  $effect(() => listen(window, (on) => (dragging = on)));

  $effect(() => { document.body.style.setProperty('--left', ui.left + 'px'); });

  $effect(() => register({
    snapshot: () => ({
      name: app.source?.name ?? null,
      grid: app.grid && { w: app.grid.w, h: app.grid.h, opaque: app.grid.cells.filter((v) => v >= 0).length, palette: app.grid.palette.map((p) => ({ ...p })) },
      settings: $state.snapshot(app.settings),
      edits: app.edits,
      undo: app.undo.length,
      redo: app.redo.length,
      zoom: ui.zoom,
      version: VERSION,
    }),
    /** Input-to-preview times, ms (perf.ts). */
    latency: () => [...latencies],
  }));

  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t instanceof HTMLInputElement && /^(text|url|search|number)$/.test(t.type)) || t.classList.contains('num'));

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      ui.popover = null;
      ui.cropping = false;
      ui.placing = false;
      // Esc clears the Select tool's selection (R26); Paint keeps its brush
      if (ui.tool === 'select') ui.sel = null;
      stopPicking();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || typing(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  }
</script>

<svelte:window onkeydown={keydown} />

<Header />

<aside class="left">
  <ImagePanel />
  <PalettePanel />
</aside>

<ViewportPane />

<aside class="right">
  <ClickerPanel />
  <SizePanel />
  <BasePanel />
  <InsidePanel />
  <SidesPanel />
  <KeychainPanel />
  <MagnetsPanel />
  <OrientationPanel />
</aside>

<Footer />

<Toast />
<UpdatePrompt />
<div class="dropzone" class:show={dragging}><div>Drop an image to load it</div></div>

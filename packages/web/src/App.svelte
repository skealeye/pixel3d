<script lang="ts">
  import { VERSION } from '@pixel3d/core';
  import { redo, app, ui, undo, recompute } from './state.svelte';
  import { listen } from './load';
  import { register } from './hook';
  import Header from './Header.svelte';
  import ImagePanel from './panels/ImagePanel.svelte';
  import SettingsPlaceholder from './panels/SettingsPlaceholder.svelte';
  import ViewportPane from './viewport/ViewportPane.svelte';
  import Footer from './Footer.svelte';
  import Toast from './Toast.svelte';

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
  }));

  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t instanceof HTMLInputElement && /^(text|url|search|number)$/.test(t.type)) || t.classList.contains('num'));

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      ui.popover = null;
      ui.cropping = false;
      if (ui.picking) { ui.picking = false; recompute(); }
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
  <section>
    <h2>Colours and heights</h2>
    <p class="placeholder">{app.grid ? `${app.grid.palette.length} colours` : 'No image yet'}</p>
  </section>
</aside>

<ViewportPane />

<SettingsPlaceholder />

<Footer />

<Toast />
<div class="dropzone" class:show={dragging}><div>Drop an image to load it</div></div>

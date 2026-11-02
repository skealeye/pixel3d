<script lang="ts">
  import { untrack } from 'svelte';
  import { VERSION, type Edit } from '@pixel3d/core';
  import { redo, app, ui, undo, stopPicking } from './state.svelte';
  import { BRUSHES } from './brush';
  import { listen } from './load';
  import { register } from './hook';
  import { latencies } from './perf';
  import Header from './Header.svelte';
  import ImagePanel from './panels/ImagePanel.svelte';
  import PalettePanel from './panels/PalettePanel.svelte';
  import ClickerPanel from './panels/ClickerPanel.svelte';
  import SizePanel from './panels/SizePanel.svelte';
  import BasePanel from './panels/BasePanel.svelte';
  import OutlinePanel from './panels/OutlinePanel.svelte';
  import InsidePanel from './panels/InsidePanel.svelte';
  import SidesPanel from './panels/SidesPanel.svelte';
  import KeychainPanel from './panels/KeychainPanel.svelte';
  import MagnetsPanel from './panels/MagnetsPanel.svelte';
  import OrientationPanel from './panels/OrientationPanel.svelte';
  import PixelEditor from './panels/PixelEditor.svelte';
  import ViewportPane from './viewport/ViewportPane.svelte';
  import Footer from './Footer.svelte';
  import PhoneApp from './phone/PhoneApp.svelte';
  import { PHONE_QUERY } from './phone';
  import { closeEditor, newCanvas, restoreSketch, setBrush } from './actions.svelte';
  import { loadSketch, saveSketch } from './sketch';
  import Toast from './Toast.svelte';
  import UpdatePrompt from './UpdatePrompt.svelte';

  let dragging = $state(false);

  $effect(() => listen(window, (on) => (dragging = on)));

  $effect(() => { document.body.style.setProperty('--left', ui.left + 'px'); });

  // a phone-sized screen gets the sketchpad (phone/PhoneApp.svelte); crossing the breakpoint keeps the drawing.
  // ui.phone starts right (state.svelte.ts), so a phone never builds the PC layout first; this follows changes
  $effect(() => {
    const q = matchMedia(PHONE_QUERY);
    const set = () => (ui.phone = q.matches);
    set();
    q.addEventListener('change', set);
    return () => q.removeEventListener('change', set);
  });
  $effect(() => {
    const phone = ui.phone;
    document.body.classList.toggle('phone', phone);
    untrack(() => {
      // the tools of one layout mean nothing in the other: the viewer is always Select, the sketchpad starts in Paint
      closeEditor();
      if (!phone) return;
      if (!app.source) {
        const saved = loadSketch();
        if (saved) restoreSketch(saved);
        else newCanvas(32, 32, 8);
        // the blank canvas is where the phone starts, not a step to undo (undoing it would leave nothing to draw on)
        app.undo = [];
        app.redo = [];
      }
      ui.tool = 'paint';
      ui.sel = app.grid?.palette[0]?.hex ?? '#000000';
    });
  });

  // the phone's drawing is kept in the browser's storage: saved a moment after each change, and when the page is hidden
  $effect(() => {
    const src = app.source, edits = app.edits, colors = app.settings.colors.max;
    if (!ui.phone || !src?.blank) return;
    const save = () => saveSketch({ v: 1, w: src.img.width, h: src.img.height, colors, edits: $state.snapshot(edits) as Edit[] });
    const timer = setTimeout(save, 400);
    const hide = () => { if (document.visibilityState === 'hidden') { clearTimeout(timer); save(); } };
    document.addEventListener('visibilitychange', hide);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', hide); };
  });

  $effect(() => register({
    snapshot: () => ({
      name: app.source?.name ?? null,
      grid: app.grid && { w: app.grid.w, h: app.grid.h, opaque: app.grid.cells.filter((v) => v >= 0).length, palette: app.grid.palette.map((p) => ({ ...p })) },
      settings: $state.snapshot(app.settings),
      edits: app.edits,
      undo: app.undo.length,
      redo: app.redo.length,
      zoom: ui.zoom,
      tool: ui.tool,
      version: VERSION,
    }),
    /** Input-to-preview times, ms (perf.ts). */
    latency: () => [...latencies],
    /** Picks the source tool and brush color in one call (tests choose a brush color without the color picker). */
    setTool: (t: typeof ui.tool, hex = '#000000') => { ui.tool = t; setBrush(hex); },
  }));

  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t instanceof HTMLInputElement && /^(text|url|search|number)$/.test(t.type)) || t.classList.contains('num'));

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // first Esc closes what is open (a popover, the Batch dialog, which closes itself) or cancels a mode
      const busy = !!ui.popover || ui.batch || ui.cropping || ui.placing || ui.picking;
      ui.popover = null;
      ui.cropping = false;
      ui.placing = false;
      stopPicking();
      // only an Esc nothing else used clears the Select tool's selection (R26); Paint keeps its brush
      if (!busy && !ui.editor && ui.tool === 'select') ui.sel = null;
      return;
    }
    if (ui.editor && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) {
      const k = e.key.toLowerCase(), i = BRUSHES.indexOf(ui.brush);
      if (k === 'b') ui.tool = 'paint';
      else if (k === 'e') ui.tool = 'erase';
      else if (k === 'f') ui.tool = 'fill';
      else if (k === 'i') ui.tool = 'select';
      else if (k === '[') ui.brush = BRUSHES[Math.max(0, i - 1)]!;
      else if (k === ']') ui.brush = BRUSHES[Math.min(BRUSHES.length - 1, i + 1)]!;
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || typing(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  }
</script>

<svelte:window onkeydown={keydown} />

{#if ui.phone}
  <PhoneApp />
{:else}
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
  <OutlinePanel />
  <!-- a clicker uses none of these (it always prints flat, R24), so they are hidden for one; its keychain is a loop on the body -->
  {#if app.settings.make !== 'clicker'}
    <InsidePanel />
    <SidesPanel />
  {/if}
  <KeychainPanel />
  {#if app.settings.make !== 'clicker'}
    <MagnetsPanel />
    <OrientationPanel />
  {/if}
</aside>

<Footer />
{/if}

<PixelEditor />
<Toast />
<UpdatePrompt />
<div class="dropzone" class:show={dragging}><div>Drop an image to load it</div></div>

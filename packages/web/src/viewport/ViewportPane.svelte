<script lang="ts">
  import { pieces } from '@pixel3d/core';
  import { app, ui } from '../state.svelte';
  import { Viewport } from './Viewport';
  import { ModelBuilder } from './modelBuilder';
  import { previewOf } from './previewMesh';
  import { register } from '../hook';

  let main: HTMLElement;
  let canvas: HTMLCanvasElement;
  let resizer: HTMLDivElement;
  let vp: Viewport | undefined = $state();
  /** Size of what is shown, mm: the preview's until the core model arrives, then the model's. */
  let size = $state<{ x: number; y: number; z: number } | null>(null);
  let resizing = $state(false);

  const count = $derived(app.grid ? pieces(app.grid).length : 0);

  let builder: ModelBuilder | undefined;
  /** mm per pixel row, so the cut runs through the middle of a row. */
  let rowMm = 1;
  let lastSource: unknown;

  $effect(() => {
    const v = new Viewport(canvas, main);
    builder = new ModelBuilder(
      (model) => { v.setModel(model, { row: rowMm }); size = v.size; },
      (message) => console.warn(`pixel3d: the model could not be built: ${message}`),
    );
    vp = v;
    const unregister = register({ viewport: () => ({ shown: v.shown, cut: ui.cut, grid: { ...ui.grid }, renders: v.renders, size: v.size }) });
    return () => { unregister(); builder?.dispose(); v.dispose(); vp = builder = undefined; };
  });

  // the fast preview at once, then the core model (debounced, in a worker) replaces it
  $effect(() => {
    const grid = app.grid, settings = $state.snapshot(app.settings), v = vp;
    if (!v || !builder) return;
    if (!grid) { builder.cancel(); v.clear(); size = null; return; }
    const p = previewOf(grid, settings);
    rowMm = p?.px.y ?? 1;
    v.setPreview(p);
    size = v.size;
    if (app.source !== lastSource) { lastSource = app.source; v.fitView(); }
    if (p) builder.schedule(grid, settings);
    else builder.cancel();
  });

  $effect(() => { vp?.setCut(ui.cut); });
  $effect(() => { vp?.setGrid({ on: ui.grid.on, colour: ui.grid.colour, opacity: ui.grid.opacity }); });

  function resizeDown(e: PointerEvent) { resizer.setPointerCapture(e.pointerId); resizing = true; }
  function resizeMove(e: PointerEvent) {
    if (!resizing) return;
    ui.left = Math.round(Math.min(Math.max(e.clientX, 260), innerWidth * 0.6));
    ui.wide = ui.left > 400;
  }
</script>

<main bind:this={main}>
  <canvas id="view" bind:this={canvas}></canvas>
  <div id="resizer" title="Drag to resize" role="separator" aria-orientation="vertical" class:drag={resizing} bind:this={resizer}
    onpointerdown={resizeDown} onpointermove={resizeMove} onpointerup={() => (resizing = false)}></div>
  <div class="vtools">
    <button class="btn" id="resetView" onclick={() => vp?.fitView()}>Reset view</button>
    <div style="position:relative">
      <button class="btn" id="gridBtn" class:on={ui.popover === 'grid'} onclick={() => (ui.popover = ui.popover === 'grid' ? null : 'grid')}>Grid</button>
      <div class="pop" id="gridPop" class:open={ui.popover === 'grid'}>
        <label class="check"><input type="checkbox" id="gridOn" bind:checked={ui.grid.on}> Show grid</label>
        <div class="sl"><label for="gridColor">Colour</label><input type="color" id="gridColor" bind:value={ui.grid.colour} style="width:100%"><span></span></div>
        <div class="sl"><label for="gridOpacity">Opacity</label><input type="range" id="gridOpacity" min="0" max="100"
          value={Math.round(ui.grid.opacity * 100)} oninput={(e) => (ui.grid.opacity = +e.currentTarget.value / 100)}><span class="unit" id="gridOpacityV">{Math.round(ui.grid.opacity * 100)}%</span></div>
      </div>
    </div>
    <button class="btn" id="cutBtn" class:on={ui.cut} title="Slice the model in half to see inside" onclick={() => (ui.cut = !ui.cut)}>Cut view</button>
  </div>
  <div class="note" id="note" style:display={ui.cut ? 'block' : 'none'}><b>Cut view.</b> Gold is solid material. Empty space shows what is hollow.</div>
  {#if size}
    <div class="dims" id="dims"><b>{size.x.toFixed(1)} × {size.y.toFixed(1)} × {size.z.toFixed(1)} mm</b>&nbsp; {#if count > 1}<span class="warn">{count} separate pieces</span>{:else}one piece{/if}</div>
  {/if}
</main>

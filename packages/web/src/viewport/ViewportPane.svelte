<script lang="ts">
  import { cornerTouches, type Grid } from '@pixel3d/core';
  import { app, toast, ui } from '../state.svelte';
  import { pieceCount, removeStrays } from '../actions.svelte';
  import { previewShown } from '../perf';
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
  /** Why the last core build failed; the preview stays up meanwhile. Cleared by the next model. */
  let buildError = $state<string | null>(null);

  const count = $derived(pieceCount());
  /** Stray pixels (every piece but the largest) and corner-only contacts, for the note. */
  const strays = $derived.by(() => {
    const g = app.grid;
    const parts = app.parts;
    if (!g || count < 2 || parts.length < 2) return null;
    return { n: parts.length, pixels: parts.slice(1).reduce((a, p) => a + p.length, 0), corners: cornerTouches(g) > 0 };
  });

  let builder: ModelBuilder | undefined;
  /** mm per pixel row, so the cut runs through the middle of a row. */
  let rowMm = 1;
  let lastSource: unknown;
  /** The grid of the newest build request: only the newest result is delivered, so it is the grid of any model that arrives. */
  let scheduled: Grid | null = null;

  $effect(() => {
    const v = new Viewport(canvas, main);
    builder = new ModelBuilder(
      (model) => { v.setModel(model, { row: rowMm }); size = v.size; buildError = null; if (scheduled) app.built = { grid: scheduled, pieces: model.pieces }; },
      (message) => { buildError = message; toast(`Couldn't build the model: ${message}`); },
    );
    vp = v;
    const b = builder;
    const unregister = register({
      viewport: () => ({ shown: v.shown, cut: ui.cut, grid: { ...ui.grid }, renders: v.renders, size: v.size, buildError, ...v.stats() }),
      failNextBuild: () => b.failNextBuild(),
    });
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
    previewShown();
    size = v.size;
    if (app.source !== lastSource) { lastSource = app.source; v.fitView(); }
    if (p) { scheduled = grid; builder.schedule(grid, settings); }
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
    onpointerdown={resizeDown} onpointermove={resizeMove} onpointerup={() => (resizing = false)} onpointercancel={() => (resizing = false)}></div>
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
  <div class="note" id="note" style:display={ui.cut || strays ? 'block' : 'none'}>
    {#if ui.cut}<b>Cut view.</b> Gold is solid material. Empty space shows what is hollow.{/if}
    {#if strays}
      {#if ui.cut}<br>{/if}
      <span class="warn">{strays.n} separate pieces. {strays.pixels} stray pixel{strays.pixels > 1 ? 's' : ''} (outlined in red in the image) don't share an edge with the rest, so they would print as loose parts.{strays.corners ? " Pixels that touch only at a corner don't count as joined." : ''} Paint pixels to connect them, or remove them.</span><br><button class="btn small" id="removeStrays" onclick={removeStrays}>Remove strays</button>
    {/if}
  </div>
  {#if size}
    <div class="dims" id="dims"><b>{size.x.toFixed(1)} × {size.y.toFixed(1)} × {size.z.toFixed(1)} mm</b>&nbsp; {#if buildError}<span class="warn">preview only, the model could not be built</span>{:else if count > 1}<span class="warn">{count} separate pieces</span>{:else}one piece{/if}</div>
  {/if}
</main>

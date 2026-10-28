<script lang="ts">
  import { cornerTouches, type Grid, type Settings } from '@pixel3d/core';
  import { app, pushUndo, setting, toast, ui } from '../state.svelte';
  import { pieceCount, removeStrays } from '../actions.svelte';
  import { previewShown } from '../perf';
  import { fmt, gridLabel, gridStep, toUnit } from '../units';
  import { Viewport } from './Viewport';
  import { ModelBuilder } from './modelBuilder';
  import { previewOf } from './previewMesh';
  import { artFrame, handlesOf, modelToAnchor } from './handles';
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
  /**
   * The last model's warnings (too thin to hollow out, Hollow built as Shell...). The thin-base magnet warning is
   * left out: the Magnets panel shows it.
   */
  let warnings = $state<string[]>([]);

  const count = $derived(pieceCount());
  const unit = $derived(app.settings.size.unit);
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
  /** The switch count of the newest build request, for the stand-in switches of a clicker. */
  let scheduledSwitches = 1;
  /** Frame the view when the next model arrives (a new image shown as a clicker, which has no fast preview). */
  let fitOnModel = false;
  /** What the last preview and the last build were made from, so a change neither uses skips it. */
  let last: { grid: Grid | null; preview: string; build: string } = { grid: null, preview: '', build: '' };

  /** Equal content: a recompute makes a new grid object even when nothing in it changed. */
  function sameGrid(a: Grid | null, b: Grid) {
    if (!a) return false;
    if (a === b) return true;
    if (a.w !== b.w || a.h !== b.h || a.palette.length !== b.palette.length) return false;
    if (a.palette.some((p, i) => p.hex !== b.palette[i]!.hex || p.height !== b.palette[i]!.height)) return false;
    for (let k = 0; k < a.cells.length; k++) if (a.cells[k] !== b.cells[k]) return false;
    return true;
  }
  /** The settings the preview uses (previewMesh.ts). */
  const previewKey = (s: Settings) => JSON.stringify([s.size.width, s.size.height, s.size.keepAspect, s.pixelMm, s.base, s.sides, s.heights.h]);
  /** Core builds the model unrotated; the viewport turns it, and units are display-only. */
  const forBuild = (s: Settings): Settings => ({ ...s, rotation: [0, 0, 0], size: { ...s.size, unit: 'mm' } });

  $effect(() => {
    const v = new Viewport(canvas, main);
    builder = new ModelBuilder(
      (model) => {
        v.setModel(model, { row: rowMm, switches: scheduledSwitches }); size = v.size; buildError = null;
        if (fitOnModel) { fitOnModel = false; v.fitView(); }
        warnings = model.warnings.filter((w) => !/ magnet needs about /.test(w));
        if (scheduled) app.built = { grid: scheduled, pieces: model.pieces };
      },
      (message) => { buildError = message; toast(`Couldn't build the model: ${message}`); },
    );
    vp = v;
    const b = builder;
    const unregister = register({
      viewport: () => ({
        shown: v.shown, cut: ui.cut, grid: { ...ui.grid }, renders: v.renders, size: v.size, buildError, ...v.stats(),
        bounds: v.bounds(), handles: v.handleScreen(), gridStep: v.gridStep, clicker: v.clicker(),
      }),
      failNextBuild: () => b.failNextBuild(),
    });
    return () => { unregister(); builder?.dispose(); v.dispose(); vp = builder = undefined; };
  });

  // the fast preview at once, then the core model (debounced, in a worker) replaces it. A change the preview
  // doesn't show (keychain, magnets, Inside) keeps the current model up until the new one arrives.
  $effect(() => {
    const grid = app.grid, settings = $state.snapshot(app.settings) as Settings, v = vp;
    if (!v || !builder) return;
    if (!grid) { builder.cancel(); v.clear(); size = null; warnings = []; last = { grid: null, preview: '', build: '' }; return; }
    const same = sameGrid(last.grid, grid), fresh = app.source !== lastSource;
    const build = forBuild(settings), pk = previewKey(settings), bk = JSON.stringify(build);
    last.grid = grid;
    const clicker = settings.make === 'clicker';
    if (!same || fresh || pk !== last.preview || v.shown !== 'model') {
      last.preview = pk;
      if (clicker) {
        // the fast preview can't show a clicker (cap, body, switch seats): what is shown stays until the model arrives
        const f = artFrame(grid, settings);
        if (!f) { v.clear(); size = null; builder.cancel(); last.build = ''; return; }
        rowMm = f.px.y;
      } else {
        const p = previewOf(grid, settings);
        rowMm = p?.px.y ?? 1;
        v.setPreview(p);
        previewShown();
        size = v.size;
        if (!p) { builder.cancel(); last.build = ''; return; }
      }
    }
    if (fresh) {
      lastSource = app.source;
      // a clicker is framed when its model arrives
      if (clicker) fitOnModel = true;
      else v.fitView();
    }
    if (!same || bk !== last.build || v.shown !== 'model') {
      scheduled = grid;
      scheduledSwitches = settings.clicker.switches;
      last.build = bk;
      builder.schedule(grid, build);
    } else {
      // the same grid content: the model shown (or on its way) is still this grid's
      if (app.built && app.built.grid !== grid && sameGrid(app.built.grid, grid)) app.built = { grid, pieces: app.built.pieces };
      scheduled = grid;
    }
  });

  $effect(() => { vp?.setCut(ui.cut); });
  $effect(() => { vp?.setGrid({ on: ui.grid.on, colour: ui.grid.colour, opacity: ui.grid.opacity, step: gridStep(unit) }); });
  $effect(() => {
    const r = app.settings.rotation, clicker = app.settings.make === 'clicker';
    if (!vp) return;
    // core ignores the rotation for a clicker: both parts print flat side down
    vp.setRotation(clicker ? [0, 0, 0] : [r[0], r[1], r[2]]);
    size = vp.size;
  });
  $effect(() => {
    const g = app.grid, s = $state.snapshot(app.settings) as Settings;
    vp?.setHandles(g && s.make !== 'clicker' ? handlesOf(g, s) : []);
  });
  $effect(() => {
    const view = ui.clkView;
    if (!vp) return;
    vp.setClickerView(view);
    size = vp.size;
  });
  $effect(() => { vp?.setCursor(ui.placing ? 'crosshair' : ''); });

  /** Model-frame point → anchor; a point on the back half is mirrored onto the front first. */
  function anchorAt(x: number, y: number, object: string) {
    const g = app.grid, v = vp;
    if (!g || !v) return null;
    if (object === 'back') x = v.frontMaxX() + v.backMinX() - x;
    return modelToAnchor(x, y, g, app.settings);
  }

  /** The handle being dragged: one undo step, taken when it first moves. */
  let drag: { kind: 'hole' | 'magnet'; i: number; moved: boolean } | null = null;

  /** Capture phase, so it runs before the orbit controls see the press. */
  function pointerDown(e: PointerEvent) {
    const v = vp;
    if (!v || !app.grid || e.button !== 0) return;
    if (ui.placing) {
      v.setOrbit(false);
      const hit = v.pick(e.clientX, e.clientY);
      const a = hit && anchorAt(hit.x, hit.y, hit.object);
      if (a) {
        ui.placing = false;
        setting(() => app.settings.magnets.at.push(a));
      }
      return;
    }
    const h = v.handleAt(e.clientX, e.clientY);
    if (!h) return;
    drag = { ...h, moved: false };
    v.setHold(true);
    v.setCursor('grabbing');
    canvas.setPointerCapture(e.pointerId);
  }

  function pointerMove(e: PointerEvent) {
    const v = vp;
    if (!v) return;
    if (!drag) {
      if (!ui.placing) v.setCursor(app.grid && v.handleAt(e.clientX, e.clientY) ? 'grab' : '');
      return;
    }
    const p = v.onTop(e.clientX, e.clientY);
    const a = p && anchorAt(p.x, p.y, 'main');
    if (!a) return;
    const s = app.settings;
    if (!drag.moved) { drag.moved = true; pushUndo(); }
    if (drag.kind === 'hole') s.keychain.hole.at = a;
    else if (drag.i < s.magnets.at.length) s.magnets.at[drag.i] = a;
  }

  function pointerUp() {
    const v = vp;
    if (!v) return;
    if (drag) { drag = null; v.setHold(false); v.setCursor(''); }
    else v.setOrbit(true);
  }

  function resizeDown(e: PointerEvent) { resizer.setPointerCapture(e.pointerId); resizing = true; }
  function resizeMove(e: PointerEvent) {
    if (!resizing) return;
    ui.left = Math.round(Math.min(Math.max(e.clientX, 260), innerWidth * 0.6));
    ui.wide = ui.left > 400;
  }
</script>

<main bind:this={main}>
  <canvas id="view" bind:this={canvas} onpointerdowncapture={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp}></canvas>
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
  <div class="note" id="note" style:display={ui.cut || strays || warnings.length ? 'block' : 'none'}>
    {#each warnings as w, i (w)}{#if i}<br>{/if}<span class="warn">{w}</span>{/each}
    {#if warnings.length && ui.cut}<br>{/if}
    {#if ui.cut}<b>Cut view.</b> Gold is solid material. Empty space shows what is hollow.{/if}
    {#if strays}
      {#if ui.cut || warnings.length}<br>{/if}
      <span class="warn">{strays.n} separate pieces. {strays.pixels} stray pixel{strays.pixels > 1 ? 's' : ''} (outlined in red in the image) don't share an edge with the rest, so they would print as loose parts.{strays.corners ? " Pixels that touch only at a corner don't count as joined." : ''} Paint pixels to connect them, or remove them.</span><br><button class="btn small" id="removeStrays" onclick={removeStrays}>Remove strays</button>
    {/if}
  </div>
  <div class="mode" id="mode" style:display={ui.placing ? 'block' : 'none'}>Click the model to place a magnet. Press Esc to cancel.</div>
  {#if size}
    <div class="dims" id="dims"><b>{fmt(toUnit(size.x, unit), unit)} × {fmt(toUnit(size.y, unit), unit)} × {fmt(toUnit(size.z, unit), unit)} {unit}</b>&nbsp; {#if buildError}<span class="warn">preview only, the model could not be built</span>{:else if count > 1}<span class="warn">{count} separate pieces</span>{:else if app.settings.make === 'clicker'}{ui.clkView === 'assembled' ? 'assembled, switch at rest' : 'cap and body'}{:else}one piece{/if}</div>
  {/if}
  <!-- not in the mockup: the grid's scale, so mm and inches can be told apart -->
  {#if ui.grid.on}<div class="gridscale" id="gridScale">{gridLabel(unit)}</div>{/if}
</main>

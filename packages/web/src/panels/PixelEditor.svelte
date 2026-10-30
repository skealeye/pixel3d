<script lang="ts">
  import { untrack } from 'svelte';
  import { app, recolorLive, redo, setting, ui, undo } from '../state.svelte';
  import { closeEditor, maxColors, newCanvas, resizeCanvas, setBrush } from '../actions.svelte';
  import { BRUSHES, COMMON_COLORS } from '../brush';
  import ColorWheel from './ColorWheel.svelte';
  import Favorites from './Favorites.svelte';
  import SourceCanvas from './SourceCanvas.svelte';

  /** The Pixel Editor: a window over the app (backdrop blurred) with the big picture, brushes and every color source. */
  let dialog: HTMLDialogElement;

  $effect(() => {
    if (ui.editor && !dialog.open) dialog.showModal();
    else if (!ui.editor && dialog.open) dialog.close();
  });

  const palette = $derived(app.grid?.palette ?? []);
  /** The brush color: it need not be in the image until a pixel is painted with it. */
  const cur = $derived(ui.sel && /^#[0-9a-f]{6}$/.test(ui.sel) ? ui.sel : (palette[0]?.hex ?? ''));
  // the tool buttons: Pick is the viewer's Select tool (drag pans, a click picks the color)
  const tools = [['paint', 'paint', 'Paint', 'B'], ['erase', 'erase', 'Erase', 'E'], ['pick', 'select', 'Pick', 'I']] as const;

  /** Choosing a color means painting with it: Erase and Pick go back to Paint. */
  function use(c: string) {
    setBrush(c);
    ui.tool = 'paint';
  }

  // the size of a canvas to start, and of the blank canvas being drawn on
  let nw = $state(32), nh = $state(32), nc = $state(16), rw = $state(32), rh = $state(32);
  // the page's toasts sit behind this window, so what they say is shown here for a few seconds
  let note = $state(''), noteTimer = 0, seen = ui.toast.n;
  $effect(() => {
    const n = ui.toast.n;
    if (n === seen) return;
    seen = n;
    if (!untrack(() => ui.editor)) return;
    note = ui.toast.text;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => (note = ''), 4000);
  });

  /** Allow one more color (up to 16): the Colors setting of the Pixel Viewer, one step up. A pixelated photo has its own. */
  function moreColors() {
    if (max < 16) setting(() => { app.settings.colors.max = max + 1; });
  }
  /** The most colors the image may have: one slot each in Image colors. */
  const max = $derived(maxColors());
  $effect(() => {
    if (app.source?.blank && app.grid) { rw = app.grid.w; rh = app.grid.h; }
  });

  // the wheel: a color in the image is recolored everywhere as one undo step; a new color only changes the brush
  let live: ReturnType<typeof recolorLive> | null = null;
  function wheelStart() {
    live = !ui.newColor && palette.some((p) => p.hex === cur) ? recolorLive(cur) : null;
  }
  function wheelInput(hex: string) {
    if (live) live.set(hex);
    else ui.sel = hex;
    ui.tool = 'paint';
  }
  function wheelEnd() {
    live?.end();
    live = null;
  }
</script>

<dialog class="editor" id="editor" bind:this={dialog} onclose={closeEditor}>
  <header class="edHead">
    <h3>Pixel Editor</h3>
    <button class="btn icon" id="edUndo" title="Undo (Ctrl+Z)" disabled={!app.undo.length} onclick={undo}>↶</button>
    <button class="btn icon" id="edRedo" title="Redo (Ctrl+Y)" disabled={!app.redo.length} onclick={redo}>↷</button>
    <span class="hint" style="margin:0 0 0 auto">Scroll to zoom, drag to pan with Pick</span>
    <button class="btn primary" id="edDone" onclick={closeEditor}>Done</button>
  </header>
  {#if note}<div class="edNote" id="edNote" role="status">{note}</div>{/if}
  <div class="edBody">
    <div class="edTools">
      <div class="lbl">Tool</div>
      {#each tools as [id, tool, label, key] (id)}
        <button class="btn" class:on={ui.tool === tool} data-tool={id} title="{label} ({key})" onclick={() => (ui.tool = tool)}>{label}</button>
      {/each}
      <div class="lbl">Brush</div>
      <div class="brushes">
        {#each BRUSHES as b (b)}
          <button class="btn" class:on={ui.brush === b} data-brush={b} title="{b} × {b} ([ and ] change it)" onclick={() => (ui.brush = b)}>{b}×{b}</button>
        {/each}
      </div>
      {#if app.source?.blank}
        <div class="lbl">Canvas</div>
        <div class="resize">
          <input id="edRW" type="number" min="4" max="128" bind:value={rw} aria-label="Canvas width">
          <input id="edRH" type="number" min="4" max="128" bind:value={rh} aria-label="Canvas height">
          <button class="btn small" id="edResize" title="Change the canvas size, keeping the drawing from the top-left" onclick={() => resizeCanvas(rw, rh)}>Resize</button>
        </div>
      {/if}
    </div>
    <div class="edCanvas">
      {#if app.source}
        <SourceCanvas id="edSrc" />
      {:else}
        <div id="edNew" class="newCanvas">
          <h3>New canvas</h3>
          <p>Draw from scratch. Pick a size in pixels, or open an image to edit instead.</p>
          <div class="sizes">
            {#each [16, 32, 48, 64] as n (n)}
              <button class="btn" data-size={n} onclick={() => newCanvas(n, n, nc)}>{n} × {n}</button>
            {/each}
          </div>
          <div class="row">
            <label for="edNewW">Width</label><input id="edNewW" type="number" min="4" max="128" bind:value={nw}>
            <label for="edNewH">Height</label><input id="edNewH" type="number" min="4" max="128" bind:value={nh}>
            <label for="edNewColors">Colors</label><input id="edNewColors" type="number" min="2" max="16" bind:value={nc}>
            <button class="btn primary" id="edCreate" onclick={() => newCanvas(nw, nh, nc)}>Create</button>
          </div>
        </div>
      {/if}
    </div>
    <div class="edColors">
      <div class="lbl">Image colors <span id="edCount">{palette.length} of {max}</span></div>
      <div class="chips" id="edImage">
        {#each palette as p (p.hex)}
          <button class="chip" class:cur={p.hex === cur} style:background={p.hex} data-c={p.hex} title={p.hex} aria-label="Use {p.hex}" onclick={() => use(p.hex)}></button>
        {/each}
        {#each { length: Math.max(0, max - palette.length) } as _, i (i)}
          <span class="chip empty" title="Free slot: painting a new color uses it"></span>
        {/each}
        {#if max < 16 && !app.meta?.pixelated}
          <button class="slotMore" id="edMoreColors" title="Allow one more color (the Colors setting of the Pixel Viewer)" aria-label="Allow one more color" onclick={moreColors}>+</button>
        {/if}
      </div>
      <div class="lbl">Common colors</div>
      <div class="chips" id="edCommon">
        {#each COMMON_COLORS as c (c)}
          <button class="chip" class:cur={c === cur} style:background={c} data-c={c} title={c} aria-label="Use {c}" onclick={() => use(c)}></button>
        {/each}
      </div>
      <Favorites id="edFavs" value={cur} pick={use} slots={12} />
      <div class="lbl wheelHead">Color
        <button class="btn small" class:on={ui.newColor} id="edNewBtn" title="The wheel then makes a new color instead of changing this one" onclick={() => (ui.newColor = true)}>New color</button>
      </div>
      <ColorWheel value={cur} oninput={wheelInput} onstart={wheelStart} onend={wheelEnd} />
    </div>
  </div>
</dialog>

<script lang="ts">
  import { app, recolorLive, redo, ui, undo } from '../state.svelte';
  import { closeEditor, setBrush } from '../actions.svelte';
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
    </div>
    <div class="edCanvas"><SourceCanvas id="edSrc" /></div>
    <div class="edColors">
      <div class="lbl">Image colors</div>
      <div class="chips" id="edImage">
        {#each palette as p (p.hex)}
          <button class="chip" class:cur={p.hex === cur} style:background={p.hex} data-c={p.hex} title={p.hex} aria-label="Use {p.hex}" onclick={() => use(p.hex)}></button>
        {/each}
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

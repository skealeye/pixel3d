<script lang="ts">
  import { app, recolorLive, ui } from '../state.svelte';
  import { maxColors, setBrush } from '../actions.svelte';
  import SourceCanvas from '../panels/SourceCanvas.svelte';
  import ColorSquare from '../panels/ColorSquare.svelte';
  import BrushPopup from './BrushPopup.svelte';

  let brushOpen = $state(false);
  const palette = $derived(app.grid?.palette ?? []);
  const max = $derived(maxColors());
  /** The brush color: it need not be in the image until a pixel is painted with it. */
  const cur = $derived(ui.sel && /^#[0-9a-f]{6}$/.test(ui.sel) ? ui.sel : (palette[0]?.hex ?? '#000000'));

  // paint with the color the picker shows from the start (a blank canvas has no first color)
  if (!ui.sel) ui.sel = app.grid?.palette[0]?.hex ?? '#000000';

  /** Choosing a color means painting with it: Erase and Pick go back to Paint; Fill stays. */
  function use(c: string) {
    setBrush(c);
    if (ui.tool !== 'fill') ui.tool = 'paint';
  }

  // the picker: a color in the image is recolored everywhere as one undo step; a new color only changes the brush
  let live: ReturnType<typeof recolorLive> | null = null;
  function pickStart() {
    live = !ui.newColor && palette.some((p) => p.hex === cur) ? recolorLive(cur) : null;
  }
  function pickInput(hex: string) {
    if (live) live.set(hex);
    else ui.sel = hex;
    if (ui.tool !== 'fill') ui.tool = 'paint';
  }
  function pickEnd() {
    live?.end();
    live = null;
  }
  // Pick is the viewer's Select tool (a tap picks the color under it), as in the PC editor
  const tools = [['paint', 'paint', 'Paint'], ['erase', 'erase', 'Erase'], ['fill', 'fill', 'Fill'], ['pick', 'select', 'Pick']] as const;
</script>

<div id="phDraw">
  <div id="phCanvas"><SourceCanvas id="phSrc" fit /></div>
  <div id="phControls">
    <div id="phToolRow">
      {#each tools as [id, tool, label] (id)}
        <button class="btn" id="phTool-{id}" class:on={ui.tool === tool} onclick={() => (ui.tool = tool)}>{label}</button>
      {/each}
      <button class="btn" id="phBrush" aria-label="Brush size" onclick={() => (brushOpen = true)}>{ui.brush}×{ui.brush} ▾</button>
    </div>
    <div id="phColorArea">
      <div id="phSlots">
        {#each palette as p (p.hex)}
          <button class="slot" class:cur={!ui.newColor && p.hex === cur} style:background={p.hex} data-c={p.hex} aria-label="Use {p.hex}" onclick={() => use(p.hex)}></button>
        {/each}
        {#each { length: Math.max(0, max - palette.length) } as _, i (i)}
          <button class="slot empty" class:cur={ui.newColor && i === 0} aria-label="New color" onclick={() => (ui.newColor = true)}></button>
        {/each}
      </div>
      <ColorSquare value={cur} oninput={pickInput} onstart={pickStart} onend={pickEnd} />
    </div>
  </div>
</div>
{#if brushOpen}<BrushPopup close={() => (brushOpen = false)} />{/if}

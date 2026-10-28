<script lang="ts">
  import { deleteColour, recolour, setHeight } from '../actions.svelte';
  import { inputStarted } from '../perf';
  import { ui } from '../state.svelte';

  /** One palette colour: swatch (paint with it), hex (recolour), height slider, delete. */
  let { hex, height }: { hex: string; height: number } = $props();

  /** One undo step per drag: the first input of a drag pushes, the rest update it. */
  let dragging = false;

  function pick() {
    ui.sel = hex;
    if (ui.tool === 'select') ui.tool = 'paint';
  }

  function slide(v: number) {
    inputStarted();
    setHeight(hex, v, !dragging);
    dragging = true;
  }
</script>

<li class:sel={ui.sel === hex}>
  <button class="sw" style:background={hex} title="Paint with this colour" aria-label="Paint with {hex}" onclick={pick}></button>
  <label class="hex">{hex}<input type="color" value={hex} title="Recolour every pixel of this colour"
    onchange={(e) => recolour(hex, e.currentTarget.value)}></label>
  <input type="range" min="0.2" max="20" step="0.1" value={height} aria-label="Height of {hex}"
    oninput={(e) => slide(+e.currentTarget.value)} onchange={() => (dragging = false)}>
  <span class="hv">{height.toFixed(1)} mm</span>
  <button class="del" title="Delete colour (pixels move to the nearest colour)" aria-label="Delete {hex}" onclick={() => deleteColour(hex)}>×</button>
</li>

<script lang="ts">
  import { deleteColor, recolor, setHeight } from '../actions.svelte';
  import { inputStarted } from '../perf';
  import { ui } from '../state.svelte';

  /** One palette color: swatch (select it), hex (recolor), height slider, delete. */
  let { hex, height }: { hex: string; height: number } = $props();

  /** One undo step per drag: the first input of a drag pushes, the rest update it. */
  let dragging = false;

  /** Select this color (shown on the model, R26), or clear it when it is already selected. */
  function pick() {
    ui.sel = ui.sel === hex ? null : hex;
  }

  function slide(v: number) {
    inputStarted();
    setHeight(hex, v, !dragging);
    dragging = true;
  }
</script>

<li class:sel={ui.sel === hex}>
  <button class="sw" style:background={hex} title="Show where this color is used" aria-label="Select {hex}" onclick={pick}></button>
  <label class="hex">{hex}<input type="color" value={hex} title="Recolor every pixel of this color"
    onchange={(e) => recolor(hex, e.currentTarget.value)}></label>
  <input type="range" min="0.2" max="20" step="0.1" value={height} aria-label="Height of {hex}"
    oninput={(e) => slide(+e.currentTarget.value)} onchange={() => (dragging = false)}>
  <span class="hv">{height.toFixed(1)} mm</span>
  <button class="del" title="Delete color (pixels move to the nearest color)" aria-label="Delete {hex}" onclick={() => deleteColor(hex)}>×</button>
</li>

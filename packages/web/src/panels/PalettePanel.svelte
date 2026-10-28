<script lang="ts">
  import { addColour, restoreColours } from '../actions.svelte';
  import { app, live, toast } from '../state.svelte';
  import HeightModes from './HeightModes.svelte';
  import PaletteRow from './PaletteRow.svelte';
  import Slider from './Slider.svelte';

  const palette = $derived(app.grid?.palette ?? []);
  const count = $derived(app.grid && app.meta ? `${palette.length} of ${app.meta.colours}` : '');
  // the color count merges the closest pair of colors until this many are left
  const colours = live(() => app.settings.colours.max, (v) => (app.settings.colours.max = v));

  function add() {
    if (!app.grid) { toast('Open an image first.'); return; }
    addColour();
  }
</script>

<section>
  <h2>Colors and heights <small id="pcount">{count}</small><button class="btn small" id="restoreCols" title="Bring back deleted and recolored colors. Heights are kept." onclick={restoreColours}>Restore colors</button></h2>
  <HeightModes />
  <!-- not in the mockup: the color count. Pixelate has its own Colors slider, so this one hides while pixelating -->
  {#if !app.meta?.pixelated}
    <Slider id="colMax" label="Colors" min={2} max={16} value={app.settings.colours.max} hold="#pal" {...colours} />
  {/if}
  <ul class="pal" id="pal">
    {#each palette as p (p.hex)}
      <PaletteRow hex={p.hex} height={p.height} />
    {/each}
  </ul>
  <div class="row"><button class="btn" id="addColour" onclick={add}>Add color</button><span class="hint" style="margin:0">Click a swatch to select it (or, in Paint, to paint with it). Click a hex code to recolor.</span></div>
</section>

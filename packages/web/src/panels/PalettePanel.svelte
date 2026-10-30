<script lang="ts">
  import { openEditor, restoreColors } from '../actions.svelte';
  import { app, live } from '../state.svelte';
  import HeightModes from './HeightModes.svelte';
  import PaletteRow from './PaletteRow.svelte';
  import Slider from './Slider.svelte';

  const palette = $derived(app.grid?.palette ?? []);
  const count = $derived(app.grid && app.meta ? `${palette.length} of ${app.meta.colors}` : '');
  // the color count merges the closest pair of colors until this many are left
  const colors = live(() => app.settings.colors.max, (v) => (app.settings.colors.max = v));
</script>

<section>
  <h2>Colors and heights <small id="pcount">{count}</small><button class="btn small" id="restoreCols" title="Bring back deleted and recolored colors. Heights are kept." onclick={restoreColors}>Restore colors</button></h2>
  <HeightModes />
  <!-- not in the mockup: the color count. Pixelate has its own Colors slider, so this one hides while pixelating -->
  {#if !app.meta?.pixelated}
    <Slider id="colMax" label="Colors" min={2} max={16} value={app.settings.colors.max} hold="#pal" {...colors} />
  {/if}
  <ul class="pal" id="pal">
    {#each palette as p (p.hex)}
      <PaletteRow hex={p.hex} height={p.height} />
    {/each}
  </ul>
  <div class="row"><button class="btn" id="addColor" onclick={openEditor}>Add color</button><span class="hint" style="margin:0">Click a swatch to show where it is used. Click a hex code to recolor. Colors are added and painted in Edit pixels.</span></div>
</section>

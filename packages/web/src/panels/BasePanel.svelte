<script lang="ts">
  import { app, live, setting } from '../state.svelte';
  import { colourInput } from './colour';
  import Favourites from './Favourites.svelte';
  import Slider from './Slider.svelte';

  const base = $derived(app.settings.base);
  const thickness = live(() => base.height, (v) => (base.height = v));
  const colour = colourInput((hex) => (base.colour = hex));
</script>

<section>
  <h2>Base <input type="checkbox" id="baseOn" aria-label="Base" checked={base.enabled} style="margin-left:auto"
    onchange={(e) => { const on = e.currentTarget.checked; setting(() => (base.enabled = on)); }}></h2>
  {#if base.enabled}
    <div id="baseRows">
      <Slider id="baseH" label="Thickness" min={0.5} max={8} step={0.1} value={base.height} unit="mm" format={(v) => v.toFixed(1)} {...thickness} />
      <div class="row"><label for="baseColor">Color</label><input type="color" id="baseColor" value={base.colour} {...colour}></div>
      <Favourites id="baseFavs" value={base.colour} pick={(hex) => setting(() => (base.colour = hex))} />
    </div>
  {/if}
</section>

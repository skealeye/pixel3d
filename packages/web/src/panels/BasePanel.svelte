<script lang="ts">
  import { app, live, setting } from '../state.svelte';
  import { colorInput } from './color';
  import Favorites from './Favorites.svelte';
  import Slider from './Slider.svelte';

  const base = $derived(app.settings.base);
  const thickness = live(() => base.height, (v) => (base.height = v));
  const color = colorInput((hex) => (base.color = hex));
</script>

<section>
  <h2>Base <input type="checkbox" id="baseOn" aria-label="Base" checked={base.enabled} style="margin-left:auto"
    onchange={(e) => { const on = e.currentTarget.checked; setting(() => (base.enabled = on)); }}></h2>
  {#if base.enabled}
    <div id="baseRows">
      <Slider id="baseH" label="Thickness" min={0.5} max={8} step={0.1} value={base.height} unit="mm" format={(v) => v.toFixed(1)} {...thickness} />
      <div class="row"><label for="baseColor">Color</label><input type="color" id="baseColor" value={base.color} {...color}></div>
      <Favorites id="baseFavs" value={base.color} pick={(hex) => setting(() => (base.color = hex))} />
    </div>
  {/if}
  <!-- not in the mockup (user request 2026-10-28): shown with the base off too, as it also rounds the outline and the clicker -->
  <label class="check"><input type="checkbox" id="smooth" checked={app.settings.smooth}
    onchange={(e) => { const on = e.currentTarget.checked; setting(() => (app.settings.smooth = on)); }}> Smooth edges</label>
  <p class="hint" id="smoothHint">Rounds the stepped pixel edge of the base, outline and clicker cap and body. The art keeps its pixels.</p>
</section>

<script lang="ts">
  import { app, live, setting } from '../state.svelte';
  import { fmt, fromUnit, toUnit, type Unit } from '../units';
  import { colorInput } from './color';
  import Favorites from './Favorites.svelte';
  import Slider from './Slider.svelte';

  /**
   * Outline (user request 2026-10-28, spec §4.7b): a ring round the art's outer edge, as tall as the lowest color, in
   * its own color. Not in the mockup; laid out like the Base section.
   */
  const outline = $derived(app.settings.outline);
  const u = $derived<Unit>(app.settings.size.unit);
  const MIN = 0.5, MAX = 5;
  const width = live(() => toUnit(outline.width, u), (v) => (outline.width = Math.min(MAX, Math.max(MIN, fromUnit(v, u)))));
  const color = colorInput((hex) => (outline.color = hex));
</script>

<section>
  <h2>Outline <input type="checkbox" id="outlineOn" aria-label="Outline" checked={outline.on} style="margin-left:auto"
    onchange={(e) => { const on = e.currentTarget.checked; setting(() => (outline.on = on)); }}></h2>
  {#if outline.on}
    <div id="outlineRows">
      <Slider id="outlineW" label="Width" min={toUnit(MIN, u)} max={toUnit(MAX, u)} step={u === 'in' ? 0.01 : 0.1} value={toUnit(outline.width, u)}
        unit={u} format={(v) => fmt(v, u)} {...width} />
      <div class="row"><label for="outlineColor">Color</label><input type="color" id="outlineColor" value={outline.color} {...color}></div>
      <Favorites id="outlineFavs" value={outline.color} pick={(hex) => setting(() => (outline.color = hex))} />
    </div>
  {/if}
  <p class="hint" id="outlineHint">A border round the outside of the art, as tall as its lowest color.</p>
</section>

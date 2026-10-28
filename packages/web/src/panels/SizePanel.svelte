<script lang="ts">
  import { app, live, setting } from '../state.svelte';
  import { opaqueBox } from '../pipeline';
  import { fmt, fromUnit, toUnit, type Unit } from '../units';
  import Slider from './Slider.svelte';

  /**
   * Width and Height of the outline. A typed or dragged size wins over the stored pixel size, so every change here
   * deletes `settings.pixelMm` and the pipeline sets it again from the new size (spec §4.5).
   */
  const size = $derived(app.settings.size);
  const u = $derived<Unit>(size.unit);
  const MIN = 5, MAX = 200;

  /** Height over width of the opaque box, while an image is open. */
  const ratio = () => { const b = app.grid && opaqueBox(app.grid); return b ? b.h / b.w : null; };

  const width = live(() => toUnit(size.width, u), (v) => {
    delete app.settings.pixelMm;
    size.width = fromUnit(v, u);
  });
  const height = live(() => toUnit(size.height, u), (v) => {
    delete app.settings.pixelMm;
    const r = ratio(), mm = fromUnit(v, u);
    // with the aspect lock the width follows (the pipeline derives the height from it)
    if (size.keepAspect && r) size.width = mm / r;
    size.height = mm;
  });

  const lock = (on: boolean) => setting(() => { delete app.settings.pixelMm; size.keepAspect = on; });
  const units = [['mm', 'mm'], ['in', 'in']] as const;
</script>

<section>
  <h2>Size</h2>
  <Slider id="w" label="Width" min={toUnit(MIN, u)} max={toUnit(MAX, u)} step={u === 'in' ? 0.01 : 0.5} value={toUnit(size.width, u)} unit={u} format={(v) => fmt(v, u)} {...width} />
  <Slider id="h" label="Height" min={toUnit(MIN, u)} max={toUnit(MAX, u)} step={u === 'in' ? 0.01 : 0.5} value={toUnit(size.height, u)} unit={u} format={(v) => fmt(v, u)} {...height} />
  <label class="check"><input type="checkbox" id="lock" checked={size.keepAspect} onchange={(e) => lock(e.currentTarget.checked)}> Keep aspect ratio</label>
  <!-- not in the mockup: the unit switch (spec §4.5, mm or inches). Inches are display-only; core always gets mm -->
  <div class="row"><span class="lbl">Units</span>
    <div class="seg" data-key="unit">
      {#each units as [v, label] (v)}
        <button data-v={v} class:on={u === v} onclick={() => u !== v && setting(() => (size.unit = v))}>{label}</button>
      {/each}
    </div>
  </div>
</section>

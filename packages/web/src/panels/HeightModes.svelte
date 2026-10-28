<script lang="ts">
  import { DEFAULTS } from '@pixel3d/core';
  import { app, change, live } from '../state.svelte';
  import { inputStarted } from '../perf';
  import Slider from './Slider.svelte';

  /** Height mode and its values. Changing any of them sets every color's height again, so per-color heights go. */
  const h = $derived(app.settings.heights);
  const modes = [['uniform', 'All the same'], ['random', 'Random'], ['brightness', 'By brightness']] as const;
  const MIN = 0.2, MAX = 20;
  const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

  const dropHeights = () => { app.edits = app.edits.filter((e) => e.kind !== 'height'); };

  function set(apply: () => void) {
    if (!app.source) { apply(); return; }
    change(() => { apply(); dropHeights(); });
  }

  /** A typed number: applied when valid, otherwise the box shows the current value again. */
  function typed(box: HTMLInputElement, current: number, apply: (v: number) => void) {
    const v = +box.value;
    if (box.value.trim() === '' || Number.isNaN(v)) { box.value = String(current); return; }
    set(() => apply(v));
  }

  function reroll() {
    let seed = h.seed;
    while (seed === h.seed) seed = Math.floor(Math.random() * 9999);
    set(() => { h.seed = seed; h.mode = 'random'; });
  }

  const pixel = live(() => h.h, (v) => { inputStarted(); h.h = v; dropHeights(); });
</script>

<div class="heights">
  <div class="seg" data-key="heightMode">
    {#each modes as [v, label] (v)}
      <button data-v={v} class:on={h.mode === v} onclick={() => h.mode !== v && set(() => (h.mode = v))}>{label}</button>
    {/each}
  </div>
  {#if h.mode === 'uniform'}
    <Slider id="defH" label="Pixel height" min={MIN} max={MAX} step={0.1} value={h.h} unit="mm" format={(v) => v.toFixed(1)} {...pixel} />
  {:else}
    <div class="row" id="rangeRow">
      <label for="hMin">Range</label>
      <input class="num" type="number" step="0.2" id="hMin" value={h.min} onchange={(e) => typed(e.currentTarget, h.min, (v) => (h.min = clamp(v)))}>
      <span>to</span>
      <input class="num" type="number" step="0.2" id="hMax" value={h.max} aria-label="Range maximum" onchange={(e) => typed(e.currentTarget, h.max, (v) => (h.max = clamp(v)))}>
      <span class="unit">mm</span>
    </div>
  {/if}
  {#if h.mode !== 'brightness'}
    <div class="row" id="seedRow">
      <label for="seed">Seed</label>
      <input class="num" type="number" id="seed" value={h.seed} onchange={(e) => typed(e.currentTarget, h.seed, (v) => (h.seed = Math.round(v)))}>
      <button class="btn" id="reroll" onclick={reroll}>Randomize</button>
    </div>
  {:else}
    <label class="check" id="brightRow"><input type="checkbox" id="darkHigh" checked={h.darkHigh}
      onchange={(e) => { const on = e.currentTarget.checked; set(() => (h.darkHigh = on)); }}> Darker colors sit higher</label>
  {/if}
</div>

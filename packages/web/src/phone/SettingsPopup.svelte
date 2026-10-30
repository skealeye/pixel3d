<script lang="ts">
  import { app, setting } from '../state.svelte';
  import { resizeCanvas } from '../actions.svelte';

  let { close }: { close: () => void } = $props();

  let rw = $state(app.grid?.w ?? 32), rh = $state(app.grid?.h ?? 32);
  $effect(() => {
    if (app.grid) { rw = app.grid.w; rh = app.grid.h; }
  });

  const max = $derived(app.settings.colors.max);
  /** Never fewer than the drawing uses. */
  const least = $derived(Math.max(2, app.grid?.palette.length ?? 0));
  const setMax = (n: number) => setting(() => { app.settings.colors.max = n; });
</script>

<div class="phScrim" role="presentation" onpointerdown={(e) => { if (e.target === e.currentTarget) close(); }}>
  <div class="phPop" id="phSettings" role="dialog" aria-label="Settings">
    <div class="lbl">Canvas size</div>
    <div class="phRow" id="phSize">
      {#each [16, 32, 48, 64] as n (n)}
        <button class="btn" class:on={app.grid?.w === n && app.grid?.h === n} data-size={n} onclick={() => resizeCanvas(n, n)}>{n}</button>
      {/each}
    </div>
    <div class="phRow">
      <input id="phW" type="number" min="4" max="128" bind:value={rw} aria-label="Canvas width">
      <span>×</span>
      <input id="phH" type="number" min="4" max="128" bind:value={rh} aria-label="Canvas height">
      <button class="btn" id="phResize" title="Change the canvas size, keeping the drawing from the top-left" onclick={() => resizeCanvas(rw, rh)}>Resize</button>
    </div>
    <div class="lbl">Most colors</div>
    <div class="phRow">
      <button class="btn" id="phColorsMinus" aria-label="Fewer colors" disabled={max <= least} onclick={() => setMax(max - 1)}>−</button>
      <span id="phColors">{max}</span>
      <button class="btn" id="phColorsPlus" aria-label="More colors" disabled={max >= 16} onclick={() => setMax(max + 1)}>+</button>
    </div>
    <button class="btn primary" id="phDone" onclick={close}>Done</button>
  </div>
</div>

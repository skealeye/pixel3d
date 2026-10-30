<script lang="ts">
  import { ui } from '../state.svelte';
  import { BRUSHES } from '../brush';

  let { close }: { close: () => void } = $props();
</script>

<div class="phScrim" role="presentation" onpointerdown={(e) => { if (e.target === e.currentTarget) close(); }}>
  <div class="phPop" id="phBrushPop" role="dialog" aria-label="Brush size">
    <div class="lbl">Brush</div>
    <div class="phRow">
      {#each BRUSHES as b (b)}
        <button class="btn" class:on={ui.brush === b} data-brush={b} onclick={() => { ui.brush = b; close(); }}>{b}×{b}</button>
      {/each}
    </div>
  </div>
</div>

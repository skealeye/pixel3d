<script lang="ts">
  import { VERSION } from '@pixel3d/core';
  import { pieceCount } from './actions.svelte';
  import { app } from './state.svelte';

  const count = $derived(pieceCount());
  const filaments = $derived(app.grid ? app.grid.palette.length + (app.settings.base.enabled ? 1 : 0) : 0);
</script>

<footer>
  {#if app.grid}
    <span class={count > 1 ? 'bad' : 'ok'} id="health">{count > 1 ? `▲ ${count} separate pieces` : '● Watertight'}</span>
    <span id="fcount">{app.settings.export.mono ? '1 filament' : `${filaments} filaments`}</span>
  {/if}
  <span class="spacer"></span>
  <span>v{VERSION}</span>
</footer>

<script lang="ts">
  import { VERSION, filamentColors } from '@pixel3d/core';
  import { pieceCount } from './actions.svelte';
  import { app } from './state.svelte';

  const count = $derived(pieceCount());
  /** Distinct filaments: a base the same color as an art color shares its slot (R25). */
  const filaments = $derived(app.grid ? filamentColors(app.grid.palette, app.settings).length : 0);
</script>

<footer>
  {#if app.grid}
    <span class={count > 1 ? 'bad' : 'ok'} id="health">{count > 1 ? `▲ ${count} separate pieces` : '● Watertight'}</span>
    <span id="fcount">{filaments === 1 ? '1 filament' : `${filaments} filaments`}</span>
  {/if}
  <span class="spacer"></span>
  <span>v{VERSION}</span>
</footer>

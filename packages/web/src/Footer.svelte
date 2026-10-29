<script lang="ts">
  import { VERSION, filamentColors } from '@pixel3d/core';
  import { pieceCount, piecesNote } from './actions.svelte';
  import { app } from './state.svelte';

  const count = $derived(pieceCount());
  const note = $derived(piecesNote());
  /** Distinct filaments: a base the same color as an art color shares its slot (R25). */
  const filaments = $derived(app.grid ? filamentColors(app.grid, app.settings).length : 0);
</script>

<footer>
  {#if app.grid}
    <span class={count > 1 ? 'bad' : 'ok'} id="health">{count > 1 && note ? `▲ ${note[0]!.toUpperCase()}${note.slice(1)}` : '● Watertight'}</span>
    <span id="fcount">{filaments === 1 ? '1 filament' : `${filaments} filaments`}</span>
  {/if}
  <span class="spacer"></span>
  <a id="madeBy" href="https://ko-fi.com/seankealey" target="_blank" rel="noopener noreferrer" title="© 2026 seankealey">Made by seankealey</a>
  <!-- the open-source libraries in the bundle and their licenses, generated at build (scripts/third-party-licenses.ts) -->
  <a id="credits" href="THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener noreferrer" title="Open-source libraries pixel3d uses, and their licenses">Credits</a>
  <span>v{VERSION}</span>
</footer>

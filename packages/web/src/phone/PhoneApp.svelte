<script lang="ts">
  import { ui } from '../state.svelte';
  import { app, undo } from '../state.svelte';
  import ViewportPane from '../viewport/ViewportPane.svelte';
  import { savePng } from '../png';
  import DrawTab from './DrawTab.svelte';
  import SettingsPopup from './SettingsPopup.svelte';

  let settingsOpen = $state(false);
</script>

<div id="phone">
  <div id="phTop">
    <button class="btn" id="phGear" aria-label="Settings" onclick={() => (settingsOpen = true)}>⚙</button>
    <button class="btn" id="phUndo" disabled={!app.undo.length} onclick={undo}>Undo</button>
    <button class="btn" id="phReset" aria-label="Reset view" title="Reset view (fit the drawing)" disabled={ui.tab !== 'draw'} onclick={() => ui.viewReset++}>Reset</button>
    <nav id="phTabs" aria-label="View">
      <button id="tabDraw" class:on={ui.tab === 'draw'} onclick={() => (ui.tab = 'draw')}>Draw</button>
      <button id="tab3d" class:on={ui.tab === '3d'} onclick={() => (ui.tab = '3d')}>3D</button>
    </nav>
    <button class="btn primary" id="savePng" onclick={savePng}>Save PNG</button>
  </div>
  <!-- both tabs stay mounted so the 3D view keeps its model and camera -->
  <div id="phMain">
    <div class="phTab" hidden={ui.tab !== 'draw'}><DrawTab /></div>
    <div class="phTab" hidden={ui.tab !== '3d'}><ViewportPane /></div>
  </div>
</div>
{#if settingsOpen}<SettingsPopup close={() => (settingsOpen = false)} />{/if}

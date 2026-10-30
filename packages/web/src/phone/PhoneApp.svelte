<script lang="ts">
  import { ui } from '../state.svelte';
  import SourceCanvas from '../panels/SourceCanvas.svelte';
  import ViewportPane from '../viewport/ViewportPane.svelte';
</script>

<div id="phone">
  <div id="phTop"></div>
  <!-- both tabs stay mounted so the 3D view keeps its model and camera -->
  <div id="phMain">
    <div class="phTab" hidden={ui.tab !== 'draw'}><SourceCanvas id="phSrc" /></div>
    <div class="phTab" hidden={ui.tab !== '3d'}><ViewportPane /></div>
  </div>
  <nav id="phTabs">
    <button id="tabDraw" class:on={ui.tab === 'draw'} onclick={() => (ui.tab = 'draw')}>Draw</button>
    <button id="tab3d" class:on={ui.tab === '3d'} onclick={() => (ui.tab = '3d')}>3D</button>
  </nav>
</div>

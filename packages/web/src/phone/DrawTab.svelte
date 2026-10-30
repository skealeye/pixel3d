<script lang="ts">
  import { ui } from '../state.svelte';
  import SourceCanvas from '../panels/SourceCanvas.svelte';
  import BrushPopup from './BrushPopup.svelte';

  let brushOpen = $state(false);
  // Pick is the viewer's Select tool (a tap picks the color under it), as in the PC editor
  const tools = [['paint', 'paint', 'Paint'], ['erase', 'erase', 'Erase'], ['pick', 'select', 'Pick']] as const;
</script>

<div id="phDraw">
  <div id="phCanvas"><SourceCanvas id="phSrc" fit /></div>
  <div id="phControls">
    <div id="phToolRow">
      {#each tools as [id, tool, label] (id)}
        <button class="btn" id="phTool-{id}" class:on={ui.tool === tool} onclick={() => (ui.tool = tool)}>{label}</button>
      {/each}
      <button class="btn" id="phBrush" aria-label="Brush size" onclick={() => (brushOpen = true)}>{ui.brush}×{ui.brush} ▾</button>
    </div>
    <!-- the color slots and the picker go here -->
    <div id="phColorArea"></div>
  </div>
</div>
{#if brushOpen}<BrushPopup close={() => (brushOpen = false)} />{/if}

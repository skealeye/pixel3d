<script lang="ts">
  import { app, ui, undo, redo } from './state.svelte';
  import { loadFile } from './load';
  import ExportPopover from './panels/ExportPopover.svelte';
  import BatchDialog from './panels/BatchDialog.svelte';

  let fileIn: HTMLInputElement;
</script>

<header>
  <div class="mark">pixel<span>3d</span></div>
  <div class="file" id="fileInfo">
    {#if app.source && app.meta}<b>{app.source.name}</b>&nbsp; {app.meta.info}{:else}Open an image, or drop one anywhere on the window{/if}
  </div>
  <div class="spacer"></div>
  <button class="btn icon" id="undo" title="Undo (Ctrl+Z)" disabled={!app.undo.length} onclick={undo}>↶</button>
  <button class="btn icon" id="redo" title="Redo (Ctrl+Y)" disabled={!app.redo.length} onclick={redo}>↷</button>
  <button class="btn" id="openBatch" onclick={() => { ui.popover = null; ui.batch = true; }}>Batch and API</button>
  <button class="btn" id="openImg" title="Open an image, or drop one anywhere on the window" onclick={() => fileIn.click()}>Open image</button>
  <input type="file" id="fileIn" accept="image/png,image/gif,image/webp,image/jpeg" hidden bind:this={fileIn}
    onchange={(e) => { const t = e.currentTarget; void loadFile(t.files?.[0]); t.value = ''; }}>
  <ExportPopover />
  <a class="btn kofi" id="kofi" href="https://ko-fi.com/seankealey" target="_blank" rel="noopener noreferrer"
    title="Support pixel3d on Ko-fi"><img src="kofi.png" alt="" width="20" height="16">Support me on Ko-fi</a>
</header>

<BatchDialog />

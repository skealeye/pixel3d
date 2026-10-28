<script lang="ts">
  import { untrack } from 'svelte';
  import { toast, ui } from '../state.svelte';
  import { applyPresetText, baseName, currentPreset, presetText } from '../presets.svelte';
  import { download } from '../export/exporter';
  import { batchSnippets } from '../snippets';

  /** Batch and API (mockup v0.1.9): save the settings as a preset, the commands that use it, and Load preset (spec §5). */
  let dialog: HTMLDialogElement;
  let presetIn: HTMLInputElement;
  /** What the dialog shows, worked out when it opens (as the mockup does). */
  let shown = $state({ name: 'model', cli: '', json: '' });

  $effect(() => {
    if (ui.batch && !dialog.open) {
      untrack(() => {
        const name = baseName();
        shown = { name, cli: batchSnippets(name), json: presetText(currentPreset()) };
      });
      dialog.showModal();
    } else if (!ui.batch && dialog.open) dialog.close();
  });

  function save() {
    const file = `${shown.name}.json`;
    download(file, presetText(currentPreset()) + '\n', 'application/json');
    ui.batch = false;
    toast(`Saved ${file}`);
  }

  async function load(file: File | undefined) {
    if (!file) return;
    if (applyPresetText(await file.text(), file.name)) ui.batch = false;
  }
</script>

<dialog id="batch" bind:this={dialog} onclose={() => (ui.batch = false)}>
  <h3>Batch and API</h3>
  <p>Save these settings as a preset, then convert a whole folder from the command line, from Python over the local API, or from Claude through the MCP tools. Your colour heights become colour rules.</p>
  <pre id="cli">{shown.cli}</pre>
  <pre id="presetJson">{shown.json}</pre>
  <div class="row" style="justify-content:flex-end">
    <!-- not in the mockup: Load preset (spec §5: the UI can save the current settings as a preset and load one) -->
    <button class="btn" id="loadPreset" style="margin-right:auto" onclick={() => presetIn.click()}>Load preset</button>
    <input type="file" id="presetIn" accept=".json,application/json" hidden bind:this={presetIn}
      onchange={(e) => { const t = e.currentTarget; void load(t.files?.[0]); t.value = ''; }}>
    <button class="btn" id="closeBatch" onclick={() => (ui.batch = false)}>Close</button>
    <button class="btn primary" id="savePreset" onclick={save}>Save preset</button>
  </div>
</dialog>

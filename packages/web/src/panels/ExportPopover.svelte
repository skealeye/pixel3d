<script lang="ts">
  import { filamentColors, safeName, type Settings, type Slicer } from '@pixel3d/core';
  import { app, setting, stopPicking, toast, ui } from '../state.svelte';
  import { baseName } from '../presets.svelte';
  import { downloadFiles, failNextExport, runExport } from '../export/exporter';
  import { register } from '../hook';
  import { colourInput } from './colour';

  /** The Export panel (mockup v0.1.9): All colors / One color, format, slicer, file name and a summary line (spec §4.8). */
  const ex = $derived(app.settings.export);
  const open = $derived(ui.popover === 'export');
  const SLICERS: [Slicer, string][] = [['bambu', 'Bambu Studio'], ['orca', 'OrcaSlicer'], ['prusa', 'PrusaSlicer'], ['generic', 'Other']];
  const slicerLabel = $derived(SLICERS.find(([v]) => v === ex.slicer)![1]);
  const monoColour = colourInput((hex) => (app.settings.export.monoColour = hex));
  let busy = $state(false);
  $effect(() => register({ failNextExport }));

  // a new image names the export after itself
  let named: unknown = null;
  $effect(() => {
    const src = app.source;
    if (src && src !== named) { named = src; ui.exportName = baseName(); }
  });

  const name = $derived(safeName(ui.exportName || 'model'));
  /** Two printed objects come out as two STL files: halves (front, back) and a clicker (cap, body). */
  const fileNames = $derived.by(() => {
    const two = app.settings.make === 'clicker' ? ['cap', 'body'] : app.settings.sides.mode === 'halves' ? ['front', 'back'] : null;
    return ex.format === 'stl' && two ? `${name}_${two[0]}.stl and ${name}_${two[1]}.stl` : `${name}.${ex.format}`;
  });
  /** Distinct filaments, as the 3MF assigns them (R25). */
  const filaments = $derived(app.grid ? filamentColors(app.grid, app.settings).length : 0);
  const summary = $derived(`${fileNames}, ${filaments === 1 ? 'one filament' : `${filaments} filaments`}, ${ui.dims}`);

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    ui.popover = open ? null : 'export';
  }

  const set = (apply: () => void) => setting(apply);

  /** Build the model afresh in the export worker, with the real settings (rotation included), and download it. */
  async function exportFile() {
    if (busy || !app.source) return;
    stopPicking(); // the grid shown while picking keeps the background
    const grid = app.grid;
    if (!grid) return;
    busy = true;
    ui.popover = null;
    const done = `Exported ${fileNames}` + (ex.mono ? ' in one color.' : ex.format === '3mf' ? `, filaments 1 to ${filaments} assigned for ${slicerLabel}.` : '.');
    try {
      const settings = $state.snapshot(app.settings) as Settings;
      downloadFiles(await runExport({ kind: 'model', grid, settings, name }), `${name}.zip`);
      toast(done);
    } catch (err) {
      toast(`Couldn't export: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onclick={() => { if (open) ui.popover = null; }} />

<div class="exportWrap">
  <button class="btn primary" id="exportBtn" class:on={open} disabled={!app.source || busy} onclick={toggle}>Export</button>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div id="exportPop" class:open onclick={(e) => e.stopPropagation()}>
    <h2>Export</h2>
    <div class="seg" data-key="colourMode">
      <button data-v="full" class:on={!ex.mono} onclick={() => ex.mono && set(() => (app.settings.export.mono = false))}>All colors</button>
      <button data-v="mono" class:on={ex.mono} onclick={() => !ex.mono && set(() => (app.settings.export.mono = true))}>One color</button>
    </div>
    {#if ex.mono}
      <div class="row" id="monoRow"><label for="monoColor">Print color</label><input type="color" id="monoColor" value={ex.monoColour} {...monoColour}></div>
    {/if}
    <div class="seg" data-key="format">
      <button data-v="3mf" class:on={ex.format === '3mf'} onclick={() => ex.format !== '3mf' && set(() => (app.settings.export.format = '3mf'))}>3MF</button>
      <button data-v="stl" class:on={ex.format === 'stl'} onclick={() => ex.format !== 'stl' && set(() => (app.settings.export.format = 'stl'))}>STL</button>
    </div>
    {#if ex.format === '3mf'}
      <div class="row" id="slicerRow"><label for="slicer">Slicer</label>
        <select id="slicer" value={ex.slicer} onchange={(e) => { const v = e.currentTarget.value as Slicer; set(() => (app.settings.export.slicer = v)); }}>
          {#each SLICERS as [v, label] (v)}<option value={v}>{label}</option>{/each}
        </select>
      </div>
    {/if}
    <div class="row"><label style="flex:0" for="name">Name</label><input id="name" bind:value={ui.exportName}></div>
    <div class="summary" id="summary">{summary}</div>
    <button class="btn primary" id="export" disabled={busy} onclick={exportFile}>Export file</button>
  </div>
</div>

<script lang="ts">
  import { app, setting, ui } from '../state.svelte';
  import { magnetPocket } from '../magnets';

  /** Magnets: placed by clicking the model (viewport/handles.ts), dragged there, removed here. */
  const m = $derived(app.settings.magnets);
  const sides = $derived(app.settings.sides.mode);
  const lowest = $derived(app.grid?.palette.length ? Math.min(...app.grid.palette.map((p) => p.height)) : app.settings.heights.h);
  const pocket = $derived(magnetPocket(app.settings, lowest));
  const sizes = [['8x3', '8 × 3 mm'], ['6x2', '6 × 2 mm'], ['10x3', '10 × 3 mm']] as const;
  const positions = [['bottom', 'Pocket in bottom'], ['centre', 'Sealed in centre']] as const;

  function place() {
    if (!app.grid) { ui.placing = false; return; }
    ui.placing = !ui.placing;
  }
</script>

<section class:off={app.settings.make === 'clicker'} inert={app.settings.make === 'clicker'}>
  <h2>Magnets <small id="magCount">{m.at.length} placed</small></h2>
  <div class="row" style="margin-top:0"><label for="magSize">Size</label>
    <!-- the mockup's three sizes; a custom size comes from presets -->
    <select id="magSize" value={typeof m.size === 'string' ? m.size : ''}
      onchange={(e) => { const v = e.currentTarget.value as '8x3' | '6x2' | '10x3'; setting(() => (m.size = v)); }}>
      {#if typeof m.size !== 'string'}<option value="">{m.size.d} × {m.size.h} mm</option>{/if}
      {#each sizes as [v, label] (v)}<option value={v}>{label}</option>{/each}
    </select>
  </div>
  {#if sides === 'single'}
    <div id="magPosRow">
      <div class="seg" data-key="magPos">
        {#each positions as [v, label] (v)}
          <button data-v={v} class:on={m.position === v} onclick={() => m.position !== v && setting(() => (m.position = v))}>{label}</button>
        {/each}
      </div>
    </div>
  {/if}
  <div class="row"><button class="btn" id="placeMag" class:on={ui.placing} onclick={place}>Place a magnet</button><button class="btn" id="clearMag"
    onclick={() => m.at.length && setting(() => (m.at = []))}>Clear all</button></div>
  <ul class="maglist" id="magList">
    {#each m.at as _, i (i)}
      <li>Magnet {i + 1}<button class="del" title="Remove" aria-label="Remove magnet {i + 1}" onclick={() => setting(() => m.at.splice(i, 1))}>×</button></li>
    {/each}
  </ul>
  <p class="hint" id="magHint">
    {#if m.at.length}
      {#if pocket.thin}<span class="warn">A {pocket.d} × {pocket.h} mm magnet needs about {pocket.need} mm here. Make the base thicker or pick a smaller magnet.</span>
      {:else if pocket.sealed}Sealed inside. The print pauses at this layer so you can drop the magnet in.
      {:else}Open on the bottom, so you can press the magnet in after printing. Drag to move.{/if}
    {:else if sides === 'halves'}Pockets open on the glue face, so the magnet ends up sealed inside.{/if}
  </p>
  <!-- not in the mockup: the material readout (spec §4.8) -->
  {#if m.at.length}<p class="hint" id="magRead">{pocket.readout}</p>{/if}
</section>

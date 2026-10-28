<script lang="ts">
  import { app, live, setting, ui } from '../state.svelte';
  import Slider from './Slider.svelte';

  /** Inside: Solid, Shell or Hollow. Shell and Hollow need a flat bottom, so the Sides mode limits them (sides.ts). */
  const inside = $derived(app.settings.inside);
  const sides = $derived(app.settings.sides.mode);
  const modes = [['solid', 'Solid'], ['shell', 'Shell'], ['hollow', 'Hollow']] as const;
  const HINTS = {
    solid: 'Filled all the way through.',
    shell: 'Hollow inside with a closed floor, to save filament and weight. Use Cut view to see inside.',
    hollow: 'Hollow inside and open underneath, like an upside-down tray.',
  };
  const allowed = $derived(ALLOWED[sides]);
  const wall = live(() => inside.wall, (v) => (inside.wall = v));

  function pick(v: 'solid' | 'shell' | 'hollow') {
    if (inside.mode === v || !setting(() => (inside.mode = v))) return;
    // Cut view comes on by itself the first time Shell or Hollow is picked
    if (v !== 'solid' && !ui.cutAuto) { ui.cutAuto = true; ui.cut = true; }
  }
</script>

<script lang="ts" module>
  /** Inside modes each Sides mode allows: Double sided has no open bottom; halves keep their glue faces solid. */
  export const ALLOWED = { single: ['solid', 'shell', 'hollow'], solid: ['solid', 'shell'], halves: ['solid'] } as const;
</script>

<section class:off={app.settings.make === 'clicker'} inert={app.settings.make === 'clicker'}>
  <h2>Inside</h2>
  <div class="seg" data-key="bottom">
    {#each modes as [v, label] (v)}
      <button data-v={v} class:on={inside.mode === v} disabled={!(allowed as readonly string[]).includes(v)} onclick={() => pick(v)}>{label}</button>
    {/each}
  </div>
  <p class="hint" id="bottomHint">{sides === 'halves' ? 'Halves stay solid so the glue faces are flat.' : HINTS[inside.mode]}</p>
  {#if inside.mode !== 'solid'}
    <div id="wallRow"><Slider id="wall" label="Wall" min={0.8} max={5} step={0.1} value={inside.wall} unit="mm" format={(v) => v.toFixed(1)} {...wall} /></div>
  {/if}
</section>

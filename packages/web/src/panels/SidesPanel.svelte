<script lang="ts">
  import { app, setting } from '../state.svelte';
  import { ALLOWED } from './InsidePanel.svelte';

  const sides = $derived(app.settings.sides);
  const modes = [['single', 'One side'], ['solid', 'Double sided'], ['halves', 'Two halves']] as const;
  const HINTS = {
    single: 'Pixels on the front only. Prints flat with no supports.',
    // not in the mockup: the last sentence, the note recommending Two halves (spec §4.8)
    solid: 'Pixels on both faces in one piece. Needs supports when printed flat. For the cleanest finish, use Two halves.',
    halves: 'Front and back as two flat-backed pieces. Print both, then glue. The cleanest finish.',
  };
  const halves = $derived(sides.mode === 'halves');

  function pick(v: 'single' | 'solid' | 'halves') {
    if (sides.mode === v) return;
    setting(() => {
      sides.mode = v;
      // an Inside mode this side mode can't build goes back to Solid
      const inside = app.settings.inside;
      if (!(ALLOWED[v] as readonly string[]).includes(inside.mode)) inside.mode = 'solid';
    });
  }
</script>

<section class:off={app.settings.make === 'clicker'} inert={app.settings.make === 'clicker'}>
  <h2>Sides</h2>
  <div class="seg" data-key="sides">
    {#each modes as [v, label] (v)}
      <button data-v={v} class:on={sides.mode === v} onclick={() => pick(v)}>{label}</button>
    {/each}
  </div>
  <p class="hint" id="sidesHint">{HINTS[sides.mode]}</p>
  {#if sides.mode !== 'single'}
    <div id="applyRow">
      <div class="row"><span class="lbl">Color heights apply to</span></div>
      <div class="seg" data-key="heightsOn">
        <button data-v="both" id="hoBoth" class:on={sides.heightsOn === 'both'} onclick={() => sides.heightsOn !== 'both' && setting(() => (sides.heightsOn = 'both'))}>{halves ? 'Both halves' : 'Both sides'}</button>
        <button data-v="top" id="hoTop" class:on={sides.heightsOn === 'top'} onclick={() => sides.heightsOn !== 'top' && setting(() => (sides.heightsOn = 'top'))}>{halves ? 'Front half only' : 'Top side only'}</button>
      </div>
    </div>
  {/if}
</section>

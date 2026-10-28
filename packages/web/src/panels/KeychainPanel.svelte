<script lang="ts">
  import { app, live, setting } from '../state.svelte';
  import { colourInput } from './colour';
  import Favourites from './Favourites.svelte';
  import Slider from './Slider.svelte';

  /** Keychain: none, a hole (dragged on the model, viewport/handles.ts) or a loop placed by angle. */
  const key = $derived(app.settings.keychain);
  const types = [['none', 'None'], ['hole', 'Hole'], ['loop', 'Loop']] as const;
  const f1 = (v: number) => v.toFixed(1);

  const holeSize = live(() => key.hole.size, (v) => (key.hole.size = v));
  const angle = live(() => key.loop.angle, (v) => (key.loop.angle = Math.round(v)));
  // the hole stays at least 2 mm smaller than the outside
  const inner = live(() => key.loop.inner, (v) => { key.loop.inner = v; if (key.loop.outer < v + 2) key.loop.outer = v + 2; });
  const outer = live(() => key.loop.outer, (v) => { key.loop.outer = v; if (key.loop.inner > v - 2) key.loop.inner = v - 2; });
  const colour = colourInput((hex) => (key.loop.colour = hex));

  const ownColour = $derived(!app.settings.base.enabled && !app.settings.export.mono);
  const hint = $derived(key.type === 'hole'
    ? 'Drag the gold marker on the model to move the hole. It cuts through every layer.'
    : app.settings.base.enabled ? 'The loop uses the base color.' : 'Move the slider to slide the loop around the edge.');
</script>

<section class:off={app.settings.make === 'clicker'} inert={app.settings.make === 'clicker'}>
  <h2>Keychain</h2>
  <div class="seg" data-key="key">
    {#each types as [v, label] (v)}
      <button data-v={v} class:on={key.type === v} onclick={() => key.type !== v && setting(() => (key.type = v))}>{label}</button>
    {/each}
  </div>
  {#if key.type === 'hole'}
    <div id="holeRows">
      <div class="seg" data-key="holeStyle">
        <button data-v="round" class:on={key.hole.style === 'round'} onclick={() => key.hole.style !== 'round' && setting(() => (key.hole.style = 'round'))}>Round hole</button>
        <button data-v="square" class:on={key.hole.style === 'square'} onclick={() => key.hole.style !== 'square' && setting(() => (key.hole.style = 'square'))}>Square hole</button>
      </div>
      <Slider id="holeD" label="Size" min={2} max={10} step={0.5} value={key.hole.size} unit="mm" format={f1} {...holeSize} />
    </div>
  {:else if key.type === 'loop'}
    <div id="loopRows">
      <div class="seg" data-key="loopStyle">
        <button data-v="round" class:on={key.loop.style === 'round'} onclick={() => key.loop.style !== 'round' && setting(() => (key.loop.style = 'round'))}>Rounded loop</button>
        <button data-v="pixel" class:on={key.loop.style === 'pixel'} onclick={() => key.loop.style !== 'pixel' && setting(() => (key.loop.style = 'pixel'))}>Pixel loop</button>
      </div>
      <Slider id="loopAngle" label="Position" min={0} max={359} step={1} value={key.loop.angle} unit="°" format={(v) => String(Math.round(v))} {...angle} />
      <Slider id="loopIn" label="Hole" min={2} max={10} step={0.5} value={key.loop.inner} unit="mm" format={f1} {...inner} />
      <Slider id="loopOut" label="Outside" min={4} max={16} step={0.5} value={key.loop.outer} unit="mm" format={f1} {...outer} />
      {#if ownColour}
        <div id="loopColRows">
          <div class="row"><label for="loopColor">Loop color</label><input type="color" id="loopColor" value={key.loop.colour} {...colour}></div>
          <Favourites id="loopFavs" value={key.loop.colour} pick={(hex) => setting(() => (key.loop.colour = hex))} />
        </div>
      {/if}
    </div>
  {/if}
  {#if key.type !== 'none'}<p class="hint" id="keyHint">{hint}</p>{/if}
</section>

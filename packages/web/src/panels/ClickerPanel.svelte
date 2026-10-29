<script lang="ts">
  import { CAP_ROOF, MX, type Settings } from '@pixel3d/core';
  import { downloadFiles, runExport } from '../export/exporter';
  import { app, live, setting, toast, ui } from '../state.svelte';
  import { press } from '../viewport/press';
  import { colorInput } from './color';
  import Favorites from './Favorites.svelte';
  import Slider from './Slider.svelte';

  /** Make: Flat model / Clicker, and the keycap clicker's settings (spec §4.6b). Core builds both parts (clicker.ts). */
  const s = $derived(app.settings);
  const c = $derived(app.settings.clicker);
  const on = $derived(s.make === 'clicker');
  const shapes = [['outline', 'Outline'], ['circle', 'Circle'], ['square', 'Square']] as const;
  const views = [['apart', 'Apart (as printed)'], ['assembled', 'Assembled']] as const;
  const backings = [['base', 'Base color'], ['art', 'Art colors']] as const;
  const f1 = (v: number) => v.toFixed(1);

  const border = live(() => c.border, (v) => (c.border = v));
  const capHeight = live(() => c.capHeight, (v) => (c.capHeight = v));
  /** The body's own color, or null for the base color. */
  const bodyColor = colorInput((hex) => (c.bodyColor = hex));
  const setBody = (hex: string | null) => c.bodyColor !== hex && setting(() => (c.bodyColor = hex));
  const fitGap = live(() => c.fitGap, (v) => (c.fitGap = Math.round(v * 100) / 100));

  /** One switch's nudge from its automatic spot (axis 0 = X, 1 = Y), mm. */
  const nudge = (i: number, axis: 0 | 1) => live(() => c.offsets[i]?.[axis] ?? 0, (v) => {
    while (c.offsets.length <= i) c.offsets.push([0, 0]);
    c.offsets[i]![axis] = Math.round(v * 2) / 2;
  });
  const nudges = [0, 1, 2].map((i) => [nudge(i, 0), nudge(i, 1)] as const);
  const moved = $derived(c.offsets.some((o) => o[0] !== 0 || o[1] !== 0));

  /** The cap's thinnest backing: the pocket plus its roof, kept even with Base off (core `capThickness`). */
  const minBacking = Math.round((MX.engage + CAP_ROOF) * 100) / 100;

  function make(v: 'model' | 'clicker') {
    if (s.make === v) return;
    if (setting(() => (app.settings.make = v))) {
      ui.placing = false;
      press.reset();
    }
  }

  /** Space presses unless focus is in a control that uses it; the Press button itself is fine (it gets focus on a click). */
  const pressable = (t: EventTarget | null) => !(t instanceof HTMLElement && t.id !== 'clkPress' && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName));
  function keydown(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.repeat || !on || ui.clkView !== 'assembled' || !pressable(document.activeElement)) return;
    e.preventDefault();
    press.start();
  }
  function keyup(e: KeyboardEvent) { if (e.code === 'Space') press.stop(); }

  let busy = $state(false);

  /** The fit-test coupons (core `fitTest`) in the Export format (a 3MF or FBX, or a zip of STLs or of the OBJ and MTL), built in the export worker. */
  async function downloadFitTest() {
    if (busy) return;
    busy = true;
    try {
      downloadFiles(await runExport({ kind: 'fitTest', settings: $state.snapshot(app.settings) as Settings }), 'pixel3d_fit_test.zip');
    } catch (err) {
      toast(`Couldn't make the fit test: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  }
</script>

<!-- a lost focus never sends the keyup, so release then too -->
<svelte:window onkeydown={keydown} onkeyup={keyup} onblur={() => press.stop()} />

<section>
  <h2>Make</h2>
  <div class="seg" data-key="make">
    <button data-v="model" class:on={!on} onclick={() => make('model')}>Flat model</button>
    <button data-v="clicker" class:on={on} onclick={() => make('clicker')}>Clicker</button>
  </div>
  <p class="hint" id="makeHint">{on
    ? 'Your art becomes a key cap that clicks on a mechanical keyboard switch (MX-compatible). Prints as two parts: the cap and a body that holds the switch.'
    : 'A flat pixel model: keychain, magnet, fridge magnet or display piece.'}</p>
</section>

{#if on}
  <section id="clkSec">
    <h2>Clicker</h2>
    <div id="clkRows">
      <div class="row"><span class="lbl">Body shape</span></div>
      <div class="seg" data-key="clkShape">
        {#each shapes as [v, label] (v)}
          <button data-v={v} class:on={c.shape === v} onclick={() => c.shape !== v && setting(() => (c.shape = v))}>{label}</button>
        {/each}
      </div>
      <Slider id="clkBorder" label="Border" min={1.5} max={10} step={0.5} value={c.border} unit="mm" format={f1} {...border} />
      <Slider id="clkProud" label="Cap height" min={0.5} max={4} step={0.5} value={c.capHeight} unit="mm" format={f1} {...capHeight} />
      <!-- spec §4.6b (R22): 0.2–1.5 mm, not the mockup's 0.1–0.6 -->
      <Slider id="clkTol" label="Fit gap" min={0.2} max={1.5} step={0.05} value={c.fitGap} unit="mm" format={(v) => v.toFixed(2)} {...fitGap} />
      <!-- not in the mockup (user request 2026-10-28): the cap's backing color -->
      <div class="row"><span class="lbl">Cap backing</span></div>
      <div class="seg" data-key="clkBacking">
        {#each backings as [v, label] (v)}
          <button data-v={v} class:on={c.backing === v} onclick={() => c.backing !== v && setting(() => (c.backing = v))}>{label}</button>
        {/each}
      </div>
      <p class="hint" id="clkBackingHint">{c.backing === 'art'
        ? "Each art color runs the full depth of the cap, so the cap has no base color. Spots that aren't art take the nearest art color."
        : 'The cap sits on a backing in the base color.'}</p>
      <!-- not in the mockup (user request 2026-10-28): the body in its own color, e.g. one of the art colors, so an
           art-color cap doesn't add a filament -->
      <div class="row"><span class="lbl">Body color</span></div>
      <div class="seg" data-key="clkBody">
        <button data-v="base" class:on={c.bodyColor === null} onclick={() => setBody(null)}>Base color</button>
        <button data-v="own" class:on={c.bodyColor !== null} onclick={() => setBody(c.bodyColor ?? s.base.color)}>Own color</button>
      </div>
      {#if c.bodyColor !== null}
        <div id="clkBodyRows">
          <div class="row"><label for="clkBodyColor">Color</label><input type="color" id="clkBodyColor" value={c.bodyColor} {...bodyColor}></div>
          {#if app.grid?.palette.length}
            <div class="favs" id="clkBodyArt" style="flex-wrap:wrap">
              <span class="lbl">Art colors</span>
              {#each app.grid.palette as p (p.hex)}
                <button class="sw" style:background={p.hex} title={p.hex} aria-label={`Use ${p.hex}`} onclick={() => setBody(p.hex)}></button>
              {/each}
            </div>
          {/if}
          <Favorites id="clkBodyFavs" value={c.bodyColor} pick={(hex) => setBody(hex)} />
        </div>
      {/if}
      <div class="row"><span class="lbl">Switches</span></div>
      <div class="seg" data-key="clkSwitches">
        {#each [1, 2, 3] as const as n (n)}
          <button data-v={n} class:on={c.switches === n} onclick={() => c.switches !== n && setting(() => (c.switches = n))}>{n}</button>
        {/each}
      </div>
      <div class="row"><span class="lbl">Switch position</span></div>
      {#each nudges.slice(0, c.switches) as [nx, ny], i (i)}
        <Slider id={`clkX${i}`} label={c.switches > 1 ? `Switch ${i + 1} X` : 'X'} min={-20} max={20} step={0.5} value={c.offsets[i]?.[0] ?? 0} unit="mm" format={f1} {...nx} />
        <Slider id={`clkY${i}`} label={c.switches > 1 ? `Switch ${i + 1} Y` : 'Y'} min={-20} max={20} step={0.5} value={c.offsets[i]?.[1] ?? 0} unit="mm" format={f1} {...ny} />
      {/each}
      <div class="row"><button class="btn" id="clkSpotReset" disabled={!moved} onclick={() => setting(() => (c.offsets = []))}>Reset to automatic</button></div>
      <p class="hint" id="clkSpotHint">Moves the switch (and its pockets in the cap and body) from the automatic spot. X is right, Y is up. Press where you want the click to feel best.</p>
      <div class="row"><span class="lbl">View</span></div>
      <div class="seg" data-key="clkView">
        {#each views as [v, label] (v)}
          <button data-v={v} class:on={ui.clkView === v} onclick={() => (ui.clkView = v)}>{label}</button>
        {/each}
      </div>
      {#if ui.clkView === 'assembled'}
        <div class="row" id="pressRow"><button class="btn" id="clkPress"
          onpointerdown={() => press.start()} onpointerup={() => press.stop()} onpointerleave={() => press.stop()} onpointercancel={() => press.stop()}>Press</button><span class="bginfo">Hold the button, or hold Space, to press the cap down.</span></div>
      {/if}
      <p class="hint" id="clkHint">Needs {c.switches} MX-style switch{c.switches > 1 ? 'es' : ''}. Press {c.switches > 1 ? 'each' : 'the'} switch into the body from above until it sits on the step, then push the cap on. {MX.travel} mm of travel. Both parts print flat side down, the cap art side up. The cap's backing is always at least {minBacking} mm thick, even with Base off, so it can hold the switch.</p>
      <!-- not in the mockup: the fit test (spec §4.6b). The mockup's Export panel has no place for it, so it stays here -->
      <div class="row"><button class="btn" id="fitTest" disabled={busy} onclick={downloadFitTest}>Download fit test</button></div>
      <p class="hint" id="fitHint">Print this first to check the switch fits your printer: a stem coupon and three shaft coupons, 0.1 mm tighter, as designed and 0.1 mm looser (1, 2 and 3 notches).</p>
    </div>
  </section>
{/if}

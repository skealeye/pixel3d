<script lang="ts">
  import { CAP_ROOF, MX, fitTest, toSTL, type Settings } from '@pixel3d/core';
  import { zipSync } from 'fflate';
  import { app, live, setting, toast, ui } from '../state.svelte';
  import { press } from '../viewport/press';
  import Slider from './Slider.svelte';

  /** Make: Flat model / Clicker, and the keycap clicker's settings (spec §4.6b). Core builds both parts (clicker.ts). */
  const s = $derived(app.settings);
  const c = $derived(app.settings.clicker);
  const on = $derived(s.make === 'clicker');
  const shapes = [['outline', 'Outline'], ['circle', 'Circle'], ['square', 'Square']] as const;
  const views = [['apart', 'Apart (as printed)'], ['assembled', 'Assembled']] as const;
  const f1 = (v: number) => v.toFixed(1);

  const border = live(() => c.border, (v) => (c.border = v));
  const capHeight = live(() => c.capHeight, (v) => (c.capHeight = v));
  const fitGap = live(() => c.fitGap, (v) => (c.fitGap = Math.round(v * 100) / 100));

  /** The cap's thinnest backing: the pocket plus its roof, kept even with Base off (core `capThickness`). */
  const minBacking = Math.round((MX.engage + CAP_ROOF) * 100) / 100;

  function make(v: 'model' | 'clicker') {
    if (s.make === v) return;
    if (setting(() => (app.settings.make = v))) {
      ui.placing = false;
      press.reset();
    }
  }

  const pressable = (t: EventTarget | null) => !(t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName));
  function keydown(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.repeat || !on || ui.clkView !== 'assembled' || !pressable(document.activeElement)) return;
    e.preventDefault();
    press.start();
  }
  function keyup(e: KeyboardEvent) { if (e.code === 'Space') press.stop(); }

  let busy = $state(false);

  /** The fit-test coupons (core `fitTest`) as one STL per coupon in a zip. Task 15's export takes this over. */
  async function downloadFitTest() {
    if (busy) return;
    busy = true;
    try {
      const model = await fitTest($state.snapshot(app.settings) as Settings);
      const files = await toSTL(model, { mono: true, name: 'fit_test' });
      const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])), { level: 6 });
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'pixel3d_fit_test.zip' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast(`Couldn't make the fit test: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={keydown} onkeyup={keyup} />

<section>
  <h2>Make</h2>
  <div class="seg" data-key="make">
    <button data-v="model" class:on={!on} onclick={() => make('model')}>Flat model</button>
    <button data-v="clicker" class:on={on} onclick={() => make('clicker')}>Clicker</button>
  </div>
  <p class="hint" id="makeHint">{on
    ? 'Your art becomes a key cap that clicks on a mechanical keyboard switch (Cherry MX style). Prints as two parts: the cap and a body that holds the switch.'
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
      <div class="row"><span class="lbl">Switches</span></div>
      <div class="seg" data-key="clkSwitches">
        {#each [1, 2, 3] as const as n (n)}
          <button data-v={n} class:on={c.switches === n} onclick={() => c.switches !== n && setting(() => (c.switches = n))}>{n}</button>
        {/each}
      </div>
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
      <!-- not in the mockup: the fit test (spec §4.6b), here until Task 15's export panel takes it over -->
      <div class="row"><button class="btn" id="fitTest" disabled={busy} onclick={downloadFitTest}>Download fit test</button></div>
      <p class="hint" id="fitHint">Print this first to check the switch fits your printer: a stem coupon and three shaft coupons, 0.1 mm tighter, as designed and 0.1 mm looser (1, 2 and 3 notches).</p>
    </div>
  </section>
{/if}

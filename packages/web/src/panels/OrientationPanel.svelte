<script lang="ts">
  import { app, setting } from '../state.svelte';

  /** Export orientation in quarter turns (spec §4.8). The viewport shows it; core gets it at export. */
  const rot = $derived(app.settings.rotation);
  const label = $derived(rot.some(Boolean) ? `X ${rot[0] * 90}°, Y ${rot[1] * 90}°, Z ${rot[2] * 90}°` : 'Flat');

  const turn = (a: 0 | 1 | 2) => setting(() => { app.settings.rotation[a] = (app.settings.rotation[a] + 1) % 4; });
  const to = (r: [number, number, number]) => { if (rot.some((v, i) => v !== r[i])) setting(() => (app.settings.rotation = r)); };
</script>

<section>
  <h2>Orientation</h2>
  <div class="row" style="margin-top:0">
    <button class="btn" data-rot="0" onclick={() => turn(0)}>Rotate X</button>
    <button class="btn" data-rot="1" onclick={() => turn(1)}>Rotate Y</button>
    <button class="btn" data-rot="2" onclick={() => turn(2)}>Rotate Z</button>
  </div>
  <div class="row">
    <button class="btn" id="flat" onclick={() => to([0, 0, 0])}>Flat</button>
    <button class="btn" id="edge" onclick={() => to([1, 0, 0])}>On edge</button>
    <span class="hint" style="margin:0" id="rotLabel">{label}</span>
  </div>
</section>

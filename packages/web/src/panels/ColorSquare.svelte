<script lang="ts">
  import { untrack } from 'svelte';
  import { hexToHsv, hsvToHex } from '../color';

  /**
   * A saturation (x) and brightness (y) square with a hue strip beneath it and a patch of the color. A change is a
   * gesture, as in `ColorWheel`: `onstart`, then `oninput` for each step, then `onend`.
   */
  let { value, oninput, onstart, onend }: { value: string; oninput: (hex: string) => void; onstart: () => void; onend: () => void } = $props();

  let h = $state(0), s = $state(0), v = $state(1);
  let drag: 'sv' | 'hue' | null = null;
  const valid = (x: string) => /^#[0-9a-f]{6}$/i.test(x);

  // follow the color from outside (a slot, Pick): keep the hue and saturation we hold while it is the same color
  $effect(() => {
    const x = value;
    if (valid(x) && x.toLowerCase() !== untrack(() => hsvToHex(h, s, v))) ({ h, s, v } = hexToHsv(x));
  });

  const unit = (n: number) => Math.min(1, Math.max(0, n));

  function at(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement, b = el.getBoundingClientRect();
    const x = unit((e.clientX - b.left) / b.width);
    if (drag === 'hue') h = x * 360;
    else { s = x; v = 1 - unit((e.clientY - b.top) / b.height); }
    oninput(hsvToHex(h, s, v));
  }

  const down = (kind: 'sv' | 'hue') => (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = kind;
    onstart();
    at(e);
  };
  function move(e: PointerEvent) { if (drag) at(e); }
  function up() { if (drag) { drag = null; onend(); } }
</script>

<div class="csq">
  <div id="phSquare" class="csqSV" role="presentation" style:--hue={hsvToHex(h, 1, 1)} onpointerdown={down('sv')} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <span class="csqDot" style:left="{s * 100}%" style:top="{(1 - v) * 100}%" style:background={value}></span>
  </div>
  <div class="csqRow">
    <div id="phHue" class="csqHue" role="presentation" onpointerdown={down('hue')} onpointermove={move} onpointerup={up} onpointercancel={up}>
      <span class="csqDot" style:left="{(h / 360) * 100}%" style:top="50%" style:background={hsvToHex(h, 1, 1)}></span>
    </div>
    <span id="phPatch" class="csqPatch" style:background={value}></span>
  </div>
</div>

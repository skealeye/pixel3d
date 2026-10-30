<script lang="ts">
  import { untrack } from 'svelte';
  import { hexToHsv, hsvToHex } from '../color';

  /**
   * A hue and saturation disc, a brightness slider and a hex box for one color. A change is a gesture: `onstart`, then
   * `oninput` for each step, then `onend` (the editor makes one undo step of it).
   */
  let { value, oninput, onstart, onend }: { value: string; oninput: (hex: string) => void; onstart: () => void; onend: () => void } = $props();

  const SIZE = 150;
  let canvas: HTMLCanvasElement;
  let h = $state(0), s = $state(0), v = $state(1);
  let drag = false, sliding = false;
  const valid = (x: string) => /^#[0-9a-f]{6}$/i.test(x);

  // follow the color from outside (a chip, Pick): keep the hue and saturation we hold while it is the same color
  $effect(() => {
    const x = value;
    if (valid(x) && x.toLowerCase() !== untrack(() => hsvToHex(h, s, v))) ({ h, s, v } = hexToHsv(x));
  });

  $effect(() => {
    const ctx = canvas.getContext('2d')!, img = ctx.createImageData(SIZE, SIZE), R = SIZE / 2;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - R, dy = y + 0.5 - R, r = Math.hypot(dx, dy);
      if (r > R) continue;
      const hex = hsvToHex((Math.atan2(dy, dx) * 180) / Math.PI, r / R, v), k = (y * SIZE + x) * 4;
      img.data.set([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255], k);
    }
    ctx.putImageData(img, 0, 0);
  });

  const emit = () => oninput(hsvToHex(h, s, v));

  function disc(e: PointerEvent) {
    const b = canvas.getBoundingClientRect(), R = b.width / 2;
    const dx = e.clientX - b.left - R, dy = e.clientY - b.top - R;
    h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    s = Math.min(1, Math.hypot(dx, dy) / R);
    emit();
  }

  function down(e: PointerEvent) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = true;
    onstart();
    disc(e);
  }
  function move(e: PointerEvent) { if (drag) disc(e); }
  function up() { if (drag) { drag = false; onend(); } }

  /** A brightness drag that ends where it began fires no `change`, so the gesture also ends on release. */
  function finish() {
    if (sliding) { sliding = false; onend(); }
  }

  function bright(e: Event & { currentTarget: HTMLInputElement }) {
    if (!sliding) { sliding = true; onstart(); }
    v = +e.currentTarget.value / 100;
    emit();
  }

  function typed(e: Event & { currentTarget: HTMLInputElement }) {
    const x = e.currentTarget.value.trim().toLowerCase();
    if (!valid(x)) { e.currentTarget.value = value; return; }
    ({ h, s, v } = hexToHsv(x));
    onstart();
    oninput(x);
    onend();
  }

  const marker = $derived({ x: SIZE / 2 + Math.cos((h * Math.PI) / 180) * s * (SIZE / 2), y: SIZE / 2 + Math.sin((h * Math.PI) / 180) * s * (SIZE / 2) });
</script>

<div class="wheel">
  <div class="wheelDisc">
    <canvas id="edWheel" bind:this={canvas} width={SIZE} height={SIZE} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></canvas>
    <span class="wheelDot" style:left="{marker.x}px" style:top="{marker.y}px" style:background={value}></span>
  </div>
  <input type="range" id="edBright" min="0" max="100" value={Math.round(v * 100)} aria-label="Brightness"
    style:background="linear-gradient(90deg, #000, {hsvToHex(h, s, 1)})"
    oninput={bright} onchange={finish} onpointerup={finish} onkeyup={finish} onblur={finish}>
  <div class="row">
    <span class="wheelSw" style:background={value}></span>
    <input type="text" id="edHex" value={value} spellcheck="false" aria-label="Color as #rrggbb" maxlength="7" onchange={typed}>
  </div>
</div>

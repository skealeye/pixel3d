<script lang="ts">
  import { untrack } from 'svelte';
  import { change, app, ui } from '../state.svelte';
  import { colorAt } from '../pipeline';
  import { cropTo, paintCells, pieceCount } from '../actions.svelte';
  import { footprint } from '../brush';

  /** `id` tells the viewer's canvas from the Pixel Editor's. */
  let { id = 'src' }: { id?: string } = $props();

  const MAX_ZOOM = 16;
  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  /** CSS size of the square canvas. */
  let size = $state(160);
  let pan = $state({ x: 0, y: 0 });
  /** A pan remembers where it started so a click (no movement) can pick a color; a paint stroke its last cell. */
  let drag:
    | { kind: 'pan'; x: number; y: number; at: { x: number; y: number } }
    | { kind: 'crop'; c0: number; r0: number }
    | { kind: 'paint'; i: number; j: number; pushed: boolean }
    | null = null;
  let sel = $state<{ c0: number; r0: number; c1: number; r1: number } | null>(null);
  /** The cell under the pointer, for the brush outline while Paint or Erase is on. */
  let hover = $state<{ i: number; j: number } | null>(null);
  const parts = $derived(app.parts);

  /** Layout of the grid on the canvas: cell size and top-left, CSS px. */
  function layout() {
    const g = app.grid;
    if (!g) return null;
    const c0 = size / Math.max(g.w, g.h);
    const cell = c0 * ui.zoom;
    const left = ((size - g.w * c0) / 2 - size / 2) * ui.zoom + size / 2 + pan.x;
    const top = ((size - g.h * c0) / 2 - size / 2) * ui.zoom + size / 2 + pan.y;
    return { g, cell, left, top };
  }

  function cellAt(e: PointerEvent | MouseEvent) {
    const l = layout();
    if (!l) return null;
    const r = canvas.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - l.left) / l.cell), j = Math.floor((e.clientY - r.top - l.top) / l.cell);
    return { i, j, inside: i >= 0 && j >= 0 && i < l.g.w && j < l.g.h, g: l.g };
  }

  function draw() {
    if (!canvas) return;
    const dpr = devicePixelRatio, W = Math.round(size * dpr);
    if (canvas.width !== W) { canvas.width = canvas.height = W; }
    canvas.style.width = canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    const l = layout();
    if (!l) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { g, cell, left, top } = l;
    const px = (v: number) => Math.round(v * dpr) / dpr;
    for (let k = 0; k < g.cells.length; k++) {
      const v = g.cells[k]!;
      if (v < 0) continue;
      const i = k % g.w, j = (k - i) / g.w;
      ctx.fillStyle = g.palette[v]!.hex;
      const x0 = px(left + i * cell), y0 = px(top + j * cell);
      ctx.fillRect(x0, y0, px(left + (i + 1) * cell) - x0, px(top + (j + 1) * cell) - y0);
    }
    // the pixel grid, once cells are big enough to see it
    if (cell >= 4) {
      ctx.strokeStyle = '#ffffff1a';
      ctx.lineWidth = 1 / dpr;
      ctx.beginPath();
      for (let i = 0; i <= g.w; i++) { const x = px(left + i * cell) + 0.5 / dpr; ctx.moveTo(x, top); ctx.lineTo(x, top + g.h * cell); }
      for (let j = 0; j <= g.h; j++) { const y = px(top + j * cell) + 0.5 / dpr; ctx.moveTo(left, y); ctx.lineTo(left + g.w * cell, y); }
      ctx.stroke();
    }
    // everything but the largest piece gets a red outline, while what is printed is in pieces (a clicker's backing,
    // an outline ring or a smoothed base can join them)
    if (parts.length > 1 && pieceCount() > 1) {
      ctx.strokeStyle = '#e0715c';
      ctx.lineWidth = 2;
      for (const piece of parts.slice(1)) for (const k of piece) {
        const i = k % g.w, j = (k - i) / g.w;
        ctx.strokeRect(left + i * cell + 1, top + j * cell + 1, cell - 2, cell - 2);
      }
    }
    if (hover && !ui.cropping && !ui.picking && ui.tool !== 'select') {
      ctx.strokeStyle = '#d9a441';
      ctx.lineWidth = 2;
      const o = ui.brush % 2 ? (ui.brush - 1) / 2 : 0;
      const i0 = Math.max(0, hover.i - o), j0 = Math.max(0, hover.j - o);
      const i1 = Math.min(g.w, hover.i - o + ui.brush), j1 = Math.min(g.h, hover.j - o + ui.brush);
      if (i1 > i0 && j1 > j0) ctx.strokeRect(left + i0 * cell, top + j0 * cell, (i1 - i0) * cell, (j1 - j0) * cell);
    }
    if (sel) {
      const x = left + Math.min(sel.c0, sel.c1) * cell, y = top + Math.min(sel.r0, sel.r1) * cell;
      const w = (Math.abs(sel.c1 - sel.c0) + 1) * cell, h = (Math.abs(sel.r1 - sel.r0) + 1) * cell;
      ctx.fillStyle = '#1b1e23aa';
      ctx.fillRect(0, 0, size, y); ctx.fillRect(0, y + h, size, size - y - h);
      ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, size - x - w, h);
      ctx.strokeStyle = '#d9a441';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
  }

  $effect(() => {
    // redraw when any of these change
    void [app.grid, ui.zoom, pan.x, pan.y, size, sel, pieceCount(), hover, ui.tool, ui.brush];
    draw();
  });

  $effect(() => {
    const ro = new ResizeObserver(() => { size = Math.max(160, box.clientWidth - 22); draw(); });
    ro.observe(box);
    return () => ro.disconnect();
  });

  // added by hand: the wheel must be able to preventDefault (not passive)
  $effect(() => {
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  });

  // a new image starts unzoomed
  let lastSource = app.source;
  $effect(() => {
    if (app.source !== lastSource) { lastSource = app.source; reset(); }
  });

  function reset() { ui.zoom = 1; pan = { x: 0, y: 0 }; }

  // the editor opening or closing resets the zoom (actions.svelte.ts): the pan goes with it, on both canvases
  $effect(() => {
    void ui.editor;
    untrack(reset);
  });

  const clampCell = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));

  function down(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    // a drag here pans or paints: no text selection, and no middle-button autoscroll of the side panel
    e.preventDefault();
    const at = cellAt(e);
    if (ui.picking && e.button === 0) {
      if (!at?.inside || !app.source || !app.meta) return;
      const src = app.source, hex = colorAt(src, app.meta, at.g.w, at.g.h, at.i, at.j);
      ui.picking = false;
      change(() => { app.source = { ...src, pick: hex }; app.settings.background.enabled = true; });
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    if (ui.cropping && e.button === 0 && at) {
      const c = clampCell(at.i, at.g.w), r = clampCell(at.j, at.g.h);
      drag = { kind: 'crop', c0: c, r0: r };
      sel = { c0: c, r0: r, c1: c, r1: r };
      return;
    }
    if (ui.tool !== 'select' && e.button === 0 && at) {
      drag = { kind: 'paint', i: at.i, j: at.j, pushed: false };
      stroke([{ x: at.i, y: at.j }]);
      return;
    }
    drag = { kind: 'pan', x: e.clientX - pan.x, y: e.clientY - pan.y, at: { x: e.clientX, y: e.clientY } };
  }

  /** Paint cells as part of the current stroke: the first cell that changes makes the stroke's one undo step. */
  function stroke(cells: { x: number; y: number }[]) {
    if (drag?.kind !== 'paint') return;
    const seen = new Set<number>(), all: { x: number; y: number }[] = [];
    for (const c of cells) for (const f of footprint(c.x, c.y, ui.brush)) {
      const k = f.y * 65536 + f.x;
      if (!seen.has(k)) { seen.add(k); all.push(f); }
    }
    if (paintCells(all, !drag.pushed)) drag.pushed = true;
  }

  /** Cells on the line from (i0, j0) to (i1, j1), excluding the first, so a fast drag leaves no gaps. */
  function line(i0: number, j0: number, i1: number, j1: number) {
    const out: { x: number; y: number }[] = [];
    const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
    for (let t = 1; t <= n; t++) out.push({ x: Math.round(i0 + ((i1 - i0) * t) / n), y: Math.round(j0 + ((j1 - j0) * t) / n) });
    return out;
  }

  function move(e: PointerEvent) {
    if (ui.tool !== 'select') {
      const h = cellAt(e);
      if (h?.i !== hover?.i || h?.j !== hover?.j) hover = h && { i: h.i, j: h.j };
    }
    if (!drag) return;
    if (drag.kind === 'pan') { pan = { x: e.clientX - drag.x, y: e.clientY - drag.y }; return; }
    const at = cellAt(e);
    if (!at) return;
    if (drag.kind === 'paint') {
      if (at.i === drag.i && at.j === drag.j) return;
      const cells = line(drag.i, drag.j, at.i, at.j);
      drag.i = at.i;
      drag.j = at.j;
      stroke(cells);
      return;
    }
    sel = { c0: drag.c0, r0: drag.r0, c1: clampCell(at.i, at.g.w), r1: clampCell(at.j, at.g.h) };
  }

  function up(e: PointerEvent) {
    const d = drag, s = sel;
    drag = null;
    sel = null;
    // Select: a click without a drag picks the color under the pointer
    if (d?.kind === 'pan' && ui.tool === 'select' && Math.hypot(e.clientX - d.at.x, e.clientY - d.at.y) < 4) {
      const at = cellAt(e), v = at?.inside ? at.g.cells[at.j * at.g.w + at.i]! : -1;
      if (at && v >= 0) { ui.sel = at.g.palette[v]!.hex; ui.newColor = false; }
      return;
    }
    if (d?.kind !== 'crop' || !s) return;
    cropTo(Math.min(s.c0, s.c1), Math.min(s.r0, s.r1), Math.max(s.c0, s.c1) + 1, Math.max(s.r0, s.r1) + 1);
    reset();
  }

  function wheel(e: WheelEvent) {
    if (!app.grid) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left - size / 2, my = e.clientY - r.top - size / 2;
    const z = Math.min(MAX_ZOOM, Math.max(1, ui.zoom * Math.exp(-e.deltaY * 0.002)));
    // keep the point under the cursor still
    const k = z / ui.zoom;
    pan = z === 1 ? { x: 0, y: 0 } : { x: mx - (mx - pan.x) * k, y: my - (my - pan.y) * k };
    ui.zoom = z;
  }
</script>

<div class="source" id="sourceBox" bind:this={box}>
  <canvas {id} bind:this={canvas} class:pan={!ui.picking && !ui.cropping && ui.tool === 'select'} class:crop={ui.cropping}
    class:draw={!ui.picking && !ui.cropping && ui.tool !== 'select'}
    title="Scroll to zoom, drag to pan, double-click to fit"
    onmousedown={(e) => e.preventDefault()} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={() => (hover = null)} ondblclick={reset}></canvas>
</div>

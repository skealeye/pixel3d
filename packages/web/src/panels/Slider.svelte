<script lang="ts">
  /** A slider plus a number box (the mockup's `.sl` row). `begin` runs once per drag or typed value, before the first `set`. */
  let { id, label, min, max, step = 1, value, unit = '', disabled = false, title, note, hold, format = String, begin, set }: {
    id: string; label: string; min: number; max: number; step?: number; value: number; unit?: string; disabled?: boolean;
    /** Tooltip on both inputs (e.g. why the control is disabled). */
    title?: string;
    /** A short note shown inside the row, under the slider. */
    note?: { id: string; text: string };
    /**
     * An element (CSS selector) whose height this slider changes, e.g. the palette list for a color count. While the
     * slider is dragged the element keeps at least its starting height, so the panel can't scroll and move the slider
     * out from under the pointer; it lets go on release.
     */
    hold?: string;
    /** How the number box shows the value. */
    format?: (v: number) => string;
    begin?: () => void; set: (v: number) => void;
  } = $props();

  let dragging = false;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  function holdLayout() {
    const el = hold ? document.querySelector<HTMLElement>(hold) : null;
    if (!el) return;
    el.style.minHeight = `${el.offsetHeight}px`;
    const release = () => { el.style.minHeight = ''; removeEventListener('pointerup', release); removeEventListener('pointercancel', release); };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  }
</script>

<div class="sl">
  <label for={id + 'R'}>{label}</label>
  <input type="range" id={id + 'R'} {min} {max} {step} {value} {disabled} {title} onpointerdown={holdLayout}
    oninput={(e) => { if (!dragging) { dragging = true; begin?.(); } set(+e.currentTarget.value); }}
    onchange={() => (dragging = false)}>
  <input class="num" id={id} value={format(value)} {disabled} {title} aria-label={label}
    onchange={(e) => { const v = +e.currentTarget.value; if (Number.isNaN(v)) { e.currentTarget.value = format(value); return; } begin?.(); set(clamp(v)); }}>
  <span class="unit">{unit}</span>
  {#if note}<span class="slnote" id={note.id}>{note.text}</span>{/if}
</div>

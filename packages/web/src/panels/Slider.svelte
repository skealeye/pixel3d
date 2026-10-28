<script lang="ts">
  /** A slider plus a number box (the mockup's `.sl` row). `begin` runs once per drag or typed value, before the first `set`. */
  let { id, label, min, max, step = 1, value, unit = '', disabled = false, format = String, begin, set }: {
    id: string; label: string; min: number; max: number; step?: number; value: number; unit?: string; disabled?: boolean;
    /** How the number box shows the value. */
    format?: (v: number) => string;
    begin?: () => void; set: (v: number) => void;
  } = $props();

  let dragging = false;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
</script>

<div class="sl">
  <label for={id + 'R'}>{label}</label>
  <input type="range" id={id + 'R'} {min} {max} {step} {value} {disabled}
    oninput={(e) => { if (!dragging) { dragging = true; begin?.(); } set(+e.currentTarget.value); }}
    onchange={() => (dragging = false)}>
  <input class="num" id={id} value={format(value)} {disabled} aria-label={label}
    onchange={(e) => { const v = +e.currentTarget.value; if (Number.isNaN(v)) { e.currentTarget.value = format(value); return; } begin?.(); set(clamp(v)); }}>
  <span class="unit">{unit}</span>
</div>

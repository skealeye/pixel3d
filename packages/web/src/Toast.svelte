<script lang="ts">
  import { ui } from './state.svelte';

  let show = $state(false);
  $effect(() => {
    if (!ui.toast.n) return;
    show = true;
    const t = setTimeout(() => (show = false), 2400);
    return () => clearTimeout(t);
  });
</script>

<div class="toast" class:show role="status" aria-live="polite">{ui.toast.text}</div>

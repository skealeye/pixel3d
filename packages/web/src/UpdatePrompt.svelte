<script lang="ts">
  import { registerSW } from 'virtual:pwa-register';
  import { register } from './hook';

  /**
   * A new deploy waits until it is asked for (`registerType: 'prompt'`): a lasting toast offers Reload, which tells
   * the waiting service worker to take over and reloads. Not in the mockup.
   */
  let show = $state(false);
  let update: ((reload?: boolean) => Promise<void>) | null = null;

  $effect(() => {
    update = registerSW({ onNeedRefresh: () => (show = true) });
    // the dev server has no service worker: the e2e test raises the prompt itself
    return register({ needRefresh: () => (show = true) });
  });
</script>

{#if show}
  <div class="toast show update" id="updateToast" role="status">
    A new version is ready.
    <button class="btn small" id="updateReload" onclick={() => void update?.(true)}>Reload</button>
  </div>
{/if}

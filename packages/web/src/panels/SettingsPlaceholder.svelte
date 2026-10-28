<script lang="ts">
  /** The right-hand settings column. Its controls arrive in Task 14 (model settings) and Task 17 (clicker). */
  const sections = ['Make', 'Size', 'Base', 'Inside', 'Sides', 'Keychain', 'Magnets', 'Orientation'];
</script>

<aside class="right">
  {#each sections as title (title)}
    <section><h2>{title}</h2></section>
  {/each}
</aside>

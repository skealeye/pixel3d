<script lang="ts" module>
  /** Favorite colors: a list of twelve shared by every row (a panel shows the first few), kept in the browser between visits (spec §4.5). */
  const KEY = 'px3d.favs';
  const MAX = 12;
  const DEFAULT = ['#2a2d33', '#f2efe6', '#111111', '#d9a441', '#3d6fb6'];

  function load(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (Array.isArray(v) && v.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return v.slice(0, MAX);
    } catch { /* a damaged entry falls back to the defaults */ }
    return [...DEFAULT];
  }

  const favs = $state({ list: load() });

  function save(list: string[]) {
    favs.list = list;
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked: kept for this visit */ }
  }
</script>

<script lang="ts">
  import { toast } from '../state.svelte';

  /** `value` is the color this row edits; `pick` uses a favorite; `slots` is how many boxes show. */
  let { id, value, pick, slots = 5 }: { id: string; value: string; pick: (hex: string) => void; slots?: number } = $props();
</script>

<div class="favs" {id}>
  <span class="lbl">Favorites</span>
  {#each { length: slots } as _, i (i)}
    {@const c = favs.list[i]}
    {#if c}
      <button class="fav" class:cur={c === value} style:background={c} data-c={c} title="Use {c}. Right-click to remove." aria-label="Use {c}"
        onclick={() => pick(c)}
        oncontextmenu={(e) => { e.preventDefault(); save(favs.list.filter((x) => x !== c)); }}></button>
    {:else}
      <span class="fav empty" title="Empty slot"></span>
    {/if}
  {/each}
  <button class="star" title="Save the current color as a favorite"
    onclick={() => { save([value, ...favs.list.filter((x) => x !== value)].slice(0, MAX)); toast('Saved to favorites.'); }}>☆ Save</button>
</div>

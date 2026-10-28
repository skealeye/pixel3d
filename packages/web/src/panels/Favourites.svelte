<script lang="ts" module>
  /** Favourite colours: five slots shared by every row, kept in the browser between visits (spec §4.5). */
  const KEY = 'px3d.favs';
  const DEFAULT = ['#2a2d33', '#f2efe6', '#111111', '#d9a441', '#3d6fb6'];

  function load(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (Array.isArray(v) && v.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return v.slice(0, 5);
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

  /** `value` is the colour this row edits; `pick` uses a favourite. */
  let { id, value, pick }: { id: string; value: string; pick: (hex: string) => void } = $props();
</script>

<div class="favs" {id}>
  <span class="lbl">Favourites</span>
  {#each { length: 5 } as _, i (i)}
    {@const c = favs.list[i]}
    {#if c}
      <button class="fav" class:cur={c === value} style:background={c} data-c={c} title="Use {c}. Right-click to remove." aria-label="Use {c}"
        onclick={() => pick(c)}
        oncontextmenu={(e) => { e.preventDefault(); save(favs.list.filter((x) => x !== c)); }}></button>
    {:else}
      <span class="fav empty" title="Empty slot"></span>
    {/if}
  {/each}
  <button class="star" title="Save the current colour as a favourite"
    onclick={() => { save([value, ...favs.list.filter((x) => x !== value)].slice(0, 5)); toast('Saved to favourites.'); }}>☆ Save</button>
</div>

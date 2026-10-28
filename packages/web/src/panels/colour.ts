import { setting } from '../state.svelte';

/**
 * A color picker bound to one setting: the first input of a picking session is one undo step, the rest of the
 * session (the picker sends input events while it is dragged) updates it in place. A model color never changes
 * the grid, so the in-place updates need no pipeline run.
 */
export function colourInput(put: (hex: string) => void) {
  let open = false;
  return {
    oninput: (e: Event & { currentTarget: HTMLInputElement }) => {
      const hex = e.currentTarget.value.toLowerCase();
      if (open) put(hex);
      else { open = true; setting(() => put(hex)); }
    },
    onchange: () => { open = false; },
  };
}

import type { Grid } from './grid';
import type { Settings } from './settings';

/**
 * Filament slots for parts in print order: one slot per distinct color (lowercase #rrggbb), first use first. A base
 * or loop the same color as an art color shares its slot (R25). The 3MF writer assigns slots with this, and
 * `filamentColors` predicts the same list from the grid and settings.
 */
export function filamentSlots(hexes: readonly string[]): string[] {
  return [...new Set(hexes.map((h) => h.toLowerCase()))];
}

/**
 * The filament colors a model of `g` prints with, in 3MF slot order (the parts' order). A flat model: the base, the
 * palette colors that have pixels (a color with none, e.g. just added, makes no part), the outline ring, then a keychain
 * loop that has no base to join. A clicker: the cap (its base-color backing unless the backing takes the art's colors,
 * the art colors, the outline ring), then the body, which always prints in the base color. One color is one filament.
 */
export function filamentColors(g: Grid, s: Settings): string[] {
  if (s.export.mono) return [s.export.monoColor.toLowerCase()];
  const used = new Set<number>();
  for (const v of g.cells) if (v >= 0) used.add(v);
  const art = g.palette.filter((_, i) => used.has(i)).map((p) => p.hex);
  const ring = s.outline.on && used.size ? [s.outline.color] : [];
  if (s.make === 'clicker') return filamentSlots([...(s.clicker.backing === 'base' ? [s.base.color] : []), ...art, ...ring, s.base.color]);
  const loop = !s.base.enabled && s.keychain.type === 'loop' && s.keychain.loop.outer > s.keychain.loop.inner;
  return filamentSlots([...(s.base.enabled ? [s.base.color] : []), ...art, ...ring, ...(loop ? [s.keychain.loop.color] : [])]);
}

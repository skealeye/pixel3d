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
 * The filament colors a model of `g` prints with, in 3MF slot order: the base (a clicker's cap backing and body
 * always have one), the palette colors that have pixels (a color with none, e.g. just added, makes no part), then a
 * keychain loop that has no base to join. One color is one filament.
 */
export function filamentColors(g: Grid, s: Settings): string[] {
  if (s.export.mono) return [s.export.monoColor.toLowerCase()];
  const clicker = s.make === 'clicker';
  const used = new Set<number>();
  for (const v of g.cells) if (v >= 0) used.add(v);
  const parts: string[] = [];
  if (clicker || s.base.enabled) parts.push(s.base.color);
  g.palette.forEach((p, i) => { if (used.has(i)) parts.push(p.hex); });
  const loop = !clicker && !s.base.enabled && s.keychain.type === 'loop' && s.keychain.loop.outer > s.keychain.loop.inner;
  if (loop) parts.push(s.keychain.loop.color);
  return filamentSlots(parts);
}

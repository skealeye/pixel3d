import type { Settings } from './settings';

/**
 * The distinct filament colors a model prints with, lowercase #rrggbb, in 3MF slot order: the base (a clicker's
 * cap backing and body always have one), the palette, then a keychain loop that has no base to join. A base or loop
 * the same color as an art color shares its filament slot (R25); One color is one filament.
 */
export function filamentColors(palette: readonly { hex: string }[], s: Settings): string[] {
  if (s.export.mono) return [s.export.monoColour.toLowerCase()];
  const clicker = s.make === 'clicker';
  const list: string[] = [];
  if (clicker || s.base.enabled) list.push(s.base.colour);
  list.push(...palette.map((p) => p.hex));
  const loop = !clicker && !s.base.enabled && s.keychain.type === 'loop' && s.keychain.loop.outer > s.keychain.loop.inner;
  if (loop) list.push(s.keychain.loop.colour);
  return [...new Set(list.map((h) => h.toLowerCase()))];
}

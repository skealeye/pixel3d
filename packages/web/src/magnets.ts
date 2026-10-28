import { magnetSize, type Settings } from '@pixel3d/core';

const r1 = (n: number) => (Math.round(Math.max(0, n) * 10) / 10).toFixed(1);

/**
 * The pocket as core cuts it (features.ts magnetCutters), for the panel: whether it is sealed, the material below it
 * (null when it opens onto the bed or the glue face) and above it up to the lowest color's top, and the
 * thin-base check (the mockup's: base only, or half the base plus the lowest color for halves).
 */
export function magnetPocket(s: Settings, lowest: number) {
  const { d, h } = magnetSize(s);
  const bt = s.base.enabled ? s.base.height : 0;
  const mode = s.sides.mode;
  const sealed = mode === 'solid' || (mode === 'single' && s.magnets.position === 'centre');
  const under = s.sides.heightsOn === 'both' ? lowest : s.heights.h;
  let below: number | null = null, above: number;
  if (mode === 'solid') {
    const z0 = (bt - h) / 2;
    below = z0 + under;
    above = bt - (z0 + h) + lowest;
  } else if (mode === 'halves') {
    above = bt / 2 + lowest - h;
  } else if (sealed) {
    // a base thinner than the magnet puts the pocket on the bed, open, as core cuts it
    const z0 = Math.max(0, (bt - h) / 2);
    below = z0 > 0 ? z0 : null;
    above = bt + lowest - (z0 + h);
  } else {
    above = bt + lowest - h;
  }
  const need = h + (sealed ? 1.2 : 0.6), have = mode === 'halves' ? bt / 2 + lowest : bt;
  const readout = `Material left: ${below === null ? 'none below (the pocket is open)' : `${r1(below)} mm below the pocket`}, ${r1(above)} mm above it.`;
  return { d, h, sealed, thin: have < need - 1e-9, need: (Math.round(need * 10) / 10).toFixed(1), readout };
}

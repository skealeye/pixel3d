import type { Grid } from './grid';

/** 4-connected groups of opaque cells (as cell indices), largest first. */
export function pieces(g: Grid): number[][] {
  const { w, h, cells } = g;
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  for (let k = 0; k < w * h; k++) {
    if (cells[k]! < 0 || seen[k]) continue;
    const group = [k];
    seen[k] = 1;
    for (let i = 0; i < group.length; i++) {
      const c = group[i]!, x = c % w;
      for (const n of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w]) {
        if (n >= 0 && n < w * h && !seen[n] && cells[n]! >= 0) { seen[n] = 1; group.push(n); }
      }
    }
    out.push(group);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Count 2x2 blocks whose only opaque cells are diagonal (pieces that touch just at a corner). */
export function cornerTouches(g: Grid): number {
  const on = (x: number, y: number) => g.cells[y * g.w + x]! >= 0;
  let n = 0;
  for (let y = 0; y < g.h - 1; y++) {
    for (let x = 0; x < g.w - 1; x++) {
      const a = on(x, y), b = on(x + 1, y), c = on(x, y + 1), d = on(x + 1, y + 1);
      if ((a && d && !b && !c) || (b && c && !a && !d)) n++;
    }
  }
  return n;
}

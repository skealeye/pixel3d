/** A closed loop of grid-corner points `[x, y]`, y up. */
export type Loop = [number, number][];

/**
 * Outline of the cells where `on[row * w + x]` is set (row 0 = top), as closed loops of grid
 * corners in a y-up frame: cell (x, row) spans [x, x+1] x [yUp, yUp+1] with yUp = h-1-row.
 * Outer loops run anticlockwise and holes clockwise (the region is always on the left);
 * points along straight runs are dropped. Where two cells meet only at a corner the walk
 * turns left, so the loops touch at that point but never cross.
 */
export function traceLoops(on: Uint8Array, w: number, h: number): Loop[] {
  const W = w + 1, V = W * (h + 1);
  // up to two outgoing edges per corner (two at a corner-only contact); -1 = none
  const out = new Int32Array(V * 2).fill(-1);
  const add = (a: number, b: number) => { out[out[a * 2]! < 0 ? a * 2 : a * 2 + 1] = b; };
  const has = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h && on[(h - 1 - y) * w + x] !== 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!has(x, y)) continue;
      const v = y * W + x; // corner (x, y)
      if (!has(x, y - 1)) add(v, v + 1);
      if (!has(x + 1, y)) add(v + 1, v + 1 + W);
      if (!has(x, y + 1)) add(v + 1 + W, v + W);
      if (!has(x - 1, y)) add(v + W, v);
    }
  }
  const loops: Loop[] = [];
  const take = (v: number, prev: number): number => {
    const a = out[v * 2]!, b = out[v * 2 + 1]!;
    let pick = 0;
    if (b >= 0) {
      if (a < 0) pick = 1;
      else {
        // two ways on: turn left of the incoming direction (dx, dy) -> (-dy, dx)
        const dx = v % W - prev % W, dy = Math.floor(v / W) - Math.floor(prev / W);
        const ax = a % W - v % W, ay = Math.floor(a / W) - Math.floor(v / W);
        pick = ax === -dy && ay === dx ? 0 : 1;
      }
    }
    const n = out[v * 2 + pick]!;
    out[v * 2 + pick] = -1;
    return n;
  };
  for (let s = 0; s < V; s++) {
    while (out[s * 2]! >= 0 || out[s * 2 + 1]! >= 0) {
      const pts: number[] = [s];
      let prev = s, v = take(s, s);
      while (v !== s) { pts.push(v); const n = take(v, prev); prev = v; v = n; }
      loops.push(simplify(pts, W));
    }
  }
  return loops;
}

/** Drop corners that sit on a straight run (all loop edges are axis-aligned). */
function simplify(pts: number[], W: number): Loop {
  const n = pts.length, loop: Loop = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n]!, c = pts[i]!, q = pts[(i + 1) % n]!;
    const px = p % W, cx = c % W, qx = q % W, py = (p - px) / W, cy = (c - cx) / W, qy = (q - qx) / W;
    if ((px === cx && cx === qx) || (py === cy && cy === qy)) continue;
    loop.push([cx, cy]);
  }
  return loop;
}

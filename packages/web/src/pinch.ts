export type Pt = { x: number; y: number };
/** Where a two-finger pinch started: both fingers and the view then. Points are relative to the canvas centre. */
export interface PinchStart { a: Pt; b: Pt; zoom: number; pan: Pt }

/** The view for fingers now at `a` and `b`: zoom follows the distance between them (1 to `max`), and the content
 * that was under their starting midpoint stays under their midpoint, as the wheel keeps the point under the cursor. */
export function pinchView(s: PinchStart, a: Pt, b: Pt, max: number): { zoom: number; pan: Pt } {
  const d0 = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), d = Math.hypot(b.x - a.x, b.y - a.y);
  const zoom = Math.min(max, Math.max(1, d0 > 0 ? (s.zoom * d) / d0 : s.zoom));
  if (zoom === 1) return { zoom, pan: { x: 0, y: 0 } };
  const k = zoom / s.zoom;
  const m0 = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { zoom, pan: { x: m.x - (m0.x - s.pan.x) * k, y: m.y - (m0.y - s.pan.y) * k } };
}

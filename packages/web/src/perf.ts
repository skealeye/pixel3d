/**
 * Input-to-preview latency: a height change must reach the viewport within 50 ms. An input marks the start; the next
 * preview handed to the viewport ends the measure. The e2e tests read the durations through the hook.
 */
const START = 'pixel3d:input';
let pending = false;
export const latencies: number[] = [];

export function inputStarted() {
  performance.mark(START);
  pending = true;
}

export function previewShown() {
  if (!pending) return;
  pending = false;
  latencies.push(performance.measure('pixel3d:input-to-preview', START).duration);
  if (latencies.length > 100) latencies.shift();
}

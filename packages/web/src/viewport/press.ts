import { MX } from '@pixel3d/core';

/** Where a real MX switch actuates, mm down: the click sounds here on the way down, and a little higher on the way up. */
const ACTUATE = 2, RESET = 1.6;

/**
 * The press preview (ported from the mockup): the cap and the switch stem travel the full 4 mm down while Press or
 * Space is held, and spring back on release. A quick tap still goes all the way down before it springs back.
 * One shared instance: the Clicker panel drives it, the viewport reads `at` every frame.
 */
class Press {
  /** How far down the cap is, mm (0 at rest, `MX.travel` fully pressed). */
  at = 0;
  private down = false;
  private release = false;

  start() { this.down = true; this.release = false; }
  stop() { if (this.down) this.release = true; }
  reset() { this.at = 0; this.down = this.release = false; }
  /** Still moving or held. */
  get busy() { return this.down || this.at > 1e-3; }

  /** Advance by `dt` seconds. Returns true when `at` changed. */
  step(dt: number): boolean {
    const bottom = this.at >= MX.travel * 0.97;
    if (this.release && bottom) this.down = this.release = false;
    const goal = this.down ? MX.travel : 0;
    const before = this.at;
    this.at += (goal - this.at) * Math.min(1, dt * (goal ? 28 : 16));
    if (Math.abs(goal - this.at) < 1e-3) this.at = goal;
    if (before < ACTUATE && this.at >= ACTUATE) clickSound();
    if (before > RESET && this.at <= RESET) clickSound();
    return this.at !== before;
  }
}

export const press = new Press();

let audio: AudioContext | null = null;

/** A short filtered noise burst: the switch's click. */
function clickSound() {
  try {
    audio ??= new AudioContext();
    const n = audio.createBuffer(1, Math.round(audio.sampleRate * 0.03), audio.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audio.sampleRate * 0.003));
    const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    f.type = 'highpass';
    f.frequency.value = 1800;
    g.gain.value = 0.5;
    src.buffer = n;
    src.connect(f).connect(g).connect(audio.destination);
    src.start();
  } catch {
    // no audio (blocked or unsupported): the preview still moves
  }
}

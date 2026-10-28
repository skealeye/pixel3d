import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULTS, PresetError, applyEdits, decodeImage, detectScale, downsampleNearest, parsePreset,
  placeRelative, presetFromState, resolvePreset, toGrid,
} from '../src/index';
import type { Edit, Grid, Preset, Settings } from '../src/index';

const potion = async (): Promise<Grid> => {
  const img = await decodeImage(new Uint8Array(readFileSync(new URL('./fixtures/potion.png', import.meta.url))));
  return toGrid(downsampleNearest(img, detectScale(img)), 16);
};
const empty: Preset = { version: 1, settings: {}, colourRules: [] };
const errOf = (f: () => unknown): PresetError => {
  try { f(); } catch (e) { return e as PresetError; }
  throw new Error('did not throw');
};

describe('DEFAULTS', () => {
  it('match the mockup', () => {
    expect(DEFAULTS.size).toMatchObject({ width: 40, height: 40, keepAspect: true, unit: 'mm' });
    expect(DEFAULTS.base).toEqual({ enabled: true, height: 2, colour: '#2a2d33' });
    expect(DEFAULTS.inside).toEqual({ mode: 'solid', wall: 1.2 });
    expect(DEFAULTS.keychain.hole).toMatchObject({ style: 'round', size: 4 });
    expect(DEFAULTS.keychain.loop).toMatchObject({ inner: 4, outer: 8, angle: 0 });
    expect(DEFAULTS.magnets).toMatchObject({ size: '8x3', position: 'bottom', at: [] });
    expect(DEFAULTS.make).toBe('model');
    expect(DEFAULTS.pixelMm).toBeUndefined();
  });
});

describe('parsePreset', () => {
  it('round-trips presetFromState through JSON', async () => {
    const g = await potion();
    const s: Settings = {
      ...DEFAULTS,
      base: { ...DEFAULTS.base, height: 3 },
      sides: { mode: 'halves', heightsOn: 'top' },
      magnets: { size: { d: 5, h: 2 }, position: 'centre', at: ['top-left', { fx: 0.25, fy: 0.75 }] },
      rotation: [1, 0, 3],
      pixelMm: { x: 1, y: 1 },
    };
    const p = parsePreset(JSON.parse(JSON.stringify(presetFromState(s, g, []))));
    const { pixelMm: _omit, ...expected } = s;
    expect(resolvePreset(p, g).settings).toEqual(expected);
  });

  it('rejects a version other than 1', () => {
    const e = errOf(() => parsePreset({ version: 2, settings: {}, colourRules: [] }));
    expect(e).toBeInstanceOf(PresetError);
    expect(e.path).toBe('version');
    expect(e.message).toMatch(/version/);
  });

  it('reports the dotted path of a bad value', () => {
    const e = errOf(() => parsePreset({ version: 1, settings: { base: { height: 'x' } }, colourRules: [] }));
    expect(e.path).toBe('settings.base.height');
  });

  it('rejects out-of-range values and unknown fields', () => {
    expect(errOf(() => parsePreset({ version: 1, settings: { base: { height: 99 } }, colourRules: [] })).path).toBe('settings.base.height');
    expect(errOf(() => parsePreset({ version: 1, settings: { base: { colour: 'red' } }, colourRules: [] })).path).toBe('settings.base.colour');
    expect(errOf(() => parsePreset({ version: 1, settings: { bogus: 1 }, colourRules: [] })).path).toBe('settings');
    expect(errOf(() => parsePreset({ version: 1, settings: {}, colourRules: [{ match: '#000000', tolPct: 0, nope: 1 }] })).path).toBe('colourRules.0');
    expect(errOf(() => parsePreset('nope')).path).toBe('');
  });

  it('accepts partial settings and fills the rest from DEFAULTS', async () => {
    const p = parsePreset({ version: 1, settings: { base: { height: 3 } }, colourRules: [] });
    const { settings } = resolvePreset(p, await potion());
    expect(settings.base).toEqual({ ...DEFAULTS.base, height: 3 });
    expect(settings.size).toEqual(DEFAULTS.size);
  });
});

describe('resolvePreset colour rules', () => {
  it('sets a matched colour height and lists it as applied', async () => {
    const g = await potion();
    expect(g.palette.some((c) => c.hex === '#2b2135')).toBe(true);
    const p = parsePreset({ version: 1, settings: {}, colourRules: [{ match: '#2b2135', tolPct: 0, height: 5 }] });
    const r = resolvePreset(p, g);
    expect(r.applied).toEqual(['#2b2135 → height 5']);
    expect(r.edits).toEqual([{ kind: 'height', hex: '#2b2135', h: 5 }]);
    const out = applyEdits(g, r.edits).grid;
    expect(out.palette.find((c) => c.hex === '#2b2135')!.height).toBe(5);
  });

  it('applies nothing and does not error when no colour matches', async () => {
    const p = parsePreset({ version: 1, settings: {}, colourRules: [{ match: '#00ff00', tolPct: 1, height: 5, delete: true }] });
    const r = resolvePreset(p, await potion());
    expect(r.edits).toEqual([]);
    expect(r.applied).toEqual([]);
  });

  it('matches within the tolerance and emits recolour and delete edits', async () => {
    const g = await potion();
    const near = '#2b2136';
    const p = parsePreset({ version: 1, settings: {}, colourRules: [
      { match: near, tolPct: 2, recolour: '#FF0000' },
      { match: '#9c6b3e', tolPct: 0, delete: true },
    ] });
    const r = resolvePreset(p, g);
    expect(r.edits).toEqual([
      { kind: 'recolour', from: '#2b2135', to: '#ff0000' },
      { kind: 'delete', hex: '#9c6b3e' },
    ]);
    expect(r.applied).toEqual(['#2b2135 → recolour #ff0000', '#9c6b3e → delete']);
  });
});

describe('presetFromState', () => {
  it('turns height, recolour and delete edits into rules and drops paint', async () => {
    const g = await potion();
    const edits: Edit[] = [
      { kind: 'height', hex: '#2b2135', h: 4 },
      { kind: 'paint', x: 0, y: 0, hex: '#123456' },
      { kind: 'recolour', from: '#7a4fd6', to: '#00ff00' },
      { kind: 'height', hex: '#00ff00', h: 3 },
      { kind: 'delete', hex: '#9c6b3e' },
    ];
    const p = presetFromState(DEFAULTS, g, edits);
    expect(p.colourRules).toEqual([
      { match: '#2b2135', tolPct: 0, height: 4 },
      { match: '#7a4fd6', tolPct: 0, recolour: '#00ff00', height: 3 },
      { match: '#9c6b3e', tolPct: 0, delete: true },
    ]);
    expect(() => parsePreset(JSON.parse(JSON.stringify(p)))).not.toThrow();
  });
});

describe('placeRelative', () => {
  it('top-center lands on an opaque cell in the top row of the bounding box', async () => {
    const g = await potion();
    const { u, v } = placeRelative('top-center', g);
    let top = -1;
    for (let y = 0; y < g.h && top < 0; y++) for (let x = 0; x < g.w; x++) if (g.cells[y * g.w + x]! >= 0) { top = y; break; }
    const cx = Math.floor(u), cy = g.h - 1 - Math.floor(v);
    expect(g.cells[cy * g.w + cx]).toBeGreaterThanOrEqual(0);
    expect(cy).toBe(top);
    expect(v).toBeCloseTo(g.h - top - 0.5);
  });

  it('measures v up from the bottom and snaps to an opaque cell centre', () => {
    const cells = new Int16Array(16).fill(-1);
    cells[0 * 4 + 1] = 0; // x=1, top row
    cells[3 * 4 + 2] = 0; // x=2, bottom row
    const g: Grid = { w: 4, h: 4, cells, palette: [{ hex: '#ffffff', height: 1 }] };
    expect(placeRelative('top-left', g)).toEqual({ u: 1.5, v: 3.5 });
    expect(placeRelative({ fx: 1, fy: 1 }, g)).toEqual({ u: 2.5, v: 0.5 });
  });
});

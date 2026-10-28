import { colorRuleEdits, parsePreset, presetFromState, presetSettings, type Edit, type Grid, type Preset, type Settings } from '@pixel3d/core';
import { computeGrid } from './pipeline';
import { app, change, setting, toast } from './state.svelte';

const NO_COLORS: Grid = { w: 0, h: 0, cells: new Int16Array(0), palette: [] };

/** The file name the image's exports and presets are named after: its name without the extension. */
export function baseName(): string {
  const n = app.source?.name ?? 'model';
  return n.replace(/\.[^.]*$/, '') || 'model';
}

/**
 * The current settings as a preset (core `presetFromState`, the format `px3d convert --preset` reads): the image's
 * height, recolor and delete edits become color rules on the colors before edits.
 */
export function currentPreset(): Preset {
  return presetFromState($state.snapshot(app.settings) as Settings, app.meta?.base ?? NO_COLORS, app.edits);
}

export const presetText = (p: Preset = currentPreset()) => JSON.stringify(p, null, 2);

/** Paint and add edits belong to the image, not the preset: they are kept when a preset loads. */
const imageEdit = (e: Edit) => e.kind === 'paint' || e.kind === 'add';

/**
 * Apply a preset file: its settings over the defaults, its color rules as edits on this image's colors (as `convert`
 * applies them), in one undo step. Returns false with a toast giving the reason when the file is not a valid preset.
 */
export function applyPresetText(text: string, fileName: string): boolean {
  let preset: Preset;
  try {
    preset = parsePreset(JSON.parse(text));
  } catch (e) {
    const why = e instanceof SyntaxError ? 'it is not valid JSON.' : e instanceof Error ? e.message : String(e);
    toast(`Couldn't load ${fileName}: ${why}`);
    return false;
  }
  const settings = presetSettings(preset);
  const ok = (app.source ? change : setting)(() => {
    app.settings = structuredClone(settings);
    if (!app.source) return;
    const r = computeGrid(app.source, settings, []);
    const rules = 'error' in r ? [] : colorRuleEdits(preset.colorRules, r.meta.base).edits;
    app.edits = [...rules, ...app.edits.filter(imageEdit)];
  });
  if (ok) toast(`Loaded ${fileName}`);
  return ok;
}

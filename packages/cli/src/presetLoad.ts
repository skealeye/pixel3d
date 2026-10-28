/** Preset JSON handling shared by `px3d convert` and `px3d serve`. */

/** The preset text is not JSON. `message` reads "is not valid JSON: ..." so callers can prefix a label. */
export class PresetJsonError extends Error {}

/** The preset used when none is given. */
export const emptyPresetDoc = (): Record<string, unknown> => ({ version: 1, settings: {}, colorRules: [] });

/** JSON.parse that throws `PresetJsonError`. */
export function parsePresetJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new PresetJsonError(`is not valid JSON: ${(e as Error).message}`);
  }
}

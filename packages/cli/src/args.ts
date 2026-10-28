/** `px3d convert` options (node:util parseArgs). `-o` is short for `--out`. */
export const CONVERT_OPTIONS = {
  preset: { type: 'string' },
  out: { type: 'string', short: 'o' },
  format: { type: 'string' },
  set: { type: 'string', multiple: true },
} as const;

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Parse a `--set` value: JSON when it is JSON (numbers, booleans, arrays...), otherwise the raw string. */
export function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Apply `key.path=value` to a plain object, creating (or replacing non-object) intermediate levels. Throws on a malformed pair. */
export function setPath(target: Record<string, unknown>, pair: string): void {
  const eq = pair.indexOf('=');
  if (eq < 1) throw new Error(`--set expects key=value, got "${pair}".`);
  const keys = pair.slice(0, eq).split('.');
  if (keys.some((k) => !k || FORBIDDEN.has(k))) throw new Error(`--set has an invalid key: "${pair.slice(0, eq)}".`);
  let obj = target;
  for (const k of keys.slice(0, -1)) {
    const next = obj[k];
    obj = obj[k] = next && typeof next === 'object' && !Array.isArray(next) ? (next as Record<string, unknown>) : {};
  }
  obj[keys[keys.length - 1]!] = parseValue(pair.slice(eq + 1));
}

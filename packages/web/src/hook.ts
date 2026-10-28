/**
 * `window.__pixel3d`: read-only state for the e2e tests. Only installed in dev builds or with `?test` in the URL.
 */
type Part = Record<string, () => unknown>;

export const hookEnabled = import.meta.env.DEV || new URLSearchParams(location.search).has('test');

export function register(p: Part): () => void {
  if (!hookEnabled) return () => {};
  const w = window as unknown as { __pixel3d?: Part };
  w.__pixel3d = Object.assign(w.__pixel3d ?? {}, p);
  return () => { for (const k of Object.keys(p)) delete w.__pixel3d?.[k]; };
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { noticesText, packagesIn, ROOT_FILE, rootLists } from '../../../scripts/third-party-licenses';

describe('third-party notices', () => {
  it('packagesIn names the npm packages of bundled module paths, scoped ones included', () => {
    expect(packagesIn([
      String.raw`Z:\Git\pixel3d\node_modules\three\build\three.module.js`,
      '/repo/node_modules/@jsquash/webp/decode.js',
      '\0virtual:/repo/node_modules/workbox-window/build/workbox-window.prod.es5.mjs',
      '/repo/node_modules/a/node_modules/b/index.js',
      '/repo/packages/core/src/index.ts',
    ])).toEqual(['@jsquash/webp', 'b', 'three', 'workbox-window']);
  });

  it('the repo-root THIRD_PARTY_LICENSES.txt lists both bundles, holds manifold-3d under Apache-2.0, and is in sync', () => {
    const text = readFileSync(ROOT_FILE, 'utf8');
    const lists = rootLists();
    expect(lists.web).toEqual(expect.arrayContaining(['manifold-3d', 'three', 'svelte', 'zod', 'fflate', 'workbox-precaching']));
    expect(lists.cli).toEqual(expect.arrayContaining(['hono', 'zod', 'fflate']));
    expect(text).toMatch(/^manifold-3d \S+\nLicense: Apache-2\.0$/m);
    expect(text).toContain('Apache License');
    // node_modules changed since the last build: run npm run build:web and npm run build:cli
    expect(noticesText(lists)).toBe(text);
  });
});

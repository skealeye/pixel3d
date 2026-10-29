import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { packagesIn, ROOT_FILE, writeNotices } from '../../scripts/third-party-licenses';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const NOTICES = 'THIRD_PARTY_LICENSES.txt';
/** Every module the build bundles, the export worker's included (its build runs inside the main one). */
const bundled = new Set<string>();
const collect = (): Plugin => ({
  name: 'pixel3d:collect-modules',
  generateBundle(_, bundle) {
    for (const c of Object.values(bundle)) if (c.type === 'chunk') for (const id of c.moduleIds) bundled.add(id);
  },
});
/**
 * The service worker's Workbox runtime, which vite-plugin-pwa builds after this bundle: precaching, the
 * Google Fonts route (routing, strategies) and its cache expiration.
 */
const SW_PACKAGES = ['workbox-core', 'workbox-expiration', 'workbox-precaching', 'workbox-routing', 'workbox-strategies'];
/**
 * Credits (footer): THIRD_PARTY_LICENSES.txt lists the packages actually bundled, with their license texts. The build
 * emits it into dist (precached, so it works offline) and refreshes the repo-root copy; dev serves the root copy.
 */
const notices = (): Plugin => ({
  name: 'pixel3d:third-party-notices',
  generateBundle: {
    order: 'post',
    handler(_, bundle) {
      for (const c of Object.values(bundle)) if (c.type === 'chunk') for (const id of c.moduleIds) bundled.add(id);
      const names = [...new Set([...packagesIn(bundled), ...SW_PACKAGES])].sort();
      this.emitFile({ type: 'asset', fileName: NOTICES, source: writeNotices('web', names) });
    },
  },
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== `${server.config.base}${NOTICES}`) return next();
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(readFileSync(ROOT_FILE));
    });
  },
});

export default defineConfig({
  root: here('.'),
  // a GitHub project page is served from /<repo>/: the Pages workflow sets BASE_PATH
  base: process.env.BASE_PATH || '/',
  plugins: [
    svelte(),
    notices(),
    // installable and offline (spec §3): precache the whole build, wasm included. The manifest is public/manifest.webmanifest.
    VitePWA({
      // a new deploy waits for the user: UpdatePrompt.svelte (virtual:pwa-register) offers Reload
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,webmanifest,txt}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // the Google Fonts stylesheet and font files, once seen, work offline too
        runtimeCaching: [{
          urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'fonts', expiration: { maxEntries: 20 } },
        }],
      },
    }),
  ],
  resolve: {
    alias: {
      '@pixel3d/core': here('../core/src/index.ts'),
      // core and manifold-3d import these only on their Node branch; a stub keeps them out of the browser bundle
      ...Object.fromEntries(['node:fs/promises', 'node:module', 'node:url'].map((m) => [m, here('src/node-stub.ts')])),
    },
  },
  // both wasm loaders find their .wasm next to their own module (import.meta.url), so Vite must not pre-bundle them
  optimizeDeps: { exclude: ['manifold-3d', '@jsquash/webp'] },
  worker: { format: 'es', plugins: () => [collect()] },
  server: { port: 5173, strictPort: true, fs: { allow: [here('../..')] } },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'es2022',
    // three.js alone is ~700 kB minified
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      // zod ships /* @__PURE__ */ comments in places the bundler can't use; the notice is noise
      onwarn(w, warn) { if (w.code !== 'INVALID_ANNOTATION') warn(w); },
      // the PWA plugin's precache step is slow on the network share; the timing report is noise
      checks: { bundlerTimings: false },
    },
  },
});

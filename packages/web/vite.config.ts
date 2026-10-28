import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  // a GitHub project page is served from /<repo>/: the Pages workflow sets BASE_PATH
  base: process.env.BASE_PATH || '/',
  plugins: [
    svelte(),
    // installable and offline (spec §3): precache the whole build, wasm included. The manifest is public/manifest.webmanifest.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,webmanifest}'],
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
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, fs: { allow: [here('../..')] } },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'es2022',
    // three.js alone is ~700 kB minified
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      // zod ships /* @__PURE__ */ comments in places Rollup can't use; the notice is noise
      onwarn(w, warn) { if (w.code !== 'INVALID_ANNOTATION') warn(w); },
    },
  },
});

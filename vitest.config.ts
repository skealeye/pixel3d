import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@pixel3d/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
  },
  // packages/web/test/e2e holds Playwright specs, run by `npm run test:e2e`
  test: { include: ['packages/*/test/**/*.test.ts'], exclude: ['**/node_modules/**', 'packages/web/test/e2e/**'] },
});

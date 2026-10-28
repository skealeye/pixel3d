import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  outputDir: '../../test-results',
  reporter: [['list']],
  timeout: 30_000,
  fullyParallel: true,
  use: { baseURL: 'http://localhost:5173', ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } },
  webServer: {
    command: 'npx vite --config packages/web/vite.config.ts',
    cwd: '../..',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

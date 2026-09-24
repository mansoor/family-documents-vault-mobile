import { defineConfig, devices } from '@playwright/test';

/**
 * The app's web build against a real vault: the web export is served by
 * scripts/serve-web.mjs, which passes /api/ through to FDV_DEV_API (the
 * throwaway stack on :8099 by default). `pnpm web:e2e` builds and runs it.
 */
const port = Number(process.env.PORT ?? 8098);

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'node ../scripts/serve-web.mjs',
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(port), FDV_DEV_API: process.env.FDV_DEV_API ?? 'http://localhost:8099' },
  },
});

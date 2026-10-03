import { defineConfig, devices } from '@playwright/test';
import { LOCAL_PORT, PAGES_PORT } from './e2e/paths';

// Builds come first: `npm run e2e` (or `npm run e2e:build` once, then `npx playwright test`).
const chromium = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 760 },
  // A preinstalled Chromium of another version (e.g. in a sandbox without downloads).
  launchOptions: { executablePath: process.env.E2E_CHROMIUM || undefined },
};

export default defineConfig({
  testDir: 'e2e',
  // The local editor tests share one repo and commit to it: one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'pages', testMatch: 'pages/**/*.spec.ts', use: { ...chromium, baseURL: `http://localhost:${PAGES_PORT}/` } },
    {
      name: 'mobile',
      testMatch: 'mobile/**/*.spec.ts',
      use: { ...devices['Pixel 7'], launchOptions: chromium.launchOptions, baseURL: `http://localhost:${PAGES_PORT}/` },
    },
    { name: 'local', testMatch: 'local/**/*.spec.ts', use: { ...chromium, baseURL: `http://localhost:${LOCAL_PORT}/` } },
  ],
  webServer: [
    {
      command: `npx vite preview --outDir dist-e2e-pages --port ${PAGES_PORT} --strictPort`,
      cwd: 'app',
      url: `http://localhost:${PAGES_PORT}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx tsx e2e/serve-local.ts',
      url: `http://localhost:${LOCAL_PORT}/`,
      // Always fresh: the tests commit to its repo.
      reuseExistingServer: false,
    },
  ],
});

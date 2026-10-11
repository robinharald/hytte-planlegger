/**
 * Playwright configuration for the smoke test in e2e/ (see docs/architecture.md, "Testing").
 *
 * - Chromium only, desktop viewport 1400×900 (the phone test overrides the viewport itself).
 * - The dev server is started on a fixed port (or reused when one is already running there).
 * - One worker, no retries: the tests share a WebGL-heavy page and write the committed screenshots in
 *   e2e/screenshots/ themselves, so parallel runs would race on the same files.
 * - Reports and traces land under e2e/ (ignored by e2e/.gitignore); the screenshots are committed.
 * - WebGL in headless Chromium runs on SwiftShader; the flags make that explicit and deterministic across
 *   machines (CI runners have no GPU). It is slow, hence the generous timeouts.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/test-results',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { outputFolder: 'e2e/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173/',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

/**
 * Playwright configuration for the end-to-end tests in e2e/ (see docs/architecture.md, "Testing").
 *
 * - Chromium only. Project 'chromium': desktop viewport 1400×900 against the dev server on 5173 (smoke, editing,
 *   furniture, proposals; the smoke test's phone case sets its own viewport). Project 'iphone': the iPhone 13 device
 *   (390×844, touch, mobile) on Chromium (phone-*.spec.ts; WebKit is not installed, and touch input goes through the
 *   DevTools protocol). Project 'pwa': the production build served by `vite preview` on 4173 under
 *   /hytte-planlegger/, the path GitHub Pages serves it at, with its service worker (offline.spec.ts: offline reload,
 *   fonts from the cache).
 * - Every project runs the app in LOCAL mode: under browser automation (`navigator.webdriver`) the app never uses
 *   the family's real Firestore space (state/familyStore.ts `resolveFamilyMode`).
 * - The dev server is started on a fixed port (or reused when one is already running there). The preview server is
 *   built fresh (`npm run build`) and only when the 'pwa' project runs (all projects, or `--project pwa`).
 * - One worker, no retries: the tests share a WebGL-heavy page and write the committed screenshots in
 *   e2e/screenshots/ themselves, so parallel runs would race on the same files.
 * - Reports and traces land under e2e/ (ignored by e2e/.gitignore); the screenshots are committed.
 * - WebGL in headless Chromium runs on SwiftShader; the flags make that explicit and deterministic across
 *   machines (CI runners have no GPU). It is slow, hence the generous timeouts.
 */
import { defineConfig, devices } from '@playwright/test';

const DEV_URL = 'http://localhost:5173/';
/** The production build under the same path as on GitHub Pages (https://robinharald.github.io/hytte-planlegger/). */
const PWA_URL = 'http://localhost:4173/hytte-planlegger/';

/** Projects named on the command line (`--project x` / `--project=x`); empty = all. */
function selectedProjects(argv: readonly string[]): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a.startsWith('--project=')) out.push(a.slice('--project='.length));
    else if (a === '--project' && argv[i + 1]) out.push(argv[i + 1]);
  });
  return out;
}
const selected = selectedProjects(process.argv);
const runs = (name: string) => selected.length === 0 || selected.includes(name);

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
    baseURL: DEV_URL,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: [/phone-[\w-]+\.spec\.ts/, /offline\.spec\.ts/] },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /phone-[\w-]+\.spec\.ts/ },
    { name: 'pwa', use: { browserName: 'chromium', baseURL: PWA_URL, serviceWorkers: 'allow' }, testMatch: /offline\.spec\.ts/ },
  ],
  webServer: [
    ...(runs('chromium') || runs('iphone')
      ? [{ command: 'npm run dev -- --port 5173 --strictPort', url: DEV_URL, reuseExistingServer: true, timeout: 120_000 }]
      : []),
    // A fresh production build each run (a reused preview could serve an old build).
    // The build's relative base ('./') is served under /hytte-planlegger/ like Pages does (`--base` only moves the
    // preview server's mount point; the files are the ones Pages gets).
    ...(runs('pwa')
      ? [{ command: 'npm run build && npx vite preview --port 4173 --strictPort --base /hytte-planlegger/', url: PWA_URL, reuseExistingServer: false, timeout: 300_000 }]
      : []),
  ],
});

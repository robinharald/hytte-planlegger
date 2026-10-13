/**
 * The lazy libraries offline (project 'pwa': the production build in `vite preview` under /hytte-planlegger/ with its
 * service worker; fix round 3 after phase 3). The PDF libraries and the IFC reader are not precached: the app fetches
 * them into the 'hytte-lazy-libs' cache itself a few seconds after an online start (src/export/warmLazy.ts). After
 * that, with no network and a reload, «Lag PDF» makes the PDF and «Last inn IFC-fil» reads e2e/fixtures/test-cabin.ifc.
 * `vite preview` sends `Vary: Origin`, so this also covers the worker's route ignoring Vary (vite.config.ts): without
 * it the module scripts never matched the cached files offline.
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, dismissToasts, type HytteWindow, READY_TIMEOUT_MS, skipFirstRun } from './helpers';

const FIXTURE_IFC = fileURLToPath(new URL('./fixtures/test-cabin.ifc', import.meta.url));
/** src/export/warmLazy.ts WARM_KEY / LAZY_CACHE. */
const WARM_KEY = 'hytte-planlegger:lazy-libs-warm';
const LAZY_CACHE = 'hytte-lazy-libs';
const OFFLINE_FIRST_USE = 'Første gang trenger dette nett';

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
}

test('offline after one online start: a PDF and an IFC file work (the lazy libraries were fetched in the background)', async ({ page, context }) => {
  test.setTimeout(240_000);
  const pageErrors = collectPageErrors(page);
  await skipFirstRun(page);
  await page.goto('./');
  await waitReady(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The background fetch: about 8 s after the start and an idle moment, then the files go into the cache.
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), WARM_KEY), { timeout: 90_000, intervals: [1000] })
    .not.toBeNull();
  const cached = await page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname), LAZY_CACHE);
  expect(cached.some((p) => /\/assets\/planPdf-[\w-]+\.js$/.test(p)), cached.join('\n')).toBe(true);
  expect(cached.some((p) => /\/assets\/web-ifc[^/]*\.wasm$/.test(p)), cached.join('\n')).toBe(true);

  // No network, and a reload: the worker serves the app.
  await context.setOffline(true);
  await page.reload();
  await waitReady(page);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await dismissToasts(page);

  // «Eksporter plan som PDF» → «Lag PDF».
  await page.getByTestId('export-menu').locator('summary').click();
  await page.getByTestId('export-menu-pdf').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-make').click();
  await expect
    .poll(() => page.evaluate(() => (window as HytteWindow).__hytte?.lastExport?.kind ?? null), { timeout: 60_000 })
    .toBe('pdf');
  const info = await page.evaluate(() => (window as HytteWindow).__hytte?.lastExport ?? null);
  expect(info?.pages ?? 0).toBeGreaterThan(0);
  expect(info?.bytes ?? 0).toBeGreaterThan(20_000);
  await expect(page.getByTestId('export-dialog')).not.toContainText(OFFLINE_FIRST_USE);
  await page.keyboard.press('Escape');

  // «IFC-modell» → «Last inn IFC-fil» with the synthetic fixture.
  await page.getByTestId('view-tab-split').click();
  await page.getByTestId('ifc-panel').locator('summary').click();
  await expect(page.getByTestId('ifc-load')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('ifc-load').click();
  await (await chooser).setFiles(FIXTURE_IFC);
  await expect(page.getByTestId('ifc-file')).toContainText('test-cabin.ifc', { timeout: 60_000 });
  await expect(page.locator('[data-testid=plan-view] [data-layer=ifc] path[data-ifc=wall]')).toHaveCount(1);
  await expect(page.getByTestId('ifc-panel')).not.toContainText(OFFLINE_FIRST_USE);
  await page.getByTestId('ifc-remove').click();

  await context.setOffline(false);
  expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
});

/**
 * PWA (project 'pwa': the production build in `vite preview` under /hytte-planlegger/, the path GitHub Pages serves
 * it at; docs/phase2-plan.md §5): the page's assets and manifest under that path, the manifest and its icons, the
 * service worker registered by the app (registerType 'prompt', scope /hytte-planlegger/) and controlling the page
 * after a reload, then
 * OFFLINE: a reload still starts the app (precached index.html, JS, CSS, fonts), the self-hosted fonts load from
 * the cache, and a proposal made before going offline is still there (local mode under automation).
 */
import { expect, test, type Page } from '@playwright/test';
import { activeVariant, collectPageErrors, createNewProposal, type HytteWindow, projectOnScreen, READY_TIMEOUT_MS, skipFirstRun } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
}

/** Families of the faces that loaded (after document.fonts.ready). */
async function loadedFonts(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.weight}`);
  });
}

test('offline: the service worker serves the app, its fonts and the saved proposals', async ({ page, context }) => {
  const pageErrors = collectPageErrors(page);
  await skipFirstRun(page);
  await page.goto('./');
  await waitReady(page);
  expect(new URL(page.url()).pathname).toBe('/hytte-planlegger/');
  // Every script, stylesheet and font the page loaded came from under /hytte-planlegger/ (relative base './').
  const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name)).filter((u) => u.origin === location.origin).map((u) => u.pathname));
  expect(loaded.filter((p) => !p.startsWith('/hytte-planlegger/')), 'assets outside the Pages path').toEqual([]);
  expect(loaded.some((p) => /\/hytte-planlegger\/assets\/index-[\w-]+\.js$/.test(p))).toBe(true);

  // The manifest (no start_url: a home-screen app opens the page it was added from, #f= included) and its icons.
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await page.evaluate(async (url) => (await fetch(url)).json() as Promise<Record<string, unknown>>, href ?? '');
  expect(manifest).toMatchObject({ short_name: 'Hytteplanlegger', display: 'standalone', scope: './', lang: 'nb' });
  expect(manifest.start_url).toBeUndefined();
  const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[];
  expect(icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
  for (const icon of [...icons.map((i) => i.src), 'apple-touch-icon.png']) {
    expect(await page.evaluate(async (src) => (await fetch(src)).status, icon), icon).toBe(200);
  }
  expect(await page.locator('link[rel="apple-touch-icon"]').count()).toBe(1);

  // The app registers its worker; after a reload it controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await waitReady(page);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/hytte-planlegger\/sw\.js$/);
  expect(await page.evaluate(async () => new URL((await navigator.serviceWorker.ready).scope).pathname)).toBe('/hytte-planlegger/');

  // A proposal made while online (saved on this device).
  await createNewProposal(page);
  const id = (await activeVariant(page)).id;
  await page.waitForTimeout(1200);

  // Offline: the reload is served by the worker.
  await context.setOffline(true);
  await page.reload();
  await waitReady(page);
  expect((await projectOnScreen(page)).variants.map((v) => v.id)).toContain(id);
  expect((await activeVariant(page)).id).toBe(id);
  const fonts = await loadedFonts(page);
  expect(fonts.some((f) => f.startsWith('Barlow '))).toBe(true);
  expect(fonts.some((f) => f.startsWith('Barlow Semi Condensed'))).toBe(true);
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'local');
  await context.setOffline(false);
  expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
});

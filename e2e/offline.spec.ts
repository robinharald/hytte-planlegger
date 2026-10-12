/**
 * PWA (project 'pwa': the production build in `vite preview` under /hytte-planlegger/, the path GitHub Pages serves
 * it at; docs/phase2-plan.md §5): the page's assets and manifest under that path, the manifest and its icons, the
 * service worker registered by the app (registerType 'prompt', scope /hytte-planlegger/) and controlling the page
 * after a reload, then
 * OFFLINE: a reload still starts the app (precached index.html, JS, CSS, fonts), the self-hosted fonts load from
 * the cache, and a proposal made before going offline is still there (local mode under automation).
 * UPDATE (fix round after 2b): two tabs, a new version of the worker (dist/sw.js changed on disk, restored afterwards):
 * both show «Ny versjon av appen er klar. [Oppdater]»; Oppdater in one reloads that tab only; the other shows «Appen er
 * oppdatert i en annen fane … [Last på nytt]» and does not reload by itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

test('update: Oppdater in one tab reloads that tab only; the other says so and waits', async ({ context }) => {
  // The worker the preview server serves (vite preview reads dist/ from disk on every request).
  const swFile = fileURLToPath(new URL('../dist/sw.js', import.meta.url));
  const original = readFileSync(swFile, 'utf8');
  const a = await context.newPage();
  const b = await context.newPage();
  const errors = [...[a, b].map((p) => collectPageErrors(p))];
  for (const p of [a, b]) await skipFirstRun(p);
  // Installed and controlling both tabs (the first install never shows the toast).
  await a.goto('./');
  await waitReady(a);
  await a.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  for (const p of [a, b]) {
    await (p === a ? p.reload() : p.goto('./'));
    await waitReady(p);
    await expect.poll(() => p.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  }
  await expect(a.getByTestId('update-toast')).toHaveCount(0);
  await b.evaluate(() => ((window as unknown as { __e2eMarker?: string }).__e2eMarker = 'still here'));
  let reloadsB = 0;
  b.on('load', () => reloadsB++);
  try {
    writeFileSync(swFile, `${original}\n// e2e: a new version ${Date.now()}\n`);
    await a.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    for (const p of [a, b]) {
      await expect(p.getByTestId('update-toast')).toContainText('Ny versjon av appen er klar.', { timeout: 30_000 });
      await expect(p.getByTestId('update-now')).toHaveText('Oppdater');
    }
    // Oppdater in A: A reloads into the new version.
    await Promise.all([a.waitForEvent('load', { timeout: 30_000 }), a.getByTestId('update-now').click()]);
    await waitReady(a);
    await expect(a.getByTestId('update-toast')).toHaveCount(0);
    // B: the notice and its button, no reload.
    await expect(b.getByTestId('update-toast')).toContainText('Appen er oppdatert i en annen fane.', { timeout: 30_000 });
    await expect(b.getByTestId('update-now')).toHaveText('Last på nytt');
    await b.waitForTimeout(3000);
    expect(reloadsB, 'B did not reload by itself').toBe(0);
    expect(await b.evaluate(() => (window as unknown as { __e2eMarker?: string }).__e2eMarker)).toBe('still here');
    // Its own button reloads it, into the new version.
    await Promise.all([b.waitForEvent('load', { timeout: 30_000 }), b.getByTestId('update-now').click()]);
    await waitReady(b);
    await expect(b.getByTestId('update-toast')).toHaveCount(0);
  } finally {
    writeFileSync(swFile, original);
  }
  expect(errors.flat(), 'uncaught errors in the pages').toEqual([]);
});

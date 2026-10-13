/**
 * The REAL family space and the production build offline (the 'pwa' project: `vite preview` under /hytte-planlegger/
 * with its service worker), opt-in like e2e/family-firestore.spec.ts (`E2E_FIRESTORE=1`): an edit made offline and a
 * reload while still offline — the edit is on screen (Firestore's own cache) and the pill keeps saying «Lagret her –
 * sendes når du er på nett» (before the fix round it said «Lagret for alle» after the reload); back online it is sent
 * and the pill says «Lagret for alle». The throwaway family is deleted afterwards.
 */
import { expect, test } from '@playwright/test';
import { activeVariant, collectPageErrors, dragPlan, FIRST_RUN_KEY, type HytteWindow, INSTALL_CARD_KEY, READY_TIMEOUT_MS, selectAt } from './helpers';
import { e2eFamilyId, FIRESTORE_ENABLED, FIRESTORE_SKIP_REASON, proposalDocs, purgeFamily, tubOf } from './firestoreAdmin';

const waitReady = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });

test.describe('the real family space offline (production build)', () => {
  test.skip(!FIRESTORE_ENABLED, FIRESTORE_SKIP_REASON);
  const F = e2eFamilyId('offline-reload');
  test.afterAll(async () => {
    expect(await purgeFamily(F), `documents left in ${F}`).toBe(0);
  });

  test('an offline edit survives an offline reload, and the pill keeps saying it is not sent yet', async ({ page, context }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(
      ({ keys }) => {
        localStorage.setItem('hytte-planlegger:family-mode', 'shared');
        localStorage.setItem('hytte-planlegger:my-name', 'Test A');
        for (const k of keys) localStorage.setItem(k, '1');
      },
      { keys: [FIRST_RUN_KEY, INSTALL_CARD_KEY] },
    );
    await page.goto(`./#f=${F}`);
    await waitReady(page);
    // A new device at the link of the (empty) family: «Ikke startet» until the first proposal (fourth fix round).
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'notStarted', { timeout: 60_000 });
    page.once('dialog', (d) => void d.accept('Uten nett'));
    await page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(page)).name).toBe('Uten nett');
    const id = (await activeVariant(page)).id;
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.id), { timeout: 30_000 }).toEqual([id]);
    // The worker controls the page (so it can start offline).
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await waitReady(page);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced', { timeout: 60_000 });
    expect((await activeVariant(page)).id).toBe(id);

    // Offline: move the hot tub 2 m west. Queued on this device.
    await context.setOffline(true);
    await selectAt(page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [21.7, -3.2], [19.7, -3.2], 16);
    await expect.poll(async () => (await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(20.2);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'pending', { timeout: 15_000 });

    // Reload, still offline: the edit is there, and the pill still says it is not sent.
    await page.reload();
    await waitReady(page);
    await expect.poll(async () => (await activeVariant(page)).id, { timeout: 30_000 }).toBe(id);
    expect((await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(20.2);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'pending', { timeout: 30_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'pending');
    expect(tubOf((await proposalDocs(F))[0])?.[0], 'the server does not have it yet').toBeCloseTo(21.7, 1);

    // Online again: sent, «Lagret for alle».
    await context.setOffline(false);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced', { timeout: 60_000 });
    await expect.poll(async () => tubOf((await proposalDocs(F))[0])?.[0] ?? 99, { timeout: 30_000 }).toBeLessThan(20.2);
    expect(errors).toEqual([]);
  });
});

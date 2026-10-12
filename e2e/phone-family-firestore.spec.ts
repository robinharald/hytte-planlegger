/**
 * The REAL family space on an iPhone (the 'iphone' project), opt-in like e2e/family-firestore.spec.ts
 * (`E2E_FIRESTORE=1`): the anonymous sign-in and the first save load no Google scripts and no auth iframe (before the
 * fix round, `getAuth` loaded apis.google.com's gapi, firebaseapp.com/__/auth/iframe and called getProjectConfig on
 * phones). Only Firebase's own sign-in and database hosts are contacted. The throwaway family is deleted afterwards.
 */
import { expect, test } from '@playwright/test';
import { activeVariant, FIRST_RUN_KEY, type HytteWindow, INSTALL_CARD_KEY, READY_TIMEOUT_MS } from './helpers';
import { e2eFamilyId, FIRESTORE_ENABLED, FIRESTORE_SKIP_REASON, proposalDocs, purgeFamily } from './firestoreAdmin';

test.describe('the real family space on an iPhone', () => {
  test.skip(!FIRESTORE_ENABLED, FIRESTORE_SKIP_REASON);
  const F = e2eFamilyId('iphone');
  test.afterAll(async () => {
    expect(await purgeFamily(F), `documents left in ${F}`).toBe(0);
  });

  test('sign-in and saving load no Google scripts and no auth iframe', async ({ page }, testInfo) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.addInitScript(
      ({ keys }) => {
        localStorage.setItem('hytte-planlegger:family-mode', 'shared');
        localStorage.setItem('hytte-planlegger:my-name', 'Test iPhone');
        for (const k of keys) localStorage.setItem(k, '1');
      },
      { keys: [FIRST_RUN_KEY, INSTALL_CARD_KEY] },
    );
    await page.goto(`/#f=${F}`);
    await page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced', { timeout: 60_000 });
    page.once('dialog', (d) => void d.accept('Pappas idé'));
    await page.getByTestId('new-proposal').tap();
    await expect.poll(async () => (await activeVariant(page)).name).toBe('Pappas idé');
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.data.name), { timeout: 30_000 }).toEqual(['Pappas idé']);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced', { timeout: 30_000 });
    await page.waitForTimeout(2000);

    const remote = requests.filter((u) => new URL(u).hostname !== 'localhost');
    const hosts = [...new Set(remote.map((u) => new URL(u).hostname))].sort();
    testInfo.annotations.push({ type: 'hosts', description: hosts.join(', ') });
    expect(remote.filter((u) => /apis\.google\.com|gapi|__\/auth\/iframe|getProjectConfig|iframe\.js/.test(u)), 'Google scripts or the auth iframe').toEqual([]);
    expect(page.frames().filter((f) => /__\/auth\/iframe/.test(f.url())), 'an auth iframe').toEqual([]);
    // Only Firebase's sign-in (identitytoolkit, securetoken for a token refresh) and the database.
    for (const h of hosts) expect(['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com']).toContain(h);
  });
});

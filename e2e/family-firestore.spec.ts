/**
 * The REAL family space (Firestore) on a desktop, opt-in: `E2E_FIRESTORE=1 npx playwright test --project=chromium
 * e2e/family-firestore.spec.ts`. Every other spec runs the app in local mode; these switch the shared mode on
 * (`hytte-planlegger:family-mode` = 'shared') in throwaway families `e2e-…` and delete them afterwards
 * (e2e/firestoreAdmin.ts `purgeFamily`, checked to leave 0 documents). Two browser contexts are two devices.
 *
 *  - A delete made OFFLINE on device A from an old view, while device B moves the hot tub online: when A comes back
 *    the server keeps B's content (only deletedAt changes), B is told («… ble slettet av Test A på en enhet som ikke
 *    hadde sett de siste endringene dine …») and «Hent tilbake» brings B's version back on both devices.
 *  - A real phase-1 autosave (src/state/fixtures/phase1-autosave.plain-visit.json) brings no proposal into the family
 *    space; an edited one becomes «Forslag D (eget)» with a device-unique id.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { activeVariant, collectPageErrors, dragPlan, FIRST_RUN_KEY, type HytteWindow, INSTALL_CARD_KEY, projectOnScreen, READY_TIMEOUT_MS, selectAt } from './helpers';
import { e2eFamilyId, FIRESTORE_ENABLED, FIRESTORE_SKIP_REASON, proposalDocs, purgeFamily, tubOf } from './firestoreAdmin';

const PHASE1_AUTOSAVE = readFileSync(new URL('../src/state/fixtures/phase1-autosave.plain-visit.json', import.meta.url), 'utf8');

interface Device {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

/** A device in the shared mode with its own storage, named `name`, opened at `#f=<family><extra>`; waits for «Lagret for alle». */
async function device(browser: Browser, testInfo: TestInfo, family: string, name: string, opts: { extra?: string; autosave?: string } = {}): Promise<Device> {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1400, height: 900 } });
  await context.addInitScript(
    ({ name, keys, autosave }) => {
      localStorage.setItem('hytte-planlegger:family-mode', 'shared');
      localStorage.setItem('hytte-planlegger:my-name', name);
      for (const k of keys) localStorage.setItem(k, '1');
      if (autosave && !localStorage.getItem('hytte-planlegger:project.before-2b')) localStorage.setItem('hytte-planlegger:project', autosave);
    },
    { name, keys: [FIRST_RUN_KEY, INSTALL_CARD_KEY], autosave: opts.autosave ?? null },
  );
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await page.goto(`/#f=${family}${opts.extra ?? ''}`);
  await page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced', { timeout: 60_000 });
  return { context, page, errors };
}

test.describe('the real family space (Firestore), throwaway e2e- families', () => {
  test.skip(!FIRESTORE_ENABLED, FIRESTORE_SKIP_REASON);
  const families: string[] = [];
  test.afterAll(async () => {
    for (const f of families) expect(await purgeFamily(f), `documents left in ${f}`).toBe(0);
  });

  test('a delete made offline from an old view keeps the newer edit of another device; that device is told and gets it back', async ({ browser }, testInfo) => {
    const F = e2eFamilyId('offline-delete');
    families.push(F);
    const A = await device(browser, testInfo, F, 'Test A');
    A.page.once('dialog', (d) => void d.accept('Felles'));
    await A.page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(A.page)).name).toBe('Felles');
    const id = (await activeVariant(A.page)).id;
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.id), { timeout: 30_000 }).toEqual([id]);
    const tub0 = tubOf((await proposalDocs(F))[0]);
    expect(tub0?.[0]).toBeCloseTo(21.7, 1);

    const B = await device(browser, testInfo, F, 'Test B', { extra: `&p=${id}` });
    await expect.poll(async () => (await activeVariant(B.page)).id).toBe(id);

    // A goes offline and deletes «Felles» (both confirmations): queued on A.
    await A.context.setOffline(true);
    await A.page.getByTestId('delete-proposal').click();
    await A.page.getByTestId('delete-next').click();
    await A.page.getByTestId('delete-confirm').click();
    await expect.poll(async () => (await projectOnScreen(A.page)).variants.map((v) => v.id)).not.toContain(id);
    await expect(A.page.getByTestId('status-pill')).toHaveAttribute('data-state', 'pending', { timeout: 15_000 });

    // B, online, moves the hot tub 2 m west; the server has it.
    await selectAt(B.page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(B.page, [21.7, -3.2], [19.7, -3.2], 16);
    await expect.poll(async () => (await activeVariant(B.page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(20.2);
    await expect.poll(async () => tubOf((await proposalDocs(F))[0])?.[0] ?? 0, { timeout: 30_000 }).toBeLessThan(20.2);

    // A comes back: the delete lands as a field update — B's content stays, it is in the Papirkurv.
    await A.context.setOffline(false);
    await expect(A.page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced', { timeout: 60_000 });
    await expect.poll(async () => (await proposalDocs(F))[0]?.data.deletedAt ?? null, { timeout: 30_000 }).not.toBeNull();
    const doc = (await proposalDocs(F))[0];
    expect(tubOf(doc)?.[0], 'B\'s edit is still the content').toBeLessThan(20.2);
    expect(doc.data.updatedBy).toBe('Test A');

    // B is told, and «Hent tilbake» brings its version back on both devices.
    const banner = B.page.getByTestId('overwritten-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveAttribute('data-kind', 'deleted');
    await expect(banner).toContainText('ble slettet av Test A');
    await B.page.getByTestId('overwritten-restore').click();
    await expect.poll(async () => ((await proposalDocs(F))[0]?.data ?? { deletedAt: 'missing' }).deletedAt, { timeout: 30_000 }).toBeNull();
    for (const d of [A, B]) {
      await expect
        .poll(async () => (await projectOnScreen(d.page)).variants.find((v) => v.id === id)?.outdoor.hotTubs[0].centre[0] ?? 99, { timeout: 30_000 })
        .toBeLessThan(20.2);
    }
    expect([...A.errors, ...B.errors]).toEqual([]);
    await A.context.close();
    await B.context.close();
  });

  test('a real phase-1 autosave brings no proposal into the family space; an edited one is «Forslag D (eget)» with its own id', async ({ browser }, testInfo) => {
    const F = e2eFamilyId('phase1');
    families.push(F);
    const plain = await device(browser, testInfo, F, 'Test A', { autosave: PHASE1_AUTOSAVE });
    expect((await projectOnScreen(plain.page)).variants.map((v) => v.name)).toEqual(['Forslag D']);
    await plain.page.waitForTimeout(3000);
    expect(await proposalDocs(F), 'nothing written for a plain visit').toEqual([]);
    expect(await plain.page.evaluate(() => localStorage.getItem('hytte-planlegger:project'))).toBeNull();

    const edited = JSON.parse(PHASE1_AUTOSAVE) as { updatedAt: string; variants: { rooms: { name: string }[] }[] };
    edited.updatedAt = '2026-10-01T08:30:00.000Z';
    edited.variants[0].rooms[0].name = 'Omdøpt rom';
    const other = await device(browser, testInfo, F, 'Test B', { autosave: JSON.stringify(edited) });
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.data.name), { timeout: 30_000 }).toEqual(['Forslag D (eget)']);
    const doc = (await proposalDocs(F))[0];
    expect(doc.id).toMatch(/^forslag-d-eget-/);
    expect(doc.data.updatedAt, 'its own «sist endret»').toBe('2026-10-01T08:30:00.000Z');
    expect((await activeVariant(other.page)).id, 'the edited copy is on screen').toBe(doc.id);
    expect([...plain.errors, ...other.errors]).toEqual([]);
    await plain.context.close();
    await other.context.close();
  });
});

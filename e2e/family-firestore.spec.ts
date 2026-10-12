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
 *    space; an edited one becomes «Forslag D (eget)» with a device-unique id (once the empty space is started:
 *    «Denne plassen er tom. Er lenken hel?» [Begynn her]).
 *  - Last fix round, scenario H (old tabs): tab 1 at R makes «Mammas idé»; tab 2 opens the family link F, which asks
 *    first («Bytt dit»), then brings it along. Tab 1, still open, says «Denne enheten har byttet delt plass i en annen
 *    fane» and saves nothing more (a proposal made there never reaches R). Tab 1 reloaded at R is no switch — the
 *    device stays in F, nothing is offered or moved, and another device opening F sees both proposals.
 *  - Last fix round, scenario J (a proposal link to a private space): Pappa's device uses F («Pappas plan»); Mamma's
 *    private space R has «Mammas idé», and she sends `#f=R&p=<id>`. Pappa opens it in a new tab: no switch, nothing
 *    offered to move out of F; «Hent «Mammas idé» som en kopi hit» adds a copy in F, and R keeps its proposal.
 *  - Final fix round, «Lagre over» within 5 minutes of the last revision: B holds a drag while A moves the hot tub and
 *    saves; B lets go (a conflict) and chooses «Lagre over». The server has B's version, A's is a revision (savedBy
 *    Test A); A is told («… ble lagret over av Test B …») and finds it under Tidligere versjoner, tagged «din» and
 *    «lagt bort ved Lagre over».
 *  - Final fix round, leaving the app: an edit followed at once by visibilitychange → hidden (all iOS fires) is
 *    written within 0.7 s, before the 1 s debounce, and is on the server after the context is closed.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { activeVariant, collectPageErrors, dragPlan, FIRST_RUN_KEY, type HytteWindow, INSTALL_CARD_KEY, planToClient, projectOnScreen, READY_TIMEOUT_MS, selectAt } from './helpers';
import { e2eFamilyId, FIRESTORE_ENABLED, FIRESTORE_SKIP_REASON, listDocs, proposalDocs, purgeFamily, tubOf } from './firestoreAdmin';

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
    // The space is still empty: asked first, nothing moved in until it is started.
    await expect(other.page.getByTestId('empty-family-banner')).toBeVisible({ timeout: 30_000 });
    await other.page.waitForTimeout(2000);
    expect(await proposalDocs(F), 'nothing moved into an empty space before it is started').toEqual([]);
    await other.page.getByTestId('empty-family-start').click();
    await expect(other.page.getByTestId('empty-family-banner')).toHaveCount(0);
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.data.name), { timeout: 30_000 }).toEqual(['Forslag D (eget)']);
    const doc = (await proposalDocs(F))[0];
    expect(doc.id).toMatch(/^forslag-d-eget-/);
    expect(doc.data.updatedAt, 'its own «sist endret»').toBe('2026-10-01T08:30:00.000Z');
    expect((await activeVariant(other.page)).id, 'the edited copy is on screen').toBe(doc.id);
    expect([...plain.errors, ...other.errors]).toEqual([]);
    await plain.context.close();
    await other.context.close();
  });

  test('H: a tab left open during a switch saves nothing more; reloaded at the space left it switches nothing; the family keeps both', async ({ browser }, testInfo) => {
    const R = e2eFamilyId('old-tab-r');
    const F = e2eFamilyId('old-tab-f');
    families.push(R, F);
    // Tab 1: the device's own space R, with «Mammas idé».
    const A = await device(browser, testInfo, R, 'Test A');
    A.page.once('dialog', (d) => void d.accept('Mammas idé'));
    await A.page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(A.page)).name).toBe('Mammas idé');
    const mammas = (await activeVariant(A.page)).id;
    await expect.poll(async () => (await proposalDocs(R)).map((d) => d.id), { timeout: 30_000 }).toEqual([mammas]);

    // Tab 2 (same device): the family link F asks first; nothing is stored or offered until «Bytt dit».
    const tab2 = await A.context.newPage();
    const tab2Errors = collectPageErrors(tab2);
    await tab2.goto(`/#f=${F}`);
    await tab2.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
    const ask = tab2.getByTestId('other-family-banner');
    await expect(ask).toBeVisible({ timeout: 30_000 });
    await expect(ask).toContainText('Denne lenken går til en annen delt plass.');
    await expect(ask).toContainText('Plassen i lenken har ingen forslag (er lenken hel?); plassen du bruker nå har 1.', { timeout: 30_000 });
    await expect(tab2.getByTestId('carry-over-banner')).toHaveCount(0);
    expect(await tab2.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(R);
    await Promise.all([tab2.waitForEvent('load'), tab2.getByTestId('other-family-switch').click()]);
    await tab2.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
    await expect(tab2.getByTestId('carry-over-banner')).toBeVisible({ timeout: 30_000 });
    await tab2.getByTestId('carry-over-accept').click();
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.data.name), { timeout: 30_000 }).toEqual(['Mammas idé']);
    expect(await tab2.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(F);

    // Tab 1, still open at R: told, and it saves nothing more (the reviewer's «Ny i gammel fane» landed in R).
    await expect(A.page.getByTestId('family-elsewhere-banner')).toBeVisible({ timeout: 15_000 });
    await expect(A.page.getByTestId('status-pill')).toHaveAttribute('data-state', 'elsewhere');
    A.page.once('dialog', (d) => void d.accept('Ny i gammel fane'));
    await A.page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(A.page)).name).toBe('Ny i gammel fane');
    await A.page.waitForTimeout(3000);
    expect((await proposalDocs(R)).map((d) => d.data.name), 'nothing new in the space left').toEqual(['Mammas idé']);
    expect((await proposalDocs(F)).map((d) => d.data.name)).toEqual(['Mammas idé']);

    tab2.once('dialog', (d) => void d.accept('Ny idé i familien'));
    await tab2.getByTestId('new-proposal').click();
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.data.name).sort(), { timeout: 30_000 }).toEqual(['Mammas idé', 'Ny idé i familien']);

    // Tab 1 is reloaded (its address is still #f=R&p=<«Mammas idé»>): no switch, no offer, the banner asks. The proposal
    // it names is in R's Papirkurv now, so there is nothing to copy: only «Bli her».
    expect(new URL(A.page.url()).hash).toBe(`#f=${R}&p=${mammas}`);
    await A.page.reload();
    await A.page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
    const old = A.page.getByTestId('other-family-banner');
    await expect(old).toBeVisible({ timeout: 30_000 });
    await expect(old).toHaveAttribute('data-kind', 'proposal');
    await expect(old).toContainText('Forslaget i lenken finnes ikke i den plassen.', { timeout: 30_000 });
    await expect(A.page.getByTestId('other-family-copy')).toHaveCount(0);
    await expect(A.page.getByTestId('other-family-switch')).toHaveCount(0);
    await expect(A.page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced', { timeout: 60_000 });
    await expect.poll(async () => (await projectOnScreen(A.page)).variants.map((v) => v.name).sort(), { timeout: 30_000 }).toEqual(['Forslag D', 'Mammas idé', 'Ny idé i familien']);
    await A.page.waitForTimeout(3000);
    await expect(A.page.getByTestId('carry-over-banner')).toHaveCount(0);
    expect(await A.page.evaluate(() => localStorage.getItem('hytte-planlegger:family')), 'the stored family is unchanged').toBe(F);
    // «Bli her»: the address bar shows the family space again.
    await A.page.getByTestId('other-family-stay').click();
    await expect.poll(() => new URL(A.page.url()).hash.startsWith(`#f=${F}`)).toBe(true);

    // Nothing left the family space: another device opening F sees both; R has only «Mammas idé» in its Papirkurv.
    const other = await device(browser, testInfo, F, 'Test B');
    await expect.poll(async () => (await projectOnScreen(other.page)).variants.map((v) => v.name).sort(), { timeout: 30_000 }).toEqual(['Forslag D', 'Mammas idé', 'Ny idé i familien']);
    expect((await proposalDocs(F)).map((d) => d.data.deletedAt ?? null)).toEqual([null, null]);
    const inR = await proposalDocs(R);
    expect(inR.map((d) => [d.data.name, d.data.deletedAt !== null])).toEqual([['Mammas idé', true]]);
    expect([...A.errors, ...tab2Errors, ...other.errors]).toEqual([]);
    await A.context.close();
    await other.context.close();
  });

  test('J: a link to one proposal in another space is copied here, never a switch; that space keeps it', async ({ browser }, testInfo) => {
    const F = e2eFamilyId('prop-link-f');
    const R = e2eFamilyId('prop-link-r');
    families.push(F, R);
    // Pappa's device uses F with «Pappas plan».
    const pappa = await device(browser, testInfo, F, 'Pappa');
    pappa.page.once('dialog', (d) => void d.accept('Pappas plan'));
    await pappa.page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.data.name), { timeout: 30_000 }).toEqual(['Pappas plan']);
    // Mamma's device, in her private space R, makes «Mammas idé» and sends its link.
    const mamma = await device(browser, testInfo, R, 'Mamma');
    mamma.page.once('dialog', (d) => void d.accept('Mammas idé'));
    await mamma.page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await proposalDocs(R)).map((d) => d.data.name), { timeout: 30_000 }).toEqual(['Mammas idé']);
    const x = (await activeVariant(mamma.page)).id;

    // Pappa opens it in a new tab: no switch; a copy is offered.
    const tab = await pappa.context.newPage();
    const tabErrors = collectPageErrors(tab);
    await tab.goto(`/#f=${R}&p=${x}`);
    await tab.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
    const ask = tab.getByTestId('other-family-banner');
    await expect(ask).toHaveAttribute('data-kind', 'proposal', { timeout: 30_000 });
    await expect(ask).toContainText('Denne lenken går til «Mammas idé» i en annen delt plass.', { timeout: 30_000 });
    await expect(tab.getByTestId('other-family-switch')).toHaveCount(0);
    await tab.waitForTimeout(2000);
    await expect(tab.getByTestId('carry-over-banner')).toHaveCount(0);
    expect(await tab.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(F);
    await tab.getByTestId('other-family-copy').click();
    await expect(ask).toHaveCount(0);
    await expect.poll(async () => (await activeVariant(tab)).name).toBe('Mammas idé');
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.data.name).sort(), { timeout: 30_000 }).toEqual(['Mammas idé', 'Pappas plan']);
    expect(new URL(tab.url()).hash.startsWith(`#f=${F}`)).toBe(true);
    // R is untouched (its proposal is not in the Papirkurv); Pappa's first tab saw no switch.
    expect((await proposalDocs(R)).map((d) => [d.data.name, d.data.deletedAt ?? null])).toEqual([['Mammas idé', null]]);
    await expect(pappa.page.getByTestId('family-elsewhere-banner')).toHaveCount(0);
    expect([...pappa.errors, ...mamma.errors, ...tabErrors]).toEqual([]);
    await pappa.context.close();
    await mamma.context.close();
  });

  test('«Lagre over» within 5 minutes of a revision keeps the other device\'s version under Tidligere versjoner', async ({ browser }, testInfo) => {
    const F = e2eFamilyId('save-over');
    families.push(F);
    const A = await device(browser, testInfo, F, 'Test A');
    A.page.once('dialog', (d) => void d.accept('Felles'));
    await A.page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(A.page)).name).toBe('Felles');
    const id = (await activeVariant(A.page)).id;
    await expect.poll(async () => (await proposalDocs(F)).map((d) => d.id), { timeout: 30_000 }).toEqual([id]);
    const B = await device(browser, testInfo, F, 'Test B', { extra: `&p=${id}` });
    await expect.poll(async () => (await activeVariant(B.page)).id).toBe(id);

    // B holds a drag of the hot tub (2 m west, not let go) while A moves it 2 m north; A's save reaches the server.
    await selectAt(B.page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    const [bx0, by0] = await planToClient(B.page, [21.7, -3.2]);
    const [bx1, by1] = await planToClient(B.page, [19.7, -3.2]);
    await B.page.mouse.move(bx0, by0);
    await B.page.mouse.down();
    for (let i = 1; i <= 10; i++) await B.page.mouse.move(bx0 + ((bx1 - bx0) * i) / 10, by0 + ((by1 - by0) * i) / 10);
    await selectAt(A.page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(A.page, [21.7, -3.2], [21.7, -1.2], 16);
    await expect.poll(async () => tubOf((await proposalDocs(F))[0])?.[1] ?? -9, { timeout: 30_000 }).toBeGreaterThan(-1.7);
    const theirs = tubOf((await proposalDocs(F))[0]);
    // Let A's version reach B (it waits there while the drag lasts), then B lets go: a conflict.
    await B.page.waitForTimeout(2000);
    await B.page.mouse.up();
    const banner = B.page.getByTestId('conflict-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText('ble endret av Test A');
    await expect(banner).toContainText('«Lagre over» legger den andre utgaven der.');
    await B.page.getByTestId('conflict-overwrite').click();
    await expect(banner).toHaveCount(0);

    // The server has B's version; A's is a revision (the first revision is less than 5 minutes old).
    await expect.poll(async () => tubOf((await proposalDocs(F))[0])?.[0] ?? 99, { timeout: 30_000 }).toBeLessThan(20.2);
    expect((await proposalDocs(F))[0].data.updatedBy).toBe('Test B');
    const revisions = await listDocs(`families/${F}/proposals/${id}/revisions`);
    expect(revisions.map((r) => tubOf(r)), 'A\'s version is kept').toContainEqual(theirs);
    expect(revisions.find((r) => JSON.stringify(tubOf(r)) === JSON.stringify(theirs))?.data.savedBy).toBe('Test A');
    // A gets B's version on screen, is told, and finds its own under Tidligere versjoner (tagged).
    await expect.poll(async () => (await activeVariant(A.page)).outdoor.hotTubs[0].centre[0], { timeout: 30_000 }).toBeLessThan(20.2);
    const told = A.page.getByTestId('overwritten-banner');
    await expect(told).toHaveAttribute('data-kind', 'savedOver', { timeout: 30_000 });
    await expect(told).toContainText('«Felles» ble lagret over av Test B. Din utgave ligger under Tidligere versjoner.');
    await expect(B.page.getByTestId('overwritten-banner')).toHaveCount(0);
    await A.page.getByTestId('more-menu').locator('summary').click();
    await A.page.getByTestId('more-revisions').click();
    await expect(A.page.getByTestId('revision-item').filter({ hasText: 'Test A' }).first()).toBeVisible({ timeout: 30_000 });
    await expect(A.page.getByTestId('revision-item').filter({ hasText: 'lagt bort ved Lagre over' })).toHaveCount(1);
    await expect(A.page.getByTestId('revision-item').filter({ hasText: 'lagt bort ved Lagre over' })).toContainText('din');
    expect([...A.errors, ...B.errors]).toEqual([]);
    await A.context.close();
    await B.context.close();
  });

  test('an edit made just before the app goes to the background is sent at once (visibilitychange → hidden)', async ({ browser }, testInfo) => {
    const F = e2eFamilyId('hidden');
    families.push(F);
    const A = await device(browser, testInfo, F, 'Test A');
    A.page.once('dialog', (d) => void d.accept('Skjult'));
    await A.page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(A.page)).name).toBe('Skjult');
    await expect.poll(async () => (await proposalDocs(F)).length, { timeout: 30_000 }).toBe(1);
    await A.page.waitForTimeout(2000);
    const writes: number[] = [];
    A.page.on('request', (r) => {
      if (/Firestore\/Write\/channel/.test(r.url()) && r.method() === 'POST') writes.push(Date.now());
    });

    // The hot tub 1.5 m north, then at once the app goes to the background (iOS: only visibilitychange fires).
    await selectAt(A.page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(A.page, [21.7, -3.2], [21.7, -1.7], 12);
    const t0 = Date.now();
    await A.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // The save goes out before the 1 s debounce would have sent it …
    await expect.poll(() => writes.filter((t) => t >= t0).length, { timeout: 2000, intervals: [50] }).toBeGreaterThan(0);
    const first = Math.min(...writes.filter((t) => t >= t0));
    expect(first - t0, 'ms from hidden to the write').toBeLessThan(700);
    // … so it reaches the server even when the app is then killed (the context closed, as iOS evicts a suspended app).
    await A.page.waitForTimeout(500);
    expect(A.errors).toEqual([]);
    await A.context.close();
    await expect.poll(async () => tubOf((await proposalDocs(F))[0])?.[1] ?? -9, { timeout: 30_000 }).toBeGreaterThan(-2.0);
  });
});

/**
 * Proposals ("Forslag") in local mode (docs/phase2-plan.md §5; Playwright never uses the real shared space): the
 * proposals menu, autosave across a reload, rename, delete with two confirmations, the Papirkurv, the status pill,
 * "Send forslaget", an old #d= link imported as a new proposal, and an old whole-project autosave turned into
 * proposals (Forslag D itself is always the bundled one) — a REAL phase-1 plain-visit autosave
 * (src/state/fixtures/phase1-autosave.plain-visit.json) brings none, an edited one is shown as its own proposal.
 *
 * Fix round after 2b, with the shared mode switched on (`hytte-planlegger:family-mode` = 'shared') but never the real
 * Firestore:
 *  - a `#f=` link whose id is not whole shows «Lenken til familiens plass er ikke hel …», starts no family (nothing
 *    stored, the broken link kept, the pill «Kun på denne enheten (familielenken er ikke hel)»), keeps a proposal made
 *    there on the device across a reload, and loads no Firebase at all;
 *  - after a switch to another family in the same tab (the hash changed), the proposals this device made in the old
 *    space are offered («Hent forslagene fra den forrige plassen»); accepting copies them in and puts the old ones in
 *    the old space's Papirkurv. The family space is an in-browser fake: the page's Firestore module
 *    (src/state/familyStore.firestore.ts, served by the dev server) is routed to the real module with
 *    `loadFirebaseAdapter` replaced by a store in localStorage (`FAKE_FIRESTORE`), which lasts across reloads; a
 *    write in one tab reaches the other tabs' listeners through the `storage` event.
 * Final fix round:
 *  - an old tab at the first space's link after the switch is no switch: the banner asks (last fix round: «Denne lenken
 *    går til en annen delt plass.» with «Bytt dit» / «Bli her», as for any other space), nothing offered, the stored
 *    family unchanged;
 *  - Angre right after «+ Nytt forslag» does not delete the proposal (making one is no undo step);
 *  - two tabs on the fake family space: B holds a drag while A saves, B lets go → conflict; «Lagre over» stores B's
 *    version and keeps A's under Tidligere versjoner (restored from there it comes back).
 * Last fix round (any other space asks first; «another device» is a second browser context whose documents are put
 * into this one's fake space):
 *  - a link pasted into the tab switches only after «Bytt dit» (the carry-over test);
 *  - a link to a space this device never used, with a proposal made on another device, asks with «Bytt dit»
 *    highlighted and says what both spaces hold; after «Bytt dit» in that tab, the tab left open in the old space says
 *    «Denne enheten har byttet delt plass i en annen fane.», saves nothing more and reloads in the new space;
 *  - a `&p=` link to another space offers «Hent «…» som en kopi hit» and never switches; the same link twice adds one
 *    copy; the other space keeps its proposal.
 * Fourth fix round:
 *  - the `&p=` banner offers «Bytt dit» too (highlighted like the space banner): a device in a space of its own takes a
 *    copy, edits it, then switches through the link; the family's proposal is shown and the edited copy is offered
 *    and brought along;
 *  - the tab left open after another tab's switch is read-only (no «+ Nytt forslag», no tools, the plan takes no edit);
 *  - an old proposal link to the space left whose proposal was carried here opens it here;
 *  - an empty link's space on a new device: the pill says «Ikke startet»; «Hva heter du?» never opens on its own while
 *    editing: a banner after a pause (the locked toast's «Nytt forslag»), and «+ Nytt forslag» asks for both names in
 *    one dialog (ui/Dialogs.tsx `promptNewProposal`).
 *
 * Screenshots: proposals-menu.png (the open menu), share-dialog.png (local "Send forslaget"), family-carry-over.png
 * (the offer after the switch), family-other-space.png (the banner for a link to another space).
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import LZString from 'lz-string';
import { createForslagD, SEED_REVISION } from '../src/model/seed/forslagD';
import { CURRENT_SCHEMA_VERSION } from '../src/model/types';
import type { DeckVertex, Project, Vec2 } from '../src/model/types';
import {
  activeVariant,
  collectPageErrors,
  createNewProposal,
  dismissToasts,
  dragPlan,
  type HytteWindow,
  loadAndWaitReady,
  planToClient,
  projectOnScreen,
  READY_TIMEOUT_MS,
  selectAt,
  shoot,
  skipFirstRun,
} from './helpers';

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
}

async function reloadReady(page: Page): Promise<void> {
  await page.reload();
  await waitReady(page);
}

/** A phase-1 style full share link payload (persistence.ts decodes it; importing persistence here would pull in JSON modules). */
function shareParam(project: Project): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify({ v: CURRENT_SCHEMA_VERSION, project }));
}

const names = async (page: Page) => (await projectOnScreen(page)).variants.map((v) => v.name);

/** localStorage 'hytte-planlegger:project' as the live phase-1 site left it after a plain visit (captured 12 Oct 2026). */
const PHASE1_AUTOSAVE = readFileSync(new URL('../src/state/fixtures/phase1-autosave.plain-visit.json', import.meta.url), 'utf8');

/** The old autosave in localStorage before the app starts (once: not after it was moved into the proposals). */
async function withOldAutosave(page: Page, json: string): Promise<void> {
  await page.addInitScript((text) => {
    if (!localStorage.getItem('hytte-planlegger:project.before-2b')) localStorage.setItem('hytte-planlegger:project', text);
  }, json);
}

/** localStorage key of the in-browser fake family space (a map from document path to its data). */
const FAKE_KEY = 'e2e-fake-firestore';

/**
 * Appended to the dev server's familyStore.firestore.ts (whose own `loadFirebaseAdapter` is renamed away): a
 * FirestoreAdapter on localStorage, so the shared mode runs without Firebase and keeps its documents across reloads.
 * `applyUpdate` is the module's own.
 */
const FAKE_FIRESTORE = `
const E2E_KEY = '${FAKE_KEY}';
const e2eEmitters = new Set();
const e2eLoad = () => { try { return JSON.parse(localStorage.getItem(E2E_KEY) || '{}'); } catch { return {}; } };
const e2eChildren = (docs, coll) => Object.keys(docs).filter((k) => k.startsWith(coll + '/') && !k.slice(coll.length + 1).includes('/')).map((k) => ({ id: k.slice(coll.length + 1), data: structuredClone(docs[k]) }));
export async function loadFirebaseAdapter() {
  const watchers = new Set();
  const emit = () => { const docs = e2eLoad(); for (const w of watchers) w.onNext(e2eChildren(docs, w.path), { fromCache: false, hasPendingWrites: false }); };
  e2eEmitters.add(emit);
  // Another tab of the same browser context wrote: its listeners hear it like the SDK's live listeners would.
  const onStorage = (e) => { if (e.key === E2E_KEY) emit(); };
  addEventListener('storage', onStorage);
  return {
    async signIn() {},
    watch(path, onNext) {
      const w = { path, onNext };
      watchers.add(w);
      setTimeout(() => { if (watchers.has(w)) onNext(e2eChildren(e2eLoad(), path), { fromCache: false, hasPendingWrites: false }); }, 0);
      return () => watchers.delete(w);
    },
    async read(path) { return e2eChildren(e2eLoad(), path); },
    async get(path) { const d = e2eLoad()[path]; return d ? structuredClone(d) : null; },
    write(ops) {
      const docs = e2eLoad();
      for (const op of ops) {
        if (op.kind === 'set') docs[op.path] = op.merge ? { ...(docs[op.path] || {}), ...structuredClone(op.data) } : structuredClone(op.data);
        else if (op.kind === 'update') {
          if (!docs[op.path]) return { acked: Promise.reject(Object.assign(new Error('not-found'), { code: 'not-found' })) };
          docs[op.path] = applyUpdate(docs[op.path], op);
        } else delete docs[op.path];
      }
      localStorage.setItem(E2E_KEY, JSON.stringify(docs));
      // Like the SDK: every listener has the write before the server's confirmation arrives.
      for (const e of e2eEmitters) queueMicrotask(e);
      return { acked: new Promise((r) => setTimeout(r, 0)) };
    },
    async waitForPendingWrites() {},
    dispose() { e2eEmitters.delete(emit); removeEventListener('storage', onStorage); watchers.clear(); },
  };
}
`;

/** Shared mode with the fake family space (see the header); fails the test if the module cannot be patched. */
async function withFakeFamilySpace(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('hytte-planlegger:family-mode', 'shared'));
  await page.route(/\/src\/state\/familyStore\.firestore\.ts(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const text = await response.text();
    const marker = 'export async function loadFirebaseAdapter(';
    if (!text.includes(marker)) throw new Error('familyStore.firestore.ts: loadFirebaseAdapter not found');
    await route.fulfill({ response, body: text.replace(marker, 'async function loadRealFirebaseAdapter(') + FAKE_FIRESTORE });
  });
}

/** Documents of the fake family space under `prefix`. */
async function fakeDocs(page: Page, prefix: string): Promise<Record<string, Record<string, unknown>>> {
  return page.evaluate(
    ([key, pre]) => {
      const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Record<string, unknown>>;
      return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(pre)));
    },
    [FAKE_KEY, prefix] as const,
  );
}

test.describe('proposals (local mode)', () => {
  test.beforeEach(async ({ page }) => skipFirstRun(page));

  test('create, edit, reload, rename, delete with two confirmations, restore from the Papirkurv', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await loadAndWaitReady(page);
    const pill = page.getByTestId('status-pill');
    await expect(pill).toHaveAttribute('data-state', 'local');
    await expect(pill).toHaveAttribute('aria-label', 'Kun på denne enheten (ingen delt plass satt opp)');

    // Create ("+ Nytt forslag" accepts the default name "Mitt forslag") and edit: the hot tub 2 m west.
    await createNewProposal(page);
    const id = (await activeVariant(page)).id;
    const tub0 = (await activeVariant(page)).outdoor.hotTubs[0].centre;
    await selectAt(page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [21.7, -3.2], [19.7, -3.2]);
    await expect.poll(async () => (await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(tub0[0] - 1.5);
    const tub1 = (await activeVariant(page)).outdoor.hotTubs[0].centre;

    // Saved on this device: a reload shows the same proposal, with the moved hot tub.
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect((await activeVariant(page)).id).toBe(id);
    expect((await activeVariant(page)).outdoor.hotTubs[0].centre).toEqual(tub1);

    // The menu: Forslag D first (Grunnlag), then the proposal with "sist endret …"; choosing switches.
    await page.getByTestId('proposals-menu').click();
    const items = page.getByTestId('proposals-list').locator('.proposal-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Forslag D');
    await expect(items.nth(0)).toContainText('Grunnlag');
    await expect(page.getByTestId(`proposal-item-${id}`)).toContainText(/Mitt forslag\s*sist endret i dag \d\d\.\d\d/);
    await shoot(page, testInfo, 'proposals-menu');
    await page.getByTestId('proposal-item-forslag-d').click();
    await expect.poll(async () => (await activeVariant(page)).id).toBe('forslag-d');
    await page.getByTestId('proposals-menu').click();
    await page.getByTestId(`proposal-item-${id}`).click();
    await expect.poll(async () => (await activeVariant(page)).id).toBe(id);

    // Rename.
    page.once('dialog', (d) => void d.accept('Hyttedrøm'));
    await page.getByTestId('rename-proposal').click();
    await expect(page.getByTestId('proposals-menu')).toContainText('Hyttedrøm');

    // Delete: asked twice; the second step says what happens.
    await page.getByTestId('delete-proposal').click();
    await expect(page.getByTestId('delete-step-1')).toHaveText('Vil du slette «Hyttedrøm»?');
    await page.getByTestId('delete-next').click();
    await expect(page.getByTestId('delete-step-2')).toContainText('Er du sikker? Forslaget forsvinner fra listen.');
    await expect(page.getByTestId('delete-step-2')).toContainText('Papirkurv i 30 dager');
    await page.getByTestId('delete-confirm').click();
    await expect.poll(() => names(page)).toEqual(['Forslag D']);
    await expect(page.getByTestId('toast').first()).toContainText('«Hyttedrøm» er lagt i Papirkurv.');

    // Gone after a reload too — but in the Papirkurv.
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect(await names(page)).toEqual(['Forslag D']);
    await page.getByTestId('more-menu').locator('summary').click();
    await page.getByTestId('more-trash').click();
    const row = page.getByTestId(`trash-item-${id}`);
    await expect(row).toContainText('Hyttedrøm');
    await expect(row).toContainText(/Slettet i dag \d\d\.\d\d · forsvinner om 30 dager/);
    await page.getByTestId(`trash-restore-${id}`).click();
    await expect(page.getByTestId('trash-panel')).toHaveCount(0);
    await expect.poll(() => names(page)).toEqual(['Forslag D', 'Hyttedrøm']);
    expect((await activeVariant(page)).id).toBe(id);
    expect((await activeVariant(page)).outdoor.hotTubs[0].centre).toEqual(tub1);
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect(await names(page)).toEqual(['Forslag D', 'Hyttedrøm']);

    // Send forslaget (local): a link with a copy of the proposal.
    await page.getByTestId('open-share').click();
    await expect(page.getByTestId('share-local-link')).toHaveValue(/#d=/);
    await shoot(page, testInfo, 'share-dialog');
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('an old #d= link opens as a new proposal; the same link again adds nothing', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const shared = createForslagD();
    const v = shared.variants[0];
    delete v.locked;
    v.name = 'Pappas forslag';
    v.notes = 'fra lenken';
    const hash = `#d=${shareParam(shared)}`;
    await page.goto(`/${hash}`);
    await waitReady(page);
    await expect.poll(() => names(page)).toEqual(['Forslag D', 'Pappas forslag']);
    const active = await activeVariant(page);
    expect(active).toMatchObject({ name: 'Pappas forslag', notes: 'fra lenken' });
    expect(active.locked).toBeUndefined();
    await expect(page.getByTestId('toast').first()).toContainText('«Pappas forslag» fra lenken er lagt til som et nytt forslag.');
    // The address bar no longer carries the link.
    expect(new URL(page.url()).hash).toBe('');
    await page.waitForTimeout(1200);
    await page.goto(`/${hash}`);
    await waitReady(page);
    expect(await names(page)).toEqual(['Forslag D', 'Pappas forslag']);
    expect(pageErrors).toEqual([]);
  });

  test('an autosave from before the shared proposals becomes proposals; Forslag D is the current bundled one', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    // A phase-2a autosave of an older seed revision whose (unlocked) working copy still has the old terrace from x 5.
    const old = createForslagD();
    old.seedRevision = SEED_REVISION - 1;
    delete old.variants[0].locked;
    const oldPoints: Vec2[] = [[5, -4.6], [23.2, -4.6], [23.2, 12.1], [9, 12.1], [9, 6.2], [20.8, 6.2], [20.8, -2], [16, -2], [16, 0], [9, 0], [9, -2], [5, -2]];
    old.variants[0].outdoor.decks[0].polygon = oldPoints.map((p, i): DeckVertex => ({ id: `deck-terrasse-v${i}`, p }));
    await page.addInitScript((json) => {
      if (!localStorage.getItem('hytte-planlegger:project.before-2b')) localStorage.setItem('hytte-planlegger:project', json);
    }, JSON.stringify(old));
    await loadAndWaitReady(page);
    const p = await projectOnScreen(page);
    expect(p.variants.map((v) => [v.name, v.locked === true])).toEqual([
      ['Forslag D', true],
      ['Forslag D (eget)', false],
    ]);
    expect(p.seedRevision).toBe(SEED_REVISION);
    const deckMinX = (i: number) => Math.min(...p.variants[i].outdoor.decks[0].polygon.map((q) => q.p[0]));
    expect(deckMinX(0)).toBe(9);
    expect(deckMinX(1)).toBe(5);
    // The old key is retired (kept as a backup), so a reload does not import it twice.
    expect(await page.evaluate(() => [localStorage.getItem('hytte-planlegger:project'), localStorage.getItem('hytte-planlegger:project.before-2b') !== null])).toEqual([null, true]);
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect(await names(page)).toEqual(['Forslag D', 'Forslag D (eget)']);
    await expect(page.getByText('Forslag D er oppdatert')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('a real phase-1 autosave: a plain visit brings no proposal; an edited one is its own proposal, shown', async ({ page, context }) => {
    const pageErrors = collectPageErrors(page);
    await withOldAutosave(page, PHASE1_AUTOSAVE);
    await loadAndWaitReady(page);
    expect(await names(page)).toEqual(['Forslag D']);
    expect(await page.evaluate(() => [localStorage.getItem('hytte-planlegger:project'), localStorage.getItem('hytte-planlegger:project.before-2b')])).toEqual([
      null,
      PHASE1_AUTOSAVE,
    ]);

    // Another device whose phase-1 working copy was edited (a room renamed).
    const edited = JSON.parse(PHASE1_AUTOSAVE) as { updatedAt: string; variants: { rooms: { name: string }[] }[] };
    edited.updatedAt = '2026-10-01T08:30:00.000Z';
    edited.variants[0].rooms[0].name = 'Omdøpt rom';
    await page.close();
    const other = await context.newPage();
    const otherErrors = collectPageErrors(other);
    await other.goto('/');
    await other.evaluate((text) => {
      localStorage.clear();
      localStorage.setItem('hytte-planlegger:first-run-seen', '1');
      localStorage.setItem('hytte-planlegger:install-card-seen', '1');
      localStorage.setItem('hytte-planlegger:project', text);
    }, JSON.stringify(edited));
    await other.reload();
    await waitReady(other);
    const p = await projectOnScreen(other);
    expect(p.variants.map((v) => v.name)).toEqual(['Forslag D', 'Forslag D (eget)']);
    expect(p.variants[1].id).toMatch(/^forslag-d-eget-/);
    expect(p.activeVariantId).toBe(p.variants[1].id);
    expect(p.variants[1].rooms[0].name).toBe('Omdøpt rom');
    expect([...pageErrors, ...otherErrors]).toEqual([]);
  });
});

test.describe('family links (shared mode, never the real Firestore)', () => {
  test.beforeEach(async ({ page }) => skipFirstRun(page));

  test('a #f= link that is not whole shows the banner and starts no family; the proposals stay on the device', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const remote: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).hostname !== 'localhost' && /googleapis|firebase|gstatic/.test(r.url())) remote.push(r.url());
    });
    await page.addInitScript(() => localStorage.setItem('hytte-planlegger:family-mode', 'shared'));
    await page.goto('/#f=e2e-tooshort');
    await waitReady(page);
    const banner = page.getByTestId('family-link-invalid');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Lenken til familiens plass er ikke hel');
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'noFamily');
    expect(await page.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBeNull();
    expect(new URL(page.url()).hash, 'the broken link stays (a reload must not start a family either)').toBe('#f=e2e-tooshort');

    // A proposal made here is kept on this device, also across a reload with the same broken link.
    await createNewProposal(page);
    const id = (await activeVariant(page)).id;
    await page.waitForTimeout(1500);
    await reloadReady(page);
    expect((await projectOnScreen(page)).variants.map((v) => v.id)).toContain(id);
    await expect(page.getByTestId('family-link-invalid')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBeNull();
    expect(remote, 'no Firebase request').toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('after a switch to another family in the same tab, the proposals made here in the old space are offered and brought along', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await withFakeFamilySpace(page);
    // A name is set, so «Hva heter du?» (the first save in a shared space) does not cover the banners.
    await page.addInitScript(() => localStorage.setItem('hytte-planlegger:my-name', 'Mamma'));
    const F1 = 'e2e-carry-over-family-one-0123';
    const F2 = 'e2e-carry-over-family-two-4567';
    await page.goto(`/#f=${F1}`);
    await waitReady(page);
    // A new device at the link of an empty space: nothing is stored there yet (fourth fix round: never «Lagret»).
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'notStarted');
    page.once('dialog', (d) => void d.accept('Mammas idé'));
    await page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(page)).name).toBe('Mammas idé');
    const id = (await activeVariant(page)).id;
    // Saved in the first space (after the 1 s debounce) and recorded as made on this device.
    await expect.poll(async () => Object.keys(await fakeDocs(page, `families/${F1}/proposals/`))).toContain(`families/${F1}/proposals/${id}`);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hytte-planlegger:family.created') ?? '{}'))).toMatchObject({ [F1]: [id] });

    // The other family's link pasted into this tab: never a switch on its own (last fix round). The banner says what
    // both spaces hold; the link's space is empty, so «Bli her» is the highlighted button. «Bytt dit» reloads in that
    // space and remembers the old one.
    await page.evaluate((f) => (window.location.hash = `#f=${f}`), F2);
    const ask = page.getByTestId('other-family-banner');
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('Denne lenken går til en annen delt plass.');
    await expect(ask).toContainText('Plassen i lenken har ingen forslag (er lenken hel?); plassen du bruker nå har 1.');
    await expect(ask).toHaveAttribute('data-primary', 'stay');
    expect(await page.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(F1);
    await Promise.all([page.waitForEvent('load'), page.getByTestId('other-family-switch').click()]);
    await waitReady(page);
    expect(await page.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(F2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hytte-planlegger:family.previous') ?? '[]'))).toContain(F1);
    expect((await projectOnScreen(page)).variants.map((v) => v.name)).toEqual(['Forslag D']);
    const offer = page.getByTestId('carry-over-banner');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('«Mammas idé»');
    await shoot(page, testInfo, 'family-carry-over');

    await page.getByTestId('carry-over-accept').click();
    await expect(offer).toHaveCount(0);
    await expect(page.getByTestId('toast').filter({ hasText: 'hentet fra den forrige plassen' })).toBeVisible();
    await expect.poll(async () => (await projectOnScreen(page)).variants.map((v) => v.name)).toEqual(['Forslag D', 'Mammas idé']);
    // In the new space now; in the old one it lies in the Papirkurv.
    await expect.poll(async () => Object.keys(await fakeDocs(page, `families/${F2}/proposals/`)).length).toBe(1);
    const old = (await fakeDocs(page, `families/${F1}/proposals/`))[`families/${F1}/proposals/${id}`];
    expect(old?.deletedAt, 'the old copy is in the old space\'s Papirkurv').toBeTruthy();
    // Not offered again.
    await reloadReady(page);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('carry-over-banner')).toHaveCount(0);

    // Final fix round: an old tab still at the first space's link is opened again (iOS reloads old Safari tabs). It
    // is no switch: the device stays in F2, nothing is offered, and the banner asks (last fix round: the same banner
    // as for any other space).
    page.once('dialog', (d) => void d.accept('Ny idé i familien'));
    await page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(page)).name).toBe('Ny idé i familien');
    await expect.poll(async () => Object.keys(await fakeDocs(page, `families/${F2}/proposals/`)).length).toBe(2);
    const oldTab = await page.context().newPage();
    const oldTabErrors = collectPageErrors(oldTab);
    await withFakeFamilySpace(oldTab);
    await oldTab.goto(`/#f=${F1}`);
    await waitReady(oldTab);
    const left = oldTab.getByTestId('other-family-banner');
    await expect(left).toBeVisible();
    await expect(left).toContainText('Denne lenken går til en annen delt plass.');
    await expect.poll(async () => (await projectOnScreen(oldTab)).variants.map((v) => v.name)).toEqual(['Forslag D', 'Mammas idé', 'Ny idé i familien']);
    await oldTab.waitForTimeout(500);
    await expect(oldTab.getByTestId('carry-over-banner')).toHaveCount(0);
    expect(await oldTab.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(F2);
    expect(new URL(oldTab.url()).hash, 'the link stays until the user answers').toBe(`#f=${F1}`);
    await oldTab.getByTestId('other-family-stay').click();
    await expect(left).toHaveCount(0);
    await expect.poll(() => new URL(oldTab.url()).hash.startsWith(`#f=${F2}`)).toBe(true);
    // Fourth fix round: the old link to «Mammas idé» in the space left (it was carried here, keeping its id) opens it
    // here, with no question.
    await oldTab.goto(`/#f=${F1}&p=${id}`);
    await waitReady(oldTab);
    await expect.poll(async () => (await activeVariant(oldTab)).id).toBe(id);
    await expect(oldTab.getByTestId('toast').filter({ hasText: '«Mammas idé» fra lenken finnes alt i listen.' })).toBeVisible();
    await expect(oldTab.getByTestId('other-family-banner')).toHaveCount(0);
    await expect.poll(() => new URL(oldTab.url()).hash).toBe(`#f=${F2}&p=${id}`);
    // Nothing left the family space.
    const inF2 = await fakeDocs(oldTab, `families/${F2}/proposals/`);
    expect(Object.values(inF2).map((d) => d.deletedAt ?? null)).toEqual([null, null]);
    await oldTab.close();
    expect([...pageErrors, ...oldTabErrors]).toEqual([]);
  });

  /** Mamma's device (its own storage: a second browser context) made `proposal` in `family`; returns those documents. */
  async function otherDeviceMade(browser: Browser, testInfo: TestInfo, family: string, proposal: string): Promise<{ id: string; docs: Record<string, Record<string, unknown>> }> {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1400, height: 900 } });
    const p = await context.newPage();
    const errors = collectPageErrors(p);
    await skipFirstRun(p);
    await withFakeFamilySpace(p);
    await p.addInitScript(() => localStorage.setItem('hytte-planlegger:my-name', 'Mamma'));
    await p.goto(`/#f=${family}`);
    await waitReady(p);
    p.once('dialog', (d) => void d.accept(proposal));
    await p.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(p)).name).toBe(proposal);
    const id = (await activeVariant(p)).id;
    await expect.poll(async () => Object.keys(await fakeDocs(p, `families/${family}/proposals/`))).toContain(`families/${family}/proposals/${id}`);
    const docs = await fakeDocs(p, `families/${family}`);
    expect(errors).toEqual([]);
    await context.close();
    return { id, docs };
  }

  /** This device (Pappa) in `family`, with `proposal` made here and saved. */
  async function deviceWith(page: Page, family: string, proposal: string): Promise<string> {
    await withFakeFamilySpace(page);
    await page.addInitScript(() => localStorage.setItem('hytte-planlegger:my-name', 'Pappa'));
    await page.goto(`/#f=${family}`);
    await waitReady(page);
    page.once('dialog', (d) => void d.accept(proposal));
    await page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(page)).name).toBe(proposal);
    const id = (await activeVariant(page)).id;
    await expect.poll(async () => Object.keys(await fakeDocs(page, `families/${family}/proposals/`))).toContain(`families/${family}/proposals/${id}`);
    expect(await page.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(family);
    return id;
  }

  /** Documents another device wrote, put into this browser's fake family space. */
  async function addFakeDocs(page: Page, docs: Record<string, Record<string, unknown>>): Promise<void> {
    await page.evaluate(
      ([key, add]) => {
        const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(key, JSON.stringify({ ...all, ...add }));
      },
      [FAKE_KEY, docs] as const,
    );
  }

  test('a link to a space this device never used asks first, with «Bytt dit» highlighted; the tab left open stops saving', async ({ page, browser }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    const FA = 'e2e-never-used-family-a-01234567';
    const FB = 'e2e-never-used-family-b-01234567';
    const mamma = await otherDeviceMade(browser, testInfo, FB, 'Mammas idé');
    await deviceWith(page, FA, 'Pappas plan');
    await addFakeDocs(page, mamma.docs);

    // A second tab opens Mamma's family link: no switch at start-up. The banner says what both spaces hold; only the
    // link's space has proposals made on other devices, so «Bytt dit» is the highlighted button.
    const tab2 = await page.context().newPage();
    const tab2Errors = collectPageErrors(tab2);
    await withFakeFamilySpace(tab2);
    await tab2.goto(`/#f=${FB}`);
    await waitReady(tab2);
    const ask = tab2.getByTestId('other-family-banner');
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('Denne lenken går til en annen delt plass.');
    await expect(ask).toContainText('Plassen i lenken har 1 forslag (Mamma); plassen du bruker nå har 1.');
    await expect(ask).toHaveAttribute('data-primary', 'switch');
    await expect(tab2.getByTestId('other-family-switch')).toHaveClass(/btn-primary/);
    await expect(tab2.getByTestId('other-family-stay')).not.toHaveClass(/btn-primary/);
    await shoot(tab2, testInfo, 'family-other-space');
    expect(await tab2.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(FA);
    expect((await projectOnScreen(tab2)).variants.map((v) => v.name)).toEqual(['Forslag D', 'Pappas plan']);
    await tab2.waitForTimeout(300);
    await expect(tab2.getByTestId('carry-over-banner')).toHaveCount(0);

    // «Bytt dit»: tab 2 reloads in FB, which shows Mamma's proposal, and offers to bring «Pappas plan» along.
    await Promise.all([tab2.waitForEvent('load'), tab2.getByTestId('other-family-switch').click()]);
    await waitReady(tab2);
    expect(await tab2.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(FB);
    await expect.poll(async () => (await projectOnScreen(tab2)).variants.map((v) => v.name)).toEqual(['Forslag D', 'Mammas idé']);
    await expect(tab2.getByTestId('carry-over-banner')).toContainText('«Pappas plan»');

    // Tab 1, still open in FA, hears it (the storage event): it says so, and saves nothing more.
    await page.bringToFront();
    const elsewhere = page.getByTestId('family-elsewhere-banner');
    await expect(elsewhere).toBeVisible();
    await expect(elsewhere).toContainText('Denne enheten har byttet delt plass i en annen fane.');
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'elsewhere');
    // Read-only until it is reloaded (fourth fix round): no «+ Nytt forslag», no tools, a drag only pans.
    await expect(page.getByTestId('new-proposal')).toHaveCount(0);
    await expect(page.getByTestId('toolbar')).toHaveCount(0);
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'false');
    const tubBefore = (await activeVariant(page)).outdoor.hotTubs[0].centre;
    await dragPlan(page, [tubBefore[0], tubBefore[1]], [tubBefore[0] - 2, tubBefore[1]]);
    await page.waitForTimeout(2000);
    expect((await activeVariant(page)).outdoor.hotTubs[0].centre, 'no edit in the stopped tab').toEqual(tubBefore);
    const namesIn = async (f: string) => Object.values(await fakeDocs(page, `families/${f}/proposals/`)).map((d) => d.name);
    expect(await namesIn(FA), 'nothing new in the space left').toEqual(['Pappas plan']);
    expect(await namesIn(FB)).toEqual(['Mammas idé']);
    // «Last på nytt»: tab 1 reloads in the space the device uses now.
    await Promise.all([page.waitForEvent('load'), page.getByTestId('family-elsewhere-reload').click()]);
    await waitReady(page);
    expect(new URL(page.url()).hash.startsWith(`#f=${FB}`)).toBe(true);
    await expect.poll(async () => (await projectOnScreen(page)).variants.map((v) => v.name)).toContain('Mammas idé');
    await expect(page.getByTestId('family-elsewhere-banner')).toHaveCount(0);
    await tab2.close();
    expect([...pageErrors, ...tab2Errors]).toEqual([]);
  });

  test('a link to one proposal in another space offers it as a copy here (or «Bytt dit»), never switches on its own', async ({ page, browser }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    const FA = 'e2e-proposal-link-family-a-0123';
    const FB = 'e2e-proposal-link-family-b-0123';
    const mamma = await otherDeviceMade(browser, testInfo, FB, 'Mammas idé');
    await deviceWith(page, FA, 'Pappas plan');
    await addFakeDocs(page, mamma.docs);

    // Mamma's «Send forslaget» link (#f=FB&p=<id>) opened in this tab.
    await page.evaluate(([f, p]) => (window.location.hash = `#f=${f}&p=${p}`), [FB, mamma.id] as const);
    const ask = page.getByTestId('other-family-banner');
    await expect(ask).toBeVisible();
    await expect(ask).toHaveAttribute('data-kind', 'proposal');
    await expect(ask).toContainText('Denne lenken går til «Mammas idé» i en annen delt plass.');
    await expect(ask).toContainText('Plassen i lenken har 1 forslag (Mamma); plassen du bruker nå har 1.');
    await expect(ask).toContainText('(plassen du bruker nå, byttes ikke) eller bytte dit.');
    // Fourth fix round: «Bytt dit» too, highlighted as on the space banner (proposals by others there, none here).
    await expect(ask).toHaveAttribute('data-primary', 'switch');
    await expect(page.getByTestId('other-family-switch')).toHaveClass(/btn-primary/);
    const copy = page.getByTestId('other-family-copy');
    await expect(copy).toHaveText('Hent «Mammas idé» som en kopi hit');
    await expect(copy).not.toHaveClass(/btn-primary/);
    await copy.click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByTestId('toast').filter({ hasText: '«Mammas idé» er hentet som en kopi.' })).toBeVisible();
    await expect.poll(async () => (await projectOnScreen(page)).variants.map((v) => v.name)).toEqual(['Forslag D', 'Pappas plan', 'Mammas idé']);
    const copied = (await activeVariant(page)).id;
    expect(copied, 'a copy with its own id').not.toBe(mamma.id);
    // No switch, nothing offered, the address bar shows this space; the copy is saved here, FB keeps its proposal.
    expect(await page.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(FA);
    await expect.poll(() => new URL(page.url()).hash).toBe(`#f=${FA}&p=${copied}`);
    await expect(page.getByTestId('carry-over-banner')).toHaveCount(0);
    await expect.poll(async () => Object.keys(await fakeDocs(page, `families/${FA}/proposals/`)).length).toBe(2);
    const inFB = Object.values(await fakeDocs(page, `families/${FB}/proposals/`));
    expect(inFB.map((d) => [d.name, d.deletedAt ?? null])).toEqual([['Mammas idé', null]]);

    // The same link again adds no second copy.
    await page.evaluate(([f, p]) => (window.location.hash = `#f=${f}&p=${p}`), [FB, mamma.id] as const);
    await expect(ask).toBeVisible();
    await page.getByTestId('other-family-copy').click();
    await expect(page.getByTestId('toast').filter({ hasText: '«Mammas idé» fra lenken finnes alt i listen.' })).toBeVisible();
    expect((await projectOnScreen(page)).variants.map((v) => v.name)).toEqual(['Forslag D', 'Pappas plan', 'Mammas idé']);
    expect(pageErrors).toEqual([]);
  });

  /** The hot tub's centre in a fake-space proposal document (the project is JSON text). */
  const tubOfDoc = (d: Record<string, unknown> | undefined): number[] | null =>
    typeof d?.project === 'string' ? ((JSON.parse(d.project) as Project).variants[0]?.outdoor.hotTubs[0]?.centre ?? null) : null;

  test('a device in a space of its own joins through a proposal link; the copy it edited comes along (fourth fix round)', async ({ page, browser }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    const FB = 'e2e-own-space-family-b-0123456';
    const mamma = await otherDeviceMade(browser, testInfo, FB, 'Mammas idé');
    // Pappa opened the plain address first (an old bookmark): a space of his own, empty.
    await withFakeFamilySpace(page);
    await page.addInitScript(() => localStorage.setItem('hytte-planlegger:my-name', 'Pappa'));
    await page.goto('/');
    await waitReady(page);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced');
    const own = await page.evaluate(() => localStorage.getItem('hytte-planlegger:family'));
    if (!own) throw new Error('no space of its own');
    await addFakeDocs(page, mamma.docs);

    // Mamma's «Send forslaget» link: proposals by others there, none here, so «Bytt dit» is highlighted. He takes a copy.
    await page.evaluate(([f, p]) => (window.location.hash = `#f=${f}&p=${p}`), [FB, mamma.id] as const);
    const ask = page.getByTestId('other-family-banner');
    await expect(ask).toHaveAttribute('data-primary', 'switch');
    await expect(ask).toContainText('Plassen i lenken har 1 forslag (Mamma); plassen du bruker nå har ingen.');
    await page.getByTestId('other-family-copy').click();
    await expect(ask).toHaveCount(0);
    const copy = (await activeVariant(page)).id;
    const copyDoc = `families/${own}/proposals/${copy}`;
    await dismissToasts(page);
    // He edits the copy (the hot tub 2 m west); it is saved in his own space.
    await selectAt(page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [21.7, -3.2], [19.7, -3.2]);
    await expect.poll(async () => (await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(20.2);
    const moved = (await activeVariant(page)).outdoor.hotTubs[0].centre;
    await expect.poll(async () => tubOfDoc((await fakeDocs(page, copyDoc))[copyDoc])).toEqual(moved);

    // The proposal link again, and «Bytt dit»: the family's space, with Mamma's proposal on screen …
    await page.evaluate(([f, p]) => (window.location.hash = `#f=${f}&p=${p}`), [FB, mamma.id] as const);
    await expect(ask).toHaveAttribute('data-primary', 'switch');
    await Promise.all([page.waitForEvent('load'), page.getByTestId('other-family-switch').click()]);
    await waitReady(page);
    expect(await page.evaluate(() => localStorage.getItem('hytte-planlegger:family'))).toBe(FB);
    await expect.poll(async () => (await activeVariant(page)).id).toBe(mamma.id);
    // … and the edited copy is offered (highlighted: his old space has nobody else's proposals) and brought along.
    const offer = page.getByTestId('carry-over-banner');
    await expect(offer).toContainText('«Mammas idé»');
    await expect(page.getByTestId('carry-over-accept')).toHaveClass(/btn-primary/);
    await page.getByTestId('carry-over-accept').click();
    await expect(offer).toHaveCount(0);
    await expect.poll(async () => (await projectOnScreen(page)).variants.map((v) => v.name)).toEqual(['Forslag D', 'Mammas idé', 'Mammas idé (delt)']);
    expect((await projectOnScreen(page)).variants.find((v) => v.id === copy)?.outdoor.hotTubs[0].centre).toEqual(moved);
    await expect.poll(async () => Object.keys(await fakeDocs(page, `families/${FB}/proposals/`)).filter((k) => !k.includes('/revisions/')).length).toBe(2);
    await expect.poll(async () => (await fakeDocs(page, copyDoc))[copyDoc]?.deletedAt ?? null, 'in his old space\'s Papirkurv').toBeTruthy();
    expect(pageErrors).toEqual([]);
  });

  test('«Hva heter du?» never opens on its own while editing: a banner after a pause; the pill of an empty space (fourth fix round)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const F = 'e2e-name-banner-family-0123456';
    await withFakeFamilySpace(page);
    // A new device, no name, a link to an empty space: asked first, and the pill is neutral.
    await page.goto(`/#f=${F}`);
    await waitReady(page);
    await expect(page.getByTestId('empty-family-banner')).toBeVisible();
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'notStarted');
    await expect(page.getByTestId('status-pill')).toHaveAttribute('aria-label', 'Ikke startet – plassen i lenken er tom');
    // An editing tool on Forslag D: the locked toast; its «Nytt forslag» asks for no name.
    await page.getByTestId('tool-wall').click({ force: true });
    await page.getByTestId('toast-new-proposal').click();
    await expect.poll(async () => (await projectOnScreen(page)).variants.length).toBe(2);
    const id = (await activeVariant(page)).id;
    await expect(page.getByTestId('empty-family-banner')).toHaveCount(0);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced');
    await dismissToasts(page);
    // Editing right away: the hot tub dragged twice, 1.5 s apart. No dialog, no banner meanwhile.
    await selectAt(page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [21.7, -3.2], [20.7, -3.2]);
    await page.waitForTimeout(1500);
    await dragPlan(page, [20.7, -3.2], [19.7, -3.2]);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('name-dialog')).toHaveCount(0);
    await expect(page.getByTestId('name-banner')).toHaveCount(0);
    expect((await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(20.2);
    // Left alone: the banner (not a dialog). «Skriv navnet» opens the prompt.
    const banner = page.getByTestId('name-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText('Hva heter du?');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await page.getByTestId('name-banner-write').click();
    await page.getByTestId('name-input').fill('Pappa');
    await page.getByTestId('name-save').click();
    await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('hytte-planlegger:my-name'))).toBe('Pappa');
    // The next save carries the name.
    await selectAt(page, [19.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [19.7, -3.2], [19.7, -2.2]);
    const doc = `families/${F}/proposals/${id}`;
    await expect.poll(async () => (await fakeDocs(page, doc))[doc]?.updatedBy).toBe('Pappa');
    expect(pageErrors).toEqual([]);
  });

  test('«+ Nytt forslag» while the name is unknown asks for both names in one dialog (fourth fix round)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const F = 'e2e-name-dialog-family-0123456';
    await withFakeFamilySpace(page);
    await page.goto(`/#f=${F}`);
    await waitReady(page);
    let native = false;
    page.once('dialog', (d) => {
      native = true;
      void d.dismiss();
    });
    await page.getByTestId('new-proposal').click();
    const dialog = page.getByTestId('new-proposal-dialog');
    await expect.poll(async () => native || (await dialog.count()) > 0).toBe(true);
    expect(native, 'the top bar opens the two-field dialog, not the browser prompt').toBe(false);
    await expect(dialog).toContainText('Navn på forslaget');
    await expect(dialog).toContainText('Hva heter du?');
    await page.getByTestId('new-proposal-name').fill('Pappas idé');
    await page.getByTestId('new-proposal-person').fill('Pappa');
    await page.getByTestId('new-proposal-create').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await activeVariant(page)).name).toBe('Pappas idé');
    const id = (await activeVariant(page)).id;
    const doc = `families/${F}/proposals/${id}`;
    // The first save already carries the name; nothing asks again.
    await expect.poll(async () => (await fakeDocs(page, doc))[doc]?.createdBy).toBe('Pappa');
    await page.waitForTimeout(4500);
    await expect(page.getByTestId('name-banner')).toHaveCount(0);
    await expect(page.getByTestId('name-dialog')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('conflicts and undo (final fix round after 2b)', () => {
  test.beforeEach(async ({ page }) => skipFirstRun(page));

  test('Angre right after «+ Nytt forslag» does not delete the new proposal', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await loadAndWaitReady(page);
    await createNewProposal(page);
    const id = (await activeVariant(page)).id;
    // Making a proposal is no undo step: Angre has nothing to undo, and Ctrl+Z leaves the proposal.
    await expect(page.getByTestId('undo')).toBeDisabled();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect((await projectOnScreen(page)).variants.map((v) => v.id)).toContain(id);
    expect((await activeVariant(page)).id).toBe(id);
    // An edit after it is undone on its own; the proposal stays.
    const tub0 = (await activeVariant(page)).outdoor.hotTubs[0].centre;
    await selectAt(page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [21.7, -3.2], [19.7, -3.2]);
    await expect.poll(async () => (await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(tub0[0] - 1.5);
    await page.getByTestId('undo').click();
    await expect.poll(async () => (await activeVariant(page)).outdoor.hotTubs[0].centre).toEqual(tub0);
    await expect(page.getByTestId('undo')).toBeDisabled();
    expect((await activeVariant(page)).id).toBe(id);
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect((await projectOnScreen(page)).variants.map((v) => v.id)).toContain(id);
    expect(pageErrors).toEqual([]);
  });

  test('a conflict resolved with «Lagre over» keeps the other version under Tidligere versjoner (fake family space)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await withFakeFamilySpace(page);
    // A name is set (both tabs share it), so «Hva heter du?» does not cover the plan.
    await page.addInitScript(() => localStorage.setItem('hytte-planlegger:my-name', 'Mamma'));
    const F = 'e2e-conflict-family-0123456789abc';
    await page.goto(`/#f=${F}`);
    await waitReady(page);
    // A new device at the link of an empty space: nothing is stored there yet (fourth fix round: never «Lagret»).
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'notStarted');
    page.once('dialog', (d) => void d.accept('Felles'));
    await page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(page)).name).toBe('Felles');
    const id = (await activeVariant(page)).id;
    const doc = `families/${F}/proposals/${id}`;
    const tubIn = (d: Record<string, unknown> | undefined): number[] | null =>
      typeof d?.project === 'string' ? ((JSON.parse(d.project) as Project).variants[0]?.outdoor.hotTubs[0]?.centre ?? null) : null;
    await expect.poll(async () => tubIn((await fakeDocs(page, doc))[doc])).toEqual([21.7, -3.2]);

    // A second tab is a second device for the sync (its own memory), on the same fake family space.
    const other = await page.context().newPage();
    const otherErrors = collectPageErrors(other);
    await withFakeFamilySpace(other);
    await other.goto(`/#f=${F}&p=${id}`);
    await waitReady(other);
    await expect(other.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced');
    await expect.poll(async () => (await activeVariant(other)).id).toBe(id);

    // B holds a drag of the hot tub (2 m west, not let go) while A moves it 2 m north and saves. (A tab in the
    // background gets no animation frames: each tab is brought to the front before it is used.)
    await selectAt(other, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    const [bx0, by0] = await planToClient(other, [21.7, -3.2]);
    const [bx1, by1] = await planToClient(other, [19.7, -3.2]);
    await other.mouse.move(bx0, by0);
    await other.mouse.down();
    for (let i = 1; i <= 10; i++) await other.mouse.move(bx0 + ((bx1 - bx0) * i) / 10, by0 + ((by1 - by0) * i) / 10);
    await page.bringToFront();
    await selectAt(page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [21.7, -3.2], [21.7, -1.2]);
    await expect.poll(async () => tubIn((await fakeDocs(page, doc))[doc])?.[1] ?? -9).toBeGreaterThan(-1.7);
    const theirs = tubIn((await fakeDocs(page, doc))[doc]);
    await other.bringToFront();
    await other.waitForTimeout(600);
    await other.mouse.up();

    // B: a conflict, and the banner says what each button keeps.
    const banner = other.getByTestId('conflict-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('«Lagre over» legger den andre utgaven der.');
    await expect(other.getByTestId('status-pill')).toHaveAttribute('data-state', 'conflict');
    await other.getByTestId('conflict-overwrite').click();
    await expect(banner).toHaveCount(0);
    // B's version is stored; A's is a revision (within 5 minutes of the first one).
    await expect.poll(async () => tubIn((await fakeDocs(page, doc))[doc])?.[0] ?? 99).toBeLessThan(20.2);
    const revs = Object.values(await fakeDocs(page, `${doc}/revisions/`)).map(tubIn);
    expect(revs, 'the other version is kept').toContainEqual(theirs);
    // A sees B's version.
    await expect.poll(async () => (await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(20.2);
    await other.bringToFront();

    // Tidligere versjoner on B lists it; restoring the newest brings A's version back.
    await other.getByTestId('more-menu').locator('summary').click();
    await other.getByTestId('more-revisions').click();
    const items = other.getByTestId('revision-item');
    await expect.poll(() => items.count()).toBeGreaterThanOrEqual(2);
    other.once('dialog', (d) => void d.accept());
    await items.first().getByRole('button').click();
    await expect.poll(async () => (await activeVariant(other)).outdoor.hotTubs[0].centre).toEqual(theirs);
    expect([...pageErrors, ...otherErrors]).toEqual([]);
    await other.close();
  });
});

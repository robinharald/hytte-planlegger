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
 *    `loadFirebaseAdapter` replaced by a store in localStorage (`FAKE_FIRESTORE`), which lasts across reloads.
 *
 * Screenshots: proposals-menu.png (the open menu), share-dialog.png (local "Send forslaget"), family-carry-over.png
 * (the offer after the switch).
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import LZString from 'lz-string';
import { createForslagD, SEED_REVISION } from '../src/model/seed/forslagD';
import { CURRENT_SCHEMA_VERSION } from '../src/model/types';
import type { DeckVertex, Project, Vec2 } from '../src/model/types';
import {
  activeVariant,
  collectPageErrors,
  createNewProposal,
  dragPlan,
  type HytteWindow,
  loadAndWaitReady,
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
        if (op.kind === 'set') docs[op.path] = structuredClone(op.data);
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
    dispose() { e2eEmitters.delete(emit); watchers.clear(); },
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
    const F1 = 'e2e-carry-over-family-one-0123';
    const F2 = 'e2e-carry-over-family-two-4567';
    await page.goto(`/#f=${F1}`);
    await waitReady(page);
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'synced');
    page.once('dialog', (d) => void d.accept('Mammas idé'));
    await page.getByTestId('new-proposal').click();
    await expect.poll(async () => (await activeVariant(page)).name).toBe('Mammas idé');
    const id = (await activeVariant(page)).id;
    // Saved in the first space (after the 1 s debounce) and recorded as made on this device.
    await expect.poll(async () => Object.keys(await fakeDocs(page, `families/${F1}/proposals/`))).toContain(`families/${F1}/proposals/${id}`);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hytte-planlegger:family.created') ?? '{}'))).toMatchObject({ [F1]: [id] });

    // The other family's link pasted into this tab: the app reloads in that space and remembers the old one.
    await Promise.all([page.waitForEvent('load'), page.evaluate((f) => (window.location.hash = `#f=${f}`), F2)]);
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
    expect(pageErrors).toEqual([]);
  });
});

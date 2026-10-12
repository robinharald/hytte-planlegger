// @vitest-environment jsdom
/**
 * Fix round after 2b, the family link in shared mode (appStore.ts) on the fake Firestore (familyStore.fake.ts, through
 * a mock of familyStore.firestore.ts's `loadFirebaseAdapter`; one fake "server", a new device per page load):
 *  - a link to another family (at start-up or opened in the same tab) never switches on its own: the banner asks
 *    («Bytt dit» / «Bli her», saying what each space holds); «Bytt dit» remembers the current family BEFORE switching;
 *  - after «Bytt dit», the proposals this device created in the previous space are offered («Hent forslagene fra den
 *    forrige plassen»): accepted, they are copied into the new space and put in the old space's Papirkurv;
 *  - a link to one proposal in another space never switches: «Hent … som en kopi hit» copies it here;
 *  - another tab switching this device to another space stops this tab's saving (`storage` event);
 *  - a link's space with no proposals on a device without a family is stored only once it is started;
 *  - a `#f=` whose id is not whole never starts a new family: the stored one is used (banner), or, on a device
 *    without one, the proposals stay on this device until a whole link is opened (then they move into the family);
 *  - the one-time move of an old autosave shows the proposal it had on screen and keeps its own time; a real
 *    phase-1 plain-visit autosave brings nothing into the family space.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createForslagD, SEED_VARIANT_ID } from '../model/seed/forslagD';
import { pillState } from '../ui/familyUi';
import { FAMILY_KEYS } from './familyStore';
import { createFakeFirestore } from './familyStore.fake';
import type { FakeFirestore } from './familyStore.fake';
import { createFirestoreFamilyStore } from './familyStore.firestore';
import { createLocalFamilyStore, LOCAL_KEYS } from './familyStore.local';
import { KEYS } from './persistence';
import phase1Text from './fixtures/phase1-autosave.plain-visit.json?raw';

const firebase: { fake: FakeFirestore } = { fake: createFakeFirestore() };

vi.mock('./familyStore.firestore', async (importOriginal) => {
  const real = await importOriginal<typeof import('./familyStore.firestore')>();
  return { ...real, loadFirebaseAdapter: async () => firebase.fake.device().adapter };
});

const F1 = 'e2e-family-one-abcdefghijklmnop';
const F2 = 'e2e-family-two-abcdefghijklmnop';

type AppStoreModule = typeof import('./appStore');
let stop: (() => void) | null = null;

/** A page load with `hash` in the address bar (shared mode); waits until the family store answered. */
async function load(hash: string, opts: { shared?: boolean } = {}): Promise<AppStoreModule> {
  stop?.();
  stop = null;
  window.history.replaceState(null, '', `/${hash}`);
  vi.resetModules();
  const m = await import('./appStore');
  stop = m.startPersistence();
  const shared = opts.shared ?? true;
  await vi.waitFor(() => expect(m.familyUiStore.getState()).toMatchObject({ phase: 'ready', mode: shared ? 'shared' : 'local' }), { timeout: 4000 });
  return m;
}

/** Another device saves new proposals named `names` into `family` (made by `by`); returns their ids. */
async function othersMake(family: string, proposalNames: string[], by = 'Mamma'): Promise<string[]> {
  const seed = createForslagD();
  const store = createFirestoreFamilyStore({
    adapter: firebase.fake.device().adapter,
    familyId: family,
    storage: null,
    context: () => ({ site: seed.site, seedRevision: seed.seedRevision }),
  });
  const ids: string[] = [];
  for (const n of proposalNames) ids.push((await store.createProposal(seed.variants[0], n, { by })).id);
  await store.flush();
  store.dispose();
  return ids;
}

/** «Bytt dit» on the banner, then the reload it asks for (jsdom cannot navigate): a new page load at `#f=<id>`. */
async function switchThere(m: AppStoreModule): Promise<AppStoreModule> {
  const target = m.familyUiStore.getState().otherFamily?.id;
  if (!target) throw new Error('no other-family banner');
  m.switchToLinkedFamily();
  expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(target);
  await m.flushProposals();
  return load(`#f=${target}`);
}

const docPath = (family: string, id: string) => `families/${family}/proposals/${id}`;
const proposalDocs = (family: string) => [...firebase.fake.docs.keys()].filter((k) => k.startsWith(`families/${family}/proposals/`) && !k.includes('/revisions/'));
const names = (m: AppStoreModule) => m.appStore.getState().project.variants.map((v) => v.name);

beforeEach(() => {
  localStorage.clear();
  firebase.fake = createFakeFirestore();
  vi.stubEnv('VITE_FAMILY_STORE', 'shared');
  vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom: "Not implemented: navigation" on reload
});

afterEach(() => {
  stop?.();
  stop = null;
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('family link (shared mode)', () => {
  it('a link to another family opened in the same tab asks first; «Bytt dit» remembers the current family', async () => {
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    const m = await load(`#f=${F1}`);
    expect(m.familyId).toBe(F1);
    window.location.hash = `#f=${F2}`;
    await vi.waitFor(() => expect(m.familyUiStore.getState().otherFamily?.id).toBe(F2));
    // Nothing is stored or offered until the user chooses.
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F1);
    expect(localStorage.getItem(FAMILY_KEYS.previousFamilies)).toBeNull();
    expect(localStorage.getItem(FAMILY_KEYS.switchedFrom)).toBeNull();
    m.switchToLinkedFamily();
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F2);
    expect(JSON.parse(localStorage.getItem(FAMILY_KEYS.previousFamilies) ?? 'null')).toEqual([F1]);
    expect(localStorage.getItem(FAMILY_KEYS.switchedFrom)).toBe(F1);
  });

  it('after a switch, the proposals this device made in the previous space are offered and brought along', async () => {
    // The plain address first: this device's own family F1, with a proposal.
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    let m = await load('');
    const id = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mammas idé');
    if (!id) throw new Error('duplicate');
    await m.flushProposals();
    await vi.waitFor(() => expect(proposalDocs(F1)).toEqual([docPath(F1, id)]));
    expect(JSON.parse(localStorage.getItem(FAMILY_KEYS.createdHere) ?? 'null')).toEqual({ [F1]: [id] });

    // Then the family link (a new page load): F2 is asked about; «Bytt dit», and the proposal from F1 is offered.
    m = await load(`#f=${F2}`);
    expect(m.familyId).toBe(F1);
    m = await switchThere(m);
    expect(m.familyId).toBe(F2);
    await vi.waitFor(() => expect(m.familyUiStore.getState().carryOver).toEqual({ from: F1, names: ['Mammas idé'] }), { timeout: 4000 });
    expect(await m.acceptCarryOver()).toBe(1);
    expect(names(m)).toEqual(['Forslag D', 'Mammas idé']);
    expect(m.familyUiStore.getState().carryOver).toBeNull();
    expect(m.appStore.getState().toasts.map((t) => t.text)).toContain('Forslaget er hentet fra den forrige plassen.');
    await vi.waitFor(() => expect(proposalDocs(F2)).toEqual([docPath(F2, id)]));
    // In the old space it is in the Papirkurv (30 days), not gone.
    await vi.waitFor(() => expect(firebase.fake.docs.get(docPath(F1, id))?.deletedAt).toEqual(expect.any(String)));
    expect(localStorage.getItem(FAMILY_KEYS.switchedFrom)).toBeNull();

    // The next start offers nothing again.
    m = await load(`#f=${F2}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(m.familyUiStore.getState().carryOver).toBeNull();
  });

  it('a link that is not whole keeps the family this device has, and says so', async () => {
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    const m = await load('#f=e2e-tooshort');
    expect(m.familyId).toBe(F1);
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F1);
    expect(m.familyUiStore.getState().notices).toContain('family-link-invalid');
    expect(window.location.hash).toBe(`#f=${F1}`);
  });

  it('a link that is not whole on a device without a family: no family is made; kept here until a whole link', async () => {
    const m = await load('#f=e2e-tooshort', { shared: false });
    expect(m.familyMode).toBe('shared');
    expect(m.familyId).toBeNull();
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBeNull();
    expect(m.familyUiStore.getState().notices).toContain('family-link-invalid');
    expect(pillState(m.familyUiStore.getState())).toBe('noFamily');
    expect(window.location.hash).toBe('#f=e2e-tooshort');
    const id = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Laget her');
    await m.flushProposals();
    const here = createLocalFamilyStore({ storage: localStorage });
    expect(here.currentList().proposals.map((p) => p.id)).toEqual([id]);
    here.dispose();
    expect([...firebase.fake.docs.keys()]).toEqual([]);

    // The whole link to an empty space: asked first («Denne plassen er tom. Er lenken hel?»), nothing moved or stored.
    const m2 = await load(`#f=${F2}`);
    expect(m2.familyId).toBe(F2);
    await vi.waitFor(() => expect(m2.familyUiStore.getState().emptyFamily).toBe(true));
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBeNull();
    await settle();
    expect(proposalDocs(F2)).toEqual([]);
    // «Begynn her»: stored, and the proposal moves into the family space.
    m2.startEmptyFamily();
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F2);
    expect(m2.familyUiStore.getState().emptyFamily).toBe(false);
    await vi.waitFor(() => expect(names(m2)).toEqual(['Forslag D', 'Laget her']));
    await vi.waitFor(() => expect(proposalDocs(F2)).toEqual([docPath(F2, id!)]));
    await vi.waitFor(() => expect(localStorage.getItem(LOCAL_KEYS.proposals)).toBeNull());
  });

  it('a broken link pasted into the tab: the family stays and a banner says so', async () => {
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    const m = await load(`#f=${F1}`);
    window.location.hash = '#f=e2e-cut';
    await vi.waitFor(() => expect(m.familyUiStore.getState().notices).toContain('family-link-invalid'));
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F1);
    expect(window.location.hash).toBe(`#f=${F1}`);
  });
});

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe('the old autosave moved into the family space (shared mode)', () => {
  it('a real phase-1 plain-visit autosave brings nothing into the family space, and is retired', async () => {
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    localStorage.setItem(KEYS.project, phase1Text);
    const m = await load('');
    await m.flushProposals();
    await new Promise((r) => setTimeout(r, 30));
    expect(names(m)).toEqual(['Forslag D']);
    expect(proposalDocs(F1)).toEqual([]);
    expect(localStorage.getItem(KEYS.project)).toBeNull();
    expect(localStorage.getItem(KEYS.projectBeforeFamily)).toBe(phase1Text);
  });

  it('an edited one: its proposal is shown and keeps the autosave’s own time as «sist endret»', async () => {
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    const raw = JSON.parse(phase1Text) as Record<string, unknown> & { variants: Record<string, unknown>[] };
    raw.updatedAt = '2026-10-01T08:30:00.000Z';
    (raw.variants[0].rooms as { name: string }[])[0].name = 'Omdøpt rom';
    localStorage.setItem(KEYS.project, JSON.stringify(raw));
    const m = await load('');
    await vi.waitFor(() => expect(names(m)).toEqual(['Forslag D', 'Forslag D (eget)']));
    const p = m.appStore.getState().project;
    const id = p.variants[1].id;
    expect(id).toMatch(/^forslag-d-eget-/);
    expect(p.activeVariantId).toBe(id);
    await m.flushProposals();
    await vi.waitFor(() => expect(firebase.fake.docs.get(docPath(F1, id))?.updatedAt).toBe('2026-10-01T08:30:00.000Z'));
    expect(m.familyUiStore.getState().meta[id]?.updatedAt).toBe('2026-10-01T08:30:00.000Z');
  });
});

describe('final fix round: links to a space this device left, carried-in copies, trailing punctuation, local upgrade', () => {
  const F3 = 'e2e-family-three-abcdefghijklm';
  const settleMs = settle;

  /** F1: «Mammas idé» made here; then the F2 link: it is brought along; then «Ny idé i familien» made in F2. */
  async function switchedToF2(): Promise<{ m: AppStoreModule; mammas: string; ny: string }> {
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    let m = await load(`#f=${F1}`);
    const mammas = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mammas idé');
    if (!mammas) throw new Error('duplicate');
    await m.flushProposals();
    await vi.waitFor(() => expect(proposalDocs(F1)).toEqual([docPath(F1, mammas)]));
    m = await switchThere(await load(`#f=${F2}`));
    await vi.waitFor(() => expect(m.familyUiStore.getState().carryOver?.names).toEqual(['Mammas idé']), { timeout: 4000 });
    expect(await m.acceptCarryOver()).toBe(1);
    const ny = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Ny idé i familien');
    if (!ny) throw new Error('duplicate');
    await m.flushProposals();
    await vi.waitFor(() => expect(proposalDocs(F2).sort()).toEqual([docPath(F2, mammas), docPath(F2, ny)].sort()));
    return { m, mammas, ny };
  }

  it('1: an old tab reloaded at the space this device left: no switch, no offer; «Bli her» shows this space', async () => {
    const { mammas, ny } = await switchedToF2();
    // The old tab (address #f=F1) is reloaded.
    const m = await load(`#f=${F1}`);
    expect(m.familyId).toBe(F2);
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F2);
    expect(m.familyUiStore.getState().otherFamily?.id).toBe(F1);
    await vi.waitFor(() => expect(names(m).sort()).toEqual(['Forslag D', 'Mammas idé', 'Ny idé i familien'].sort()));
    await settleMs();
    expect(m.familyUiStore.getState().carryOver).toBeNull();
    expect(localStorage.getItem(FAMILY_KEYS.switchedFrom)).toBeNull();
    // The family space keeps both proposals; nothing went to the old space.
    expect(firebase.fake.docs.get(docPath(F2, mammas))?.deletedAt).toBeNull();
    expect(firebase.fake.docs.get(docPath(F2, ny))?.deletedAt).toBeNull();
    expect(firebase.fake.docs.has(docPath(F1, ny))).toBe(false);
    // The link stays in the address bar until the user answers; «Bli her» puts this space back.
    expect(window.location.hash).toBe(`#f=${F1}`);
    m.stayInFamily();
    expect(m.familyUiStore.getState().otherFamily).toBeNull();
    expect(window.location.hash.startsWith(`#f=${F2}`)).toBe(true);
    // The same link pasted into the open tab: the banner again, no switch.
    window.location.hash = `#f=${F1}`;
    await vi.waitFor(() => expect(m.familyUiStore.getState().otherFamily?.id).toBe(F1));
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F2);
  });

  it('1: «Bytt dit» back to a space left offers only what this device made in the space it leaves; remembered', async () => {
    await switchedToF2();
    let m = await load(`#f=${F1}`);
    expect(m.familyUiStore.getState().otherFamily?.id).toBe(F1);
    m.switchToLinkedFamily();
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F1);
    expect(JSON.parse(localStorage.getItem(FAMILY_KEYS.previousFamilies) ?? '[]')).toEqual([F2]);
    // The reload: F1 again. Only «Ny idé i familien» (made here in F2) is offered, never «Mammas idé» (brought into F2).
    m = await load(`#f=${F1}`);
    expect(m.familyId).toBe(F1);
    expect(m.familyUiStore.getState().otherFamily).toBeNull();
    await vi.waitFor(() => expect(m.familyUiStore.getState().carryOver?.names).toEqual(['Ny idé i familien']), { timeout: 4000 });
    m.declineCarryOver();
    expect(proposalDocs(F2)).toHaveLength(2);
    // And the family link F2 is a link to another space again: asked, never switched silently.
    m = await load(`#f=${F2}`);
    expect(m.familyId).toBe(F1);
    expect(m.familyUiStore.getState().otherFamily?.id).toBe(F2);
  });

  it('1: a switch to a space never used here offers only what was made in the space left, never copies brought into it', async () => {
    const { ny } = await switchedToF2();
    expect(JSON.parse(localStorage.getItem(FAMILY_KEYS.createdHere) ?? '{}')[F2]).toEqual([ny]);
    let m = await load(`#f=${F3}`);
    expect(m.familyId).toBe(F2);
    expect(m.familyUiStore.getState().carryOver).toBeNull();
    m = await switchThere(m);
    expect(m.familyId).toBe(F3);
    await vi.waitFor(() => expect(m.familyUiStore.getState().carryOver?.names).toEqual(['Ny idé i familien']), { timeout: 4000 });
    m.declineCarryOver();
  });

  it('6: a family link with a full stop after it opens the family (no broken-link banner)', async () => {
    const m = await load(`#f=${F2}.`);
    expect(m.familyId).toBe(F2);
    expect(m.familyUiStore.getState().notices).not.toContain('family-link-invalid');
    expect(window.location.hash).toBe(`#f=${F2}`);
  });

  it('7c: local mode — the proposal of the old autosave stays on screen after a reload', async () => {
    vi.stubEnv('VITE_FAMILY_STORE', 'local');
    const raw = JSON.parse(phase1Text) as Record<string, unknown> & { variants: Record<string, unknown>[] };
    (raw.variants[0].rooms as { name: string }[])[0].name = 'Omdøpt rom';
    localStorage.setItem(KEYS.project, JSON.stringify(raw));
    let m = await load('', { shared: false });
    const id = m.appStore.getState().project.activeVariantId;
    expect(names(m)).toEqual(['Forslag D', 'Forslag D (eget)']);
    expect(id).toMatch(/^forslag-d-eget-/);
    expect(localStorage.getItem(KEYS.project)).toBeNull();
    m = await load('', { shared: false });
    expect(m.appStore.getState().project.activeVariantId).toBe(id);
  });
});

describe('last fix round: links to another space ask first; a proposal link copies; other tabs; empty spaces', () => {
  /** 32 characters, like a generated family id. */
  const G = 'e2e-generated-0123456789abcdefgh';

  it('a: a never-used space at start-up is no switch: the banner says what each holds, «Bytt dit» highlighted for the family', async () => {
    // This device's own space F1 holds only its own proposal; F2 (the family) holds two made on other devices.
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    let m = await load(`#f=${F1}`);
    const mine = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Pappas plan');
    await m.flushProposals();
    await vi.waitFor(() => expect(proposalDocs(F1)).toEqual([docPath(F1, mine!)]));
    await othersMake(F2, ['Mammas idé', 'Hytte 2']);
    m = await load(`#f=${F2}`);
    expect(m.familyId).toBe(F1);
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F1);
    expect(localStorage.getItem(FAMILY_KEYS.switchedFrom)).toBeNull();
    expect(localStorage.getItem(FAMILY_KEYS.previousFamilies)).toBeNull();
    await vi.waitFor(() =>
      expect(m.familyUiStore.getState().otherFamily).toEqual({
        id: F2,
        proposal: null,
        info: { count: 2, names: ['Mamma'], others: true, hereCount: 1, hereOthers: false, proposalName: null },
      }),
    );
    await settle();
    expect(m.familyUiStore.getState().carryOver).toBeNull();
    expect(names(m)).toEqual(['Forslag D', 'Pappas plan']);
    expect(window.location.hash).toBe(`#f=${F2}`);
  });

  it('b: a link to one proposal in another space never switches; «Hent … som en kopi hit» copies it here', async () => {
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    let m = await load(`#f=${F1}`);
    const plan = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Pappas plan');
    await m.flushProposals();
    await vi.waitFor(() => expect(proposalDocs(F1)).toEqual([docPath(F1, plan!)]));
    const [x] = await othersMake(F2, ['Mammas idé']);
    m = await load(`#f=${F2}&p=${x}`);
    expect(m.familyId).toBe(F1);
    await vi.waitFor(() => expect(m.familyUiStore.getState().otherFamily?.info?.proposalName).toBe('Mammas idé'));
    expect(m.familyUiStore.getState().otherFamily?.proposal).toBe(x);
    // Never a switch from a proposal link, and nothing offered to move out of F1.
    m.switchToLinkedFamily();
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F1);
    await settle();
    expect(m.familyUiStore.getState().carryOver).toBeNull();
    expect(m.copyLinkedProposal()).toBe(true);
    expect(m.familyUiStore.getState().otherFamily).toBeNull();
    const copy = m.appStore.getState().project.activeVariantId;
    expect(copy).not.toBe(x);
    expect(names(m)).toEqual(['Forslag D', 'Pappas plan', 'Mammas idé']);
    expect(m.appStore.getState().toasts.map((t) => t.text)).toContain('«Mammas idé» er hentet som en kopi.');
    expect(window.location.hash).toBe(`#f=${F1}&p=${copy}`);
    await m.flushProposals();
    await vi.waitFor(() => expect(proposalDocs(F1).sort()).toEqual([docPath(F1, plan!), docPath(F1, copy)].sort()));
    // The other space is untouched; the copy counts as brought in (never offered to move out of F1).
    expect(firebase.fake.docs.get(docPath(F2, x))?.deletedAt).toBeNull();
    expect(JSON.parse(localStorage.getItem(FAMILY_KEYS.carriedIn) ?? '{}')[F1]).toEqual([copy]);
    // The same link again adds nothing twice.
    window.location.hash = `#f=${F2}&p=${x}`;
    await vi.waitFor(() => expect(m.familyUiStore.getState().otherFamily?.info?.proposalName).toBe('Mammas idé'));
    expect(m.copyLinkedProposal()).toBe(true);
    expect(names(m)).toEqual(['Forslag D', 'Pappas plan', 'Mammas idé']);
  });

  it('d: another tab switches this device to another space: this tab says so and saves nothing more', async () => {
    localStorage.setItem(FAMILY_KEYS.familyId, F1);
    const m = await load(`#f=${F1}`);
    const id = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Før byttet');
    await m.flushProposals();
    await vi.waitFor(() => expect(proposalDocs(F1)).toEqual([docPath(F1, id!)]));
    // The other tab chose «Bytt dit» to F2 (it writes the family key; this tab hears the storage event).
    localStorage.setItem(FAMILY_KEYS.familyId, F2);
    window.dispatchEvent(new StorageEvent('storage', { key: FAMILY_KEYS.familyId, oldValue: F1, newValue: F2 }));
    expect(m.familyUiStore.getState().elsewhere).toBe(true);
    expect(pillState(m.familyUiStore.getState())).toBe('elsewhere');
    await settle();
    const written = firebase.fake.writes;
    m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Ny i gammel fane');
    await m.flushProposals();
    await settle(1200);
    expect(firebase.fake.writes).toBe(written);
    expect(proposalDocs(F1)).toEqual([docPath(F1, id!)]);
    // «Last på nytt» opens the space this device uses now (no question about the old link).
    m.reloadInCurrentFamily();
    expect(window.location.hash).toBe(`#f=${F2}`);
  });

  it('2: a generated id with one trailing «_» or «-» opens that id; another link to an empty space is asked about', async () => {
    let m = await load(`#f=${G}_`);
    expect(m.familyId).toBe(G);
    expect(window.location.hash).toBe(`#f=${G}`);
    m = await load(`#f=${G}-`);
    expect(m.familyId).toBe(G);
    // A device without a family, an empty space: nothing stored until the user starts it (or makes a proposal there).
    await vi.waitFor(() => expect(m.familyUiStore.getState().emptyFamily).toBe(true));
    expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBeNull();
    const id = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Første forslag');
    await m.flushProposals();
    await vi.waitFor(() => expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(G));
    expect(m.familyUiStore.getState().emptyFamily).toBe(false);
    expect(proposalDocs(G)).toEqual([docPath(G, id!)]);
    // A space with proposals is stored at once (no question).
    localStorage.clear();
    await othersMake(F2, ['Mammas idé']);
    m = await load(`#f=${F2}`);
    await vi.waitFor(() => expect(localStorage.getItem(FAMILY_KEYS.familyId)).toBe(F2));
    expect(m.familyUiStore.getState().emptyFamily).toBe(false);
  });
});

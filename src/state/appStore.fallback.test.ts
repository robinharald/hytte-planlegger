// @vitest-environment jsdom
/**
 * Shared mode when Firebase cannot be loaded (appStore.ts `connectShared` / `startFallback`): the app keeps working on
 * this device — the proposals go to the local store and the pill says «Kun på denne enheten (familiens plass kan ikke
 * nås nå)» — and as soon as the family space answers, what was kept here is saved there and the local copy is
 * removed. Also at the next start: proposals left in the local store are brought into the family space.
 *
 * Firebase itself is replaced by the fake Firestore (familyStore.fake.ts) through a mock of familyStore.firestore.ts
 * whose `loadFirebaseAdapter` fails as often as the test says; the app runs in shared mode through VITE_FAMILY_STORE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED_VARIANT_ID } from '../model/seed/forslagD';
import { pillState } from '../ui/familyUi';
import { nb } from '../i18n/nb';
import { createFakeFirestore } from './familyStore.fake';
import type { FakeFirestore } from './familyStore.fake';
import { createLocalFamilyStore, LOCAL_KEYS } from './familyStore.local';

const firebase: { fake: FakeFirestore; failures: number; loads: number } = { fake: createFakeFirestore(), failures: 0, loads: 0 };

vi.mock('./familyStore.firestore', async (importOriginal) => {
  const real = await importOriginal<typeof import('./familyStore.firestore')>();
  return {
    ...real,
    loadFirebaseAdapter: async () => {
      firebase.loads++;
      if (firebase.failures > 0) {
        firebase.failures--;
        throw new Error('Firebase blocked');
      }
      return firebase.fake.device().adapter;
    },
  };
});


type AppStoreModule = typeof import('./appStore');
let app: AppStoreModule | null = null;
let stop: (() => void) | null = null;

async function startApp(failures: number): Promise<AppStoreModule> {
  firebase.failures = failures;
  firebase.loads = 0;
  vi.resetModules();
  app = await import('./appStore');
  stop = app.startPersistence();
  const m = app;
  await vi.waitFor(() => expect(m.familyUiStore.getState().phase).toBe('ready'), { timeout: 4000 });
  return app;
}

const pill = (m: AppStoreModule) => nb.family.pill[pillState(m.familyUiStore.getState())];
const proposalDocs = (familyId: string) => [...firebase.fake.docs.keys()].filter((k) => k.startsWith(`families/${familyId}/proposals/`) && !k.includes('/revisions/'));

beforeEach(() => {
  localStorage.clear();
  firebase.fake = createFakeFirestore();
  vi.stubEnv('VITE_FAMILY_STORE', 'shared');
});

afterEach(() => {
  stop?.();
  stop = null;
  app = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('shared mode without Firebase (fallback to this device)', () => {
  it('keeps working here with «Kun på denne enheten …», then saves into the family space when it answers', async () => {
    const m = await startApp(1);
    expect(m.familyMode).toBe('shared');
    expect(m.familyId).toMatch(/^[A-Za-z0-9_-]{24,64}$/);
    expect(firebase.loads).toBe(1);
    expect(m.familyUiStore.getState()).toMatchObject({ fallback: true, mode: 'local', phase: 'ready' });
    expect(pill(m)).toBe('Kun på denne enheten (familiens plass kan ikke nås nå)');

    // Everything else keeps working: a new proposal is saved on this device.
    const id = m.appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mitt forslag');
    await m.flushProposals();
    const here = createLocalFamilyStore({ storage: localStorage });
    expect(here.currentList().proposals.map((p) => p.id)).toEqual([id]);
    here.dispose();
    expect(proposalDocs(m.familyId!)).toEqual([]);

    // The device comes online (or 15 s pass): Firebase loads, the proposal goes to the family space, the local copy
    // is removed.
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(m.familyUiStore.getState()).toMatchObject({ fallback: false, mode: 'shared', phase: 'ready' }), { timeout: 4000 });
    await m.flushProposals();
    await vi.waitFor(() => expect(proposalDocs(m.familyId!)).toEqual([`families/${m.familyId}/proposals/${id}`]), { timeout: 4000 });
    await vi.waitFor(() => expect(localStorage.getItem(LOCAL_KEYS.proposals)).toBeNull(), { timeout: 4000 });
    expect(firebase.loads).toBe(2);
    expect(m.appStore.getState().project.variants.map((v) => v.name)).toEqual(['Forslag D', 'Mitt forslag']);
    expect(pill(m)).toBe(nb.family.pill.synced);
  });

  it('at the next start, proposals left on this device are brought into the family space', async () => {
    const local = createLocalFamilyStore({ storage: localStorage });
    const seed = (await import('../model/seed/forslagD')).createForslagD().variants[0];
    const kept = { ...seed, id: 'kept-here', name: 'Laget uten nett' };
    delete kept.locked;
    await local.saveProposal(kept, { base: null, by: null });
    local.dispose();
    expect(localStorage.getItem(LOCAL_KEYS.proposals)).not.toBeNull();

    const m = await startApp(0);
    await m.flushProposals();
    expect(m.familyUiStore.getState()).toMatchObject({ fallback: false, mode: 'shared' });
    await vi.waitFor(() => expect(proposalDocs(m.familyId!)).toEqual([`families/${m.familyId}/proposals/kept-here`]), { timeout: 4000 });
    expect(m.appStore.getState().project.variants.map((v) => v.name)).toEqual(['Forslag D', 'Laget uten nett']);
    await vi.waitFor(() => expect(localStorage.getItem(LOCAL_KEYS.proposals)).toBeNull(), { timeout: 4000 });
  });
});

// @vitest-environment jsdom
/**
 * The app singleton (appStore.ts) in local mode (tests never use Firestore): bootstrap (Forslag D + the stored
 * proposals, the old autosave turned into proposals, a #d= link imported, #f= without a shared space), the family
 * sync through `startPersistence` (autosave of proposals, delete → Papirkurv → restore, revisions), links, files and
 * versions imported as proposals, the read-only view kept for the banners.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createForslagD, SEED_REVISION, SEED_VARIANT_ID } from '../model/seed/forslagD';
import type { Project } from '../model/types';
import { FAMILY_KEYS } from './familyStore';
import { createLocalFamilyStore, LOCAL_KEYS } from './familyStore.local';
import {
  acceptExternalChange,
  activateProposal,
  appStore,
  applyImportedProject,
  deleteProposal,
  familyId,
  familyMode,
  familyShareLinks,
  familyUiStore,
  fetchNewSeed,
  flushProposals,
  freshSeedProject,
  importProjectAsProposals,
  keepOwnChanges,
  leaveSharedView,
  listRevisions,
  makeMyOwnCopy,
  myName,
  noticeStore,
  openSharedLink,
  resetToSeed,
  restoreFromTrash,
  restoreVersion,
  saveNamedVersion,
  seedUpdateAvailable,
  setMyName,
  sharedVariantsFor,
  shareLinkFor,
  showReadOnly,
  startPersistence,
  storage,
} from './appStore';
import { encodeShare, KEYS, listVersions, saveVersion, shareParamFromHash } from './persistence';
import { makeTestProject, makeVariant } from './testProject';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function settle(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await tick();
}

let stopPersistence: (() => void) | null = null;
async function persist(): Promise<void> {
  stopPersistence = startPersistence();
  await settle();
}
afterEach(() => {
  stopPersistence?.();
  stopPersistence = null;
});

const names = (p: Project = appStore.getState().project) => p.variants.map((v) => v.name);
const start = appStore.getState().project;

beforeEach(() => {
  localStorage.clear();
  leaveSharedView();
  appStore.getState().replaceProject(start, { readOnly: false, source: 'local' });
  noticeStore.setState({ notices: [], external: null });
  familyUiStore.setState({ askName: false, notices: [] });
});

/** What a fresh local store reads from localStorage (= after a reload). */
function storedProposals() {
  const s = createLocalFamilyStore({ storage: localStorage });
  const list = s.currentList();
  s.dispose();
  return list;
}

describe('bootstrap', () => {
  it('tests run in local mode: Forslag D (locked) with its own project id and the current seed revision', () => {
    expect(familyMode).toBe('local');
    expect(familyId).toBeNull();
    expect(storage).toBe(localStorage);
    expect(start.variants.map((v) => [v.id, v.locked])).toEqual([[SEED_VARIANT_ID, true]]);
    expect(start.seedRevision).toBe(SEED_REVISION);
    expect(freshSeedProject().id).not.toBe(start.id);
    expect(familyUiStore.getState()).toMatchObject({ mode: 'local', phase: 'ready', familyId: null });
    expect(seedUpdateAvailable(start, 0)).toBe(false);
  });

  it('an old autosave becomes proposals (stored, then retired); a #d= link is imported and shown; #f= says no shared space', async () => {
    const old = createForslagD();
    old.variants.push({ ...makeVariant('v-old', 'Mitt gamle forslag') });
    const working = { ...old.variants[0], notes: 'arbeid' };
    delete working.locked;
    old.variants.push({ ...working, id: 'kopi-d', name: 'Forslag D' });
    localStorage.setItem(KEYS.project, JSON.stringify(old));
    const shared = makeTestProject({ variants: [makeVariant('s-1', 'Fra Pappa')], activeVariantId: 's-1' });
    window.location.hash = `#d=${encodeShare(shared, { allVariants: false })}&f=short`;
    vi.resetModules();
    const fresh = await import('./appStore');
    window.location.hash = '';
    const p = fresh.appStore.getState().project;
    expect(names(p)).toEqual(['Forslag D', 'Mitt gamle forslag', 'Forslag D (eget)', 'Fra Pappa']);
    expect(p.activeVariantId).toBe(p.variants[3].id);
    expect(p.variants.slice(1).every((v) => v.locked === undefined)).toBe(true);
    expect(localStorage.getItem(KEYS.project)).toBeNull();
    expect(localStorage.getItem(KEYS.projectBeforeFamily)).not.toBeNull();
    expect(storedProposals().proposals.map((x) => x.name)).toEqual(['Mitt gamle forslag', 'Forslag D (eget)', 'Fra Pappa']);
    expect(fresh.appStore.getState().toasts.map((t) => t.text)).toEqual(['«Fra Pappa» fra lenken er lagt til som et nytt forslag.']);
    expect(fresh.familyUiStore.getState().notices).toEqual(['family-unavailable']);
    expect(fresh.familyUiStore.getState().meta[p.variants[1].id]?.name).toBe('Mitt gamle forslag');
  });

  it('a reload shows the proposal that was on screen', async () => {
    await persist();
    const id = appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mitt forslag');
    await flushProposals();
    expect(localStorage.getItem(`${FAMILY_KEYS.activeProposal}:local`)).toBe(id);
    vi.resetModules();
    const fresh = await import('./appStore');
    expect(fresh.appStore.getState().project.activeVariantId).toBe(id);
  });
});

describe('proposals through the family store (local)', () => {
  it('"Nytt forslag" and edits are saved; the menu metadata follows', async () => {
    await persist();
    const id = appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mitt forslag');
    if (!id) throw new Error('duplicate');
    await flushProposals();
    await settle();
    expect(storedProposals().proposals.map((p) => p.name)).toEqual(['Mitt forslag']);
    expect(familyUiStore.getState().meta[id]).toMatchObject({ name: 'Mitt forslag', deletedAt: null });
    appStore.getState().renameVariant(id, 'Hyttedrøm');
    appStore.getState().updateVariant(id, (v) => {
      v.notes = 'notat';
    });
    await flushProposals();
    const stored = storedProposals().proposals[0];
    expect(stored).toMatchObject({ name: 'Hyttedrøm' });
    expect(stored.variant.notes).toBe('notat');
    // The first change after the proposal was made keeps the made version as a revision.
    expect((await listRevisions(id)).map((r) => r.name)).toEqual(['Mitt forslag']);
    // Forslag D is never stored.
    expect(localStorage.getItem(LOCAL_KEYS.proposals) ?? '').not.toContain('"forslag-d":');
  });

  it('delete → Papirkurv (toast with Angre) → restore from the Papirkurv shows it again', async () => {
    await persist();
    const id = appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mitt forslag');
    if (!id) throw new Error('duplicate');
    await flushProposals();
    deleteProposal(id);
    expect(names()).toEqual(['Forslag D']);
    expect(appStore.getState().toasts.at(-1)).toMatchObject({ text: '«Mitt forslag» er lagt i Papirkurv.', undo: true });
    await flushProposals();
    await settle();
    expect(familyUiStore.getState().trash.map((t) => t.id)).toEqual([id]);
    expect(storedProposals().proposals).toEqual([]);
    expect(await restoreFromTrash(id)).toBe(true);
    expect(appStore.getState().project.activeVariantId).toBe(id);
    await settle();
    expect(familyUiStore.getState().trash).toEqual([]);
    expect(storedProposals().proposals.map((p) => p.id)).toEqual([id]);
    // Angre after a delete brings it back too.
    deleteProposal(id);
    await flushProposals();
    appStore.getState().undo();
    await flushProposals();
    expect(storedProposals().proposals.map((p) => p.id)).toEqual([id]);
    // Forslag D cannot be deleted.
    deleteProposal(SEED_VARIANT_ID);
    expect(names()).toContain('Forslag D');
  });

  it('the display name is stored on the device', () => {
    expect(myName()).toBeNull();
    setMyName(' Mamma ');
    expect(myName()).toBe('Mamma');
    expect(localStorage.getItem(FAMILY_KEYS.myName)).toBe('Mamma');
  });
});

describe('links', () => {
  it('a #d= link pasted into an open tab is added once and shown; a broken one is flagged', async () => {
    await persist();
    const shared = makeTestProject({ variants: [makeVariant('s-1', 'Forslag D')], activeVariantId: 's-1' });
    const encoded = encodeShare(shared, { allVariants: false });
    openSharedLink(encoded);
    expect(names()).toEqual(['Forslag D', 'Forslag D (delt)']);
    expect(appStore.getState().canUndo).toBe(false);
    const id = appStore.getState().project.activeVariantId;
    activateProposal(SEED_VARIANT_ID);
    openSharedLink(encoded);
    expect(names()).toEqual(['Forslag D', 'Forslag D (delt)']);
    expect(appStore.getState().project.activeVariantId).toBe(id);
    expect(appStore.getState().toasts.at(-1)?.text).toBe('«Forslag D (delt)» fra lenken finnes alt i listen.');
    openSharedLink('garbage');
    expect(noticeStore.getState().notices).toContain('link-invalid');
    await flushProposals();
    expect(storedProposals().proposals.map((p) => p.name)).toEqual(['Forslag D (delt)']);
  });

  it('local mode: no family links; shareLinkFor builds a #d= copy', () => {
    expect(familyShareLinks(SEED_VARIANT_ID)).toBeNull();
    const link = shareLinkFor(makeTestProject(), false);
    expect(shareParamFromHash(new URL(link.url).hash)).not.toBeNull();
  });

  it('sharedVariantsFor gives new ids and numbered " (delt)" names', () => {
    const own = makeTestProject({ variants: [makeVariant('v-1', 'A'), makeVariant('v-2', 'A (delt)')] });
    const shared = makeTestProject({ variants: [makeVariant('v-1', 'A'), makeVariant('v-9', 'B')], activeVariantId: 'v-9' });
    const { variants, activeId } = sharedVariantsFor(own, shared, '2026-10-12T08:00:00.000Z');
    expect(variants.map((v) => v.name)).toEqual(['A (delt 2)', 'B']);
    expect(variants.every((v) => v.id !== 'v-1' && v.id !== 'v-2' && v.createdAt === '2026-10-12T08:00:00.000Z')).toBe(true);
    expect(activeId).toBe(variants[1].id);
  });
});

describe('files and versions become proposals', () => {
  it('applyImportedProject adds the unlocked proposals (one undo step), skipping a locked base', () => {
    const file = createForslagD();
    file.variants.push(makeVariant('f-1', 'Fra fila'));
    applyImportedProject(file);
    expect(names()).toEqual(['Forslag D', 'Fra fila']);
    const added = appStore.getState().project.variants[1];
    expect(added.id).not.toBe('f-1');
    expect(appStore.getState().project.activeVariantId).toBe(added.id);
    appStore.getState().undo();
    expect(names()).toEqual(['Forslag D']);
    expect(importProjectAsProposals(createForslagD())).toBe(0);
  });

  it('restoreVersion adds the version’s proposals; a missing one is flagged', () => {
    saveVersion(localStorage, makeTestProject({ id: 'other', variants: [makeVariant('v-1', 'Gammel versjon')] }), 'x');
    const [v] = listVersions(localStorage, 'other');
    expect(restoreVersion(v.id)).toBe(true);
    expect(names()).toEqual(['Forslag D', 'Gammel versjon']);
    expect(restoreVersion('missing')).toBe(false);
    expect(noticeStore.getState().notices).toContain('version-failed');
    expect(saveNamedVersion('ny').ok).toBe(true);
  });
});

describe('kept for the banners', () => {
  it('read-only view: "Lag min egen kopi" adds the shared variant to the own project (undoable); "Tilbake" returns', () => {
    const mine = appStore.getState().project;
    showReadOnly(makeTestProject({ id: 'shared', variants: [makeVariant('v-1', 'Forslag D')] }));
    expect(appStore.getState().ui).toMatchObject({ readOnly: true, source: 'link' });
    expect(noticeStore.getState().sharedHasOwn).toBe(true);
    makeMyOwnCopy();
    expect(appStore.getState().ui.readOnly).toBe(false);
    expect(appStore.getState().project.id).toBe(mine.id);
    expect(names()).toEqual(['Forslag D', 'Forslag D (delt)']);
    appStore.getState().undo();
    expect(names()).toEqual(['Forslag D']);
    showReadOnly(makeTestProject({ id: 'shared' }));
    leaveSharedView();
    expect(appStore.getState().project.id).toBe(mine.id);
  });

  it('without an own project "Lag min egen kopi" makes the shown project the own one', () => {
    appStore.getState().replaceProject(makeTestProject({ id: 'shared' }), { readOnly: true, source: 'link' });
    makeMyOwnCopy();
    expect(appStore.getState().project.basedOnProjectId).toBe('shared');
    expect(appStore.getState().ui.readOnly).toBe(false);
  });

  it('other-tab banner buttons dismiss it; "Hent ny Forslag D" / "Tilbakestill" show Forslag D', () => {
    noticeStore.setState({ notices: ['other-tab'] });
    acceptExternalChange();
    expect(noticeStore.getState().notices).not.toContain('other-tab');
    noticeStore.setState({ notices: ['other-tab'] });
    keepOwnChanges();
    expect(noticeStore.getState().notices).not.toContain('other-tab');
    const id = appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mitt forslag');
    expect(appStore.getState().project.activeVariantId).toBe(id);
    fetchNewSeed();
    expect(appStore.getState().project.activeVariantId).toBe(SEED_VARIANT_ID);
    activateProposal(id ?? '');
    appStore.getState().select({ kind: 'wall', id: 'x' });
    resetToSeed();
    expect(appStore.getState().project.activeVariantId).toBe(SEED_VARIANT_ID);
    expect(appStore.getState().ui.selection).toBeNull();
    expect(names()).toEqual(['Forslag D', 'Mitt forslag']);
  });
});

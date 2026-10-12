// @vitest-environment jsdom
/**
 * Session actions of the app singleton (appStore.ts): share links, own copy, other tabs, seed updates, versions,
 * import. The singleton bootstraps from the bundled seed (empty localStorage, no hash).
 */
import LZString from 'lz-string';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEED_REVISION } from '../model/seed/forslagD';
import { CURRENT_SCHEMA_VERSION } from '../model/types';
import type { Project } from '../model/types';
import {
  acceptExternalChange,
  appStore,
  applyImportedProject,
  fetchNewSeed,
  freshSeedProject,
  keepOwnChanges,
  leaveSharedView,
  makeMyOwnCopy,
  noticeStore,
  openSharedLink,
  resetToSeed,
  restoreVersion,
  saveNamedVersion,
  seedUpdateAvailable,
  seedVariantFor,
  sharedVariantsFor,
  shareLinkFor,
  startPersistence,
  storage,
} from './appStore';
import { encodeShare, KEYS, listVersions, loadAutosave, loadInitialState, saveAutosave, saveVersion, shareParamFromHash } from './persistence';
import { makeTestProject, makeVariant } from './testProject';

/** Start autosave for one test; stopped in afterEach. */
let stopPersistence: (() => void) | null = null;
function persist(): void {
  stopPersistence = startPersistence();
}
afterEach(() => {
  stopPersistence?.();
  stopPersistence = null;
});

const variantNames = (p: Project = appStore.getState().project) => p.variants.map((v) => v.name);

const start = appStore.getState().project;

beforeEach(() => {
  localStorage.clear();
  leaveSharedView(); // forgets an own project kept aside by an earlier test's link
  appStore.getState().replaceProject(start, { readOnly: false, source: 'local' });
  noticeStore.setState({ notices: [], external: null });
});

describe('bootstrap', () => {
  it('starts from a fresh Forslag D with its own id and the current seed revision', () => {
    expect(storage).toBe(localStorage);
    expect(start.variants.length).toBeGreaterThan(0);
    expect(start.seedRevision).toBe(SEED_REVISION);
    const other = freshSeedProject();
    expect(other.id).not.toBe(start.id);
  });
});

describe('share links', () => {
  it('opens a link read-only and flags broken ones', () => {
    openSharedLink(encodeShare(makeTestProject({ id: 'shared' }), { allVariants: false }));
    expect(appStore.getState().project.id).toBe('shared');
    expect(appStore.getState().ui).toMatchObject({ readOnly: true, source: 'link' });
    openSharedLink('garbage');
    expect(noticeStore.getState().notices).toContain('link-invalid');
    expect(appStore.getState().project.id).toBe('shared');
  });

  it('"Lag min egen kopi" adds the shared variant to the own project (renamed on a clash, undoable)', () => {
    const mine = makeTestProject({ id: 'mine', name: 'Mitt', variants: [makeVariant('v-1', 'Forslag D'), makeVariant('v-2', 'Min variant')] });
    saveAutosave(localStorage, mine);
    appStore.getState().replaceProject(mine);
    persist();
    openSharedLink(encodeShare(makeTestProject({ id: 'shared' }), { allVariants: false }));
    expect(noticeStore.getState().sharedHasOwn).toBe(true);
    makeMyOwnCopy();
    const { project, ui, canUndo } = appStore.getState();
    expect(ui.readOnly).toBe(false);
    expect(project.id).toBe('mine');
    expect(variantNames(project)).toEqual(['Forslag D', 'Min variant', 'Forslag D (delt)']);
    const added = project.variants[2];
    expect(project.activeVariantId).toBe(added.id);
    expect(['v-1', 'v-2']).not.toContain(added.id);
    expect(added.basedOnId).toBe('v-1');
    expect(canUndo).toBe(true);
    const saved = loadAutosave(localStorage);
    expect(saved.status === 'ok' && variantNames(saved.project)).toEqual(['Forslag D', 'Min variant', 'Forslag D (delt)']);
    expect(listVersions(localStorage, 'mine')).toHaveLength(0);
    expect(noticeStore.getState().notices).not.toContain('other-tab');
    appStore.getState().undo();
    expect(variantNames()).toEqual(['Forslag D', 'Min variant']);
  });

  it('keeps the undo history of the own project when a link is opened in the same tab', () => {
    persist();
    appStore.getState().replaceProject(makeTestProject({ id: 'mine' }));
    appStore.getState().renameRoom('room-1', 'Peisestue');
    openSharedLink(encodeShare(makeTestProject({ id: 'shared', name: 'Delt' }), { allVariants: true }));
    expect(appStore.getState().canUndo).toBe(false);
    makeMyOwnCopy();
    expect(appStore.getState().project.id).toBe('mine');
    appStore.getState().undo(); // the added variant
    appStore.getState().undo(); // the rename before the link
    expect(appStore.getState().project.variants[0].rooms[0].name).toBe('Stue');
  });

  it('"Lag min egen kopi" without an own project makes the link the own project', () => {
    // A fresh visitor: the page opened on the link, nothing is stored.
    appStore.getState().replaceProject(makeTestProject({ id: 'shared' }), { readOnly: true, source: 'link' });
    persist();
    expect(localStorage.getItem(KEYS.project)).toBeNull();
    makeMyOwnCopy();
    const { project } = appStore.getState();
    expect(project.basedOnProjectId).toBe('shared');
    expect(project.id).not.toBe('shared');
    const saved = loadAutosave(localStorage);
    expect(saved.status === 'ok' && saved.project.id).toBe(project.id);
  });

  it('sharedVariantsFor gives new ids and numbered " (delt)" names', () => {
    const own = makeTestProject({ variants: [makeVariant('v-1', 'A'), makeVariant('v-2', 'A (delt)')] });
    const shared = makeTestProject({ variants: [makeVariant('v-1', 'A'), makeVariant('v-9', 'B')], activeVariantId: 'v-9' });
    const { variants, activeId } = sharedVariantsFor(own, shared, '2026-10-12T08:00:00.000Z');
    expect(variants.map((v) => v.name)).toEqual(['A (delt 2)', 'B']);
    expect(variants.every((v) => v.id !== 'v-1' && v.id !== 'v-2' && v.createdAt === '2026-10-12T08:00:00.000Z')).toBe(true);
    expect(activeId).toBe(variants[1].id);
  });

  it('refuses to copy over an autosave from a newer app version', () => {
    localStorage.setItem(KEYS.project, JSON.stringify({ ...makeTestProject(), schemaVersion: 99 }));
    openSharedLink(encodeShare(makeTestProject({ id: 'shared' }), { allVariants: false }));
    makeMyOwnCopy();
    expect(appStore.getState().ui.readOnly).toBe(true);
    expect(noticeStore.getState().notices).toContain('schema-too-new');
  });

  it('"Tilbake til mitt prosjekt" restores the autosave', () => {
    saveAutosave(localStorage, makeTestProject({ id: 'mine' }));
    appStore.getState().replaceProject(start, { readOnly: true, source: 'link' });
    openSharedLink(encodeShare(makeTestProject({ id: 'shared' }), { allVariants: false }));
    leaveSharedView();
    expect(appStore.getState().project.id).toBe('mine');
    expect(appStore.getState().ui.readOnly).toBe(false);
  });

  it('without an own project the banner offers "Vis Forslag D", which shows a fresh seed', () => {
    appStore.getState().replaceProject(start, { readOnly: true, source: 'link' });
    openSharedLink(encodeShare(makeTestProject({ id: 'shared' }), { allVariants: false }));
    expect(noticeStore.getState().sharedHasOwn).toBe(false);
    leaveSharedView();
    expect(appStore.getState().project.variants[0].id).toBe('forslag-d');
    expect(appStore.getState().ui.readOnly).toBe(false);
  });

  it('opening a link made against an older seed shows the rebased notice', () => {
    const delta = JSON.parse(
      JSON.stringify({ v: CURRENT_SCHEMA_VERSION, seedRevision: SEED_REVISION - 1, base: 'forslag-d', project: { id: 'x', activeVariantId: 'forslag-d' }, variants: [{ id: 'forslag-d', set: { name: 'Gammel' } }] }),
    ) as unknown;
    openSharedLink(LZString.compressToEncodedURIComponent(JSON.stringify(delta)));
    expect(appStore.getState().project.variants[0].name).toBe('Gammel');
    expect(noticeStore.getState().notices).toContain('link-rebased');
  });

  it('shareLinkFor builds a #d= link for the given project', () => {
    const link = shareLinkFor(makeTestProject(), false);
    expect(shareParamFromHash(new URL(link.url).hash)).not.toBeNull();
  });
});

describe('other tabs', () => {
  it('acceptExternalChange loads the newer project', () => {
    noticeStore.setState({ external: makeTestProject({ id: 'from-tab' }), notices: ['other-tab'] });
    acceptExternalChange();
    expect(appStore.getState().project.id).toBe('from-tab');
    expect(noticeStore.getState().notices).not.toContain('other-tab');
  });

  it('keepOwnChanges overwrites what the other tab saved', () => {
    appStore.getState().replaceProject(makeTestProject({ id: 'mine' }));
    persist();
    saveAutosave(localStorage, makeTestProject({ id: 'mine', name: 'Annen fane', updatedAt: '2030-01-01T00:00:00.000Z' }));
    appStore.getState().renameRoom('room-1', 'Min endring');
    saveNamedVersion('x');
    expect(noticeStore.getState().notices).toContain('other-tab');
    keepOwnChanges();
    expect(noticeStore.getState().notices).not.toContain('other-tab');
    const saved = loadAutosave(localStorage);
    expect(saved.status === 'ok' && saved.project.variants[0].rooms[0].name).toBe('Min endring');
  });
});

describe('seed updates', () => {
  it('seedUpdateAvailable compares revisions and respects a dismissal', () => {
    expect(seedUpdateAvailable(makeTestProject({ seedRevision: SEED_REVISION - 1 }), 0)).toBe(true);
    expect(seedUpdateAvailable(makeTestProject({ seedRevision: SEED_REVISION - 1 }), SEED_REVISION)).toBe(false);
    expect(seedUpdateAvailable(makeTestProject({ seedRevision: SEED_REVISION }), 0)).toBe(false);
  });

  it('"Hent ny Forslag D" adds the seed as a new variant with a unique id and name', () => {
    const before = appStore.getState().project;
    fetchNewSeed();
    const after = appStore.getState().project;
    expect(after.variants).toHaveLength(before.variants.length + 1);
    const added = after.variants.at(-1);
    expect(after.activeVariantId).toBe(added?.id);
    expect(before.variants.some((v) => v.id === added?.id)).toBe(false);
    expect(before.variants.some((v) => v.name === added?.name)).toBe(false);
    expect(after.seedRevision).toBe(SEED_REVISION);
    appStore.getState().undo();
    expect(appStore.getState().project.variants).toHaveLength(before.variants.length);
    const fresh = seedVariantFor(makeTestProject());
    expect(fresh.id).toBe(start.variants[0].id);
  });

  it('"Tilbakestill til Forslag D" keeps the project id and is undoable', () => {
    appStore.getState().replaceProject(makeTestProject({ id: 'keep-me' }));
    resetToSeed();
    expect(appStore.getState().project.id).toBe('keep-me');
    expect(appStore.getState().project.variants[0].id).toBe(start.variants[0].id);
    appStore.getState().undo();
    expect(appStore.getState().project.name).toBe('Testhytte');
  });
});

describe('autosave of the app singleton', () => {
  it('writes the project at start-up, so a version saved before any edit is found after a reload', () => {
    persist();
    const id = appStore.getState().project.id;
    expect(loadAutosave(localStorage).status).toBe('ok');
    const r = saveNamedVersion('Min første');
    expect(r.ok).toBe(true);
    const reloaded = loadInitialState({ storage, hash: '', createSeed: freshSeedProject });
    expect(reloaded.project.id).toBe(id);
    expect(listVersions(storage, reloaded.project.id).map((v) => v.name)).toEqual(['Min første']);
  });

  it('saveNamedVersion writes the autosave even when it was removed', () => {
    persist();
    localStorage.removeItem(KEYS.project);
    saveNamedVersion('Etter sletting');
    expect(loadAutosave(localStorage).status).toBe('ok');
  });

  it('restoreVersion and applyImportedProject are autosaved, never reported as another tab', () => {
    appStore.getState().replaceProject(makeTestProject({ id: 'p' }));
    persist();
    const v = saveNamedVersion('Før');
    appStore.getState().renameRoom('room-1', 'Endret');
    saveNamedVersion('Etter');
    expect(restoreVersion(v.ok ? v.version.id : '')).toBe(true);
    saveNamedVersion('Etter henting');
    const a = loadAutosave(localStorage);
    expect(a.status === 'ok' && a.project.variants[0].rooms[0].name).toBe('Stue');
    applyImportedProject(makeTestProject({ id: 'p', name: 'Importert', updatedAt: '2001-01-01T00:00:00.000Z' }));
    saveNamedVersion('Etter import');
    const b = loadAutosave(localStorage);
    expect(b.status === 'ok' && b.project.name).toBe('Importert');
    appStore.getState().undo();
    saveNamedVersion('Etter angre');
    const c = loadAutosave(localStorage);
    expect(c.status === 'ok' && c.project.name).toBe('Testhytte');
    expect(noticeStore.getState().notices).not.toContain('other-tab');
  });
});

describe('versions and import', () => {
  it('saves and restores a named version (undoable)', () => {
    appStore.getState().replaceProject(makeTestProject({ id: 'p' }));
    const r = saveNamedVersion('Før endring');
    expect(r.ok).toBe(true);
    appStore.getState().renameRoom('room-1', 'Endret');
    const id = r.ok ? r.version.id : '';
    expect(restoreVersion(id)).toBe(true);
    expect(appStore.getState().project.variants[0].rooms[0].name).toBe('Stue');
    expect(appStore.getState().ui.source).toBe('version');
    expect(restoreVersion('missing')).toBe(false);
    expect(noticeStore.getState().notices).toContain('version-failed');
  });

  it('restores versions of another project too', () => {
    saveVersion(localStorage, makeTestProject({ id: 'other', name: 'Annet' }), 'x');
    const [v] = listVersions(localStorage, 'other');
    expect(restoreVersion(v.id)).toBe(true);
    expect(appStore.getState().project.id).toBe('other');
  });

  it('applyImportedProject replaces the project (undoable)', () => {
    const before = appStore.getState().project;
    applyImportedProject(makeTestProject({ id: 'imported' }));
    expect(appStore.getState().project.id).toBe('imported');
    expect(appStore.getState().project.updatedAt).not.toBe(makeTestProject().updatedAt);
    appStore.getState().undo();
    expect(appStore.getState().project).toEqual({ ...before, updatedAt: expect.any(String) });
    expect(appStore.getState().project.updatedAt).not.toBe(before.updatedAt);
  });

});

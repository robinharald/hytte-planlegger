// @vitest-environment jsdom
/**
 * Session actions of the app singleton (appStore.ts): share links, own copy, other tabs, seed updates, versions,
 * import. The singleton bootstraps from the bundled seed (empty localStorage, no hash).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_REVISION } from '../model/seed/forslagD';
import {
  acceptExternalChange,
  appStore,
  applyImportedProject,
  fetchNewSeed,
  freshSeedProject,
  leaveSharedView,
  makeMyOwnCopy,
  noticeStore,
  openSharedLink,
  resetToSeed,
  restoreVersion,
  saveNamedVersion,
  seedUpdateAvailable,
  seedVariantFor,
  shareLinkFor,
  startPersistence,
  storage,
} from './appStore';
import { encodeShare, KEYS, listVersions, loadAutosave, saveAutosave, saveVersion, shareParamFromHash } from './persistence';
import { makeTestProject } from './testProject';

const start = appStore.getState().project;

beforeEach(() => {
  localStorage.clear();
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

  it('"Lag min egen kopi" keeps the old local project as a version and makes the copy editable', () => {
    const mine = makeTestProject({ id: 'mine', name: 'Mitt' });
    saveAutosave(localStorage, mine);
    const stop = startPersistence();
    openSharedLink(encodeShare(makeTestProject({ id: 'shared' }), { allVariants: false }));
    makeMyOwnCopy();
    const { project, ui } = appStore.getState();
    expect(ui.readOnly).toBe(false);
    expect(project.basedOnProjectId).toBe('shared');
    expect(project.id).not.toBe('shared');
    const backup = listVersions(localStorage, 'mine');
    expect(backup).toHaveLength(1);
    const saved = loadAutosave(localStorage);
    expect(saved.status === 'ok' && saved.project.id).toBe(project.id);
    stop();
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
    openSharedLink(encodeShare(makeTestProject({ id: 'shared' }), { allVariants: false }));
    leaveSharedView();
    expect(appStore.getState().project.id).toBe('mine');
    expect(appStore.getState().ui.readOnly).toBe(false);
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
    appStore.getState().undo();
    expect(appStore.getState().project).toBe(before);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LZString from 'lz-string';
import { CURRENT_SCHEMA_VERSION } from '../model/types';
import type { Project } from '../model/types';
import {
  AUTOSAVE_DELAY_MS,
  decodeShare,
  deleteVersion,
  encodeShare,
  getStorage,
  isNewer,
  KEYS,
  listVersions,
  loadAutosave,
  loadDismissedSeedRevision,
  loadInitialState,
  loadUiPrefs,
  loadVersion,
  makeOwnCopy,
  makeShareLink,
  parseProjectText,
  projectFileName,
  readProjectFile,
  sanitizeUiPrefs,
  saveAutosave,
  saveDismissedSeedRevision,
  saveUiPrefs,
  saveVersion,
  serializeProject,
  SHARE_WARN_BYTES,
  shareParamFromHash,
  sharedProject,
  startAutosave,
  VERSION_LIMIT,
  versionsBytes,
} from './persistence';
import type { KeyValueStorage } from './persistence';
import { createAppStore, DEFAULT_UI } from './store';
import { makeTestProject, makeVariant } from './testProject';

function twoVariantProject(): Project {
  return makeTestProject({ variants: [makeVariant('v-1', 'Forslag D'), makeVariant('v-2', 'Forslag E')], activeVariantId: 'v-2' });
}

/** Storage whose writes always fail (quota). */
const fullStorage: KeyValueStorage = {
  getItem: () => null,
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
  removeItem: () => {},
};

beforeEach(() => localStorage.clear());

describe('storage helpers', () => {
  it('getStorage returns localStorage in jsdom', () => {
    expect(getStorage()).toBe(localStorage);
  });

  it('isNewer compares ISO timestamps', () => {
    expect(isNewer('2026-10-11T10:00:01.000Z', '2026-10-11T10:00:00.000Z')).toBe(true);
    expect(isNewer('2026-10-11T10:00:00.000Z', '2026-10-11T10:00:00.000Z')).toBe(false);
  });
});

describe('autosave round trip', () => {
  it('saves and loads a project unchanged', () => {
    const p = twoVariantProject();
    expect(saveAutosave(localStorage, p)).toBe(true);
    const r = loadAutosave(localStorage);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.project).toEqual(p);
  });

  it('reports missing, invalid and too-new documents', () => {
    expect(loadAutosave(localStorage).status).toBe('missing');
    localStorage.setItem(KEYS.project, '{not json');
    expect(loadAutosave(localStorage).status).toBe('invalid');
    localStorage.setItem(KEYS.project, JSON.stringify({ id: 'x' }));
    expect(loadAutosave(localStorage).status).toBe('invalid');
    localStorage.setItem(KEYS.project, JSON.stringify({ ...makeTestProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }));
    expect(loadAutosave(localStorage)).toEqual({ status: 'too-new', version: CURRENT_SCHEMA_VERSION + 1 });
  });

  it('migrates an older/minimal document on load', () => {
    const p = makeTestProject() as Partial<Project>;
    delete p.seedRevision;
    localStorage.setItem(KEYS.project, JSON.stringify(p));
    const r = loadAutosave(localStorage);
    expect(r.status === 'ok' && r.project.seedRevision).toBe(0);
  });

  it('a failing storage returns false instead of throwing', () => {
    expect(saveAutosave(fullStorage, makeTestProject())).toBe(false);
    expect(saveAutosave(null, makeTestProject())).toBe(false);
    expect(loadAutosave(null).status).toBe('missing');
  });
});

describe('ui prefs', () => {
  it('round-trips the persisted subset only', () => {
    const ui = { ...DEFAULT_UI, activeView: 'plan' as const, cutHeight: 2.2, showGrid: false, readOnly: true, selection: { kind: 'room' as const, id: 'x' } };
    saveUiPrefs(localStorage, ui);
    const loaded = loadUiPrefs(localStorage);
    expect(loaded.activeView).toBe('plan');
    expect(loaded.cutHeight).toBe(2.2);
    expect(loaded.showGrid).toBe(false);
    expect('readOnly' in loaded).toBe(false);
    expect('selection' in loaded).toBe(false);
  });

  it('drops malformed fields and clamps the cut height', () => {
    expect(
      sanitizeUiPrefs({ activeView: 'nope', cutHeight: 9, showLabels: 'yes', preset: 'ovenfra', sun: { date: '21.06', minutes: 5 } }),
    ).toEqual({ cutHeight: 2.6, preset: 'ovenfra' });
    expect(sanitizeUiPrefs(null)).toEqual({});
    expect(sanitizeUiPrefs({ sun: { date: '2026-12-21', minutes: 720.4 } })).toEqual({ sun: { date: '2026-12-21', minutes: 720 } });
  });

  it('keeps dismissedSeedRevision when prefs are saved', () => {
    saveDismissedSeedRevision(localStorage, 3);
    saveUiPrefs(localStorage, DEFAULT_UI);
    expect(loadDismissedSeedRevision(localStorage)).toBe(3);
  });
});

describe('versions', () => {
  it('saves, lists newest first per project, loads and deletes', () => {
    const p = makeTestProject();
    const a = saveVersion(localStorage, p, 'Første', new Date('2026-10-01T10:00:00Z'));
    const b = saveVersion(localStorage, p, 'Andre', new Date('2026-10-02T10:00:00Z'));
    saveVersion(localStorage, makeTestProject({ id: 'other' }), 'Annet prosjekt', new Date('2026-10-03T10:00:00Z'));
    expect(a.ok && b.ok).toBe(true);
    const list = listVersions(localStorage, p.id);
    expect(list.map((v) => v.name)).toEqual(['Andre', 'Første']);
    expect(list[0].bytes).toBeGreaterThan(100);
    expect(list[0].projectName).toBe('Testhytte');
    expect(listVersions(localStorage, p.id, { others: true }).map((v) => v.name)).toEqual(['Annet prosjekt']);
    expect(versionsBytes(localStorage)).toBeGreaterThan(list[0].bytes);

    const loaded = loadVersion(localStorage, list[1].id);
    expect(loaded.status === 'ok' && loaded.project).toEqual(p);
    expect(loadVersion(localStorage, 'nope').status).toBe('missing');

    expect(deleteVersion(localStorage, list[0].id)).toBe(true);
    expect(deleteVersion(localStorage, list[0].id)).toBe(false);
    expect(listVersions(localStorage, p.id).map((v) => v.name)).toEqual(['Første']);
  });

  it(`keeps at most ${VERSION_LIMIT} versions per project, dropping the oldest`, () => {
    const p = makeTestProject();
    for (let i = 0; i < VERSION_LIMIT + 3; i++) {
      saveVersion(localStorage, p, `v${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)));
    }
    saveVersion(localStorage, makeTestProject({ id: 'other' }), 'annet', new Date(Date.UTC(2025, 0, 1)));
    const list = listVersions(localStorage, p.id);
    expect(list).toHaveLength(VERSION_LIMIT);
    expect(list[0].name).toBe(`v${VERSION_LIMIT + 2}`);
    expect(list.at(-1)?.name).toBe('v3');
    expect(listVersions(localStorage, p.id, { others: true })).toHaveLength(1);
  });

  it('uses the project name for a blank version name and reports storage failures', () => {
    const r = saveVersion(localStorage, makeTestProject(), '  ');
    expect(r.ok && r.version.name).toBe('Testhytte');
    expect(saveVersion(fullStorage, makeTestProject(), 'x')).toEqual({ ok: false, reason: 'quota' });
    expect(saveVersion(null, makeTestProject(), 'x')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('skips malformed entries', () => {
    localStorage.setItem(KEYS.versions, JSON.stringify([{ id: 1 }, 'x', null]));
    expect(listVersions(localStorage, 'test-project')).toEqual([]);
    localStorage.setItem(KEYS.versions, 'garbage');
    expect(listVersions(localStorage, 'test-project')).toEqual([]);
  });
});

describe('export / import', () => {
  it('file name is a slug plus the date', () => {
    expect(projectFileName(makeTestProject({ name: 'Hytta ved Merkesvatnet' }), new Date(2026, 9, 11))).toBe(
      'hytta-ved-merkesvatnet-2026-10-11.json',
    );
    expect(projectFileName(makeTestProject({ name: 'Æ Ø Å!' }), new Date(2026, 0, 2))).toBe('ae-o-a-2026-01-02.json');
    expect(projectFileName(makeTestProject({ name: '???' }), new Date(2026, 0, 2))).toBe('hytte-2026-01-02.json');
  });

  it('round-trips through JSON text and a file', async () => {
    const p = twoVariantProject();
    const r = parseProjectText(serializeProject(p));
    expect(r.status === 'ok' && r.project).toEqual(p);
    const f = await readProjectFile(new Blob([serializeProject(p)], { type: 'application/json' }));
    expect(f.status === 'ok' && f.project).toEqual(p);
  });

  it('accepts share payloads and stored versions as files', () => {
    const p = makeTestProject();
    const a = parseProjectText(JSON.stringify({ v: 1, project: p }));
    expect(a.status === 'ok' && a.project).toEqual(p);
    const b = parseProjectText(JSON.stringify({ id: 'x', name: 'n', projectId: p.id, project: p }));
    expect(b.status === 'ok' && b.project).toEqual(p);
  });

  it('rejects garbage and too-new files', () => {
    expect(parseProjectText('hello').status).toBe('invalid');
    expect(parseProjectText('[]').status).toBe('invalid');
    expect(parseProjectText(JSON.stringify({ ...makeTestProject(), schemaVersion: 99 })).status).toBe('too-new');
    expect(parseProjectText(JSON.stringify({ v: 99, project: makeTestProject() })).status).toBe('too-new');
  });
});

describe('share links', () => {
  it('encodes only the active variant by default', () => {
    const p = twoVariantProject();
    const r = decodeShare(encodeShare(p, { allVariants: false }));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.project.variants.map((v) => v.id)).toEqual(['v-2']);
    expect(r.project.activeVariantId).toBe('v-2');
    expect(r.project.id).toBe(p.id);
  });

  it('encodes all variants on request and round-trips exactly', () => {
    const p = twoVariantProject();
    const r = decodeShare(encodeShare(p, { allVariants: true }));
    expect(r.status === 'ok' && r.project).toEqual(p);
  });

  it('sharedProject falls back to the first variant and leaves the input alone', () => {
    const p = makeTestProject({ activeVariantId: 'gone' });
    expect(sharedProject(p, false).variants).toHaveLength(1);
    expect(sharedProject(p, true)).toBe(p);
  });

  it('builds a URL with #d=, reports its size and warns above 8 kB', () => {
    const p = makeTestProject();
    const link = makeShareLink(p, { allVariants: false }, 'https://example.org/hytte/?x=1#old');
    expect(link.url.startsWith('https://example.org/hytte/?x=1#d=')).toBe(true);
    expect(link.bytes).toBe(link.url.length);
    expect(link.tooBig).toBe(false);
    const big = makeTestProject({ variants: Array.from({ length: 40 }, (_, i) => makeVariant(`v-${i}`, `Variant nummer ${i} ${'x'.repeat(i * 7)}`)) });
    const bigLink = makeShareLink(big, { allVariants: true }, 'https://example.org/');
    expect(bigLink.bytes).toBeGreaterThan(SHARE_WARN_BYTES);
    expect(bigLink.tooBig).toBe(true);
  });

  it('reads the parameter from the hash', () => {
    expect(shareParamFromHash('#d=abc')).toBe('abc');
    expect(shareParamFromHash('d=abc')).toBe('abc');
    expect(shareParamFromHash('#x=1&d=abc')).toBe('abc');
    expect(shareParamFromHash('#d=')).toBeNull();
    expect(shareParamFromHash('')).toBeNull();
    expect(shareParamFromHash('#dd=abc')).toBeNull();
  });

  it('rejects corrupt and too-new links without throwing', () => {
    expect(decodeShare('%%%').status).toBe('invalid');
    expect(decodeShare('').status).toBe('invalid');
    expect(decodeShare(LZString.compressToEncodedURIComponent('"just a string"')).status).toBe('invalid');
    const tooNew = LZString.compressToEncodedURIComponent(JSON.stringify({ v: 99, project: makeTestProject() }));
    expect(decodeShare(tooNew)).toEqual({ status: 'too-new', version: 99 });
  });

  it('makeOwnCopy assigns a new id and remembers the original', () => {
    const p = makeTestProject();
    const copy = makeOwnCopy(p, new Date('2026-10-12T08:00:00Z'));
    expect(copy.id).not.toBe(p.id);
    expect(copy.basedOnProjectId).toBe(p.id);
    expect(copy.updatedAt).toBe('2026-10-12T08:00:00.000Z');
    expect(copy.variants).toEqual(p.variants);
    expect(copy.variants).not.toBe(p.variants);
  });
});

describe('loadInitialState', () => {
  const seed = () => makeTestProject({ id: 'seed', name: 'Seed' });

  it('uses a valid share link read-only', () => {
    saveAutosave(localStorage, makeTestProject({ id: 'mine' }));
    const hash = `#d=${encodeShare(makeTestProject({ id: 'shared' }), { allVariants: false })}`;
    const s = loadInitialState({ storage: localStorage, hash, createSeed: seed });
    expect(s.project.id).toBe('shared');
    expect(s.ui.readOnly).toBe(true);
    expect(s.ui.source).toBe('link');
    expect(s.notices).toEqual([]);
  });

  it('falls back to the autosave when the link is broken', () => {
    saveAutosave(localStorage, makeTestProject({ id: 'mine' }));
    const s = loadInitialState({ storage: localStorage, hash: '#d=garbage', createSeed: seed });
    expect(s.project.id).toBe('mine');
    expect(s.ui.readOnly).toBe(false);
    expect(s.notices).toEqual(['link-invalid']);
  });

  it('uses the seed when nothing is stored, with saved prefs applied', () => {
    saveUiPrefs(localStorage, { ...DEFAULT_UI, activeView: '3d' });
    const s = loadInitialState({ storage: localStorage, hash: '', createSeed: seed });
    expect(s.project.id).toBe('seed');
    expect(s.ui.activeView).toBe('3d');
    expect(s.notices).toEqual([]);
  });

  it('shows the seed read-only and keeps a too-new autosave untouched', () => {
    const raw = JSON.stringify({ ...makeTestProject(), schemaVersion: 99 });
    localStorage.setItem(KEYS.project, raw);
    const s = loadInitialState({ storage: localStorage, hash: '', createSeed: seed });
    expect(s.project.id).toBe('seed');
    expect(s.ui.readOnly).toBe(true);
    expect(s.notices).toEqual(['schema-too-new']);
    expect(localStorage.getItem(KEYS.project)).toBe(raw);
  });

  it('backs up an unreadable autosave before starting from the seed', () => {
    localStorage.setItem(KEYS.project, '{broken');
    const s = loadInitialState({ storage: localStorage, hash: '', createSeed: seed });
    expect(s.project.id).toBe('seed');
    expect(s.notices).toEqual(['autosave-invalid']);
    expect(localStorage.getItem(KEYS.projectBackup)).toBe('{broken');
  });

  it('reports missing storage', () => {
    const s = loadInitialState({ storage: null, hash: '', createSeed: seed });
    expect(s.notices).toEqual(['storage-unavailable']);
  });
});

describe('startAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces project writes and writes nothing for the initial project', () => {
    const store = createAppStore(makeTestProject());
    const ctl = startAutosave(store, { storage: localStorage, target: window });
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(localStorage.getItem(KEYS.project)).toBeNull();

    store.getState().renameRoom('room-1', 'A');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100);
    store.getState().renameRoom('room-1', 'B');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100);
    expect(localStorage.getItem(KEYS.project)).toBeNull();
    vi.advanceTimersByTime(200);
    const r = loadAutosave(localStorage);
    expect(r.status === 'ok' && r.project.variants[0].rooms[0].name).toBe('B');
    ctl.stop();
  });

  it('saves ui prefs too, and flushes on pagehide', () => {
    const store = createAppStore(makeTestProject());
    const ctl = startAutosave(store, { storage: localStorage, target: window });
    store.getState().setUi({ showGrid: false });
    store.getState().renameRoom('room-1', 'C');
    window.dispatchEvent(new Event('pagehide'));
    expect(loadUiPrefs(localStorage).showGrid).toBe(false);
    const r = loadAutosave(localStorage);
    expect(r.status === 'ok' && r.project.variants[0].rooms[0].name).toBe('C');
    ctl.stop();
  });

  it('never writes while read-only', () => {
    const store = createAppStore(makeTestProject());
    const ctl = startAutosave(store, { storage: localStorage, target: window });
    store.getState().replaceProject(makeTestProject({ id: 'shared' }), { readOnly: true, source: 'link' });
    ctl.flush();
    expect(localStorage.getItem(KEYS.project)).toBeNull();
    // "Lag min egen kopi" → writable again → saved.
    store.getState().replaceProject(makeOwnCopy(store.getState().project), { readOnly: false, source: 'local' });
    ctl.flush();
    const r = loadAutosave(localStorage);
    expect(r.status === 'ok' && r.project.basedOnProjectId).toBe('shared');
    ctl.stop();
  });

  it('does not overwrite a newer project saved by another tab and reports it', () => {
    const store = createAppStore(makeTestProject());
    const onExternalChange = vi.fn();
    const ctl = startAutosave(store, { storage: localStorage, target: window, onExternalChange });
    store.getState().renameRoom('room-1', 'Mine');
    const newer = makeTestProject({ updatedAt: '2999-01-01T00:00:00.000Z', name: 'Fra annen fane' });
    saveAutosave(localStorage, newer);
    ctl.flush();
    const r = loadAutosave(localStorage);
    expect(r.status === 'ok' && r.project.name).toBe('Fra annen fane');
    expect(onExternalChange).toHaveBeenCalledTimes(1);
    expect(onExternalChange.mock.calls[0][0].name).toBe('Fra annen fane');
    ctl.stop();
  });

  it('reports newer projects from storage events and ignores older ones', () => {
    const store = createAppStore(makeTestProject());
    const onExternalChange = vi.fn();
    const ctl = startAutosave(store, { storage: localStorage, target: window, onExternalChange });
    const older = makeTestProject({ updatedAt: '2000-01-01T00:00:00.000Z' });
    window.dispatchEvent(new StorageEvent('storage', { key: KEYS.project, newValue: JSON.stringify(older) }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEYS.ui, newValue: '{}' }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEYS.project, newValue: 'garbage' }));
    expect(onExternalChange).not.toHaveBeenCalled();
    const newer = makeTestProject({ updatedAt: '2999-01-01T00:00:00.000Z' });
    window.dispatchEvent(new StorageEvent('storage', { key: KEYS.project, newValue: JSON.stringify(newer) }));
    expect(onExternalChange).toHaveBeenCalledTimes(1);
    ctl.stop();
    window.dispatchEvent(new StorageEvent('storage', { key: KEYS.project, newValue: JSON.stringify({ ...newer, updatedAt: '3000-01-01T00:00:00.000Z' }) }));
    expect(onExternalChange).toHaveBeenCalledTimes(1);
  });

  it('reports failed writes', () => {
    const store = createAppStore(makeTestProject());
    const onSaveError = vi.fn();
    const ctl = startAutosave(store, { storage: fullStorage, onSaveError });
    store.getState().renameRoom('room-1', 'X');
    ctl.flush();
    expect(onSaveError).toHaveBeenCalled();
    ctl.stop();
  });
});

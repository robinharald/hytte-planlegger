/**
 * The overlay store with stand-in loading, cache and storage: loading a file, errors, the restore after a reload,
 * «Fjern», the preferences and the nudge; plus the loader's file check and the plan paths.
 */
import { describe, expect, it } from 'vitest';
import { nb } from '../i18n/nb';
import { IfcLoadError, loadIfcFile, looksLikeIfc } from './loader';
import { overlayGroups, sectionPaths, segmentsPath } from './overlayData';
import { PARSER_VERSION } from './parse';
import { DEFAULT_IFC_PREFS, IFC_PREFS_KEY, createIfcOverlayStore } from './store';
import type { IfcStoreDeps } from './store';
import { IFC_CALIBRATION } from './transform';
import { testIfc } from './testIfc';
import type { ParsedIfc } from './types';

function model(name = 'hytta.ifc', size = 100): ParsedIfc {
  return {
    version: PARSER_VERSION,
    fileName: name,
    fileSize: size,
    schema: 'IFC4',
    meshes: [
      { kind: 'wall', positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1]), indices: new Uint32Array([0, 1, 2]) },
      { kind: 'roof', positions: new Float32Array([0, 0, 2, 1, 0, 2, 1, 1, 3]), indices: new Uint32Array([0, 1, 2]) },
      { kind: 'door', positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1]), indices: new Uint32Array([0, 1, 2]) },
    ],
    sections: [
      { storey: 'ground', kind: 'wall', planH: 0.9, segments: new Float32Array([0, 0, 1.23456, 0, 1.23456, 0, 1.23456, 0.2]) },
      { storey: 'ground', kind: 'door', planH: 0.9, segments: new Float32Array([0.5, 0, 0.5, 0.2]) },
      { storey: 'loft', kind: 'wall', planH: 2.1, segments: new Float32Array([0, 0, 1, 0]) },
    ],
    counts: { wall: 1, window: 0, door: 1, roof: 1, slab: 0, other: 0 },
    min: [0, 0, 0],
    max: [1, 1, 3],
  };
}

function memoryStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

function setup(over: Partial<IfcStoreDeps> = {}, storage = memoryStorage()) {
  const cache = new Map<string, ParsedIfc>();
  const deps: IfcStoreDeps = {
    load: async (file) => model(file.name, file.size),
    readCache: async (key) => cache.get(key) ?? null,
    clearCache: async () => {
      cache.clear();
      return true;
    },
    storage: () => storage,
    ...over,
  };
  return { store: createIfcOverlayStore(deps), storage, cache };
}

const file = (name = 'hytta.ifc', size = 100) => ({ name, size, arrayBuffer: async () => new ArrayBuffer(size) });

describe('IFC overlay store', () => {
  it('starts empty with the default preferences', () => {
    const { store } = setup();
    expect(store.getState()).toMatchObject({ status: 'idle', model: null, error: null, prefs: DEFAULT_IFC_PREFS });
    expect(store.transform()).toEqual(IFC_CALIBRATION);
  });

  it('loads a file, shows it in the plan and in 3D and remembers it', async () => {
    const { store, storage } = setup();
    store.setPrefs({ showPlan: false, show3d: false });
    const p = store.loadFile(file());
    expect(store.getState().status).toBe('loading');
    await p;
    expect(store.getState().status).toBe('ready');
    expect(store.getState().model?.fileName).toBe('hytta.ifc');
    expect(store.getState().prefs).toMatchObject({ key: 'hytta.ifc|100', showPlan: true, show3d: true });
    expect(JSON.parse(storage.map.get(IFC_PREFS_KEY)!)).toMatchObject({ key: 'hytta.ifc|100' });
  });

  it('says why a file could not be read and keeps a model it already had', async () => {
    let fail: IfcLoadError | null = new IfcLoadError('not-ifc');
    const { store } = setup({
      load: async (f) => {
        if (fail) throw fail;
        return model(f.name, f.size);
      },
    });
    await store.loadFile(file('notes.txt'));
    expect(store.getState()).toMatchObject({ status: 'error', error: nb.ifc.notIfc, model: null });
    fail = null;
    await store.loadFile(file());
    expect(store.getState().error).toBeNull();
    fail = new IfcLoadError('failed');
    await store.loadFile(file('broken.ifc'));
    expect(store.getState()).toMatchObject({ status: 'ready', error: nb.ifc.failed });
    expect(store.getState().model?.fileName).toBe('hytta.ifc');
  });

  it('brings the last model back from the device cache after a reload, once', async () => {
    const first = setup();
    await first.store.loadFile(file());
    first.cache.set('hytta.ifc|100', model());
    // a new store on the same storage = the app after a reload
    let reads = 0;
    const second = setup(
      {
        readCache: async (key) => {
          reads++;
          return first.cache.get(key) ?? null;
        },
      },
      first.storage,
    );
    expect(second.store.getState().model).toBeNull();
    await Promise.all([second.store.ensureRestored(), second.store.ensureRestored()]);
    expect(reads).toBe(1);
    expect(second.store.getState()).toMatchObject({ status: 'ready', model: { fileName: 'hytta.ifc' } });
    await second.store.ensureRestored();
    expect(reads).toBe(1);
  });

  it('forgets the file when the cache no longer has it, and a newer load wins over a slow restore', async () => {
    const storage = memoryStorage({ [IFC_PREFS_KEY]: JSON.stringify({ ...DEFAULT_IFC_PREFS, key: 'gone.ifc|5' }) });
    const { store } = setup({ readCache: async () => null }, storage);
    await store.ensureRestored();
    expect(store.getState()).toMatchObject({ status: 'idle', model: null, prefs: { key: null } });

    let release: (m: ParsedIfc | null) => void = () => {};
    const slow = setup(
      { readCache: () => new Promise<ParsedIfc | null>((r) => (release = r)) },
      memoryStorage({ [IFC_PREFS_KEY]: JSON.stringify({ ...DEFAULT_IFC_PREFS, key: 'old.ifc|1' }) }),
    );
    const restoring = slow.store.ensureRestored();
    await slow.store.loadFile(file('new.ifc', 7));
    release(model('old.ifc', 1));
    await restoring;
    expect(slow.store.getState().model?.fileName).toBe('new.ifc');
  });

  it('«Fjern» drops the model, the cache and the nudge', async () => {
    const { store, cache } = setup();
    await store.loadFile(file());
    cache.set('hytta.ifc|100', model());
    store.nudge(3, -2);
    await store.remove();
    expect(store.getState()).toMatchObject({ status: 'idle', model: null, prefs: { key: null, nudge: { dx: 0, dy: 0 } } });
    expect(cache.size).toBe(0);
  });

  it('nudges in centimetres up to ±10 cm and clamps the opacity', () => {
    const { store, storage } = setup();
    store.nudge(1, 0);
    store.nudge(1, -1);
    expect(store.getState().prefs.nudge).toEqual({ dx: 0.02, dy: -0.01 });
    expect(store.transform().dx).toBeCloseTo(4.73, 9);
    for (let i = 0; i < 30; i++) store.nudge(1, -1);
    expect(store.getState().prefs.nudge).toEqual({ dx: 0.1, dy: -0.1 });
    store.resetNudge();
    expect(store.getState().prefs.nudge).toEqual({ dx: 0, dy: 0 });
    store.setPrefs({ opacity: 5 });
    expect(store.getState().prefs.opacity).toBe(1);
    store.setPrefs({ opacity: 0 });
    expect(store.getState().prefs.opacity).toBe(0.2);
    // stored preferences are read back, bad values replaced
    storage.map.set(IFC_PREFS_KEY, JSON.stringify({ opacity: 'x', showPlan: false, nudge: { dx: 0.5, dy: 'a' } }));
    const again = setup({}, storage).store.getState().prefs;
    expect(again).toMatchObject({ opacity: DEFAULT_IFC_PREFS.opacity, showPlan: false, show3d: true, nudge: { dx: 0.1, dy: 0 } });
    storage.map.set(IFC_PREFS_KEY, '{not json');
    expect(setup({}, storage).store.getState().prefs).toEqual(DEFAULT_IFC_PREFS);
  });
});

describe('IFC loader', () => {
  it('recognises STEP files by their header', () => {
    const enc = new TextEncoder();
    expect(looksLikeIfc(enc.encode(testIfc([])))).toBe(true);
    expect(looksLikeIfc(enc.encode('﻿\r\nISO-10303-21;\nHEADER;'))).toBe(true);
    expect(looksLikeIfc(enc.encode('PK\u0003\u0004 zip'))).toBe(false);
    expect(looksLikeIfc(new Uint8Array())).toBe(false);
  });

  it('refuses other files and models without geometry, and parses an IFC (no IndexedDB in Node: no cache)', async () => {
    const text = testIfc([]);
    const bytes = new TextEncoder().encode(text);
    const ifcFile = { name: 'a.ifc', size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
    await expect(loadIfcFile({ name: 'a.txt', size: 3, arrayBuffer: async () => new TextEncoder().encode('abc').buffer }, { parse: async () => model() })).rejects.toMatchObject({
      reason: 'not-ifc',
    });
    await expect(loadIfcFile(ifcFile, { parse: async () => ({ ...model(), meshes: [] }) })).rejects.toMatchObject({ reason: 'empty' });
    await expect(
      loadIfcFile(ifcFile, {
        parse: async () => {
          throw new Error('wasm');
        },
      }),
    ).rejects.toMatchObject({ reason: 'failed' });
    expect((await loadIfcFile(ifcFile, { parse: async () => model('a.ifc') })).fileName).toBe('a.ifc');
  });
});

describe('overlay data', () => {
  it('writes one move-line per segment in millimetres', () => {
    expect(segmentsPath([0, 0, 1.23456, -0.0004])).toBe('M0 0L1.235 0');
    const paths = sectionPaths(model(), 'ground');
    expect(paths.wall).toBe('M0 0L1.235 0M1.235 0L1.235 0.2');
    expect(paths.door).toBe('M0.5 0L0.5 0.2');
    expect(paths.window).toBeUndefined();
    expect(Object.keys(sectionPaths(model(), 'loft'))).toEqual(['wall']);
  });

  it('groups the meshes by the 3D switches', () => {
    const g = overlayGroups(model());
    expect(g.walls.map((m) => m.kind)).toEqual(['wall', 'door']);
    expect(g.roof.map((m) => m.kind)).toEqual(['roof']);
    expect(g.slabs).toEqual([]);
  });
});

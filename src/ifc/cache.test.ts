/**
 * The IFC cache round trip through a small in-memory IndexedDB (only what cache.ts uses: open with an upgrade, one
 * object store with a keyPath, get / put / clear in transactions; values structured-cloned like the real one).
 */
import { describe, expect, it } from 'vitest';
import { clearCachedIfc, ifcCacheKey, readCachedIfc, writeCachedIfc } from './cache';
import { PARSER_VERSION } from './parse';
import type { ParsedIfc } from './types';

type Handler = (() => void) | null;

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

function fakeIndexedDB(opts: { failOpen?: boolean } = {}) {
  const databases = new Map<string, { version: number; stores: Map<string, { keyPath: string; rows: Map<string, unknown> }> }>();
  const factory = {
    open(name: string, version: number) {
      const req = new FakeRequest<unknown>();
      setTimeout(() => {
        if (opts.failOpen) {
          req.error = new Error('denied');
          req.onerror?.();
          return;
        }
        let db = databases.get(name);
        const upgrade = !db || db.version < version;
        if (!db) databases.set(name, (db = { version, stores: new Map() }));
        const dbo = db;
        const handle = {
          objectStoreNames: { contains: (s: string) => dbo.stores.has(s) },
          createObjectStore(s: string, o: { keyPath: string }) {
            dbo.stores.set(s, { keyPath: o.keyPath, rows: new Map() });
          },
          close() {},
          transaction(s: string) {
            const store = dbo.stores.get(s)!;
            const tx = {
              oncomplete: null as Handler,
              onerror: null as Handler,
              onabort: null as Handler,
              error: null,
              objectStore: () => ({
                get: (key: string) => op(() => structuredClone(store.rows.get(key))),
                put: (value: Record<string, unknown>) =>
                  op(() => {
                    store.rows.set(value[store.keyPath] as string, structuredClone(value));
                    return value[store.keyPath];
                  }),
                clear: () => op(() => store.rows.clear()),
              }),
            };
            function op<T>(fn: () => T) {
              const r = new FakeRequest<T>();
              setTimeout(() => {
                r.result = fn();
                r.onsuccess?.();
                setTimeout(() => tx.oncomplete?.(), 0);
              }, 0);
              return r;
            }
            return tx;
          },
        };
        req.result = handle;
        if (upgrade) {
          dbo.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  return { idb: factory as unknown as IDBFactory, databases };
}

function sampleModel(): ParsedIfc {
  return {
    version: PARSER_VERSION,
    fileName: 'hytta.ifc',
    fileSize: 1234,
    schema: 'IFC4',
    meshes: [{ kind: 'wall', positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 2.5]), indices: new Uint32Array([0, 1, 2]) }],
    sections: [{ storey: 'ground', kind: 'wall', planH: 0.9, segments: new Float32Array([0, 0, 1, 0]) }],
    counts: { wall: 1, window: 0, door: 0, roof: 0, slab: 0, other: 0 },
    min: [0, 0, 0],
    max: [1, 0, 2.5],
  };
}

describe('IFC cache', () => {
  it('keys by file name and size', () => {
    expect(ifcCacheKey('hytta.ifc', 1234)).toBe('hytta.ifc|1234');
  });

  it('round-trips a parsed model with its typed arrays', async () => {
    const { idb } = fakeIndexedDB();
    const model = sampleModel();
    expect(await readCachedIfc(ifcCacheKey('hytta.ifc', 1234), idb)).toBeNull();
    expect(await writeCachedIfc(model, idb)).toBe(true);
    const back = await readCachedIfc(ifcCacheKey('hytta.ifc', 1234), idb);
    expect(back).not.toBe(model);
    expect(back).toEqual(model);
    expect(back!.meshes[0].positions).toBeInstanceOf(Float32Array);
    expect(back!.meshes[0].indices).toBeInstanceOf(Uint32Array);
    expect(back!.sections[0].segments).toBeInstanceOf(Float32Array);
    // another size of the same name is another file
    expect(await readCachedIfc(ifcCacheKey('hytta.ifc', 1235), idb)).toBeNull();
  });

  it('ignores a model from another parser version and forgets everything on clear', async () => {
    const { idb } = fakeIndexedDB();
    await writeCachedIfc({ ...sampleModel(), version: PARSER_VERSION - 1 }, idb);
    expect(await readCachedIfc(ifcCacheKey('hytta.ifc', 1234), idb)).toBeNull();
    await writeCachedIfc(sampleModel(), idb);
    expect(await readCachedIfc(ifcCacheKey('hytta.ifc', 1234), idb)).not.toBeNull();
    expect(await clearCachedIfc(idb)).toBe(true);
    expect(await readCachedIfc(ifcCacheKey('hytta.ifc', 1234), idb)).toBeNull();
  });

  it('fails soft without a usable IndexedDB', async () => {
    const { idb } = fakeIndexedDB({ failOpen: true });
    expect(await readCachedIfc('x|1', idb)).toBeNull();
    expect(await writeCachedIfc(sampleModel(), idb)).toBe(false);
    expect(await clearCachedIfc(idb)).toBe(false);
    // Node has no indexedDB at all
    expect(await readCachedIfc('x|1')).toBeNull();
  });
});

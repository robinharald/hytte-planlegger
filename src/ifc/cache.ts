/**
 * Per-device cache of parsed IFC models in IndexedDB (database 'hytte-planlegger-ifc', store 'models'), keyed by the
 * file's name and size: picking the same file again, or reloading the app, shows the overlay without loading web-ifc.
 * The record holds the parsed meshes and sections (typed arrays, structured-cloned), never the IFC file itself.
 * Every call fails soft (private mode, blocked storage, quota): reads give null, writes false.
 */
import { PARSER_VERSION } from './types';
import type { ParsedIfc } from './types';

export const IFC_DB_NAME = 'hytte-planlegger-ifc';
const STORE = 'models';
const DB_VERSION = 1;

interface CacheRecord {
  key: string;
  savedAt: string;
  model: ParsedIfc;
}

export function ifcCacheKey(name: string, size: number): string {
  return `${name}|${size}`;
}

function factory(idb?: IDBFactory): IDBFactory | null {
  try {
    return idb ?? globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(IFC_DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function withStore<T>(idb: IDBFactory | undefined, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const f = factory(idb);
  if (!f) throw new Error('no IndexedDB');
  const db = await openDb(f);
  try {
    const tx = db.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    const result = await request(fn(tx.objectStore(STORE)));
    await done;
    return result;
  } finally {
    db.close();
  }
}

/** The cached model for this key, or null (none, another parser version, or no IndexedDB). */
export async function readCachedIfc(key: string, idb?: IDBFactory): Promise<ParsedIfc | null> {
  try {
    const rec = (await withStore(idb, 'readonly', (s) => s.get(key))) as CacheRecord | undefined;
    return rec && rec.model && rec.model.version === PARSER_VERSION ? rec.model : null;
  } catch {
    return null;
  }
}

export async function writeCachedIfc(model: ParsedIfc, idb?: IDBFactory): Promise<boolean> {
  try {
    const rec: CacheRecord = { key: ifcCacheKey(model.fileName, model.fileSize), savedAt: new Date().toISOString(), model };
    await withStore(idb, 'readwrite', (s) => s.put(rec));
    return true;
  } catch {
    return false;
  }
}

/** Removes every cached model («Fjern»: the device keeps nothing of the file). */
export async function clearCachedIfc(idb?: IDBFactory): Promise<boolean> {
  try {
    await withStore(idb, 'readwrite', (s) => s.clear());
    return true;
  } catch {
    return false;
  }
}

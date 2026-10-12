/**
 * Test double of Firestore for familyStore tests (not used by the app): one in-memory "server" and any number of
 * devices (`FirestoreAdapter`s). Like the real SDK, a device sees its own writes at once (local cache + listeners),
 * other devices see them when they reach the server; while a device is offline its writes queue and `acked` waits.
 * `refuse` makes the server reject writes (rules), `signInFails` the anonymous sign-in.
 */
import type { AdapterDoc, Connectivity, FirestoreAdapter, SnapshotMeta, WriteOp } from './familyStore.firestore';

type Data = Record<string, unknown>;

export interface FakeDevice {
  adapter: FirestoreAdapter;
  connectivity: Connectivity;
  setOnline(online: boolean): void;
  /** Writes made offline that have not reached the server. */
  queued(): number;
}

export interface FakeFirestore {
  /** Server documents by full path. */
  docs: Map<string, Data>;
  device(opts?: { online?: boolean; signInFails?: boolean }): FakeDevice;
  /** Reject every write whose path matches (null = accept all). */
  refuse: ((path: string) => boolean) | null;
  /** Number of writes the server accepted. */
  writes: number;
}

const clone = (d: Data): Data => structuredClone(d);

function inCollection(path: string, collection: string): string | null {
  if (!path.startsWith(`${collection}/`)) return null;
  const rest = path.slice(collection.length + 1);
  return rest.includes('/') ? null : rest;
}

export function createFakeFirestore(): FakeFirestore {
  const devices = new Set<{ notify: () => void }>();
  const fake: FakeFirestore = {
    docs: new Map(),
    refuse: null,
    writes: 0,
    device(opts = {}) {
      let online = opts.online ?? true;
      /** Local writes not on the server yet (null = deleted). */
      const overlay = new Map<string, Data | null>();
      const queue: { ops: WriteOp[]; resolve: () => void; reject: (e: unknown) => void }[] = [];
      const watchers = new Set<{ path: string; onNext: (docs: AdapterDoc[], meta: SnapshotMeta) => void }>();
      const connectivityListeners = new Set<(online: boolean) => void>();

      const view = (collection: string): AdapterDoc[] => {
        const out = new Map<string, Data>();
        for (const [path, data] of fake.docs) {
          const id = inCollection(path, collection);
          if (id !== null) out.set(id, data);
        }
        for (const [path, data] of overlay) {
          const id = inCollection(path, collection);
          if (id === null) continue;
          if (data === null) out.delete(id);
          else out.set(id, data);
        }
        return [...out].map(([id, data]) => ({ id, data: clone(data) }));
      };
      const notify = () => {
        for (const w of watchers) w.onNext(view(w.path), { fromCache: !online, hasPendingWrites: queue.length > 0 });
      };
      const self = { notify };
      devices.add(self);

      const commit = () => {
        while (online && queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          const refused = item.ops.some((op) => fake.refuse?.(op.path));
          for (const op of item.ops) {
            if (!refused) {
              if (op.kind === 'set') fake.docs.set(op.path, clone(op.data));
              else fake.docs.delete(op.path);
            }
            overlay.delete(op.path);
          }
          if (refused) item.reject(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
          else {
            fake.writes += item.ops.length;
            item.resolve();
          }
        }
        for (const d of devices) d.notify();
      };

      const adapter: FirestoreAdapter = {
        async signIn() {
          if (opts.signInFails || !online) throw Object.assign(new Error('auth/network-request-failed'), { code: 'auth/network-request-failed' });
        },
        watch(path, onNext) {
          const w = { path, onNext };
          watchers.add(w);
          queueMicrotask(() => watchers.has(w) && onNext(view(path), { fromCache: !online, hasPendingWrites: queue.length > 0 }));
          return () => watchers.delete(w);
        },
        async read(path) {
          return view(path);
        },
        async get(path) {
          if (overlay.has(path)) {
            const d = overlay.get(path);
            return d ? clone(d) : null;
          }
          const d = fake.docs.get(path);
          return d ? clone(d) : null;
        },
        write(ops) {
          for (const op of ops) overlay.set(op.path, op.kind === 'set' ? clone(op.data) : null);
          let resolve!: () => void;
          let reject!: (e: unknown) => void;
          const acked = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
          });
          queue.push({ ops, resolve, reject });
          notify();
          if (online) queueMicrotask(commit);
          return { acked };
        },
        dispose() {
          watchers.clear();
          devices.delete(self);
        },
      };

      return {
        adapter,
        connectivity: {
          online: () => online,
          subscribe(cb) {
            connectivityListeners.add(cb);
            return () => connectivityListeners.delete(cb);
          },
        },
        setOnline(next) {
          online = next;
          for (const cb of connectivityListeners) cb(next);
          if (next) commit();
          else notify();
        },
        queued: () => queue.length,
      };
    },
  };
  return fake;
}

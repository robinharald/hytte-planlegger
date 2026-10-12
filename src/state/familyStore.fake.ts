/**
 * Test double of Firestore for familyStore tests (not used by the app): one in-memory "server" and any number of
 * devices (`FirestoreAdapter`s). Like the real SDK, a device sees its own writes at once (its queued writes applied
 * over the server's documents, in order — a field update to the newest version it knows), other devices see them
 * when they reach the server; while a device is offline its writes queue and `acked` waits. A batch is applied to the
 * server's CURRENT documents when it arrives (a `set` with `merge` keeps the fields it leaves out; an `update` of a
 * document that does not exist fails the batch, `not-found`). Documents with queued writes are flagged `pending` in
 * snapshots, also writes made on the device before a store was created on it (an offline reload). `refuse` makes
 * the server reject writes (rules), `signInFails` the anonymous sign-in.
 */
import { applyUpdate } from './familyStore.firestore';
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

/** `ops` applied in order on top of `get`; undefined = no document. Throws `not-found` for an update of a missing one. */
function applyOps(ops: readonly WriteOp[], get: (path: string) => Data | undefined): Map<string, Data | undefined> {
  const out = new Map<string, Data | undefined>();
  const cur = (path: string) => (out.has(path) ? out.get(path) : get(path));
  for (const op of ops) {
    if (op.kind === 'set') out.set(op.path, op.merge ? { ...(cur(op.path) ?? {}), ...clone(op.data) } : clone(op.data));
    else if (op.kind === 'delete') out.set(op.path, undefined);
    else {
      const d = cur(op.path);
      if (!d) throw Object.assign(new Error('not-found'), { code: 'not-found' });
      out.set(op.path, applyUpdate(d, op));
    }
  }
  return out;
}

export function createFakeFirestore(): FakeFirestore {
  const devices = new Set<{ notify: () => void }>();
  const fake: FakeFirestore = {
    docs: new Map(),
    refuse: null,
    writes: 0,
    device(opts = {}) {
      let online = opts.online ?? true;
      /** Writes not on the server yet, in order. */
      const queue: { ops: WriteOp[]; resolve: () => void; reject: (e: unknown) => void }[] = [];
      const idle: (() => void)[] = [];
      const watchers = new Set<{ path: string; onNext: (docs: AdapterDoc[], meta: SnapshotMeta) => void }>();
      const connectivityListeners = new Set<(online: boolean) => void>();

      /** This device's view of a document: the server's with the queued writes applied (an update of a missing one is skipped). */
      const local = (path: string): Data | undefined => {
        let d = fake.docs.get(path);
        for (const item of queue) {
          for (const op of item.ops) {
            if (op.path !== path) continue;
            if (op.kind === 'set') d = op.merge ? { ...(d ?? {}), ...op.data } : op.data;
            else if (op.kind === 'delete') d = undefined;
            else if (d) d = applyUpdate(d, op);
          }
        }
        return d;
      };
      const queuedPaths = () => new Set(queue.flatMap((q) => q.ops.map((op) => op.path)));

      const view = (collection: string): AdapterDoc[] => {
        const pending = queuedPaths();
        const ids = new Set<string>();
        for (const path of [...fake.docs.keys(), ...pending]) {
          const id = inCollection(path, collection);
          if (id !== null) ids.add(id);
        }
        const out: AdapterDoc[] = [];
        for (const id of ids) {
          const path = `${collection}/${id}`;
          const d = local(path);
          if (d) out.push({ id, data: clone(d), pending: pending.has(path) });
        }
        return out;
      };
      const meta = (): SnapshotMeta => ({ fromCache: !online, hasPendingWrites: queue.length > 0 });
      const notify = () => {
        for (const w of watchers) w.onNext(view(w.path), meta());
      };
      const self = { notify };
      devices.add(self);

      const commit = () => {
        while (online && queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          let error: unknown = null;
          let result: Map<string, Data | undefined> | null = null;
          if (item.ops.some((op) => fake.refuse?.(op.path))) error = Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
          else {
            try {
              result = applyOps(item.ops, (path) => fake.docs.get(path));
            } catch (e) {
              error = e;
            }
          }
          if (result) {
            for (const [path, d] of result) {
              if (d) fake.docs.set(path, d);
              else fake.docs.delete(path);
            }
            fake.writes += item.ops.length;
            item.resolve();
          } else item.reject(error);
        }
        if (queue.length === 0) for (const r of idle.splice(0)) r();
        for (const d of devices) d.notify();
      };

      const adapter: FirestoreAdapter = {
        async signIn() {
          if (opts.signInFails || !online) throw Object.assign(new Error('auth/network-request-failed'), { code: 'auth/network-request-failed' });
        },
        watch(path, onNext) {
          const w = { path, onNext };
          watchers.add(w);
          queueMicrotask(() => watchers.has(w) && onNext(view(path), meta()));
          return () => watchers.delete(w);
        },
        async read(path) {
          return view(path);
        },
        async get(path) {
          const d = local(path);
          return d ? clone(d) : null;
        },
        write(ops) {
          let resolve!: () => void;
          let reject!: (e: unknown) => void;
          const acked = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
          });
          queue.push({ ops: ops.map((op) => (op.kind === 'delete' ? op : { ...op, data: clone(op.data) })), resolve, reject });
          notify();
          if (online) queueMicrotask(commit);
          return { acked };
        },
        waitForPendingWrites() {
          if (queue.length === 0) return Promise.resolve();
          return new Promise<void>((r) => idle.push(r));
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

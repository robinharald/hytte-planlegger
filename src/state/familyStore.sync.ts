/**
 * Keeps the app store (state/store.ts: one Project whose variants are Forslag D + the family's proposals) and a
 * FamilyStore in step (docs/phase2-plan.md §5). The store stays the single source for the UI; this module only
 * translates differences:
 *
 * Out (debounced autosave, `delayMs` after the last change, and on `flush()`):
 *  - an unlocked variant the family store does not know yet → saved as a new proposal (`base: null`; a proposal in
 *    the Papirkurv with that id is restored and overwritten — that is how Angre of a delete comes back);
 *  - a known variant whose object changed → `saveProposal(variant, { base: <remote updatedAt> })`;
 *  - a known variant that is gone from the project (Slett, after its two confirmations) → `deleteProposal` (soft);
 *    when it comes back unchanged (Angre) → `restoreProposal`, a field update like the delete, so a version saved
 *    elsewhere meanwhile stays (and is shown here).
 *  The locked base (Forslag D) is never written, and nothing is written while a drag (transaction) is in progress.
 *
 * In (the live list):
 *  - a new proposal → added as a variant; a removed one (deleted elsewhere) → removed; a changed one → replaced —
 *    unless the variant here has edits that are not saved yet: then it is a CONFLICT ("«X» ble endret av Pappa …
 *    [Hent endringene] [Lagre over]") and that proposal is neither saved nor replaced until `resolveConflict`.
 *  - Remote changes never become undo steps: the undo history is rebased (every past / future snapshot gets the same
 *    replacement), so Angre only ever undoes this device's own edits and can never write an old version of someone
 *    else's change back. They wait while a drag (transaction) is in progress, and the selection is kept.
 *  - The echo of an own write is recognised by its stamp (`at`, which this module chooses), so a save racing with
 *    further edits is never mistaken for someone else's change. A field update (delete / restore from an old view)
 *    can bring other content under a stamp this device knows: that counts as a change too.
 *  - A version saved here that another device overwrote or DELETED without having seen it (an offline device) is
 *    reported in `overwritten` (the overwritten one is kept as a revision; the deleted one is in the Papirkurv with
 *    this version's content). Leaving the page while a conflict is open asks first (`beforeunload`).
 *
 * State for the UI (`getState` / `subscribe`): phase, saving / pending / online for the status pill, proposal
 * metadata for the menu ("sist endret av …"), the Papirkurv, conflicts, proposals of a newer app version.
 */
import type { AppStore } from './store';
import type { Id, Project, Variant } from '../model/types';
import { createStamper, sameContent } from './familyStore';
import type { FamilyMode, FamilyStore, FamilyStoreStatus, Proposal, ProposalList, ProposalMeta } from './familyStore';

export interface Conflict {
  id: Id;
  /** The proposal's name on this device. */
  name: string;
  /** 'changed': saved elsewhere since this device's version; 'deleted': deleted elsewhere. */
  kind: 'changed' | 'deleted';
  /** Who changed or deleted it, and when (from the stored version; null / '' when unknown). */
  by: string | null;
  at: string | null;
}

/**
 * A version saved here that another device overwrote ('changed': kept under Tidligere versjoner) or deleted
 * ('deleted': the Papirkurv has it) without having seen it.
 */
export interface Overwritten {
  id: Id;
  name: string;
  by: string | null;
  at: string;
  /** Absent = 'changed'. */
  kind?: 'changed' | 'deleted';
}

export interface SyncState {
  mode: FamilyMode;
  familyId: string | null;
  phase: FamilyStoreStatus['phase'];
  /** Edits waiting for the debounce or being handed to the store. */
  saving: boolean;
  /** Writes not yet confirmed by the server (shared). */
  pending: number;
  online: boolean;
  /** A write failed (quota here; refused there) — retried automatically. */
  failed: boolean;
  meta: Readonly<Record<Id, ProposalMeta>>;
  trash: readonly ProposalMeta[];
  tooNew: readonly ProposalMeta[];
  conflicts: readonly Conflict[];
  overwritten: readonly Overwritten[];
}

export interface ProposalSync {
  getState(): SyncState;
  subscribe(cb: (s: SyncState) => void): () => void;
  /** Write the edits made so far now (the debounce is skipped). */
  flush(): Promise<void>;
  /** `flush`, then wait (at most `timeoutMs`) until the server has every write — before "Oppdater" reloads. */
  flushAll(timeoutMs?: number): Promise<void>;
  /** 'fetch' = "Hent endringene" (the stored version replaces this one), 'overwrite' = "Lagre over". */
  resolveConflict(id: Id, choice: 'fetch' | 'overwrite'): Promise<void>;
  /** Back from the Papirkurv into the project; true when it is there now. */
  restoreFromTrash(id: Id): Promise<boolean>;
  /** "Gjenopprett tidligere versjon" (pending edits are saved first, so they become a revision too). */
  restoreRevision(id: Id, revisionId: string): Promise<boolean>;
  /** Show this proposal (when it is in the project) without an undo step. */
  activate(id: Id): boolean;
  /** Close the "overwritten" notice of a proposal. */
  dismissOverwritten(id: Id): void;
  /**
   * Add variants made outside the store's actions (an opened link, an old autosave) without an undo step; they are
   * saved like new proposals. Ids already in the project are skipped. `activate` shows one of them. `at`: the time
   * to stamp their first save with (an old autosave keeps its own "sist endret"), 1 ms later for each next one so
   * they keep their order.
   */
  addVariants(variants: Variant[], activate?: Id, opts?: { at?: string }): void;
  /** The list the family store reported last. */
  lastList(): ProposalList;
  stop(): void;
}

export interface ProposalSyncOptions {
  store: AppStore;
  family: FamilyStore;
  /** Debounce of the autosave (ms). */
  delayMs?: number;
  /** Never written: the locked base (default `variant.locked === true`). */
  isBase?: (v: Variant) => boolean;
  now?: () => number;
  /** Window-like target: flush on `pagehide` / `beforeunload`. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** The first time something is saved while the device has no name yet (shared mode asks "Hva heter du?"). */
  onNeedsName?: () => void;
  /** After a proposal was saved (the legacy import uses it to retire the old autosave). */
  onSaved?: (id: Id) => void;
  /** After this device saved a NEW proposal into the store (not a restore or an overwrite). */
  onCreated?: (id: Id) => void;
  /** After a list was merged for the first time. */
  onFirstList?: (list: ProposalList) => void;
  /** Retry delay after a failed write (ms; doubles up to a minute). */
  retryMs?: number;
}

const MAX_RETRY_MS = 60_000;

export function createProposalSync(opts: ProposalSyncOptions): ProposalSync {
  const { store, family } = opts;
  const delayMs = opts.delayMs ?? 500;
  const isBase = opts.isBase ?? ((v: Variant) => v.locked === true);
  const stamp = createStamper(opts.now);
  const baseRetry = opts.retryMs ?? 5_000;

  /** Proposals this device has in step: the stored version and the store's variant object that equals it. */
  const known = new Map<Id, { remote: Proposal; local: Variant }>();
  const conflicts = new Map<Id, { conflict: Conflict; remote: Proposal | null }>();
  /** `${id}@${at}` of own writes not yet seen in a list → the variant written. */
  const own = new Map<string, Variant>();
  /** Versions this device wrote (`${id}@${updatedAt}`): to notice one overwritten unseen. */
  const ownVersions = new Set<string>();
  const overwritten = new Map<Id, Overwritten>();
  const deleting = new Set<Id>();
  /** The last state of variants that left the project (a delete): saved before the soft delete when it was newer. */
  const lastSeen = new Map<Id, Variant>();
  /** Content of proposals this device deleted: when one comes back unchanged (Angre), it is restored, not rewritten. */
  const removedHere = new Map<Id, Variant>();
  /** Stamp for the first save of variants added with `addVariants(…, { at })`. */
  const firstAt = new Map<Id, string>();
  const failed = new Set<Id>();
  const listeners = new Set<(s: SyncState) => void>();

  let lastList: ProposalList = { proposals: [], trash: [], tooNew: [] };
  let listSeen = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deferTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = baseRetry;
  let busy = 0;
  let chain: Promise<void> = Promise.resolve();
  let askedName = false;
  let stopped = false;
  let state: SyncState = computeState();

  function computeState(): SyncState {
    const s = family.status();
    const meta: Record<Id, ProposalMeta> = {};
    for (const [id, k] of known) {
      const { variant: _variant, ...m } = k.remote;
      meta[id] = m;
    }
    return {
      mode: family.mode,
      familyId: family.familyId,
      phase: s.phase,
      saving: timer !== null || busy > 0,
      pending: s.pending,
      online: s.online,
      failed: failed.size > 0,
      meta,
      trash: lastList.trash,
      tooNew: lastList.tooNew,
      conflicts: [...conflicts.values()].map((c) => c.conflict),
      overwritten: [...overwritten.values()],
    };
  }

  const emitState = () => {
    if (stopped) return;
    state = computeState();
    for (const l of listeners) l(state);
  };

  // --- applying changes to the store (no undo step, history rebased) -------------------------------------------

  /**
   * True while `applyChanges` replaces the project: what it brings in is already stored (a remote change, a fetched
   * version, a restore), so the store subscription does not start a save for it — the pill stayed on "Lagrer …" for
   * a second whenever another device's change arrived. (`addVariants` schedules its own save.)
   */
  let applying = false;

  /** Replace / add (Variant) or remove (null) variants in the project, its undo history, and optionally activate one. */
  const applyChanges = (changes: Map<Id, Variant | null>, activate?: Id): void => {
    const s = store.getState();
    const current = s.project;
    if (changes.size === 0 && (activate === undefined || activate === current.activeVariantId)) return;
    const rebase = (p: Project, setActive?: Id): Project => {
      let touched = false;
      const variants: Variant[] = [];
      const seen = new Set<Id>();
      for (const v of p.variants) {
        seen.add(v.id);
        if (!changes.has(v.id)) {
          variants.push(v);
          continue;
        }
        touched = true;
        const next = changes.get(v.id);
        if (next) variants.push(next);
      }
      for (const [id, next] of changes) {
        if (next && !seen.has(id)) {
          variants.push(next);
          touched = true;
        }
      }
      let activeVariantId = p.activeVariantId;
      if (setActive !== undefined && variants.some((v) => v.id === setActive)) activeVariantId = setActive;
      if (!variants.some((v) => v.id === activeVariantId)) activeVariantId = (variants.find(isBase) ?? variants[0])?.id ?? activeVariantId;
      if (!touched && activeVariantId === p.activeVariantId) return p;
      return { ...p, variants, activeVariantId };
    };
    const next = rebase(current, activate);
    if (next === current) return;
    const history = s.history();
    const selection = s.ui.selection;
    const keepSelection = next.activeVariantId === current.activeVariantId && !changes.has(current.activeVariantId);
    applying = true;
    try {
      s.replaceProject(next, {}, { past: history.past.map((p) => rebase(p)), future: history.future.map((p) => rebase(p)) });
    } finally {
      applying = false;
    }
    if (keepSelection && selection) store.getState().select(selection);
  };

  // --- in ------------------------------------------------------------------------------------------------------

  const addConflict = (id: Id, name: string, remote: Proposal | null) => {
    const trashed = remote ? null : lastList.trash.find((t) => t.id === id);
    conflicts.set(id, {
      remote,
      conflict: {
        id,
        name,
        kind: remote ? 'changed' : 'deleted',
        by: remote ? remote.updatedBy : (trashed?.updatedBy ?? null),
        at: remote ? remote.updatedAt : (trashed?.deletedAt ?? null),
      },
    });
  };

  /**
   * `mine` (a version this device saved) was followed by `next`, which does not descend from it: another device
   * wrote over it without having seen it (its save was queued offline). Keep `mine` as a revision and tell the user.
   */
  const rescueIfOverwritten = (mine: Proposal, next: Proposal) => {
    if (!ownVersions.has(`${mine.id}@${mine.updatedAt}`) || next.lineage.includes(mine.updatedAt)) return;
    if (sameContent(mine.variant, next.variant)) return;
    void family.keepRevision(mine.id, mine.variant, { savedAt: mine.updatedAt, savedBy: mine.updatedBy });
    overwritten.set(mine.id, { id: mine.id, name: mine.name, by: next.updatedBy, at: next.updatedAt, kind: 'changed' });
  };

  /**
   * `mine` (the version this device knows) went into the Papirkurv: when this device saved it and the delete was made
   * from an older version (its lineage lacks `mine`: an offline device), say so — the Papirkurv has this version.
   */
  const tellIfDeletedUnseen = (mine: Proposal, list: ProposalList, name: string) => {
    if (!ownVersions.has(`${mine.id}@${mine.updatedAt}`)) return;
    const t = list.trash.find((x) => x.id === mine.id);
    if (!t || t.lineage.includes(mine.updatedAt)) return;
    overwritten.set(mine.id, { id: mine.id, name, by: t.updatedBy, at: t.deletedAt ?? t.updatedAt, kind: 'deleted' });
  };

  const applyList = (list: ProposalList): void => {
    lastList = list;
    if (stopped) return;
    if (store.getState().inTransaction()) {
      // A drag is in progress: merge when it is over.
      if (deferTimer === null) {
        deferTimer = setTimeout(() => {
          deferTimer = null;
          applyList(lastList);
        }, 250);
      }
      return;
    }
    const first = !listSeen;
    listSeen = true;
    const project = store.getState().project;
    const local = new Map(project.variants.map((v) => [v.id, v]));
    const changes = new Map<Id, Variant | null>();
    const remoteIds = new Set<Id>();
    for (const p of list.proposals) {
      remoteIds.add(p.id);
      if (deleting.has(p.id)) continue;
      const key = `${p.id}@${p.updatedAt}`;
      const mine = own.get(key);
      if (mine) {
        // The echo of an own write: in step with what was written (later edits are saved by the next flush).
        own.delete(key);
        ownVersions.add(key);
        known.set(p.id, { remote: p, local: mine });
        continue;
      }
      const k = known.get(p.id);
      const lv = local.get(p.id);
      if (lv && isBase(lv)) continue;
      if (!k) {
        if (!lv) {
          changes.set(p.id, p.variant);
          known.set(p.id, { remote: p, local: p.variant });
        } else if (sameContent(lv, p.variant)) {
          // A variant this device had before it knew the stored one (legacy import, a race at start-up): adopt.
          known.set(p.id, { remote: p, local: lv });
        } else if (!conflicts.has(p.id)) {
          addConflict(p.id, lv.name, p);
        }
        continue;
      }
      // Same stamp: unchanged — unless a field update (a delete / restore made from an old view) landed on other content.
      if (p.updatedAt === k.remote.updatedAt && (p.variant === k.remote.variant || sameContent(p.variant, k.remote.variant))) {
        if (k.remote !== p) known.set(p.id, { remote: p, local: k.local });
        continue;
      }
      // Saved elsewhere since this device's version.
      rescueIfOverwritten(k.remote, p);
      if (!lv || failed.has(p.id)) {
        // Deleted here (the flush deletes it), or a refused write rolled back (the retry writes it again).
        known.set(p.id, { remote: p, local: k.local });
        continue;
      }
      if (lv === k.local || sameContent(lv, k.local)) {
        changes.set(p.id, p.variant);
        known.set(p.id, { remote: p, local: p.variant });
        conflicts.delete(p.id);
      } else if (sameContent(lv, p.variant)) {
        known.set(p.id, { remote: p, local: lv });
        conflicts.delete(p.id);
      } else {
        addConflict(p.id, lv.name, p);
      }
    }
    for (const [id, k] of [...known]) {
      if (remoteIds.has(id) || deleting.has(id) || failed.has(id)) continue;
      const lv = local.get(id);
      if (!lv) {
        known.delete(id);
      } else if (lv === k.local || sameContent(lv, k.local)) {
        changes.set(id, null);
        known.delete(id);
        conflicts.delete(id);
        tellIfDeletedUnseen(k.remote, list, lv.name);
      } else if (!conflicts.has(id)) {
        addConflict(id, lv.name, null);
      }
    }
    applyChanges(changes);
    if (first) {
      opts.onFirstList?.(list);
      schedule(0);
    }
    emitState();
  };

  // --- out -----------------------------------------------------------------------------------------------------

  const maybeAskName = () => {
    if (askedName || family.mode !== 'shared' || family.whoAmI() !== null) return;
    askedName = true;
    opts.onNeedsName?.();
  };

  const scheduleRetry = () => {
    if (retryTimer !== null || stopped) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush();
    }, retryDelay);
    retryDelay = Math.min(MAX_RETRY_MS, retryDelay * 2);
  };

  const save = async (v: Variant, k: { remote: Proposal; local: Variant } | undefined): Promise<void> => {
    maybeAskName();
    const given = k ? undefined : firstAt.get(v.id);
    firstAt.delete(v.id);
    const at = given ?? stamp(k?.remote.updatedAt);
    const key = `${v.id}@${at}`;
    own.set(key, v);
    const force = failed.has(v.id);
    const r = await family.saveProposal(v, { base: k ? k.remote.updatedAt : null, at, force });
    if (r.status === 'saved') {
      own.delete(key);
      ownVersions.add(`${v.id}@${r.proposal.updatedAt}`);
      known.set(v.id, { remote: r.proposal, local: v });
      failed.delete(v.id);
      removedHere.delete(v.id);
      if (failed.size === 0) retryDelay = baseRetry;
      if (!k && r.proposal.createdAt === r.proposal.updatedAt) opts.onCreated?.(v.id);
      opts.onSaved?.(v.id);
      return;
    }
    own.delete(key);
    if (r.status === 'conflict') {
      addConflict(v.id, v.name, r.remote);
    } else {
      failed.add(v.id);
      scheduleRetry();
    }
  };

  const remove = async (id: Id, content: Variant): Promise<void> => {
    deleting.add(id);
    known.delete(id);
    conflicts.delete(id);
    removedHere.set(id, content);
    try {
      await family.deleteProposal(id, { at: stamp() });
    } finally {
      deleting.delete(id);
    }
  };

  /** Angre of a delete with nothing changed: back from the Papirkurv as it is there (a version saved meanwhile stays). */
  const restore = async (v: Variant): Promise<void> => {
    removedHere.delete(v.id);
    const p = await family.restoreProposal(v.id, { at: stamp() });
    if (!p) return save(v, undefined);
    known.set(v.id, { remote: p, local: v });
  };

  const doFlush = async (): Promise<void> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!listSeen || stopped) return;
    const s = store.getState();
    if (s.ui.readOnly) return;
    // A drag in progress: its in-between states are never written (others would see a half-finished move).
    if (s.inTransaction()) {
      schedule(250);
      return;
    }
    const jobs: Promise<void>[] = [];
    const ids = new Set<Id>();
    for (const v of s.project.variants) {
      ids.add(v.id);
      if (isBase(v) || conflicts.has(v.id)) continue;
      const k = known.get(v.id);
      if (k && k.local === v && !failed.has(v.id)) continue;
      if (k && !failed.has(v.id) && sameContent(k.local, v)) {
        k.local = v;
        continue;
      }
      const gone = k ? undefined : removedHere.get(v.id);
      jobs.push(gone && lastList.trash.some((t) => t.id === v.id) && sameContent(gone, v) ? restore(v) : save(v, k));
    }
    for (const [id, k] of [...known]) {
      if (ids.has(id)) continue;
      const last = lastSeen.get(id);
      lastSeen.delete(id);
      // Edits made just before the delete (within the debounce) are saved first, so the Papirkurv has them.
      const saveFirst = last && !conflicts.has(id) && !sameContent(last, k.local);
      jobs.push(saveFirst ? save(last, k).then(() => remove(id, last)) : remove(id, last ?? k.local));
    }
    if (jobs.length === 0) return;
    busy++;
    emitState();
    try {
      await Promise.all(jobs);
    } finally {
      busy--;
      emitState();
    }
  };

  /** Write what changed; the state is reported afterwards also when there was nothing to write (`saving` ends). */
  const flush = (): Promise<void> => {
    // An unexpected failure (never a conflict or a refused write: those are results) is retried, never thrown at callers.
    const run = () =>
      doFlush()
        .catch(() => scheduleRetry())
        .finally(emitState);
    chain = chain.then(run, run);
    return chain;
  };

  function schedule(ms: number = delayMs): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
    if (!state.saving) emitState();
  }

  // --- wiring --------------------------------------------------------------------------------------------------

  const unsubscribeStore = store.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    if (s.project.variants !== prev.project.variants) {
      const now = new Set(s.project.variants.map((v) => v.id));
      for (const v of prev.project.variants) if (!now.has(v.id) && !isBase(v) && known.has(v.id)) lastSeen.set(v.id, v);
      for (const id of now) lastSeen.delete(id);
    }
    if (!applying) schedule();
  });
  const unsubscribeList = family.listProposals(applyList);
  const unsubscribeStatus = family.onStatus(() => emitState());
  const unsubscribeWriteErrors = family.onWriteError((id) => {
    failed.add(id);
    scheduleRetry();
    emitState();
  });
  const onLeave = (e: Event) => {
    void flush();
    // Edits waiting for "Hent endringene" / "Lagre over" are not saved: ask before the page goes (desktop browsers;
    // `pagehide` cannot ask, and iOS has no `beforeunload`).
    if (e.type === 'beforeunload' && conflicts.size > 0 && !stopped) {
      e.preventDefault();
      (e as BeforeUnloadEvent).returnValue = '';
    }
  };
  opts.target?.addEventListener('pagehide', onLeave);
  opts.target?.addEventListener('beforeunload', onLeave);

  return {
    getState: () => state,

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    flush,

    async flushAll(timeoutMs = 4_000) {
      await flush();
      await Promise.race([family.flush(), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
    },

    async resolveConflict(id, choice) {
      const c = conflicts.get(id);
      if (!c) return;
      conflicts.delete(id);
      if (choice === 'fetch') {
        const changes = new Map<Id, Variant | null>();
        if (c.remote) {
          changes.set(id, c.remote.variant);
          known.set(id, { remote: c.remote, local: c.remote.variant });
        } else {
          changes.set(id, null);
          known.delete(id);
        }
        applyChanges(changes);
        emitState();
        return;
      }
      const v = store.getState().project.variants.find((x) => x.id === id);
      emitState();
      if (!v) return;
      await (chain = chain.then(async () => {
        const at = stamp(c.remote?.updatedAt);
        own.set(`${id}@${at}`, v);
        const r = await family.saveProposal(v, { base: null, force: true, at });
        if (r.status === 'saved') {
          ownVersions.add(`${id}@${r.proposal.updatedAt}`);
          known.set(id, { remote: r.proposal, local: v });
        }
        else {
          failed.add(id);
          scheduleRetry();
        }
      }));
      emitState();
    },

    async restoreFromTrash(id) {
      const p = await family.restoreProposal(id, { at: stamp() });
      if (!p) return false;
      if (!store.getState().project.variants.some((v) => v.id === id)) {
        known.set(id, { remote: p, local: p.variant });
        applyChanges(new Map([[id, p.variant]]));
      }
      emitState();
      return store.getState().project.variants.some((v) => v.id === id);
    },

    async restoreRevision(id, revisionId) {
      await flush();
      if (conflicts.has(id)) return false;
      const r = await family.restoreRevision(id, revisionId, { at: stamp(known.get(id)?.remote.updatedAt) });
      if (r.status !== 'saved') return false;
      known.set(id, { remote: r.proposal, local: r.proposal.variant });
      applyChanges(new Map([[id, r.proposal.variant]]));
      emitState();
      return true;
    },

    addVariants(variants, activate, o = {}) {
      const present = new Set(store.getState().project.variants.map((v) => v.id));
      const fresh = variants.filter((v) => !present.has(v.id));
      const t = o.at ? Date.parse(o.at) : NaN;
      if (Number.isFinite(t)) fresh.forEach((v, i) => firstAt.set(v.id, new Date(t + i).toISOString()));
      applyChanges(new Map(fresh.map((v) => [v.id, v] as const)), activate);
      if (fresh.length > 0) schedule(0);
    },

    lastList: () => lastList,

    dismissOverwritten(id) {
      if (overwritten.delete(id)) emitState();
    },

    activate(id) {
      if (!store.getState().project.variants.some((v) => v.id === id)) return false;
      applyChanges(new Map(), id);
      return true;
    },

    stop() {
      stopped = true;
      for (const t of [timer, deferTimer, retryTimer]) if (t !== null) clearTimeout(t);
      timer = deferTimer = retryTimer = null;
      unsubscribeStore();
      unsubscribeList();
      unsubscribeStatus();
      unsubscribeWriteErrors();
      opts.target?.removeEventListener('pagehide', onLeave);
      opts.target?.removeEventListener('beforeunload', onLeave);
      listeners.clear();
    },
  };
}

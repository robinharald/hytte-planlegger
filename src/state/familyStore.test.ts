/**
 * The family store (docs/phase2-plan.md §5): document format and rules (familyStore.ts), the localStorage store and
 * the Firestore store on the fake Firestore (familyStore.fake.ts) — save, list, conflict guard, soft delete /
 * Papirkurv / purge, revisions (≤ 1 per 5 min, ≤ 20), restore, rename, names, offline queue, refused writes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../model/types';
import type { Variant } from '../model/types';
import {
  cleanName,
  decodeProposalProject,
  encodeProposalProject,
  familyHash,
  familyLink,
  FAMILY_KEYS,
  hashHasFamily,
  isValidFamilyId,
  isValidProposalId,
  newFamilyId,
  parseHash,
  planSave,
  REVISION_INTERVAL_MS,
  REVISION_LIMIT,
  resolveFamilyMode,
  sameContent,
  TRASH_MS,
} from './familyStore';
import type { EncodeContext, FamilyStore, ProposalDoc, ProposalList } from './familyStore';
import { createLocalFamilyStore, LOCAL_KEYS } from './familyStore.local';
import { createFirestoreFamilyStore } from './familyStore.firestore';
import { createFakeFirestore } from './familyStore.fake';
import { createProposalSync } from './familyStore.sync';
import { createAppStore } from './store';
import { pillState } from '../ui/familyUi';
import { makeTestProject, makeVariant } from './testProject';

const T0 = Date.parse('2026-10-12T12:00:00.000Z');
const ctx: EncodeContext = { site: makeTestProject().site, seedRevision: 6 };
const context = () => ctx;

/** Map-backed Storage (+ a quota switch). */
function memoryStorage() {
  const map = new Map<string, string>();
  let full = false;
  return {
    map,
    setFull(v: boolean) {
      full = v;
    },
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new DOMException('full', 'QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

function clock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms), set: (ms: number) => void (t = ms) };
}

function proposalVariant(id: string, name = 'Mitt forslag'): Variant {
  const v = makeVariant(id, name);
  v.trees = [{ id: 'tree-1', position: [1, 2], height: 7, kind: 'bjork' }];
  v.ghosts = [{ id: 'g-1', a: [0, 0], b: [1, 0] }];
  return v;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('ids, links and mode', () => {
  it('family ids are 24–64 URL-safe characters; generated ones are 32', () => {
    expect(isValidFamilyId('a'.repeat(24))).toBe(true);
    expect(isValidFamilyId('a'.repeat(23))).toBe(false);
    expect(isValidFamilyId('a'.repeat(65))).toBe(false);
    expect(isValidFamilyId('abc/def-ghi-jkl-mno-pqr-st')).toBe(false);
    const id = newFamilyId();
    expect(id).toHaveLength(32);
    expect(isValidFamilyId(id)).toBe(true);
    expect(isValidProposalId('forslag-d')).toBe(true);
    expect(isValidProposalId('a/b')).toBe(false);
    expect(isValidProposalId('__x__')).toBe(false);
  });

  it('parses and builds #f= / #p= / #d= hashes', () => {
    const f = 'e2e-abcdefghijklmnopqrstuvwxyz';
    expect(parseHash(`#f=${f}&p=abc123`)).toEqual({ family: f, proposal: 'abc123', delta: null });
    expect(parseHash('#d=XYZ')).toEqual({ family: null, proposal: null, delta: 'XYZ' });
    expect(parseHash('#f=short')).toEqual({ family: null, proposal: null, delta: null });
    expect(hashHasFamily('#f=short')).toBe(true);
    expect(hashHasFamily('#d=x')).toBe(false);
    expect(familyHash(f, 'abc')).toBe(`#f=${f}&p=abc`);
    expect(familyHash(null, 'abc')).toBe('#p=abc');
    expect(familyHash(null)).toBe('');
    expect(familyLink('https://robinharald.github.io/hytte-planlegger/#old', f)).toBe(`https://robinharald.github.io/hytte-planlegger/#f=${f}`);
  });

  it('final fix round 6: a family link with what a sentence or a message adds after it still opens the family', () => {
    const f = 'e2e-abcdefghijklmnopqrstuvwxyz';
    for (const tail of ['.', ')', ',', ';', ':', '!', '?', ']', "'", '"', '»', '…', ').', '%29', '%C2%BB', '.%20']) {
      expect(parseHash(`#f=${f}${tail}`).family, tail).toBe(f);
    }
    expect(parseHash(`#f=${f}.&p=abc123`)).toEqual({ family: f, proposal: 'abc123', delta: null });
    // Only trailing characters go: a cut-off id stays broken, and so does one with other characters inside.
    expect(parseHash('#f=e2e-tooshort.').family).toBeNull();
    expect(parseHash(`#f=${f.slice(0, 10)}.${f.slice(10)}`).family).toBeNull();
  });

  it('last fix round 2: a generated (32-character) id with one trailing «_» or «-» is that id; other lengths keep theirs', () => {
    const g = 'e2e-generated-0123456789abcdefgh';
    expect(g).toHaveLength(32);
    for (const tail of ['_', '-', '_.', '-)', '_%20']) expect(parseHash(`#f=${g}${tail}`).family, tail).toBe(g);
    expect(parseHash(`#f=${g}__`).family).toBe(`${g}__`);
    expect(parseHash(`#f=${g}x`).family).toBe(`${g}x`);
    // An id of another length keeps its «_» / «-» (they are valid id characters).
    const f = 'e2e-abcdefghijklmnopqrstuvwxyz';
    expect(parseHash(`#f=${f}_`).family).toBe(`${f}_`);
  });

  it('shared only with a config, never in tests or under automation unless overridden', () => {
    expect(resolveFamilyMode({ hasConfig: false, storedOverride: 'shared' })).toBe('local');
    expect(resolveFamilyMode({ hasConfig: true })).toBe('shared');
    expect(resolveFamilyMode({ hasConfig: true, testMode: true })).toBe('local');
    expect(resolveFamilyMode({ hasConfig: true, webdriver: true })).toBe('local');
    expect(resolveFamilyMode({ hasConfig: true, webdriver: true, storedOverride: 'shared' })).toBe('shared');
    expect(resolveFamilyMode({ hasConfig: true, storedOverride: 'local' })).toBe('local');
    expect(resolveFamilyMode({ hasConfig: true, testMode: true, buildOverride: 'shared' })).toBe('shared');
  });

  it('names are trimmed and capped; empty is null', () => {
    expect(cleanName('  Mamma  ')).toBe('Mamma');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(80))).toHaveLength(40);
  });
});

describe('documents', () => {
  it('a proposal round-trips with its trees and ghosts; locked and meta never stored', () => {
    const v = { ...proposalVariant('p-1'), locked: true, meta: { updatedBy: 'x' } };
    const text = encodeProposalProject(v, ctx);
    expect(text).not.toContain('"locked"');
    expect(text).not.toContain('"meta"');
    const d = decodeProposalProject(text, 'p-1', 'Nytt navn');
    expect(d.status).toBe('ok');
    if (d.status !== 'ok') return;
    expect(d.variant.trees).toEqual(v.trees);
    expect(d.variant.ghosts).toEqual(v.ghosts);
    expect(d.variant.name).toBe('Nytt navn');
    expect(d.variant.locked).toBeUndefined();
    expect(sameContent(d.variant, { ...v, name: 'Nytt navn' })).toBe(true);
    // Deterministic: the same content gives the same text.
    expect(encodeProposalProject(v, ctx)).toBe(text);
  });

  it('a document of a newer app version is recognised, garbage is invalid', () => {
    const text = JSON.stringify({ ...JSON.parse(encodeProposalProject(proposalVariant('p'), ctx)), schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(decodeProposalProject(text, 'p', 'x').status).toBe('too-new');
    expect(decodeProposalProject('{', 'p', 'x').status).toBe('invalid');
    expect(decodeProposalProject('{}', 'p', 'x').status).toBe('invalid');
  });

  it('planSave: conflict guard, deleted proposals, one revision per 5 minutes, at most 20', () => {
    const v = proposalVariant('p-1');
    const fresh = planSave(undefined, v, { base: null, at: '2026-10-12T12:00:00.000Z', by: 'Mamma' }, ctx);
    expect(fresh.kind).toBe('write');
    if (fresh.kind !== 'write') return;
    expect(fresh.doc).toMatchObject({ createdBy: 'Mamma', updatedBy: 'Mamma', deletedAt: null, revisions: [], lastRevisionAt: null });
    expect(fresh.revision).toBeNull();
    const cur = fresh.doc;
    expect(planSave(cur, v, { base: 'other', at: 'x', by: null }, ctx)).toEqual({ kind: 'conflict', remote: 'current' });
    expect(planSave(undefined, v, { base: cur.updatedAt, at: 'x', by: null }, ctx)).toEqual({ kind: 'conflict', remote: 'deleted' });
    expect(planSave({ ...cur, deletedAt: cur.updatedAt }, v, { base: cur.updatedAt, at: 'x', by: null }, ctx)).toEqual({ kind: 'conflict', remote: 'deleted' });
    expect(planSave({ ...cur, deletedAt: cur.updatedAt }, v, { base: null, at: '2026-10-12T12:01:00.000Z', by: null }, ctx).kind).toBe('write');
    expect(planSave(cur, v, { base: 'other', force: true, at: '2026-10-12T12:01:00.000Z', by: null }, ctx).kind).toBe('write');

    const edited = { ...v, notes: 'endret' };
    const first = planSave(cur, edited, { base: cur.updatedAt, at: '2026-10-12T12:01:00.000Z', by: 'Pappa' }, ctx);
    if (first.kind !== 'write') throw new Error('expected a write');
    expect(first.revision?.doc).toMatchObject({ project: cur.project, savedAt: cur.updatedAt, savedBy: 'Mamma' });
    expect(first.doc.createdBy).toBe('Mamma');
    // Within 5 minutes of that revision: no new one.
    const second = planSave(first.doc, { ...v, notes: 'igjen' }, { base: first.doc.updatedAt, at: '2026-10-12T12:03:00.000Z', by: null }, ctx);
    expect(second.kind === 'write' && second.revision).toBe(null);
    // Unchanged content (rename only): no revision either.
    const renamed = planSave(first.doc, { ...edited, name: 'X' }, { base: first.doc.updatedAt, at: '2026-10-12T13:00:00.000Z', by: null }, ctx);
    expect(renamed.kind === 'write' && renamed.revision).toBe(null);
    // The 21st revision drops the oldest.
    const full: ProposalDoc = { ...first.doc, revisions: Array.from({ length: REVISION_LIMIT }, (_, i) => `r${i}`), lastRevisionAt: '2026-10-12T00:00:00.000Z' };
    const more = planSave(full, v, { base: full.updatedAt, at: '2026-10-12T14:00:00.000Z', by: null }, ctx);
    if (more.kind !== 'write') throw new Error('expected a write');
    expect(more.doc.revisions).toHaveLength(REVISION_LIMIT);
    expect(more.pruned).toEqual(['r0']);
    expect(more.doc.revisions.at(-1)).toBe(more.revision?.id);
  });
});

// ---------------------------------------------------------------------------
// Both implementations: the same contract
// ---------------------------------------------------------------------------

interface Harness {
  name: string;
  /** Two devices / tabs on the same data. */
  make(): { a: FamilyStore; b: FamilyStore; clock: ReturnType<typeof clock>; settle(): Promise<void> };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

function localHarness(): Harness {
  return {
    name: 'local',
    make() {
      const storage = memoryStorage();
      const c = clock();
      const a = createLocalFamilyStore({ storage, now: c.now, context });
      const b = createLocalFamilyStore({ storage, now: c.now, context });
      disposers.push(() => a.dispose(), () => b.dispose());
      return { a, b, clock: c, settle: tick };
    },
  };
}

function firestoreHarness(): Harness {
  return {
    name: 'firestore (fake)',
    make() {
      const fake = createFakeFirestore();
      const c = clock();
      const fid = 'e2e-family-abcdefghijklmnopqrstu';
      const mk = () => {
        const dev = fake.device();
        const s = createFirestoreFamilyStore({ adapter: dev.adapter, familyId: fid, storage: memoryStorage(), context, now: c.now, connectivity: dev.connectivity });
        disposers.push(() => s.dispose());
        return s;
      };
      return { a: mk(), b: mk(), clock: c, settle: async () => {
        for (let i = 0; i < 5; i++) await tick();
      } };
    },
  };
}

for (const h of [localHarness(), firestoreHarness()]) {
  describe(`FamilyStore contract: ${h.name}`, () => {
    it('saves, lists live and reads back a whole proposal', async () => {
      const { a, b, settle } = h.make();
      const seen: ProposalList[] = [];
      b.listProposals((l) => seen.push(l));
      a.setMyName('Mamma');
      const r = await a.saveProposal(proposalVariant('p-1'), { base: null });
      expect(r.status).toBe('saved');
      await settle();
      if (h.name === 'local') {
        // Another tab learns about it from a storage event (none in this test), or on its next read.
        expect((await b.getProposal('p-1'))?.createdBy).toBe('Mamma');
      } else {
        expect(seen.at(-1)?.proposals.map((p) => p.id)).toEqual(['p-1']);
      }
      const got = await b.getProposal('p-1');
      expect(got?.variant.trees).toHaveLength(1);
      expect(got?.variant.ghosts).toHaveLength(1);
      expect(got).toMatchObject({ name: 'Mitt forslag', createdBy: 'Mamma', updatedBy: 'Mamma', deletedAt: null });
    });

    it('conflict guard: a save based on an older version is refused until forced', async () => {
      const { a, b, settle, clock: c } = h.make();
      const r1 = await a.saveProposal(proposalVariant('p-1'), { base: null });
      if (r1.status !== 'saved') throw new Error('save');
      await settle();
      const base = r1.proposal.updatedAt;
      c.advance(60_000);
      b.setMyName('Pappa');
      await settle();
      const r2 = await b.saveProposal({ ...proposalVariant('p-1'), notes: 'Pappa' }, { base });
      expect(r2.status).toBe('saved');
      await settle();
      const r3 = await a.saveProposal({ ...proposalVariant('p-1'), notes: 'Mamma' }, { base });
      expect(r3.status).toBe('conflict');
      if (r3.status === 'conflict') expect(r3.remote).toMatchObject({ updatedBy: 'Pappa' });
      const r4 = await a.saveProposal({ ...proposalVariant('p-1'), notes: 'Mamma' }, { base, force: true });
      expect(r4.status).toBe('saved');
      expect((await b.getProposal('p-1'))?.variant.notes).toBe('Mamma');
    });

    it('soft delete → Papirkurv → restore; purged after 30 days with its revisions', async () => {
      const { a, settle, clock: c } = h.make();
      const p = await a.createProposal(proposalVariant('src', 'Forslag D'), 'Mitt forslag', { by: 'Mamma' });
      expect(p.variant.basedOnId).toBe('src');
      expect(p.variant.id).toBe(p.id);
      c.advance(10 * 60_000);
      await a.saveProposal({ ...p.variant, notes: 'endret' }, { base: p.updatedAt });
      expect(await a.listRevisions(p.id)).toHaveLength(1);
      await a.deleteProposal(p.id, { by: 'Pappa' });
      await settle();
      expect(a.currentList().proposals).toHaveLength(0);
      expect((await a.listTrash()).map((t) => [t.id, t.updatedBy])).toEqual([[p.id, 'Pappa']]);
      expect(await a.getProposal(p.id)).toBeNull();
      const back = await a.restoreProposal(p.id);
      expect(back?.variant.notes).toBe('endret');
      await settle();
      expect(a.currentList().trash).toHaveLength(0);
      await a.deleteProposal(p.id);
      c.advance(TRASH_MS - 1000);
      expect(await a.purgeTrash(new Date(c.now()))).toBe(0);
      c.advance(2000);
      expect(await a.purgeTrash(new Date(c.now()))).toBe(1);
      await settle();
      expect(a.currentList().trash).toHaveLength(0);
      expect(await a.listRevisions(p.id)).toEqual([]);
      expect(await a.restoreProposal(p.id)).toBeNull();
    });

    it('a deleted proposal saved with base null comes back (Angre of a delete); with its old base it is a conflict', async () => {
      const { a, settle } = h.make();
      const r = await a.saveProposal(proposalVariant('p-1'), { base: null });
      if (r.status !== 'saved') throw new Error('save');
      await a.deleteProposal('p-1');
      await settle();
      expect((await a.saveProposal(proposalVariant('p-1'), { base: r.proposal.updatedAt })).status).toBe('conflict');
      expect((await a.saveProposal(proposalVariant('p-1'), { base: null })).status).toBe('saved');
      await settle();
      expect(a.currentList().proposals.map((p) => p.id)).toEqual(['p-1']);
      expect(a.currentList().trash).toEqual([]);
    });

    it('revisions: one per save burst (≤ 1 per 5 min), at most 20, newest first; restore keeps the current one', async () => {
      const { a, clock: c } = h.make();
      const r = await a.saveProposal(proposalVariant('p-1'), { base: null, by: 'Mamma' });
      if (r.status !== 'saved') throw new Error('save');
      let base = r.proposal.updatedAt;
      const edit = async (notes: string, by: string) => {
        const s = await a.saveProposal({ ...proposalVariant('p-1'), notes }, { base, by });
        if (s.status !== 'saved') throw new Error(s.status);
        base = s.proposal.updatedAt;
      };
      await edit('1', 'Mamma');
      c.advance(60_000);
      await edit('2', 'Mamma'); // same burst
      expect(await a.listRevisions('p-1')).toHaveLength(1);
      c.advance(REVISION_INTERVAL_MS);
      await edit('3', 'Pappa');
      const revs = await a.listRevisions('p-1');
      expect(revs).toHaveLength(2);
      expect(revs[0].savedAt > revs[1].savedAt).toBe(true);
      expect(revs[0]).toMatchObject({ savedBy: 'Mamma', name: 'Mitt forslag' });
      for (let i = 0; i < 25; i++) {
        c.advance(REVISION_INTERVAL_MS);
        await edit(`n${i}`, 'Mamma');
      }
      expect(await a.listRevisions('p-1')).toHaveLength(REVISION_LIMIT);
      // Restore the newest revision (= "n23"); the current content ("n24") is kept as a revision first.
      const newest = (await a.listRevisions('p-1'))[0];
      c.advance(1000);
      const restored = await a.restoreRevision('p-1', newest.id, { by: 'Pappa' });
      expect(restored.status).toBe('saved');
      if (restored.status === 'saved') expect(restored.proposal.variant.notes).toBe('n23');
      const after = await a.listRevisions('p-1');
      expect(after).toHaveLength(REVISION_LIMIT);
      expect(after[0].savedBy).toBe('Mamma');
      const current = await a.getProposal('p-1');
      expect(current).toMatchObject({ updatedBy: 'Pappa', name: 'Mitt forslag' });
    });

    it('rename keeps the content and needs the current base', async () => {
      const { a } = h.make();
      const r = await a.saveProposal(proposalVariant('p-1'), { base: null });
      if (r.status !== 'saved') throw new Error('save');
      const renamed = await a.renameProposal('p-1', '  Hyttedrøm  ');
      expect(renamed.status).toBe('saved');
      expect((await a.getProposal('p-1'))?.name).toBe('Hyttedrøm');
      expect((await a.renameProposal('p-1', 'X', { base: r.proposal.updatedAt })).status).toBe('conflict');
      expect(await a.listRevisions('p-1')).toEqual([]);
    });

    it('whoAmI: null until asked, the name after, "" when declined', () => {
      const { a } = h.make();
      expect(a.whoAmI()).toBeNull();
      a.setMyName(' Mamma ');
      expect(a.whoAmI()).toBe('Mamma');
      a.setMyName('');
      expect(a.whoAmI()).toBe('');
    });
  });
}

// ---------------------------------------------------------------------------
// Local specifics
// ---------------------------------------------------------------------------

describe('local store', () => {
  it('stores compressed documents under its own keys and the name under hytte-planlegger:my-name', async () => {
    const storage = memoryStorage();
    const s = createLocalFamilyStore({ storage, context });
    disposers.push(() => s.dispose());
    s.setMyName('Robin');
    await s.saveProposal(proposalVariant('p-1'), { base: null });
    const raw = storage.map.get(LOCAL_KEYS.proposals) ?? '';
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).not.toContain('"walls"');
    expect(storage.map.get(FAMILY_KEYS.myName)).toBe('Robin');
    // A fresh instance (reload) reads it back.
    const again = createLocalFamilyStore({ storage, context });
    disposers.push(() => again.dispose());
    expect(again.currentList().proposals.map((p) => [p.id, p.createdBy])).toEqual([['p-1', 'Robin']]);
  });

  it('another tab: a storage event reports the new list', async () => {
    const storage = memoryStorage();
    const listeners = new Set<(e: StorageEvent) => void>();
    const target = {
      addEventListener: (_: string, l: (e: StorageEvent) => void) => void listeners.add(l),
      removeEventListener: (_: string, l: (e: StorageEvent) => void) => void listeners.delete(l),
    } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
    const tab1 = createLocalFamilyStore({ storage, target, context });
    const tab2 = createLocalFamilyStore({ storage, context });
    disposers.push(() => tab1.dispose(), () => tab2.dispose());
    const seen: string[][] = [];
    tab1.listProposals((l) => seen.push(l.proposals.map((p) => p.id)));
    await tick();
    await tab2.saveProposal(proposalVariant('p-2'), { base: null });
    for (const l of listeners) l({ key: LOCAL_KEYS.proposals } as StorageEvent);
    await tick();
    expect(seen.at(-1)).toEqual(['p-2']);
  });

  it('a full storage: the save fails as an error and nothing is half written', async () => {
    const storage = memoryStorage();
    const s = createLocalFamilyStore({ storage, context });
    disposers.push(() => s.dispose());
    storage.setFull(true);
    const r = await s.saveProposal(proposalVariant('p-1'), { base: null });
    expect(r).toEqual({ status: 'error', error: 'quota' });
    expect(s.currentList().proposals).toEqual([]);
    storage.setFull(false);
    expect((await s.saveProposal(proposalVariant('p-1'), { base: null })).status).toBe('saved');
  });

  it('without storage it still works for the page (nothing persists)', async () => {
    const s = createLocalFamilyStore({ storage: null, context });
    disposers.push(() => s.dispose());
    expect((await s.saveProposal(proposalVariant('p-1'), { base: null })).status).toBe('error');
    expect(s.status()).toMatchObject({ phase: 'ready', pending: 0 });
  });
});

// ---------------------------------------------------------------------------
// Firestore specifics (fake)
// ---------------------------------------------------------------------------

describe('Firestore store on the fake', () => {
  const fid = 'e2e-family-abcdefghijklmnopqrstu';

  it('writes only under families/{familyId}/proposals, with nothing but the proposal, the name and timestamps', async () => {
    const fake = createFakeFirestore();
    const dev = fake.device();
    const s = createFirestoreFamilyStore({ adapter: dev.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: dev.connectivity });
    disposers.push(() => s.dispose());
    s.setMyName('Mamma');
    const r = await s.saveProposal(proposalVariant('p-1'), { base: null });
    if (r.status !== 'saved') throw new Error('save');
    await tick();
    expect([...fake.docs.keys()]).toEqual([`families/${fid}/proposals/p-1`]);
    const doc = fake.docs.get(`families/${fid}/proposals/p-1`) ?? {};
    expect(Object.keys(doc).sort()).toEqual(['createdAt', 'createdBy', 'deletedAt', 'lastRevisionAt', 'lineage', 'name', 'project', 'revisions', 'schemaVersion', 'updatedAt', 'updatedBy']);
    expect(typeof doc.project).toBe('string');
    expect(JSON.stringify(doc)).not.toMatch(/userAgent|email|device|latitude/i);
  });

  it('offline: writes are seen here at once, pending until online, then reach the other device', async () => {
    const fake = createFakeFirestore();
    const mum = fake.device();
    const dad = fake.device();
    const a = createFirestoreFamilyStore({ adapter: mum.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: mum.connectivity });
    const b = createFirestoreFamilyStore({ adapter: dad.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: dad.connectivity });
    disposers.push(() => a.dispose(), () => b.dispose());
    const onDad: string[][] = [];
    b.listProposals((l) => onDad.push(l.proposals.map((p) => p.id)));
    await tick();
    mum.setOnline(false);
    await a.saveProposal(proposalVariant('p-1'), { base: null });
    expect(a.currentList().proposals.map((p) => p.id)).toEqual(['p-1']);
    expect(a.status()).toMatchObject({ pending: 1, online: false });
    let flushed = false;
    void a.flush().then(() => (flushed = true));
    await tick();
    expect(flushed).toBe(false);
    expect(onDad.at(-1) ?? []).toEqual([]);
    mum.setOnline(true);
    for (let i = 0; i < 5; i++) await tick();
    expect(flushed).toBe(true);
    expect(a.status().pending).toBe(0);
    expect(onDad.at(-1)).toEqual(['p-1']);
  });

  it('a refused write is reported (status error, onWriteError)', async () => {
    const fake = createFakeFirestore();
    fake.refuse = () => true;
    const dev = fake.device();
    const errors: string[] = [];
    const s = createFirestoreFamilyStore({
      adapter: dev.adapter,
      familyId: fid,
      storage: memoryStorage(),
      context,
      connectivity: dev.connectivity,
      onWriteError: (id) => errors.push(id),
    });
    disposers.push(() => s.dispose());
    await s.saveProposal(proposalVariant('p-1'), { base: null });
    for (let i = 0; i < 5; i++) await tick();
    expect(errors).toEqual(['p-1']);
    expect(s.status()).toMatchObject({ error: 'write', pending: 0 });
  });

  it('a failed sign-in (offline first start) still reads the cache and connects when online', async () => {
    const fake = createFakeFirestore();
    const dev = fake.device({ online: false });
    const s = createFirestoreFamilyStore({ adapter: dev.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: dev.connectivity, retryMs: 10 });
    disposers.push(() => s.dispose());
    for (let i = 0; i < 5; i++) await tick();
    expect(s.status()).toMatchObject({ phase: 'ready', error: 'auth', online: false });
    dev.setOnline(true);
    for (let i = 0; i < 5; i++) await tick();
    expect(s.status()).toMatchObject({ phase: 'ready', error: null, online: true });
  });

  it('documents of a newer app version are listed apart and never decoded', async () => {
    const fake = createFakeFirestore();
    const dev = fake.device();
    const doc: ProposalDoc = {
      name: 'Fra framtida',
      project: '{}',
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      createdAt: '2026-10-12T00:00:00.000Z',
      createdBy: null,
      updatedAt: '2026-10-12T00:00:00.000Z',
      updatedBy: null,
      deletedAt: null,
      lineage: [],
      lastRevisionAt: null,
      revisions: [],
    };
    fake.docs.set(`families/${fid}/proposals/future`, { ...doc });
    const s = createFirestoreFamilyStore({ adapter: dev.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: dev.connectivity });
    disposers.push(() => s.dispose());
    for (let i = 0; i < 3; i++) await tick();
    expect(s.currentList().proposals).toEqual([]);
    expect(s.currentList().tooNew.map((m) => m.name)).toEqual(['Fra framtida']);
  });
});

// ---------------------------------------------------------------------------
// Fix round after 2b: field updates, writes queued before the page, trashed content kept
// ---------------------------------------------------------------------------

describe('data safety (fix round after 2b)', () => {
  const fid = 'e2e-family-abcdefghijklmnopqrstu';
  const path = (id: string) => `families/${fid}/proposals/${id}`;
  const storedNotes = (fake: ReturnType<typeof createFakeFirestore>, id: string) =>
    (JSON.parse(String(fake.docs.get(path(id))?.project)) as { variants: Variant[] }).variants[0].notes;
  const ticks = async (n = 6) => {
    for (let i = 0; i < n; i++) await tick();
  };

  it('a delete made offline from an old view lands on the newer version: its content stays (Papirkurv), lineage tells', async () => {
    const fake = createFakeFirestore();
    const mum = fake.device();
    const dad = fake.device();
    const a = createFirestoreFamilyStore({ adapter: mum.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: mum.connectivity });
    const b = createFirestoreFamilyStore({ adapter: dad.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: dad.connectivity });
    disposers.push(() => a.dispose(), () => b.dispose());
    const r = await a.saveProposal(proposalVariant('p-1'), { base: null, by: 'Mamma' });
    if (r.status !== 'saved') throw new Error('save');
    await ticks();
    mum.setOnline(false);
    await a.deleteProposal('p-1', { by: 'Mamma' });
    expect(a.currentList().trash.map((t) => t.id)).toEqual(['p-1']);
    const d = await b.saveProposal({ ...proposalVariant('p-1'), notes: 'pappa' }, { base: r.proposal.updatedAt, by: 'Pappa' });
    expect(d.status).toBe('saved');
    if (d.status !== 'saved') return;
    await ticks();
    mum.setOnline(true);
    await ticks();
    const doc = fake.docs.get(path('p-1')) ?? {};
    expect(doc.deletedAt).not.toBeNull();
    expect(doc.updatedBy).toBe('Mamma');
    expect(storedNotes(fake, 'p-1')).toBe('pappa');
    // The delete was made from Mamma's version, not Pappa's: the lineage says so.
    const trashed = b.currentList().trash.find((t) => t.id === 'p-1');
    expect(trashed?.lineage).toContain(r.proposal.updatedAt);
    expect(trashed?.lineage).not.toContain(d.proposal.updatedAt);
    // Restored (also a field update): Pappa's version.
    expect((await b.restoreProposal('p-1'))?.variant.notes).toBe('pappa');
    await ticks();
    expect((await a.getProposal('p-1'))?.variant.notes).toBe('pappa');
  });

  it('keepRevision from an old view only adds a revision id: content saved meanwhile stays', async () => {
    const fake = createFakeFirestore();
    const mum = fake.device();
    const dad = fake.device();
    const a = createFirestoreFamilyStore({ adapter: mum.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: mum.connectivity });
    const b = createFirestoreFamilyStore({ adapter: dad.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: dad.connectivity });
    disposers.push(() => a.dispose(), () => b.dispose());
    const r = await a.saveProposal(proposalVariant('p-1'), { base: null });
    if (r.status !== 'saved') throw new Error('save');
    await ticks();
    mum.setOnline(false);
    expect(await a.keepRevision('p-1', { ...proposalVariant('p-1'), notes: 'gammel' }, { savedAt: '2026-10-12T10:00:00.000Z', savedBy: 'Mamma' })).toBe(true);
    await b.saveProposal({ ...proposalVariant('p-1'), notes: 'pappa' }, { base: r.proposal.updatedAt, by: 'Pappa' });
    await ticks();
    mum.setOnline(true);
    await ticks();
    expect(storedNotes(fake, 'p-1')).toBe('pappa');
    const revisions = await b.listRevisions('p-1');
    expect(revisions.some((x) => x.savedBy === 'Mamma')).toBe(true);
    expect(((fake.docs.get(path('p-1'))?.revisions ?? []) as string[]).length).toBe(revisions.length);
  });

  it('final fix round 5: a content save queued offline from an old view keeps the revisions another device added', async () => {
    const fake = createFakeFirestore();
    const mum = fake.device();
    const dad = fake.device();
    const a = createFirestoreFamilyStore({ adapter: mum.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: mum.connectivity });
    const b = createFirestoreFamilyStore({ adapter: dad.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: dad.connectivity });
    disposers.push(() => a.dispose(), () => b.dispose());
    const r = await a.saveProposal(proposalVariant('p-1'), { base: null, by: 'Mamma' });
    if (r.status !== 'saved') throw new Error('save');
    await ticks();
    mum.setOnline(false);
    // Mamma, offline, saves: her save keeps the first version as a revision (queued on her device).
    const m = await a.saveProposal({ ...proposalVariant('p-1'), notes: 'mamma' }, { base: r.proposal.updatedAt, by: 'Mamma' });
    expect(m.status).toBe('saved');
    // Pappa, online, saves too: the first version is kept as a revision there as well (its id goes into the list).
    const d = await b.saveProposal({ ...proposalVariant('p-1'), notes: 'pappa' }, { base: r.proposal.updatedAt, by: 'Pappa' });
    expect(d.status).toBe('saved');
    await ticks();
    expect(fake.docs.get(path('p-1'))?.revisions as string[]).toHaveLength(1);
    // Mamma comes online: her queued save (made from a view without Pappa's revision) lands last.
    mum.setOnline(true);
    await ticks();
    // Last write wins for the content, but the list holds both revisions: none of them is an orphan.
    expect(storedNotes(fake, 'p-1')).toBe('mamma');
    const listed = fake.docs.get(path('p-1'))?.revisions as string[];
    const kept = [...fake.docs.keys()].filter((k) => k.startsWith(`${path('p-1')}/revisions/`)).map((k) => k.split('/').pop());
    expect(listed).toHaveLength(2);
    expect([...listed].sort()).toEqual([...kept].sort());
  });

  it('writes queued before the store was created (an offline reload) are pending until the server has them', async () => {
    const fake = createFakeFirestore();
    const dev = fake.device({ online: false });
    // The earlier page queued a save while offline, then the page was reloaded (still offline).
    const plan = planSave(undefined, proposalVariant('p-1'), { base: null, at: '2026-10-12T12:00:00.000Z', by: 'Mamma' }, ctx);
    if (plan.kind !== 'write') throw new Error('plan');
    void dev.adapter.write([{ kind: 'set', path: path('p-1'), data: { ...plan.doc } }]).acked.catch(() => {});
    const s = createFirestoreFamilyStore({ adapter: dev.adapter, familyId: fid, storage: memoryStorage(), context, connectivity: dev.connectivity, retryMs: 10 });
    disposers.push(() => s.dispose());
    const store = createAppStore(makeTestProject({ variants: [{ ...makeVariant('base', 'Forslag D'), locked: true }], activeVariantId: 'base' }));
    const sync = createProposalSync({ store, family: s, delayMs: 5 });
    disposers.push(() => sync.stop());
    await ticks();
    expect(s.currentList().proposals.map((p) => p.id)).toEqual(['p-1']);
    expect(s.status()).toMatchObject({ phase: 'ready', pending: 1, online: false });
    expect(pillState(sync.getState())).toBe('pending');
    let flushed = false;
    void s.flush().then(() => (flushed = true));
    await ticks();
    expect(flushed).toBe(false);
    dev.setOnline(true);
    await ticks();
    expect(fake.docs.has(path('p-1'))).toBe(true);
    expect(s.status().pending).toBe(0);
    expect(flushed).toBe(true);
    expect(pillState(sync.getState())).toBe('synced');
  });

  it('planSave: writing over a proposal in the Papirkurv with other content keeps that content as a revision', () => {
    const v = proposalVariant('p-1');
    const fresh = planSave(undefined, v, { base: null, at: '2026-10-12T12:00:00.000Z', by: 'Mamma' }, ctx);
    if (fresh.kind !== 'write') throw new Error('plan');
    const trashed: ProposalDoc = { ...fresh.doc, deletedAt: '2026-10-12T12:00:30.000Z', updatedAt: '2026-10-12T12:00:30.000Z', updatedBy: 'Pappa', lastRevisionAt: '2026-10-12T12:00:10.000Z' };
    const back = planSave(trashed, { ...v, notes: 'annet' }, { base: null, at: '2026-10-12T12:01:00.000Z', by: 'Mamma' }, ctx);
    if (back.kind !== 'write') throw new Error('plan');
    expect(back.doc.deletedAt).toBeNull();
    expect(back.revision?.doc).toMatchObject({ project: fresh.doc.project, savedBy: 'Pappa' });
    // The same content back (Angre of a delete): nothing to keep.
    const same = planSave(trashed, v, { base: null, at: '2026-10-12T12:01:00.000Z', by: 'Mamma' }, ctx);
    expect(same.kind === 'write' && same.revision).toBeNull();
  });
});

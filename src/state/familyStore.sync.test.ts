/**
 * familyStore.sync.ts on two devices (the fake Firestore) and on the local store: autosave of new / edited / deleted
 * proposals, remote changes merged without undo steps (history rebased), the conflict guard ("Hent endringene" /
 * "Lagre over"), Angre of a delete, the Papirkurv, revisions, the echo of own writes during further edits, drags
 * (transactions) deferring a merge, the name prompt, retries after a failed write.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, Variant } from '../model/types';
import type { EncodeContext, FamilyStore } from './familyStore';
import { createFirestoreFamilyStore } from './familyStore.firestore';
import { createFakeFirestore } from './familyStore.fake';
import type { FakeFirestore } from './familyStore.fake';
import { createLocalFamilyStore } from './familyStore.local';
import { createProposalSync } from './familyStore.sync';
import type { ProposalSync } from './familyStore.sync';
import { createAppStore } from './store';
import type { AppStore } from './store';
import { makeTestProject, makeVariant } from './testProject';

const FID = 'e2e-sync-abcdefghijklmnopqrstuvw';
const context = (): EncodeContext => ({ site: makeTestProject().site, seedRevision: 6 });

function baseProject(extra: Variant[] = []): Project {
  const base = { ...makeVariant('base', 'Forslag D'), locked: true };
  return makeTestProject({ variants: [base, ...extra], activeVariantId: 'base' });
}

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function settle(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await tick();
}

interface Device {
  store: AppStore;
  family: FamilyStore;
  sync: ProposalSync;
  setOnline(v: boolean): void;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  vi.useRealTimers();
});

function device(
  fake: FakeFirestore,
  project: Project = baseProject(),
  extra: { onNeedsName?: () => void; name?: string; target?: Pick<Window, 'addEventListener' | 'removeEventListener'> } = {},
): Device {
  const dev = fake.device();
  const storage = memoryStorage();
  const family = createFirestoreFamilyStore({ adapter: dev.adapter, familyId: FID, storage, context, connectivity: dev.connectivity, retryMs: 20 });
  if (extra.name) family.setMyName(extra.name);
  const store = createAppStore(project);
  const sync = createProposalSync({ store, family, delayMs: 5, onNeedsName: extra.onNeedsName, retryMs: 10, target: extra.target });
  cleanups.push(() => {
    sync.stop();
    family.dispose();
  });
  return { store, family, sync, setOnline: dev.setOnline };
}

const names = (d: Device) => d.store.getState().project.variants.map((v) => v.name);
const variant = (d: Device, id: string) => d.store.getState().project.variants.find((v) => v.id === id);

/** "+ Nytt forslag" on a device: a copy of the base, saved by the autosave. */
async function newProposal(d: Device, name = 'Mitt forslag'): Promise<string> {
  const id = d.store.getState().duplicateVariant('base', name);
  if (!id) throw new Error('duplicate');
  await settle();
  await d.sync.flush();
  await settle();
  return id;
}

function editNotes(d: Device, id: string, notes: string) {
  d.store.getState().updateVariant(id, (v) => {
    v.notes = notes;
  });
}

describe('proposal sync between two devices', () => {
  it('a new proposal is saved and appears on the other device without an undo step there', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake);
    await settle();
    const id = await newProposal(mum);
    await settle();
    expect(names(dad)).toEqual(['Forslag D', 'Mitt forslag']);
    expect(dad.store.getState().canUndo).toBe(false);
    expect(dad.sync.getState().meta[id]).toMatchObject({ createdBy: 'Mamma', updatedBy: 'Mamma' });
    expect(variant(dad, id)?.locked).toBeUndefined();
    // The base is never written.
    expect([...fake.docs.keys()].some((k) => k.endsWith('/base'))).toBe(false);
  });

  it('edits autosave; a remote change replaces the variant and the undo history is rebased', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake);
    const dad = device(fake);
    await settle();
    const id = await newProposal(mum);
    await settle();
    // Dad edits another thing first (his own undo step) …
    const dadOwn = await newProposal(dad, 'Pappas forslag');
    editNotes(dad, dadOwn, 'pappa');
    await settle();
    // … then mum's change arrives.
    editNotes(mum, id, 'fra mamma');
    await settle();
    await mum.sync.flush();
    await settle();
    expect(variant(dad, id)?.notes).toBe('fra mamma');
    // Undo on dad's device undoes his own edit, never mum's change.
    dad.store.getState().undo();
    expect(variant(dad, dadOwn)?.notes).toBeUndefined();
    expect(variant(dad, id)?.notes).toBe('fra mamma');
    await settle();
    await dad.sync.flush();
    await settle();
    expect(variant(mum, id)?.notes).toBe('fra mamma');
  });

  it('an offline save that lands on a newer version (last write wins): the overwritten one is kept as a revision', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake, baseProject(), { name: 'Pappa' });
    await settle();
    const id = await newProposal(mum);
    await settle();
    dad.setOnline(false);
    editNotes(dad, id, 'pappa uten nett');
    await settle();
    await dad.sync.flush();
    editNotes(mum, id, 'mamma');
    await settle();
    await mum.sync.flush();
    await settle();
    dad.setOnline(true);
    await settle(16);
    // Dad's queued save reached the server last: everyone has it …
    expect(variant(mum, id)?.notes).toBe('pappa uten nett');
    // … and mum's device kept her version as a revision and says so.
    expect(mum.sync.getState().overwritten).toEqual([expect.objectContaining({ id, name: 'Mitt forslag', by: 'Pappa' })]);
    await settle();
    const revisions = await mum.family.listRevisions(id);
    expect(revisions.some((r) => r.savedBy === 'Mamma')).toBe(true);
    const kept = revisions.find((r) => r.savedBy === 'Mamma');
    expect(kept).toBeDefined();
    mum.sync.dismissOverwritten(id);
    expect(mum.sync.getState().overwritten).toEqual([]);
    // A normal sequence of saves on another device is never treated as an overwrite.
    editNotes(dad, id, 'videre');
    await settle();
    await dad.sync.flush();
    await settle();
    editNotes(dad, id, 'og videre');
    await settle();
    await dad.sync.flush();
    await settle();
    expect(variant(mum, id)?.notes).toBe('og videre');
    expect(mum.sync.getState().overwritten).toEqual([]);
  });

  it('conflict guard, deterministic: a remote save while edits wait for the debounce', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake, baseProject(), { name: 'Pappa' });
    await settle();
    const id = await newProposal(mum);
    await settle();
    // Dad edits; his autosave has not run yet when mum's save arrives.
    dad.sync.stop();
    const dadSync = createProposalSync({ store: dad.store, family: dad.family, delayMs: 60_000 });
    cleanups.push(() => dadSync.stop());
    await settle();
    editNotes(dad, id, 'pappa');
    editNotes(mum, id, 'mamma');
    await settle();
    await mum.sync.flush();
    await settle();
    const conflict = dadSync.getState().conflicts[0];
    expect(conflict).toMatchObject({ id, name: 'Mitt forslag', kind: 'changed', by: 'Mamma' });
    // Neither saved nor replaced while the conflict is open.
    expect(variant(dad, id)?.notes).toBe('pappa');
    await dadSync.flush();
    await settle();
    expect(variant(mum, id)?.notes).toBe('mamma');
    await dadSync.resolveConflict(id, 'fetch');
    expect(variant(dad, id)?.notes).toBe('mamma');
    expect(dadSync.getState().conflicts).toEqual([]);
    expect(dad.store.getState().canUndo).toBe(true); // dad's own (now superseded) edits stay undoable as no-ops
  });

  it('"Lagre over" writes this version over the newer one', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake, baseProject(), { name: 'Pappa' });
    await settle();
    const id = await newProposal(mum);
    await settle();
    dad.sync.stop();
    const dadSync = createProposalSync({ store: dad.store, family: dad.family, delayMs: 60_000 });
    cleanups.push(() => dadSync.stop());
    await settle();
    editNotes(dad, id, 'pappa');
    editNotes(mum, id, 'mamma');
    await settle();
    await mum.sync.flush();
    await settle();
    expect(dadSync.getState().conflicts).toHaveLength(1);
    await dadSync.resolveConflict(id, 'overwrite');
    await settle();
    expect(variant(mum, id)?.notes).toBe('pappa');
    expect(mum.sync.getState().meta[id]?.updatedBy).toBe('Pappa');
  });

  it('delete is soft: gone for everyone, in the Papirkurv, Angre brings it back; restore from the Papirkurv', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake);
    await settle();
    const id = await newProposal(mum);
    await settle();
    mum.store.getState().setActiveVariant(id);
    mum.store.getState().deleteVariant(id);
    await settle();
    await mum.sync.flush();
    await settle();
    expect(names(dad)).toEqual(['Forslag D']);
    expect(dad.sync.getState().trash.map((t) => [t.id, t.updatedBy])).toEqual([[id, 'Mamma']]);
    // Angre on mum's device: the proposal comes back for everyone.
    mum.store.getState().undo();
    await settle();
    await mum.sync.flush();
    await settle();
    expect(names(dad)).toEqual(['Forslag D', 'Mitt forslag']);
    expect(dad.sync.getState().trash).toEqual([]);
    // Delete again on dad's device, restore from the Papirkurv on mum's.
    dad.store.getState().deleteVariant(id);
    await settle();
    await dad.sync.flush();
    await settle();
    expect(names(mum)).toEqual(['Forslag D']);
    expect(await mum.sync.restoreFromTrash(id)).toBe(true);
    expect(mum.sync.activate(id)).toBe(true);
    expect(mum.store.getState().project.activeVariantId).toBe(id);
    await settle();
    expect(names(dad)).toEqual(['Forslag D', 'Mitt forslag']);
  });

  it('edits made just before a delete are saved first: the Papirkurv has the last state', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    await settle();
    const id = await newProposal(mum);
    mum.store.getState().renameVariant(id, 'Nytt navn');
    editNotes(mum, id, 'siste endring');
    mum.store.getState().deleteVariant(id);
    await settle();
    await mum.sync.flush();
    await settle();
    expect(mum.sync.getState().trash.map((t) => t.name)).toEqual(['Nytt navn']);
    expect(await mum.sync.restoreFromTrash(id)).toBe(true);
    expect(variant(mum, id)).toMatchObject({ name: 'Nytt navn', notes: 'siste endring' });
  });

  it('a proposal deleted elsewhere while edited here is a "deleted" conflict; "Lagre over" restores it', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake);
    await settle();
    const id = await newProposal(mum);
    await settle();
    dad.sync.stop();
    const dadSync = createProposalSync({ store: dad.store, family: dad.family, delayMs: 60_000 });
    cleanups.push(() => dadSync.stop());
    await settle();
    editNotes(dad, id, 'pappa');
    mum.store.getState().deleteVariant(id);
    await settle();
    await mum.sync.flush();
    await settle();
    expect(dadSync.getState().conflicts[0]).toMatchObject({ id, kind: 'deleted', by: 'Mamma' });
    expect(variant(dad, id)?.notes).toBe('pappa');
    await dadSync.resolveConflict(id, 'overwrite');
    await settle();
    expect(variant(mum, id)?.notes).toBe('pappa');
  });

  it('merges wait while a drag (transaction) is in progress; the selection is kept', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake);
    const dad = device(fake);
    await settle();
    const a = await newProposal(mum, 'A');
    const b = await newProposal(dad, 'B');
    await settle();
    dad.store.getState().setActiveVariant(b);
    dad.store.getState().select({ kind: 'wall', id: 'w-1' });
    dad.store.getState().beginTransaction('drag');
    editNotes(mum, a, 'endret');
    await settle();
    await mum.sync.flush();
    await settle();
    expect(variant(dad, a)?.notes).toBeUndefined();
    expect(dad.store.getState().inTransaction()).toBe(true);
    dad.store.getState().commitTransaction();
    await new Promise((r) => setTimeout(r, 300));
    expect(variant(dad, a)?.notes).toBe('endret');
    expect(dad.store.getState().ui.selection).toEqual({ kind: 'wall', id: 'w-1' });
  });

  it('own saves are never conflicts, also when editing continues while a save is in flight', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake);
    await settle();
    const id = await newProposal(mum);
    for (let i = 0; i < 6; i++) {
      editNotes(mum, id, `n${i}`);
      void mum.sync.flush();
      await tick();
    }
    await settle(20);
    await mum.sync.flush();
    await settle();
    expect(mum.sync.getState().conflicts).toEqual([]);
    expect(variant(mum, id)?.notes).toBe('n5');
    const stored = JSON.parse(String(fake.docs.get(`families/${FID}/proposals/${id}`)?.project));
    expect(stored.variants[0].notes).toBe('n5');
  });

  it('offline: saved here (pending), sent when online; status follows', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake);
    const dad = device(fake);
    await settle();
    const id = await newProposal(mum);
    await settle();
    mum.setOnline(false);
    editNotes(mum, id, 'offline');
    await settle();
    await mum.sync.flush();
    await settle();
    expect(mum.sync.getState()).toMatchObject({ pending: 1, online: false, saving: false });
    expect(variant(dad, id)?.notes).toBeUndefined();
    mum.setOnline(true);
    await settle(12);
    expect(mum.sync.getState()).toMatchObject({ pending: 0, online: true });
    expect(variant(dad, id)?.notes).toBe('offline');
  });

  it('revisions: restoring one replaces the proposal here and there', async () => {
    const fake = createFakeFirestore();
    let t = Date.parse('2026-10-12T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    const mum = device(fake);
    const dad = device(fake);
    await settle();
    const id = await newProposal(mum);
    editNotes(mum, id, 'første');
    await settle();
    await mum.sync.flush();
    t += 6 * 60_000;
    editNotes(mum, id, 'andre');
    await settle();
    await mum.sync.flush();
    await settle();
    const revs = await mum.family.listRevisions(id);
    expect(revs.length).toBeGreaterThanOrEqual(1);
    t += 60_000;
    expect(await mum.sync.restoreRevision(id, revs[0].id)).toBe(true);
    expect(variant(mum, id)?.notes).toBe('første');
    await settle();
    expect(variant(dad, id)?.notes).toBe('første');
  });

  it('asks for a name once, the first time something is saved on a device without one', async () => {
    const fake = createFakeFirestore();
    const asked = vi.fn();
    const mum = device(fake, baseProject(), { onNeedsName: asked });
    await settle();
    await newProposal(mum);
    const id2 = await newProposal(mum, 'To');
    editNotes(mum, id2, 'x');
    await mum.sync.flush();
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('a refused write is retried with force and reported as failed meanwhile', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake);
    await settle();
    fake.refuse = () => true;
    const id = mum.store.getState().duplicateVariant('base', 'Mitt forslag');
    await settle();
    await mum.sync.flush();
    await settle(12);
    // The fake rolls back the refused write, so the store sees the proposal vanish: it stays here.
    expect(names(mum)).toContain('Mitt forslag');
    fake.refuse = null;
    await new Promise((r) => setTimeout(r, 80));
    await settle(12);
    expect(fake.docs.has(`families/${FID}/proposals/${id}`)).toBe(true);
  });
});

describe('proposal sync on the local store', () => {
  it('the first list adopts proposals the project already has; nothing is rewritten', async () => {
    const storage = memoryStorage();
    const family = createLocalFamilyStore({ storage, context });
    const r = await family.saveProposal({ ...makeVariant('p-1', 'Lagret'), notes: 'x' }, { base: null });
    if (r.status !== 'saved') throw new Error('save');
    const store = createAppStore(baseProject([r.proposal.variant]));
    const spy = vi.spyOn(family, 'saveProposal');
    const sync = createProposalSync({ store, family, delayMs: 5 });
    cleanups.push(() => {
      sync.stop();
      family.dispose();
    });
    await settle();
    await sync.flush();
    expect(spy).not.toHaveBeenCalled();
    expect(sync.getState().meta['p-1']?.name).toBe('Lagret');
    expect(sync.getState()).toMatchObject({ mode: 'local', familyId: null, phase: 'ready' });
  });

  it('a variant of the project unknown to the store (legacy import) is created on the first flush', async () => {
    const storage = memoryStorage();
    const family = createLocalFamilyStore({ storage, context });
    const store = createAppStore(baseProject([makeVariant('legacy-1', 'Gammelt forslag')]));
    const saved: string[] = [];
    const sync = createProposalSync({ store, family, delayMs: 5, onSaved: (id) => saved.push(id) });
    cleanups.push(() => {
      sync.stop();
      family.dispose();
    });
    await settle();
    await sync.flush();
    expect(saved).toEqual(['legacy-1']);
    expect(family.currentList().proposals.map((p) => p.name)).toEqual(['Gammelt forslag']);
  });

  it('saving status: a debounce that finds nothing to save ends "saving" too', async () => {
    const storage = memoryStorage();
    const family = createLocalFamilyStore({ storage, context });
    const store = createAppStore(baseProject());
    const sync = createProposalSync({ store, family, delayMs: 10 });
    cleanups.push(() => {
      sync.stop();
      family.dispose();
    });
    await settle();
    store.getState().setActiveVariant('base'); // no change
    store.getState().select({ kind: 'wall', id: 'w-1' }); // ui only
    store.getState().updateVariant('base', () => {}); // a project change with nothing to save (the base)
    expect(sync.getState().saving).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    await settle();
    expect(sync.getState().saving).toBe(false);
  });

  it('saving status: saving while the debounce runs, then idle', async () => {
    const storage = memoryStorage();
    const family = createLocalFamilyStore({ storage, context });
    const store = createAppStore(baseProject());
    const sync = createProposalSync({ store, family, delayMs: 30 });
    cleanups.push(() => {
      sync.stop();
      family.dispose();
    });
    await settle();
    store.getState().duplicateVariant('base', 'X');
    expect(sync.getState().saving).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    await settle();
    expect(sync.getState().saving).toBe(false);
    expect(family.currentList().proposals).toHaveLength(1);
  });

  it('saving status: a change arriving from another device is not "saving" here (and writes nothing back)', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake, baseProject(), { name: 'Pappa' });
    await settle();
    const id = await newProposal(mum);
    await settle();
    await dad.sync.flush();
    await settle();
    const seen: boolean[] = [];
    const stop = dad.sync.subscribe((st) => seen.push(st.saving));
    editNotes(mum, id, 'fra mamma');
    await settle();
    await mum.sync.flush();
    await settle();
    expect(variant(dad, id)?.notes).toBe('fra mamma');
    const writes = fake.writes;
    await new Promise((r) => setTimeout(r, 30));
    await settle();
    stop();
    expect(seen.filter((x) => x)).toEqual([]);
    expect(dad.sync.getState().saving).toBe(false);
    // Dad's device wrote nothing back.
    expect(fake.writes).toBe(writes);
    expect(dad.family.currentList().proposals.find((x) => x.id === id)?.updatedBy).toBe('Mamma');
  });
});

describe('fix round after 2b: deletes from an old view, drags, leaving with a conflict', () => {
  const storedDoc = (fake: FakeFirestore, id: string) => fake.docs.get(`families/${FID}/proposals/${id}`) ?? {};
  const storedNotes = (fake: FakeFirestore, id: string) => (JSON.parse(String(storedDoc(fake, id).project)) as Project).variants[0].notes;

  it('a delete made offline from an old view: the newer version stays in the Papirkurv and its author is told', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake, baseProject(), { name: 'Pappa' });
    await settle();
    const id = await newProposal(mum);
    await settle();
    // Mamma, offline, deletes (both confirmations) …
    mum.setOnline(false);
    mum.store.getState().deleteVariant(id);
    await settle();
    await mum.sync.flush();
    await settle();
    // … while Pappa, online, saves an edit.
    editNotes(dad, id, 'pappa');
    await settle();
    await dad.sync.flush();
    await settle();
    expect(storedNotes(fake, id)).toBe('pappa');
    mum.setOnline(true);
    await settle(16);
    // Deleted for everyone, but with Pappa's content: nothing is lost.
    expect(storedDoc(fake, id).deletedAt).not.toBeNull();
    expect(storedNotes(fake, id)).toBe('pappa');
    expect(names(dad)).toEqual(['Forslag D']);
    // Pappa is told (his version went into the Papirkurv unseen); Mamma is not.
    expect(dad.sync.getState().overwritten).toEqual([expect.objectContaining({ id, kind: 'deleted', by: 'Mamma' })]);
    expect(mum.sync.getState().overwritten).toEqual([]);
    // Hent tilbake: Pappa's version, for everyone.
    dad.sync.dismissOverwritten(id);
    expect(await dad.sync.restoreFromTrash(id)).toBe(true);
    expect(variant(dad, id)?.notes).toBe('pappa');
    await settle();
    expect(variant(mum, id)?.notes).toBe('pappa');
  });

  it('a delete made after seeing the newest version tells nobody', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake, baseProject(), { name: 'Pappa' });
    await settle();
    const id = await newProposal(mum);
    await settle();
    editNotes(dad, id, 'pappa');
    await settle();
    await dad.sync.flush();
    await settle();
    expect(variant(mum, id)?.notes).toBe('pappa');
    mum.store.getState().deleteVariant(id);
    await settle();
    await mum.sync.flush();
    await settle();
    expect(names(dad)).toEqual(['Forslag D']);
    expect(dad.sync.getState().overwritten).toEqual([]);
  });

  it('Angre of a delete made offline brings the proposal back as the server has it (the newer version stays)', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake, baseProject(), { name: 'Pappa' });
    await settle();
    const id = await newProposal(mum);
    await settle();
    mum.setOnline(false);
    mum.store.getState().deleteVariant(id);
    await settle();
    await mum.sync.flush();
    await settle();
    mum.store.getState().undo();
    await settle();
    await mum.sync.flush();
    await settle();
    editNotes(dad, id, 'pappa');
    await settle();
    await dad.sync.flush();
    await settle();
    mum.setOnline(true);
    await settle(16);
    expect(storedDoc(fake, id).deletedAt).toBeNull();
    expect(storedNotes(fake, id)).toBe('pappa');
    expect(variant(mum, id)?.notes).toBe('pappa');
    expect(variant(dad, id)?.notes).toBe('pappa');
  });

  it('nothing is written while a drag (transaction) is in progress; the end of the drag is saved', async () => {
    const fake = createFakeFirestore();
    const mum = device(fake);
    await settle();
    const id = await newProposal(mum);
    await settle();
    const writes = fake.writes;
    mum.store.getState().setActiveVariant(id);
    mum.store.getState().beginTransaction('drag');
    editNotes(mum, id, 'midt i draget');
    await new Promise((r) => setTimeout(r, 40));
    await mum.sync.flush();
    await settle();
    expect(fake.writes).toBe(writes);
    editNotes(mum, id, 'slutten av draget');
    mum.store.getState().commitTransaction();
    await new Promise((r) => setTimeout(r, 320));
    await settle();
    expect(storedNotes(fake, id)).toBe('slutten av draget');
    // No stored version (the proposal or a revision of it) ever held the in-between state.
    expect([...fake.docs.values()].some((d) => String(d.project).includes('midt i draget'))).toBe(false);
  });

  it('leaving the page while a conflict is open asks first (beforeunload); without one it does not', async () => {
    const fake = createFakeFirestore();
    const target = new EventTarget();
    const mum = device(fake, baseProject(), { name: 'Mamma' });
    const dad = device(fake, baseProject(), { name: 'Pappa' });
    await settle();
    const id = await newProposal(mum);
    await settle();
    dad.sync.stop();
    const dadSync = createProposalSync({ store: dad.store, family: dad.family, delayMs: 60_000, target });
    cleanups.push(() => dadSync.stop());
    await settle();
    const leave = () => {
      const e = new Event('beforeunload', { cancelable: true });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await settle();
    editNotes(dad, id, 'pappa');
    editNotes(mum, id, 'mamma');
    await settle();
    await mum.sync.flush();
    await settle();
    expect(dadSync.getState().conflicts).toHaveLength(1);
    expect(leave()).toBe(true);
    await dadSync.resolveConflict(id, 'fetch');
    expect(leave()).toBe(false);
  });
});

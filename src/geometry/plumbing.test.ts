/**
 * The drainage helper (geometry/plumbing.ts, state/plumbingActions.ts, ui/plumbingInfo.ts): the furnished seed is
 * all fine (the WC and Hovedbad toilets back to back on the wall at x 18,6, today's Bad / Do / Teknisk on today's
 * drains), a toilet moved to Soverom 1 is flagged with its distance, the pair rule, stacks snap to walls and out of
 * openings, the stack actions (one undo step each, the lock, the suggestion kept when a stack is added), the stacks
 * survive a file, a share link and the family store, and the analysis costs at most 2 ms.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { DerivedVariant } from '../model/derived';
import type { Project, TerrainAsset, Variant, Vec2 } from '../model/types';
import { decodeProposalProject, encodeProposalProject } from '../state/familyStore';
import { decodeShare, encodeShare, parseProjectText, serializeProject } from '../state/persistence';
import { addDrainStack, deleteDrainStack, moveDrainStack, plumbingOf, todayWetRoomIds } from '../state/plumbingActions';
import { EDIT_STRINGS } from '../state/editStrings';
import { createAppStore, selectActiveVariant } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { nb } from '../i18n/nb';
import { plumbingInfoLines } from '../ui/plumbingInfo';
import { deriveVariant } from './derive';
import { FIXTURE_REACH_M, PAIR_REACH_M, STACK_ON_WALL_M, TOILET_REACH_M, analysePlumbing, drainWarnings, snapStackToWall } from './plumbing';
import type { PlumbingAnalysis, VariantPlumbing } from './plumbing';
import { distancePointSegment } from './polygon';

const terrain = terrainJson as unknown as TerrainAsset;
const project = createForslagD();
const seed = project.variants[0];
const derive = (v: Variant): DerivedVariant => deriveVariant(v, project.site, terrain);
const seedDerived = derive(seed);
const today = todayWetRoomIds();

type Store = ReturnType<typeof createAppStore>;

/** An unlocked copy of Forslag D in a fresh store («Mitt forslag»). */
function proposal(): Store {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}
const V = (s: Store): Variant => selectActiveVariant(s.getState());
const steps = (s: Store) => s.getState().history().past.length;
const fixture = (a: PlumbingAnalysis, id: string) => a.fixtures.find((f) => f.id === id)!;

/** fu-wc-1 (the new wing's WC toilet) moved into Soverom 1 on the lower level, its back on the north wall. */
const toiletInSoverom1 = (v: Variant): Variant =>
  produce(v, (d) => {
    const f = d.furniture.find((x) => x.id === 'fu-wc-1')!;
    f.position = [1.0, 5.715];
    f.rotationDeg = 0;
    f.levelId = 'lower';
  });

const near = (a: Vec2, b: Vec2, tol = 1e-6) => {
  expect(Math.abs(a[0] - b[0])).toBeLessThan(tol);
  expect(Math.abs(a[1] - b[1])).toBeLessThan(tol);
};

describe('the furnished seed (Forslag D)', () => {
  const a = analysePlumbing(seedDerived, seed.plumbing, { todayRoomIds: today });

  it('suggests one stack on the wall between WC and Hovedbad and finds everything fine', () => {
    expect(a.stacks).toHaveLength(1);
    const [stack] = a.stacks;
    expect(stack).toMatchObject({ id: 'suggested-ground', storeyId: 'ground', suggested: true, wallId: 'w-wc-bad' });
    expect(stack.p[0]).toBeCloseTo(18.6, 6);
    expect(stack.p[1]).toBeGreaterThan(0.06);
    expect(stack.p[1]).toBeLessThan(2.14);
    expect(a.fixtures.map((f) => f.state).filter((s) => s !== 'ok' && s !== 'today')).toEqual([]);
    expect(drainWarnings(a)).toEqual([]);
    // Every fixture of the new wing runs to the stack within its reach.
    for (const id of ['fu-wc-1', 'fu-wc-2', 'fu-hovedbad-1', 'fu-hovedbad-2', 'fu-hovedbad-3', 'fu-hovedbad-4']) {
      const f = fixture(a, id);
      expect(f.state, id).toBe('ok');
      expect(f.stackId).toBe('suggested-ground');
      expect(f.distance!, id).toBeLessThanOrEqual(f.toilet ? TOILET_REACH_M : FIXTURE_REACH_M);
      expect(f.run[0]).toEqual(f.point);
      expect(f.run.at(-1)).toEqual(stack.p);
    }
  });

  it('shows the WC and Hovedbad toilets back to back on the wall at x 18,6', () => {
    expect(a.pairs).toEqual([
      expect.objectContaining({ ids: ['fu-wc-1', 'fu-hovedbad-1'], kind: 'back-to-back', wallId: 'w-wc-bad', axis: 'x', value: 18.6, roomNames: ['WC', 'Hovedbad'], fine: true }),
    ]);
    expect(fixture(a, 'fu-wc-1').reason).toBe('pair');
    expect(fixture(a, 'fu-hovedbad-1').reason).toBe('pair');
    // A toilet's run goes along the wall: across to it, then along it.
    expect(fixture(a, 'fu-wc-1').run).toHaveLength(3);
    const lines = plumbingInfoLines(a, { editable: true });
    expect(lines[0].text).toBe('WC og Hovedbad: toalettene står rygg mot rygg på veggen ved x 18,6 – det er fint.');
    expect(lines.map((l) => l.text)).toContain('Bad, Do og Teknisk / vask bruker avløpet som er der i dag.');
    expect(lines.map((l) => l.text)).toContain('De andre 4 avløpene står innen 3,0 m fra avløpsstammen – det er fint.');
    expect(lines.some((l) => l.tone === 'far')).toBe(false);
  });

  it("leaves today's bathroom, Do and Teknisk on today's drains", () => {
    expect(a.todayRooms).toEqual(['Bad', 'Do', 'Teknisk / vask']);
    for (const id of ['fu-bad-1', 'fu-bad-2', 'fu-do-1', 'fu-teknisk-1', 'fu-teknisk-2']) {
      expect(fixture(a, id)).toMatchObject({ state: 'today', run: [], distance: null, stackId: null });
    }
    // The same without the Forslag D room list (every wet room of today's cabin).
    const plain = analysePlumbing(seedDerived, undefined);
    expect(plain.fixtures.map((f) => f.state)).toEqual(a.fixtures.map((f) => f.state));
  });
});

describe('a toilet moved to Soverom 1', () => {
  const v = toiletInSoverom1(seed);
  const d = derive(v);
  const a = analysePlumbing(d, v.plumbing, { todayRoomIds: today });

  it('is flagged with its distance from the stack, which stays with the bathrooms', () => {
    expect(d.furniture.find((f) => f.id === 'fu-wc-1')?.roomId).toBe('room-sov1');
    const f = fixture(a, 'fu-wc-1');
    expect(f).toMatchObject({ state: 'far', reason: 'far', roomName: 'Soverom 1', limit: TOILET_REACH_M, stackId: 'suggested-ground' });
    expect(a.stacks).toHaveLength(1);
    expect(a.stacks[0].wallId).toBe('w-wc-bad');
    // Along the walls: across to the stack's wall line (x 18,6), then along it.
    const along = Math.abs(f.point[1] - a.stacks[0].p[1]) + Math.abs(f.point[0] - a.stacks[0].p[0]);
    expect(f.distance).toBeCloseTo(along, 6);
    expect(f.distance!).toBeGreaterThan(20);
    // The Hovedbad toilet alone is still within reach; the pair is gone.
    expect(fixture(a, 'fu-hovedbad-1')).toMatchObject({ state: 'ok', reason: 'near' });
    expect(a.pairs.filter((p) => p.fine)).toEqual([]);
  });

  it("gives a 'drain-far' warning and a red line in Vis", () => {
    const w = drainWarnings(a);
    expect(w).toEqual([{ kind: 'drain-far', furnitureId: 'fu-wc-1', catalogId: 'toalett', roomId: 'room-sov1', distance: Math.round(fixture(a, 'fu-wc-1').distance! * 100) / 100 }]);
    const text = nb.plumbing.drainFar(w[0].catalogId, 'Soverom 1', w[0].distance);
    expect(text).toMatch(/^Toalettet i «Soverom 1» står \d+,\d m fra avløpsstammen\.$/);
    const far = plumbingInfoLines(a).filter((l) => l.tone === 'far');
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({ furnitureId: 'fu-wc-1', levelId: 'lower' });
    expect(far[0].text).toMatch(/^Soverom 1: toalettet står \d+,\d m fra avløpsstammen – det er for langt \(høyst 1,0 m\)\.$/);
  });

  it("does not count a bedroom of today's cabin turned into a bathroom as today's drain", () => {
    const asBath = produce(v, (dd) => {
      dd.rooms.find((r) => r.id === 'room-sov1')!.type = 'bad';
    });
    const db = derive(asBath);
    expect(fixture(analysePlumbing(db, undefined, { todayRoomIds: today }), 'fu-wc-1').state).toBe('far');
    // Without Forslag D's room list every wet room of today's cabin counts.
    expect(fixture(analysePlumbing(db, undefined), 'fu-wc-1').state).toBe('today');
  });
});

describe('the toilet pair rule', () => {
  const withStack = (y: number): PlumbingAnalysis => analysePlumbing(seedDerived, { stacks: [{ id: 's1', p: [18.6, y], storeyId: 'ground' }] }, { todayRoomIds: today });

  it('makes two toilets back to back fine within 2,5 m of a stack on their wall', () => {
    // 2.1 m along the wall + 0.06 m across: each beyond 1.0 m, the pair within 2.5 m.
    const a = withStack(-1.2);
    expect(a.stacks).toEqual([expect.objectContaining({ id: 's1', suggested: false, wallId: 'w-wc-bad' })]);
    for (const id of ['fu-wc-1', 'fu-hovedbad-1']) {
      const f = fixture(a, id);
      expect(f.distance!).toBeGreaterThan(TOILET_REACH_M);
      expect(f.distance!).toBeLessThanOrEqual(PAIR_REACH_M);
      expect(f).toMatchObject({ state: 'ok', reason: 'pair', limit: PAIR_REACH_M });
    }
    expect(a.pairs[0]).toMatchObject({ kind: 'back-to-back', fine: true, stackId: 's1' });
  });

  it('flags them when the stack on their wall is beyond 2,5 m', () => {
    const a = withStack(-1.9);
    expect(a.pairs[0]).toMatchObject({ kind: 'back-to-back', fine: false });
    expect(fixture(a, 'fu-wc-1')).toMatchObject({ state: 'far', limit: TOILET_REACH_M });
    expect(drainWarnings(a).map((w) => w.furnitureId)).toEqual(expect.arrayContaining(['fu-wc-1', 'fu-hovedbad-1']));
  });

  it('knows two toilets side by side on one wall', () => {
    // A second toilet in Hovedbad 0.6 m south of the first, back on the same wall.
    const v = produce(seed, (d) => {
      const t = d.furniture.find((x) => x.id === 'fu-hovedbad-1')!;
      d.furniture.push({ ...t, id: 'fu-hovedbad-x', position: [t.position[0], t.position[1] - 0.6] });
      d.furniture = d.furniture.filter((x) => x.id !== 'fu-wc-1' && x.id !== 'fu-hovedbad-3');
    });
    const a = analysePlumbing(derive(v), undefined, { todayRoomIds: today });
    expect(a.pairs).toEqual([expect.objectContaining({ ids: ['fu-hovedbad-1', 'fu-hovedbad-x'], kind: 'side-by-side', axis: 'x', value: 18.6, roomNames: ['Hovedbad'], fine: true })]);
    expect(plumbingInfoLines(a)[0].text).toBe('Hovedbad: toalettene står side om side på veggen ved x 18,6 – det er fint.');
  });
});

describe('stack snapping', () => {
  it('puts a stack on the nearest wall', () => {
    const s = snapStackToWall(seedDerived, 'ground', [18.75, 1.0])!;
    expect(s.wallId).toBe('w-wc-bad');
    near(s.p, [18.6, 1.0]);
  });

  it('keeps it out of door and window openings', () => {
    const walls = seedDerived.walls.filter((w) => w.source.kind === 'wall' && w.storeyIds.includes('ground') && !w.isGhost && w.openings.some((o) => !o.isGhost && o.type === 'door'));
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) {
      const o = w.openings.find((x) => !x.isGhost && x.type === 'door')!;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const centre: Vec2 = [w.a[0] + u[0] * o.offset, w.a[1] + u[1] * o.offset];
      const s = snapStackToWall(seedDerived, 'ground', centre)!;
      if (s.wallId !== w.id) continue;
      const t = (s.p[0] - w.a[0]) * u[0] + (s.p[1] - w.a[1]) * u[1];
      expect(Math.abs(t - o.offset), `${w.id}/${o.id}`).toBeGreaterThanOrEqual(o.width / 2 + 0.1 - 2e-3); // the point is rounded to the millimetre
    }
  });

  it('a dragged stack is stored on a wall; moving, adding and deleting are one undo step each', () => {
    const store = proposal();
    const id = moveDrainStack(store, 'suggested-ground', [18.8, 1.5])!;
    expect(id).toMatch(/^stack-/);
    expect(V(store).plumbing?.stacks).toEqual([{ id, p: [18.6, 1.5], storeyId: 'ground' }]);
    expect(steps(store)).toBe(1);
    let a = plumbingOf(store.getState());
    expect(a.stacks.map((s) => [s.id, s.suggested])).toEqual([[id, false]]);
    // A move snaps to the nearest wall.
    expect(moveDrainStack(store, id, [20.0, 2.05])).toBe(id);
    const p = V(store).plumbing!.stacks[0].p;
    expect(p).toEqual(snapStackToWall(deriveForState(store.getState()), 'ground', [20.0, 2.05])!.p);
    const d = deriveForState(store.getState());
    expect(Math.min(...d.walls.filter((w) => !w.isGhost && !w.isDivider && w.storeyIds.includes('ground')).map((w) => distancePointSegment(p, w.a, w.b)))).toBeLessThanOrEqual(STACK_ON_WALL_M);
    expect(steps(store)).toBe(2);
    // Delete: the suggestion comes back; «Slettet.» with Angre.
    expect(deleteDrainStack(store, id)).toBe(true);
    expect(V(store).plumbing?.stacks).toEqual([]);
    expect(store.getState().toasts.at(-1)).toMatchObject({ text: EDIT_STRINGS.deleted, undo: true });
    a = plumbingOf(store.getState());
    expect(a.stacks.map((s) => s.id)).toEqual(['suggested-ground']);
    expect(deleteDrainStack(store, 'suggested-ground')).toBe(false);
    expect(steps(store)).toBe(3);
    store.getState().undo();
    expect(V(store).plumbing?.stacks.map((s) => s.id)).toEqual([id]);
  });

  it('a new stack goes by the fixtures that are too far and keeps the suggestion', () => {
    const store = proposal();
    store.getState().replaceVariant(V(store).id, toiletInSoverom1(V(store)));
    expect(drainWarnings(plumbingOf(store.getState())).map((w) => w.furnitureId)).toEqual(['fu-wc-1']);
    const id = addDrainStack(store, 'ground')!;
    const stacks = V(store).plumbing!.stacks;
    expect(stacks).toHaveLength(2);
    expect(stacks.at(-1)!.id).toBe(id);
    const a = plumbingOf(store.getState());
    expect(a.stacks.every((s) => !s.suggested)).toBe(true);
    expect(fixture(a, 'fu-wc-1')).toMatchObject({ state: 'ok', stackId: id });
    expect(fixture(a, 'fu-hovedbad-1').state).toBe('ok');
    expect(drainWarnings(a)).toEqual([]);
  });

  it('Forslag D refuses every stack action with the editor toast', () => {
    const store = createAppStore(createForslagD());
    const before = V(store);
    expect(moveDrainStack(store, 'suggested-ground', [18.8, 1.5])).toBeNull();
    expect(addDrainStack(store, 'ground')).toBeNull();
    expect(deleteDrainStack(store, 'x')).toBeNull();
    expect(V(store)).toBe(before);
    expect(store.getState().toasts.map((t) => t.text)).toContain(EDIT_STRINGS.locked);
  });
});

describe('serialisation', () => {
  const plumbing: VariantPlumbing = {
    stacks: [
      { id: 'stack-a', p: [18.6, 0.5], storeyId: 'ground' },
      { id: 'stack-b', p: [5.05, 5.0], storeyId: 'ground' },
    ],
  };
  const withStacks = (): Project => {
    const p = createForslagD();
    const copy = { ...structuredClone(p.variants[0]), id: 'mitt', name: 'Mitt forslag', locked: undefined, plumbing };
    delete copy.locked;
    return { ...p, variants: [p.variants[0], copy], activeVariantId: 'mitt' };
  };

  it('keeps the stacks through a file, a share link and the family store', () => {
    const p = withStacks();
    const file = parseProjectText(serializeProject(p));
    expect(file.status).toBe('ok');
    if (file.status === 'ok') expect(file.project.variants.find((v) => v.id === 'mitt')?.plumbing).toEqual(plumbing);

    const link = decodeShare(encodeShare(p, { allVariants: false }));
    expect(link.status).toBe('ok');
    if (link.status === 'ok') expect(link.project.variants.find((v) => v.plumbing)?.plumbing).toEqual(plumbing);

    const doc = decodeProposalProject(encodeProposalProject(p.variants[1], { site: p.site, seedRevision: p.seedRevision }), 'mitt', 'Mitt forslag');
    expect(doc.status).toBe('ok');
    if (doc.status === 'ok') expect(doc.variant.plumbing).toEqual(plumbing);
  });

  it('a proposal without stacks stays without the field', () => {
    const p = createForslagD();
    const file = parseProjectText(serializeProject(p));
    expect(file.status === 'ok' && 'plumbing' in file.project.variants[0]).toBe(false);
  });
});

describe('cost', () => {
  it('analyses the furnished seed in at most 2 ms', () => {
    const variants = [seed, toiletInSoverom1(seed)];
    for (const v of variants) {
      const d = derive(v);
      for (const plumbing of [undefined, { stacks: [{ id: 's', p: [18.6, 0.5] as Vec2, storeyId: 'ground' }] }]) {
        let best = Infinity;
        for (let i = 0; i < 20; i++) {
          // A fresh derived object each time: no memo, no wall cache.
          const fresh = { ...d };
          const t0 = performance.now();
          analysePlumbing(fresh, plumbing, { todayRoomIds: today });
          best = Math.min(best, performance.now() - t0);
        }
        expect(best).toBeLessThanOrEqual(2);
      }
    }
  });

  it('is memoised on the derived model and the stacks', () => {
    const a = analysePlumbing(seedDerived, undefined, { todayRoomIds: today });
    expect(analysePlumbing(seedDerived, undefined, { todayRoomIds: today })).toBe(a);
    const b = analysePlumbing(seedDerived, { stacks: [] }, { todayRoomIds: today });
    expect(b).not.toBe(a);
    expect(analysePlumbing(seedDerived, undefined, { todayRoomIds: today })).toBe(a);
  });
});

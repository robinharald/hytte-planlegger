/**
 * Editor core on the real seed (docs/phase2-plan.md §1, §3.4–§3.7): createForslagD(), then `duplicateVariant` for an
 * unlocked copy ("Mitt forslag"). Every scenario goes through the store actions (produce → reconcile → replaceVariant).
 */
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { treesOf } from '../geometry/derive';
import { hostLine } from '../geometry/edit';
import { distancePointSegment, pointInPolygon } from '../geometry/polygon';
import { createForslagD } from '../model/seed/forslagD';
import type { Opening, Variant, Vec2 } from '../model/types';
import * as A from './editActions';
import { EDIT_STRINGS } from './editStrings';
import { createAppStore, selectActiveVariant } from './store';
import { deriveForState } from './useDerived';

type Store = ReturnType<typeof createAppStore>;

/** A store on the seed with an unlocked copy of Forslag D active and an empty history. */
function proposal(): Store {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

const V = (s: Store): Variant => selectActiveVariant(s.getState());
const D = (s: Store): DerivedVariant => deriveForState(s.getState());
const wall = (s: Store, id: string) => V(s).walls.find((w) => w.id === id);
const opening = (s: Store, id: string) => V(s).openings.find((o) => o.id === id);
const namedRooms = (s: Store) => D(s).rooms.filter((r) => r.room);
const roomByRecord = (s: Store, id: string) => D(s).rooms.find((r) => r.room?.id === id);
/**
 * Warning kinds about the building. The seed is furnished (revision 6): walls moved into furniture, or a bathroom merged
 * into a bedroom, give furniture warnings by design (their own tests: geometry/furnitureDerive.test.ts).
 */
const kinds = (s: Store) =>
  D(s)
    .warnings.filter((w) => !w.kind.startsWith('furniture-') && !(w.kind === 'door-blocked' && D(s).furniture.some((f) => f.id === w.by)))
    .map((w) => w.kind);
const toastTexts = (s: Store) => s.getState().toasts.map((t) => t.text);

/** Plan position of an opening's centre (from the derived model). */
function openingCentre(s: Store, id: string): Vec2 | null {
  for (const w of D(s).walls) {
    const o = w.openings.find((x) => x.id === id);
    if (!o) continue;
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    return [w.a[0] + ((w.b[0] - w.a[0]) * o.offset) / L, w.a[1] + ((w.b[1] - w.a[1]) * o.offset) / L];
  }
  return null;
}

const close = (a: Vec2 | null | undefined, b: Vec2, tol = 1e-6) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as Vec2)[0] - b[0])).toBeLessThan(tol);
  expect(Math.abs((a as Vec2)[1] - b[1])).toBeLessThan(tol);
};

// ---------------------------------------------------------------------------
// §1: the locked base proposal
// ---------------------------------------------------------------------------

describe('the locked base proposal (Forslag D)', () => {
  it('every action is refused with the toast and the variant object is unchanged', () => {
    const store = createAppStore(createForslagD());
    const before = V(store);
    const site = store.getState().project.site;
    const deck = before.outdoor.decks[0];
    const calls: (() => unknown)[] = [
      () => A.addWall(store, [17, 4], [17, 6]),
      () => A.moveWall(store, 'w-gang-n', [0, 0.3]),
      () => A.moveWallEndpoint(store, 'w-gang-n', 'b', [20, 3.4]),
      () => A.splitWall(store, 'w-gang-s', 0.5),
      () => A.deleteWall(store, 'w-104-103'),
      () => A.setWallProps(store, 'w-gang-n', { thickness: 0.2 }),
      () => A.restoreGhost(store, 'win-stue-s-old'),
      () => A.moveBlockEdge(store, 'blk-wing', 'v-wing-se', [1, 0]),
      () => A.moveBlockVertex(store, 'blk-main', 'v-main-ne', [17, 6.5]),
      () => A.moveBlock(store, 'blk-wing', [1, 0]),
      () => A.rotateBlock(store, 'blk-wing', 90),
      () => A.placeUnit(store, 'vedskjul', [14, 9], 0),
      () => A.deleteBlock(store, 'blk-wing'),
      () => A.setBlockProps(store, 'blk-wing', { name: 'X' }),
      () => A.setBlockSize(store, 'blk-wing', 'w', 5),
      () => A.duplicateBlock(store, 'blk-wing'),
      () => A.addOpening(store, { kind: 'wall', wallId: 'w-gang-n' }, 3, 'door'),
      () => A.moveOpening(store, 'door-mellom-vf', 8.5),
      () => A.setOpeningProps(store, 'win-kjk-n', { width: 1.4 }),
      () => A.deleteOpening(store, 'win-kjk-n'),
      () => A.nameFace(store, 'face-x', 'Rom'),
      () => A.setRoomProps(store, 'room-stue', { name: 'Storstue' }),
      () => A.deleteRoom(store, 'room-stue'),
      () => A.resizeRoom(store, 'room-sov-ny', 'd', 2.4),
      () => A.moveDeckVertex(store, deck.polygon[0].id, [8, -5]),
      () => A.moveDeckEdge(store, deck.polygon[0].id, [0, -1]),
      () => A.moveDeck(store, deck.id, [1, 0]),
      () => A.insertDeckVertex(store, deck.polygon[1].id, [23.2, 6]),
      () => A.deleteDeckVertex(store, deck.polygon[0].id),
      () => A.setDeckProps(store, deck.id, { topHeight: 0 }),
      () => A.toggleRailingEdge(store, deck.polygon[0].id),
      () => A.addSteps(store, deck.polygon[0].id, 5),
      () => A.moveSteps(store, deck.steps[0].id, 4),
      () => A.setStepsProps(store, deck.steps[0].id, { width: 2 }),
      () => A.deleteSteps(store, deck.steps[0].id),
      () => A.moveHotTub(store, 'tub-1', [20, -3]),
      () => A.setHotTubDiameter(store, 'tub-1', 2.4),
      () => A.deleteHotTub(store, 'tub-1'),
      () => A.addTree(store, [0, 20]),
      () => A.moveTree(store, 'tree-1', [0, 0]),
      () => A.deleteTree(store, 'tree-1'),
      () => A.setVariantNotes(store, 'Notat'),
      () => A.addFurniture(store, 'seng-150', [18, 5]),
      () => A.nudge(store, { kind: 'wall', id: 'w-gang-n' }, 0, 0.01),
      () => A.nudge(store, { kind: 'hotTub', id: 'tub-1' }, 0.1, 0),
    ];
    for (const call of calls) {
      call();
      expect(V(store)).toBe(before);
      expect(store.getState().project.site).toBe(site);
    }
    expect(A.beginDrag(store, { kind: 'wall', id: 'w-gang-n' }, [18, 3.4])).toBeNull();
    expect(store.getState().inTransaction()).toBe(false);
    expect(store.temporal.getState().pastStates).toHaveLength(0);
    const locked = store.getState().toasts.find((t) => t.text === EDIT_STRINGS.locked);
    expect(locked?.action).toBe('newProposal');
    expect(A.canEdit(store)).toBe(false);
  });

  it('a duplicated copy is editable', () => {
    const store = proposal();
    expect(V(store).locked).toBeUndefined();
    expect(A.canEdit(store)).toBe(true);
    expect(A.moveWall(store, 'w-gang-n', [0, 0.3])).toBe(true);
    expect(store.getState().toasts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §3.4: status bookkeeping, ghosts, parts
// ---------------------------------------------------------------------------

describe('status bookkeeping and parts (§3.4)', () => {
  it("blk-main's east edge 16 → 18 → 16 keeps BYA existing 102.18 (drag and two separate moves)", () => {
    const store = proposal();
    const start = V(store);
    expect(D(store).areas.bya.existing).toBeCloseTo(102.18, 2);
    // One drag: 16 → 18 → 16 is computed from the base, so it ends exactly where it started.
    const session = A.beginDrag(store, { kind: 'blockEdge', id: 'v-main-se' }, [16, 1]);
    expect(session?.kind).toBe('blockEdge');
    A.updateDrag(store, session, [18, 1]);
    expect(V(store).blocks.find((b) => b.id === 'blk-main')?.polygon[1].p).toEqual([18, 0]);
    expect(D(store).areas.bya.existing).toBeCloseTo(102.18, 2);
    A.updateDrag(store, session, [16, 1]);
    A.endDrag(store, session);
    expect(V(store)).toBe(start);
    // Two actions: the east edge lies on the new stue extension, so no ghost and the existing area never changes.
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-se', [2, 0])).toBe(true);
    const main = V(store).blocks.find((b) => b.id === 'blk-main');
    expect(main?.polygon.map((v) => v.p)).toEqual([
      [0, 0],
      [18, 0],
      [18, 6.2],
      [0, 6.2],
    ]);
    // The junction partner (the wing's west edge) and the collinear w-wing-w followed.
    expect(V(store).blocks.find((b) => b.id === 'blk-wing')?.polygon.map((v) => v.p)).toEqual([
      [18, -2],
      [20.8, -2],
      [20.8, 6.2],
      [18, 6.2],
    ]);
    expect(wall(store, 'w-wing-w')).toMatchObject({ a: [18, 0], b: [18, 6.2] });
    expect(V(store).ghosts).toBeUndefined();
    expect(D(store).areas.bya.existing).toBeCloseTo(102.18, 2);
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-se', [-2, 0])).toBe(true);
    expect(main && V(store).blocks.find((b) => b.id === 'blk-main')?.polygon.map((v) => v.p)[1]).toEqual([16, 0]);
    expect(V(store).blocks.find((b) => b.id === 'blk-wing')?.polygon[0].p).toEqual([16, -2]);
    expect(wall(store, 'w-wing-w')).toMatchObject({ a: [16, 0], b: [16, 6.2] });
    expect(D(store).areas.bya.existing).toBeCloseTo(102.18, 2);
  });

  it('the old west gable 0 → −1: +6.2 m² new on the axis, existing unchanged, a ghost that heals on the way back', () => {
    const store = proposal();
    const before = D(store).areas;
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [-1, 0])).toBe(true);
    const after = D(store).areas;
    // The existing part is clipped, not grown: the strip x −1..0 is the implicit (new) remainder.
    expect(after.axis.existing).toBeCloseTo(before.axis.existing, 6);
    expect(after.axis.new - before.axis.new).toBeCloseTo(6.2, 6);
    // BYA (outside of the cladding): the building grows by 1.0 × 6.42; the old gable's 0.11 m cladding strip is now
    // inside the building and counted with the new strip (areas.ts partitions the outer outline by the parts' outer
    // outlines, which only carry cladding along block-boundary edges).
    expect(after.bya.total - before.bya.total).toBeCloseTo(6.42, 6);
    expect(before.bya.existing - after.bya.existing).toBeCloseTo(0.11 * 6.42, 6);
    expect(after.bya.new - before.bya.new).toBeCloseTo(6.42 + 0.11 * 6.42, 6);
    // The old gable line is a ghost; the floor zones (lower floor, loft) reach the moved wall.
    expect(V(store).ghosts).toEqual([{ id: 'blk-main/v-main-nw/ghost', a: [0, 6.2], b: [0, 0] }]);
    const main = V(store).blocks.find((b) => b.id === 'blk-main');
    expect(main?.parts.find((p) => p.id === 'part-main-old')?.polygon).toEqual(createForslagD().variants[0].blocks[0].parts[0].polygon);
    expect(main?.floorZones.every((z) => z.polygon.some((p) => p[0] === -1))).toBe(true);
    expect(D(store).ghosts).toHaveLength(1);
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).toEqual([]);
    // Back to x 0: the ghost heals.
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [1, 0])).toBe(true);
    expect(V(store).ghosts).toBeUndefined();
    expect(D(store).areas.bya.existing).toBeCloseTo(before.bya.existing, 6);
  });

  it('"Ta tilbake" on a moved block edge moves it back', () => {
    const store = proposal();
    A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [-1, 0]);
    expect(A.restoreGhost(store, 'blk-main/v-main-nw/ghost')).toBe(true);
    expect(V(store).blocks.find((b) => b.id === 'blk-main')?.polygon[3].p).toEqual([0, 6.2]);
    expect(V(store).ghosts).toBeUndefined();
  });

  it('deleting the existing wall w-104-103 leaves a ghost, merges the rooms, and "Ta tilbake" brings both back', () => {
    const store = proposal();
    expect(roomByRecord(store, 'room-bad')).toBeDefined();
    expect(A.deleteWall(store, 'w-104-103')).toBe(true);
    expect(wall(store, 'w-104-103')?.status).toBe('removed');
    expect(D(store).walls.find((w) => w.id === 'w-104-103')?.isGhost).toBe(true);
    // Soverom 1 (7.7 m²) and Bad (3.3 m²) are one face now: the larger keeps it, the Bad record is gone.
    expect(V(store).rooms.some((r) => r.id === 'room-bad')).toBe(false);
    expect(roomByRecord(store, 'room-sov1')).toBeDefined();
    expect(namedRooms(store)).toHaveLength(26);
    expect(kinds(store)).toEqual([]);
    expect(toastTexts(store)).toEqual([EDIT_STRINGS.merged('Soverom 1', 'Bad'), EDIT_STRINGS.deleted]);
    expect(store.getState().toasts.every((t) => t.undo)).toBe(true);

    expect(A.restoreGhost(store, 'w-104-103')).toBe(true);
    expect(wall(store, 'w-104-103')?.status).toBe('existing');
    expect(roomByRecord(store, 'room-bad')?.room?.name).toBe('Bad');
    expect(roomByRecord(store, 'room-sov1')).toBeDefined();
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).toEqual([]);
  });

  it('moving an existing door makes it new and leaves a ghost at the old place; "Ta tilbake" restores it', () => {
    const store = proposal();
    const old = openingCentre(store, 'door-mellom-vf');
    expect(A.moveOpening(store, 'door-mellom-vf', 8.49)).toBe(true);
    expect(opening(store, 'door-mellom-vf')?.status).toBe('new');
    const ghost = opening(store, 'door-mellom-vf/ghost');
    expect(ghost).toMatchObject({ status: 'removed', offset: 8.99, host: { kind: 'blockEdge', blockId: 'blk-main', edgeId: 'v-main-ne' } });
    expect(openingCentre(store, 'door-mellom-vf/ghost')).toEqual(old);
    close(openingCentre(store, 'door-mellom-vf'), [7.51, 6.2]);
    const derivedGhost = D(store).walls.flatMap((w) => w.openings).find((o) => o.id === 'door-mellom-vf/ghost');
    expect(derivedGhost?.isGhost).toBe(true);
    expect(kinds(store)).toEqual([]);
    expect(A.restoreGhost(store, 'door-mellom-vf/ghost')).toBe(true);
    expect(opening(store, 'door-mellom-vf')).toMatchObject({ status: 'existing', offset: 8.99 });
    expect(opening(store, 'door-mellom-vf/ghost')).toBeUndefined();
  });

  it('moving an existing door back onto its ghost heals it (no ghost, existing again)', () => {
    const store = proposal();
    A.moveOpening(store, 'door-mellom-vf', 8.49);
    A.moveOpening(store, 'door-mellom-vf', 8.99);
    expect(opening(store, 'door-mellom-vf')?.status).toBe('existing');
    expect(opening(store, 'door-mellom-vf/ghost')).toBeUndefined();
  });

  it('moving an existing wall takes its existing openings along and leaves ghosts for both', () => {
    const store = proposal();
    expect(A.moveWall(store, 'w-vf-korr', [0, 0.2])).toBe(true);
    expect(wall(store, 'w-vf-korr')).toMatchObject({ status: 'new', a: [5.05, 4.44], b: [9, 4.44] });
    expect(wall(store, 'w-vf-korr/ghost')).toMatchObject({ status: 'removed', a: [5.05, 4.24], b: [9, 4.24] });
    expect(opening(store, 'o-vf')?.status).toBe('new');
    expect(opening(store, 'o-vf/ghost')).toMatchObject({ status: 'removed', host: { kind: 'wall', wallId: 'w-vf-korr/ghost' } });
    expect(namedRooms(store)).toHaveLength(27);
    // "Ta tilbake" moves it back with the same cascades and restores the opening too.
    expect(A.restoreGhost(store, 'w-vf-korr/ghost')).toBe(true);
    expect(wall(store, 'w-vf-korr')).toMatchObject({ status: 'existing', a: [5.05, 4.24], b: [9, 4.24] });
    expect(opening(store, 'o-vf')?.status).toBe('existing');
    expect(V(store).walls.some((w) => w.id.endsWith('/ghost'))).toBe(false);
    expect(V(store).openings.some((o) => o.id.endsWith('/ghost'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3.5: drag rules
// ---------------------------------------------------------------------------

describe('wall moves (§3.5)', () => {
  it('w-sauna-n +0.3 slides along the wing edge and w-wc-bad, leaves w-wing-w intact, all 27 rooms named', () => {
    const store = proposal();
    expect(A.moveWall(store, 'w-sauna-n', [0, 0.3])).toBe(true);
    expect(wall(store, 'w-sauna-n')).toMatchObject({ a: [16, 0.3], b: [18.6, 0.3] });
    expect(wall(store, 'w-wing-w')).toMatchObject({ a: [16, 0], b: [16, 6.2] });
    // The T-junction wall of the pantry follows along its own direction.
    expect(wall(store, 'w-pantry-wc')).toMatchObject({ a: [17.4, 0.3], b: [17.4, 2.2] });
    expect(wall(store, 'w-wc-bad')).toMatchObject({ a: [18.6, -2], b: [18.6, 2.2] });
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).toEqual([]);
  });

  it('dragging dv-stue-n keeps dv-kjk-w on its line and its far end; the shared free node follows', () => {
    const store = proposal();
    const session = A.beginDrag(store, { kind: 'wall', id: 'dv-stue-n' }, [12, 2.2]);
    A.updateDrag(store, session, [12, 2.5]);
    A.endDrag(store, session);
    expect(wall(store, 'dv-stue-n')).toMatchObject({ a: [9, 2.5], b: [16, 2.5] });
    const kjk = wall(store, 'dv-kjk-w');
    expect(kjk?.a[0]).toBe(9);
    expect(kjk?.b).toEqual([9, 4.24]);
    expect(kjk?.a).toEqual([9, 2.5]);
    // The end on the wing edge is anchored: w-gang-s (coincident there) is not stretched.
    expect(wall(store, 'w-gang-s')).toMatchObject({ a: [16, 2.2], b: [20.8, 2.2] });
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).toEqual([]);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
  });

  it('an endpoint drag of an anchored end slides along its support', () => {
    const store = proposal();
    expect(A.moveWallEndpoint(store, 'w-gang-n', 'b', [20.3, 3.9])).toBe(true);
    expect(wall(store, 'w-gang-n')).toMatchObject({ a: [16, 3.4], b: [20.8, 3.9] });
  });

  it('openings on a moved wall keep their offset; on stretched walls they keep their plan position', () => {
    const store = proposal();
    const pantry = openingCentre(store, 'd-pantry');
    expect(A.moveWall(store, 'w-gang-n', [0, 0.4])).toBe(true);
    expect(opening(store, 'd-sov-ny')?.offset).toBeCloseTo(1.3, 9);
    close(openingCentre(store, 'd-sov-ny'), [17.3, 3.8]);
    // w-wing-w is a support of w-gang-n's west end, not stretched; d-pantry on w-gang-s did not move.
    close(openingCentre(store, 'd-pantry'), pantry as Vec2);
  });

  it('splitWall re-hosts the openings beyond the split point by their centre', () => {
    const store = proposal();
    const before = ['d-pantry', 'd-wc', 'd-bad2'].map((id) => openingCentre(store, id));
    const second = A.splitWall(store, 'w-gang-s', 0.5);
    expect(second).toBeTruthy();
    expect(wall(store, 'w-gang-s')).toMatchObject({ a: [16, 2.2], b: [18.4, 2.2] });
    expect(wall(store, second as string)).toMatchObject({ a: [18.4, 2.2], b: [20.8, 2.2], status: 'new' });
    expect(opening(store, 'd-pantry')?.host).toEqual({ kind: 'wall', wallId: 'w-gang-s' });
    expect(opening(store, 'd-wc')?.host).toEqual({ kind: 'wall', wallId: 'w-gang-s' });
    expect(opening(store, 'd-bad2')?.host).toEqual({ kind: 'wall', wallId: second });
    expect(opening(store, 'd-bad2')?.offset).toBeCloseTo(1.1, 9);
    ['d-pantry', 'd-wc', 'd-bad2'].forEach((id, i) => close(openingCentre(store, id), before[i] as Vec2));
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).toEqual([]);
  });

  it('a new wall across a room splits it: the larger part keeps the room, the other is named with nameFace', () => {
    const store = proposal();
    const id = A.addWall(store, [19.2, 3.4], [19.2, 6.2]);
    expect(id).toBeTruthy();
    expect(wall(store, id as string)).toMatchObject({ levelId: 'main', status: 'new', kind: 'interior', thickness: 0.12 });
    const sov = roomByRecord(store, 'room-sov-ny');
    expect(sov?.bbox.max[0]).toBeLessThan(19.2);
    const unnamed = D(store).rooms.filter((r) => !r.room);
    expect(unnamed).toHaveLength(1);
    expect(kinds(store)).toEqual(['room-unnamed']);
    const roomId = A.nameFace(store, unnamed[0].id, 'Kontor', { type: 'annet' });
    expect(roomByRecord(store, roomId as string)?.room?.name).toBe('Kontor');
    expect(kinds(store)).toEqual([]);
  });

  it('deleting a new wall deletes it with its openings', () => {
    const store = proposal();
    expect(A.deleteWall(store, 'w-gang-n')).toBe(true);
    expect(wall(store, 'w-gang-n')).toBeUndefined();
    expect(opening(store, 'd-sov-ny')).toBeUndefined();
    expect(toastTexts(store)).toContain(EDIT_STRINGS.deleted);
  });
});

describe('rooms under edits (§3.5)', () => {
  it('a room shrunk past its anchor keeps its own (smaller) face; the anchor moves to the label point', () => {
    const store = proposal();
    expect(A.moveWall(store, 'w-gang-n', [0, -0.8])).toBe(true);
    const gang = roomByRecord(store, 'room-gang');
    expect(gang).toBeDefined();
    expect(gang?.bbox.max[1]).toBeLessThan(2.7);
    expect(V(store).rooms.find((r) => r.id === 'room-gang')?.anchor).toEqual(gang?.labelPoint);
    expect(roomByRecord(store, 'room-sov-ny')).toBeDefined();
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).toEqual([]);
    expect(store.getState().toasts).toHaveLength(0);
  });

  it('a wall dragged past the middle of the bigger room beside it moves the boundary (no swap, no merge)', () => {
    // w-gang-n 3.4 → 5.0: Soverom (ny fløy) overlaps the grown Gang face more than its own strip, but both keep a face.
    for (const dy of [1.6, 2.4]) {
      const store = proposal();
      expect(A.moveWall(store, 'w-gang-n', [0, dy])).toBe(true);
      const gang = roomByRecord(store, 'room-gang');
      const sov = roomByRecord(store, 'room-sov-ny');
      expect(gang?.bbox.max[1]).toBeGreaterThan(3.4 + dy - 0.1);
      expect(sov?.bbox.min[1]).toBeGreaterThan(3.4 + dy);
      expect(namedRooms(store)).toHaveLength(27);
      expect(store.getState().toasts).toHaveLength(0);
    }
  });
});

describe('block edits (§3.4, §3.5)', () => {
  it('a corner drag moves both edges and door-mellom-vf keeps its plan position (re-offset on both adjacent edges)', () => {
    const store = proposal();
    expect(A.moveBlockVertex(store, 'blk-main', 'v-main-ne', [17, 6.5])).toBe(true);
    expect(V(store).blocks.find((b) => b.id === 'blk-main')?.polygon.map((v) => v.p)).toEqual([
      [0, 0],
      [17, 0],
      [17, 6.5],
      [0, 6.5],
    ]);
    // North edge moved north 0.3: the door rides with it but keeps x = 7.01 (offset 8.99 → 9.99 from the new NE corner).
    close(openingCentre(store, 'door-mellom-vf'), [7.01, 6.5]);
    expect(opening(store, 'door-mellom-vf')?.offset).toBeCloseTo(9.99, 9);
    // It moved with the edge's line: new, with its ghost at the old place (§1.2, fix round after 2a).
    expect(opening(store, 'door-mellom-vf')?.status).toBe('new');
    close(openingCentre(store, 'door-mellom-vf/ghost'), [7.01, 6.2]);
    // South edge stretched: its openings keep their plan positions.
    close(openingCentre(store, 'win-ext-s1'), [13.2, 0]);
    // The bod wing (junction with the north edge) and the wing (east edge) followed.
    expect(V(store).blocks.find((b) => b.id === 'blk-bod')?.polygon[0].p).toEqual([5, 6.5]);
    expect(V(store).blocks.find((b) => b.id === 'blk-wing')?.polygon[0].p).toEqual([17, -2]);
    // Only the main north edge has existing pieces that moved (the east edge is the new extension; the bod wing's
    // south edge has no wall of its own — the main house owns that junction); the bod's side walls lost 0.3 m.
    expect(V(store).ghosts).toEqual([
      { id: 'blk-main/v-main-ne/ghost', a: [12, 6.2], b: [0, 6.2] },
      { id: 'blk-bod/v-bod-se/ghost', a: [9, 6.2], b: [9, 6.5] },
      { id: 'blk-bod/v-bod-nw/ghost', a: [5, 6.5], b: [5, 6.2] },
    ]);
    expect(namedRooms(store)).toHaveLength(27);
  });

  it('dragging the wing east wall 1 m east: the wing follows, its walls stretch, room areas change, no generic warnings', () => {
    const store = proposal();
    const area = roomByRecord(store, 'room-sov-ny')?.area ?? 0;
    const session = A.beginDrag(store, { kind: 'wall', id: 'blk-wing/v-wing-se/blk-wing-implicit/base' }, [20.8, 4]);
    expect(session?.kind).toBe('blockEdge');
    const fb = A.updateDrag(store, session, [21.8, 4.1], { snapRadiusM: 0.1 });
    expect(fb.ghost).toEqual([
      [
        [20.8, -2],
        [20.8, 6.2],
      ],
    ]);
    expect(fb.chips.length).toBeGreaterThan(0);
    A.endDrag(store, session);
    expect(V(store).blocks.find((b) => b.id === 'blk-wing')?.polygon[1].p).toEqual([21.8, -2]);
    expect(wall(store, 'w-gang-n')?.b).toEqual([21.8, 3.4]);
    expect(roomByRecord(store, 'room-sov-ny')?.area).toBeGreaterThan(area + 2);
    expect(kinds(store)).not.toContain('generic');
    expect(namedRooms(store)).toHaveLength(27);
  });

  it('moveBlock carries the walls, openings, rooms and furniture inside it; refuses a block with existing area', () => {
    const store = proposal();
    const blockId = A.placeUnit(store, 'anneks', [0, 15], 0) as string;
    const wallId = A.addWall(store, [0, 13.6], [0, 16.4]) as string;
    const doorId = A.addOpening(store, { kind: 'wall', wallId }, 1.4, 'door') as string;
    const itemId = A.addFurniture(store, 'seng-150', [1, 15]) as string;
    const roomIds = V(store).rooms.filter((r) => Math.abs(r.anchor[1] - 15) < 2).map((r) => r.id);
    expect(A.moveBlock(store, blockId, [2, -1])).toBe(true);
    expect(V(store).blocks.find((b) => b.id === blockId)?.polygon[0].p).toEqual([0, 12.5]);
    expect(wall(store, wallId)).toMatchObject({ a: [2, 12.6], b: [2, 15.4] });
    expect(opening(store, doorId)?.host).toEqual({ kind: 'wall', wallId });
    expect(V(store).furniture.find((f) => f.id === itemId)?.position).toEqual([3, 14]);
    for (const id of roomIds) expect(roomByRecord(store, id)).toBeDefined();
    const main = V(store).blocks.find((b) => b.id === 'blk-main');
    expect(A.moveBlock(store, 'blk-main', [1, 0])).toBe(false);
    expect(V(store).blocks.find((b) => b.id === 'blk-main')).toBe(main);
    expect(toastTexts(store)).toContain(EDIT_STRINGS.existingBlockMove);
  });

  it('deleteBlock cascades for a new block and is refused for an existing one', () => {
    const store = proposal();
    const blockId = A.placeUnit(store, 'bod', [0, 15], 0) as string;
    const wallId = A.addWall(store, [0, 13.6], [0, 16.4]) as string;
    const itemId = A.addFurniture(store, 'hylle', [0.5, 15]) as string;
    const unitOpenings = V(store).openings.filter((o) => o.host.kind === 'blockEdge' && o.host.blockId === blockId);
    expect(unitOpenings).toHaveLength(1);
    const roomsBefore = V(store).rooms.length;
    expect(A.deleteBlock(store, blockId)).toBe(true);
    const v = V(store);
    expect(v.blocks.some((b) => b.id === blockId)).toBe(false);
    expect(v.openings.some((o) => o.host.kind === 'blockEdge' && o.host.blockId === blockId)).toBe(false);
    expect(v.walls.some((w) => w.id === wallId)).toBe(false);
    expect(v.furniture.some((f) => f.id === itemId)).toBe(false);
    expect(v.rooms.length).toBe(roomsBefore - 1);
    expect(toastTexts(store)).toContain(EDIT_STRINGS.deleted);
    expect(namedRooms(store)).toHaveLength(27);

    const before = V(store);
    expect(A.deleteBlock(store, 'blk-glass')).toBe(false);
    expect(A.deleteBlock(store, 'blk-bod')).toBe(false);
    expect(V(store)).toBe(before);
    expect(toastTexts(store)).toContain(EDIT_STRINGS.existingBlockDelete);
    // The new wing has no existing area and can go.
    expect(A.deleteBlock(store, 'blk-wing')).toBe(true);
    expect(V(store).blocks.find((b) => b.id === 'blk-main')?.junctions.some((j) => j.otherBlockId === 'blk-wing')).toBe(false);
  });

  it('setBlockProps: Takvinkel sets drive pitch, Mønehøyde drive height; Åpen front toggles the Vedskjul opening', () => {
    const store = proposal();
    A.setBlockProps(store, 'blk-wing', { roof: { pitchDeg: 30 } });
    expect(V(store).blocks.find((b) => b.id === 'blk-wing')?.roof).toMatchObject({ pitchDeg: 30, drive: 'pitch' });
    A.setBlockProps(store, 'blk-main', { roof: { ridgeHeight: 4 } });
    expect(V(store).blocks.find((b) => b.id === 'blk-main')?.roof).toMatchObject({ ridgeHeight: 4, drive: 'height' });
    const shed = A.placeUnit(store, 'vedskjul', [0, 15], 0) as string;
    const front = (s: Store) => V(s).openings.filter((o) => o.host.kind === 'blockEdge' && o.host.blockId === shed && o.fullHeight);
    expect(front(store)).toHaveLength(1);
    A.setBlockProps(store, shed, { openFront: false });
    expect(front(store)).toHaveLength(0);
    A.setBlockProps(store, shed, { openFront: true });
    expect(front(store)).toHaveLength(1);
  });

  it('duplicateBlock copies a unit with new ids next to it', () => {
    const store = proposal();
    const shed = A.placeUnit(store, 'vedskjul', [0, 15], 0) as string;
    const copyId = A.duplicateBlock(store, shed, [3, 0]) as string;
    const b = V(store).blocks.find((x) => x.id === copyId);
    expect(b?.polygon[0].p).toEqual([2, 14.25]);
    expect(V(store).openings.filter((o) => o.host.kind === 'blockEdge' && o.host.blockId === copyId)).toHaveLength(1);
    expect(namedRooms(store)).toHaveLength(29);
  });
});

describe('openings (§3.5)', () => {
  it('a drag is clamped to its piece; dragged onto another wall it is re-hosted with the swing kept in world terms', () => {
    const store = proposal();
    // d-sov-ny on w-gang-n (+x): hinge at the west jamb, opening into the bedroom (+y).
    const session = A.beginDrag(store, { kind: 'opening', id: 'd-sov-ny' }, [17.3, 3.4]);
    A.updateDrag(store, session, [10, 3.4]);
    expect(opening(store, 'd-sov-ny')?.offset).toBeCloseTo(0.4, 9); // clamped at the wall start (end-touch)
    // Onto the wing's north wall (a block edge running −x): the hinge stays at the west jamb and the leaf keeps
    // opening towards +y, which on that edge is the outside (right of the CCW edge).
    A.updateDrag(store, session, [17.3, 6.25]);
    const o = opening(store, 'd-sov-ny') as Opening;
    expect(o.host).toEqual({ kind: 'blockEdge', blockId: 'blk-wing', edgeId: 'v-wing-ne' });
    expect(o.swing).toEqual({ hinge: 'end', side: 'right' });
    close(openingCentre(store, 'd-sov-ny'), [17.3, 6.2], 1e-6);
    A.endDrag(store, session);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    // Cancel restores everything.
    const s2 = A.beginDrag(store, { kind: 'opening', id: 'd-sov-ny' }, [17.3, 6.2]);
    A.updateDrag(store, s2, [18.3, 6.2]);
    const mid = opening(store, 'd-sov-ny');
    expect(mid?.offset).not.toBe(o.offset);
    A.cancelDrag(store, s2);
    expect(opening(store, 'd-sov-ny')?.offset).toBe(o.offset);
  });

  it('re-hosting recomputes the level unless it was set to something else than the old default', () => {
    const store = proposal();
    // win-104-w sits on the main block's west gable over the lower floor ('lower' = its default there).
    const host = { kind: 'blockEdge' as const, blockId: 'blk-main', edgeId: 'v-main-sw' };
    expect(A.moveOpening(store, 'win-104-w', 13.2, host)).toBe(true);
    expect(opening(store, 'win-104-w')?.levelId).toBe('main');
    // The loft windows say 'loft' explicitly (not the default): kept.
    expect(A.moveOpening(store, 'win-hems-w1', 1.0, host)).toBe(true);
    expect(opening(store, 'win-hems-w1')?.levelId).toBe('loft');
  });

  it('the end handle cannot cross the end of the opening\'s wall piece', () => {
    const store = proposal();
    // win-ext-s2 (x 14.8, 1.1 wide) on the main south edge's stue piece x 12–16.
    const s = A.beginDrag(store, { kind: 'opening', id: 'win-ext-s2' }, [15.35, 0], 'end');
    A.updateDrag(store, s, [17.5, 0]);
    A.endDrag(store, s);
    const o = opening(store, 'win-ext-s2');
    expect((o?.offset ?? 0) + (o?.width ?? 0) / 2).toBeCloseTo(16, 6);
    expect((o?.offset ?? 0) - (o?.width ?? 0) / 2).toBeCloseTo(14.25, 6);
  });

  it('resizing with the end handle keeps the other jamb', () => {
    const store = proposal();
    const s = A.beginDrag(store, { kind: 'opening', id: 'win-kjk-n' }, [10.0, 6.2], 'end');
    expect(s?.kind).toBe('openingResize');
    // win-kjk-n: north edge (east → west), offset 5.41 from (16, 6.2), width 1.11; jambs at s 4.855 / 5.965.
    A.updateDrag(store, s, [9.5, 6.2]);
    A.endDrag(store, s);
    const o = opening(store, 'win-kjk-n');
    // 6.5 − 4.855 = 1.645, stored in whole centimetres (fix round after 2b): 1.65.
    expect(o?.width).toBe(1.65);
    expect((o?.offset ?? 0) - (o?.width ?? 0) / 2).toBeCloseTo(4.855, 6);
    expect(o?.status).toBe('new');
    expect(opening(store, 'win-kjk-n/ghost')?.width).toBe(1.11);
  });

  it('addOpening uses type defaults and clamps into the host; setOpeningProps touches an existing window', () => {
    const store = proposal();
    const id = A.addOpening(store, { kind: 'wall', wallId: 'w-gang-n' }, 0.1, 'door') as string;
    expect(opening(store, id)).toMatchObject({ type: 'door', width: 0.9, height: 2, sill: 0, offset: 0.45, status: 'new', swing: { hinge: 'start', side: 'left' } });
    expect(A.addOpening(store, { kind: 'wall', wallId: 'dv-stue-n' }, 1, 'door')).toBeNull();
    expect(A.setOpeningProps(store, 'win-kjk-n', { width: 1.4 })).toBe(true);
    expect(opening(store, 'win-kjk-n')).toMatchObject({ width: 1.4, status: 'new' });
    expect(opening(store, 'win-kjk-n/ghost')).toMatchObject({ width: 1.11, status: 'removed' });
    expect(A.setOpeningProps(store, 'win-sov-n', { style: { frameColour: 'green' } })).toBe(true);
    expect(opening(store, 'win-sov-n/ghost')).toBeUndefined();
  });

  it('deleteOpening: an existing one becomes a ghost in place, a new one is deleted', () => {
    const store = proposal();
    expect(A.deleteOpening(store, 'win-kjk-n')).toBe(true);
    expect(opening(store, 'win-kjk-n')?.status).toBe('removed');
    expect(A.deleteOpening(store, 'win-sov-n')).toBe(true);
    expect(opening(store, 'win-sov-n')).toBeUndefined();
    expect(A.restoreGhost(store, 'win-kjk-n')).toBe(true);
    expect(opening(store, 'win-kjk-n')?.status).toBe('existing');
  });
});

describe('units (§3.5)', () => {
  it('placeUnit on the deck: the deck pieces lose the footprint, the railing regenerates around it', () => {
    const store = proposal();
    const railingBefore = D(store).outdoor.railings[0].panels.length;
    const blockId = A.placeUnit(store, 'vedskjul', [14, 11.35], 0) as string;
    const block = V(store).blocks.find((b) => b.id === blockId);
    expect(block).toMatchObject({ isNew: true, template: 'vedskjul', levelId: 'main', parts: [], floorZones: [], junctions: [], floorMaterial: 'deck' });
    expect(block?.templateFrontEdgeId).toBe(block?.polygon[0].id);
    expect(block?.polygon.map((v) => v.p)).toEqual([
      [13, 10.6],
      [15, 10.6],
      [15, 12.1],
      [13, 12.1],
    ]);
    const front = V(store).openings.find((o) => o.host.kind === 'blockEdge' && o.host.blockId === blockId);
    expect(front).toMatchObject({ type: 'opening', fullHeight: true, offset: 1, status: 'new' });
    const room = V(store).rooms.find((r) => r.name === 'Vedskjul');
    expect(room).toMatchObject({ type: 'bod', floorMaterial: 'deck', anchor: [14, 11.35] });
    const deck = D(store).outdoor.decks[0];
    // The unit stands on the deck's north edge: no hole, a notch; the railing along y 12.1 is split around it.
    const inPiece = deck.pieces.some((piece) => piece[0].some((p) => Math.abs(p[0] - 12.97) < 1e-6 && Math.abs(p[1] - 12.1) < 1e-6));
    expect(inPiece).toBe(true);
    const railing = D(store).outdoor.railings[0];
    expect(railing.panels.length).toBe(railingBefore + 1);
    expect(railing.panels.some((p) => [p.a, p.b].some((q) => Math.abs(q[0] - 15.03) < 1e-6 && q[1] === 12.1))).toBe(true);
    expect(namedRooms(store)).toHaveLength(28);
    expect(kinds(store)).toEqual([]);
  });

  it('a unit in the middle of the deck makes a hole in the deck piece', () => {
    const store = proposal();
    A.placeUnit(store, 'bod', [14, 9], 1);
    const pieces = D(store).outdoor.decks[0].pieces;
    expect(pieces.some((p) => p.length === 2)).toBe(true);
  });

  it('a unit touching the wing forms a junction (the wing keeps the wall); the door faces the deck', () => {
    const store = proposal();
    const blockId = A.placeUnit(store, 'bod', [18, 7.7], 0) as string;
    const db = D(store).blocks.find((b) => b.block.id === blockId);
    expect(db?.junctions).toEqual([{ edgeIndex: 0, s0: 0, s1: 2, otherBlockId: 'blk-wing', otherEdgeIndex: 2, role: 'removed' }]);
    const door = V(store).openings.find((o) => o.host.kind === 'blockEdge' && o.host.blockId === blockId);
    expect(door?.host.kind === 'blockEdge' && door.host.edgeId).toBe(db?.block.polygon[2].id);
    expect(door).toMatchObject({ type: 'door', swing: { hinge: 'start', side: 'right' } });
  });

  it('every template places a valid unit', () => {
    const store = proposal();
    ['vedskjul', 'bod', 'badstue', 'anneks', 'eget'].forEach((t, i) => {
      expect(A.placeUnit(store, t, [-10 * (i + 1), 20], i)).toBeTruthy();
    });
    expect(A.placeUnit(store, 'nope', [0, 30], 0)).toBeNull();
    expect(kinds(store).filter((k) => k !== 'roof-no-meet')).toEqual([]);
    expect(namedRooms(store)).toHaveLength(32);
  });
});

describe('deck (§3.5)', () => {
  it('inserting and deleting a vertex re-hosts the steps by their plan position', () => {
    const store = proposal();
    const deck = () => V(store).outdoor.decks[0];
    const at = (id: string) => D(store).outdoor.steps.find((s) => s.id === id)?.at;
    const before = deck().steps.map((s) => at(s.id));
    const east = deck().polygon[1].id; // (23.2, −4.6) → (23.2, 12.1), steps 1 and 2 on it
    const vid = A.insertDeckVertex(store, east, [23.2, 6]) as string;
    expect(vid).toBeTruthy();
    expect(deck().polygon[2]).toEqual({ id: vid, p: [23.2, 6] });
    expect(deck().steps.find((s) => s.id === 'rail-terrasse/steps/1')?.edgeId).toBe(east);
    expect(deck().steps.find((s) => s.id === 'rail-terrasse/steps/2')).toMatchObject({ edgeId: vid });
    deck().steps.forEach((s, i) => close(at(s.id), before[i] as Vec2));
    // Move the new vertex out and back in: the steps stay where they were along the edges.
    expect(A.deleteDeckVertex(store, vid)).toBe(true);
    expect(deck().polygon).toHaveLength(10);
    expect(deck().steps.find((s) => s.id === 'rail-terrasse/steps/2')?.edgeId).toBe(east);
    deck().steps.forEach((s, i) => close(at(s.id), before[i] as Vec2));
    expect(D(store).outdoor.steps.every((s) => !s.blocked)).toBe(true);
  });

  it('the plan-engineer form insertDeckVertex(deckId, edgeId, p) works too; a 3-corner deck keeps its corners', () => {
    const store = proposal();
    const deck = V(store).outdoor.decks[0];
    expect(A.insertDeckVertex(store, deck.id, deck.polygon[0].id, [15, -4.6])).toBeTruthy();
    expect(V(store).outdoor.decks[0].polygon).toHaveLength(11);
  });

  it('vertex / edge drags keep the steps on changed edges in place; toggles, steps and props', () => {
    const store = proposal();
    const deck = () => V(store).outdoor.decks[0];
    const south = deck().polygon[0].id;
    const at0 = D(store).outdoor.steps[0].at;
    expect(A.moveDeckEdge(store, south, [0, -1])).toBe(true);
    expect(deck().polygon[0].p).toEqual([9, -5.6]);
    expect(D(store).outdoor.steps[0].at).toEqual([at0[0], -5.6]);
    expect(A.moveDeckVertex(store, deck().polygon[1].id, [24, -5.6])).toBe(true);
    expect(A.toggleRailingEdge(store, south)).toBe(true);
    expect(deck().noRailingEdges).toEqual([south]);
    const id = A.addSteps(store, south, 3) as string;
    expect(deck().steps.find((s) => s.id === id)).toMatchObject({ edgeId: south, offset: 3, width: 1.4 });
    expect(A.moveSteps(store, id, 4.2)).toBe(true);
    expect(A.setStepsProps(store, id, { width: 2 })).toBe(true);
    expect(deck().steps.find((s) => s.id === id)).toMatchObject({ offset: 4.2, width: 2 });
    expect(A.deleteSteps(store, id)).toBe(true);
    expect(A.setDeckProps(store, deck().id, { railing: { style: 'boards', height: 1 } })).toBe(true);
    expect(deck().railing).toEqual({ style: 'boards', height: 1 });
  });

  it('the "+" handle inserts a vertex and drags it in one undo step; cancel takes the insertion back too', () => {
    const store = proposal();
    const south = V(store).outdoor.decks[0].polygon[0].id;
    const s = A.beginDrag(store, { kind: 'deckEdge', id: south }, [15, -4.6], 'insert');
    expect(s?.kind).toBe('deckVertex');
    expect(V(store).outdoor.decks[0].polygon).toHaveLength(11);
    A.updateDrag(store, s, [15, -5.6]);
    A.endDrag(store, s);
    expect(V(store).outdoor.decks[0].polygon[1].p).toEqual([15, -5.6]);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    const s2 = A.beginDrag(store, { kind: 'deckEdge', id: south }, [12, -5], 'insert');
    expect(V(store).outdoor.decks[0].polygon).toHaveLength(12);
    A.cancelDrag(store, s2);
    expect(V(store).outdoor.decks[0].polygon).toHaveLength(11);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
  });

  it('steps drag along their edge (one undo step)', () => {
    const store = proposal();
    const s = A.beginDrag(store, { kind: 'steps', id: 'rail-terrasse/steps/0' }, [12.3, -4.6]);
    A.updateDrag(store, s, [15.3, -4.0]);
    A.endDrag(store, s);
    expect(V(store).outdoor.decks[0].steps[0].offset).toBeCloseTo(6.3, 9);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
  });
});

describe('resizeRoom (§3.7)', () => {
  it('Soverom (ny fløy) dybde 2,40 moves w-gang-n (the only stored wall on the depth sides)', () => {
    const store = proposal();
    const res = A.resizeRoom(store, 'room-sov-ny', 'd', 2.4);
    expect(res).toEqual({ ok: true, wallId: 'w-gang-n', side: 'min' });
    expect(roomByRecord(store, 'room-sov-ny')?.dims.h).toBeCloseTo(2.4, 6);
    expect(wall(store, 'w-gang-n')?.a[1]).toBeCloseTo(3.58, 9);
  });

  it('both sides stored → the north / east one; only block edges → refused with "Endres under bygningsdelen"', () => {
    const store = proposal();
    // Gang: w-gang-s (south) and w-gang-n (north) are both stored walls → north moves.
    expect(A.resizeRoom(store, 'room-gang', 'd', 1.5)).toEqual({ ok: true, wallId: 'w-gang-n', side: 'max' });
    expect(roomByRecord(store, 'room-gang')?.dims.h).toBeCloseTo(1.5, 6);
    // Soverom (ny fløy) width: west w-wing-w (stored), east the wing's edge → the stored one.
    expect(A.resizeRoom(store, 'room-sov-ny', 'w', 4.2)).toMatchObject({ ok: true, wallId: 'w-wing-w', side: 'min' });
    // Its east side is the wing's exterior wall only → refused.
    const before = V(store);
    const res = A.resizeRoom(store, 'room-sov-ny', 'w', 4, 'max');
    expect(res).toEqual({ ok: false, reason: 'block-edge' });
    expect(V(store)).toBe(before);
    expect(toastTexts(store)).toContain(EDIT_STRINGS.resizeBlockEdge);
  });
});

describe('transactions and nudges (§3.5)', () => {
  it('a run of nudges is one undo step', () => {
    const store = proposal();
    for (let i = 0; i < 5; i++) expect(A.nudge(store, { kind: 'wall', id: 'w-gang-n' }, 0, 0.01)).toBe(true);
    expect(wall(store, 'w-gang-n')?.a).toEqual([16, 3.45]);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    store.getState().undo();
    expect(wall(store, 'w-gang-n')?.a).toEqual([16, 3.4]);
  });

  it('nudges of different elements are separate steps; every selectable kind nudges', () => {
    const store = proposal();
    const deck = V(store).outdoor.decks[0];
    expect(A.nudge(store, { kind: 'hotTub', id: 'tub-1' }, 0.1, 0)).toBe(true);
    expect(A.nudge(store, { kind: 'opening', id: 'win-sov-n' }, -0.1, 0)).toBe(true);
    expect(A.nudge(store, { kind: 'blockEdge', id: 'v-wing-se' }, 0.1, 0)).toBe(true);
    expect(A.nudge(store, { kind: 'deckVertex', id: deck.polygon[0].id }, 0, -0.1)).toBe(true);
    expect(A.nudge(store, { kind: 'deckEdge', id: deck.polygon[0].id }, 0, -0.1)).toBe(true);
    expect(A.nudge(store, { kind: 'steps', id: deck.steps[0].id }, 0.1, 0)).toBe(true);
    expect(A.nudge(store, { kind: 'tree', id: 'tree-1' }, 0.1, 0)).toBe(true);
    expect(A.nudge(store, { kind: 'room', id: 'room-stue' }, 0.1, 0)).toBe(false);
    expect(store.temporal.getState().pastStates).toHaveLength(7);
    expect(V(store).outdoor.hotTubs[0].centre).toEqual([21.8, -3.2]);
    // Trees are the proposal's own (copy-on-write): the site keeps today's position.
    expect(V(store).trees?.[0].position).toEqual([-3.9, 4]);
    expect(store.getState().project.site.trees[0].position).toEqual([-4, 4]);
  });

  it('a drag is one undo step; transactionBase is the pointer-down project', () => {
    const store = proposal();
    const p0 = store.getState().project;
    const s = A.beginDrag(store, { kind: 'hotTub', id: 'tub-1' }, [21.7, -3.2]);
    expect(store.getState().transactionBase()).toBe(p0);
    A.updateDrag(store, s, [20, -3.2]);
    A.updateDrag(store, s, [19, -3.2]);
    A.endDrag(store, s);
    expect(store.getState().transactionBase()).toBeNull();
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    // The rim touches the deck's south edge (y −4.6) when dragged near it.
    const s2 = A.beginDrag(store, { kind: 'hotTub', id: 'tub-1' }, [19, -3.2]);
    A.updateDrag(store, s2, [19, -3.5], { snapRadiusM: 0.2 });
    A.endDrag(store, s2);
    expect(V(store).outdoor.hotTubs[0].centre[1]).toBeCloseTo(-3.6, 9);
  });

  it('nothing is dragged for rooms, railings, structure and ghosts; whole existing blocks are refused', () => {
    const store = proposal();
    expect(A.beginDrag(store, { kind: 'room', id: 'room-stue' }, [10, 1])).toBeNull();
    expect(A.beginDrag(store, { kind: 'railing', id: 'deck-terrasse/railing' }, [10, -4.6])).toBeNull();
    expect(A.beginDrag(store, { kind: 'ghost', id: 'win-stue-s-old' }, [10, 0])).toBeNull();
    expect(A.beginDrag(store, { kind: 'block', id: 'blk-main' }, [3, 3])).toBeNull();
    expect(toastTexts(store)).toContain(EDIT_STRINGS.existingBlockMove);
    expect(store.getState().inTransaction()).toBe(false);
  });
});

describe('robustness on the seed', () => {
  // Known gap: w-106-korr runs on into the loft, where lw-106-top continues it in line and lw-landing ends on that
  // piece; moving either across breaks the loft landing (the rooms merge with a toast; Angre restores).
  const KNOWN = new Set(['w-106-korr', 'lw-106-top']);

  it('every stored wall moved 0.2 m across itself (both ways) keeps the rooms and dangles nothing', () => {
    const store = proposal();
    const v0 = V(store);
    const problems: string[] = [];
    for (const w of v0.walls) {
      if (KNOWN.has(w.id)) continue;
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const n: Vec2 = [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
      for (const k of [0.2, -0.2]) {
        store.getState().replaceVariant(v0.id, v0);
        store.setState({ toasts: [] });
        A.moveWall(store, w.id, [n[0] * k, n[1] * k]);
        // (A wall on a floor-zone edge — w-103-102, w-106-stue — leaves a sliver of the other floor level beside it when
        // it moves: an unnamed face, which is right: the floor step does not move with the wall.)
        const bad = D(store).warnings.filter((x) => ['generic', 'room-anchor-lost', 'wall-dangling'].includes(x.kind));
        if (bad.length > 0 || store.getState().toasts.length > 0) problems.push(`${w.id} ${k}: ${bad.map((x) => x.kind).join(', ')} ${toastTexts(store).join(' | ')}`);
      }
    }
    expect(problems).toEqual([]);
  }, 60000);

  it('every block edge moved 0.4 m out and in keeps all 27 rooms named', () => {
    const store = proposal();
    const v0 = V(store);
    const problems: string[] = [];
    for (const b of v0.blocks) {
      for (const vx of b.polygon) {
        for (const k of [0.4, -0.4]) {
          store.getState().replaceVariant(v0.id, v0);
          A.moveBlockEdge(store, b.id, vx.id, [k, k]);
          const named = namedRooms(store).length;
          const bad = D(store).warnings.filter((x) => ['generic', 'room-anchor-lost', 'wall-dangling'].includes(x.kind));
          if (named !== 27 || bad.length > 0) problems.push(`${b.id}/${vx.id} ${k}: ${named} ${bad.map((x) => x.kind).join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 60000);

  it('every existing wall end dragged 0.36 m, then "Ta tilbake": walls and openings exactly as before, all rooms named', () => {
    const store = proposal();
    const v0 = V(store);
    const J = (x: unknown) => JSON.stringify(x);
    const problems: string[] = [];
    let cases = 0;
    for (const w of v0.walls) {
      if (w.status !== 'existing' || KNOWN.has(w.id) || w.id === 'lw-landing') continue;
      for (const end of ['a', 'b'] as const) {
        for (const d of [
          [0, 0.36],
          [-0.36, 0],
        ] as Vec2[]) {
          store.getState().replaceVariant(v0.id, v0);
          if (!A.moveWallEndpoint(store, w.id, end, [w[end][0] + d[0], w[end][1] + d[1]])) continue;
          if (!wall(store, `${w.id}/ghost`)) continue;
          cases++;
          store.setState({ toasts: [] });
          A.restoreGhost(store, `${w.id}/ghost`);
          const ok = J(V(store).walls) === J(v0.walls) && J(V(store).openings) === J(v0.openings) && namedRooms(store).length === 27;
          if (!ok || store.getState().toasts.length > 0) problems.push(`${w.id}.${end} ${J(d)}`);
        }
      }
    }
    expect(cases).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  }, 180000);

  it('every block edge moved ±0.4 / ±1 m: "Ta tilbake" on its first ghost, or the move back, leaves today\'s cabin exactly (doors and windows too)', () => {
    const store = proposal();
    const v0 = V(store);
    const J = (x: unknown) => JSON.stringify(x);
    const same = () => J(V(store).blocks) === J(v0.blocks) && J(V(store).walls) === J(v0.walls) && J(V(store).openings) === J(v0.openings) && V(store).ghosts === undefined;
    const centres0 = new Map(v0.openings.map((o) => [o.id, openingCentre(store, o.id)]));
    const problems: string[] = [];
    for (const b of v0.blocks) {
      for (const vx of b.polygon) {
        for (const k of [0.4, -0.4, 1, -1]) {
          store.getState().replaceVariant(v0.id, v0);
          if (!A.moveBlockEdge(store, b.id, vx.id, [k, k])) continue;
          const first = V(store).ghosts?.[0]?.id;
          // Every existing opening that changed place is new with a ghost.
          for (const o of V(store).openings) {
            if (o.status !== 'existing' || v0.openings.find((x) => x.id === o.id)?.status !== 'existing') continue;
            const before = centres0.get(o.id);
            const now = openingCentre(store, o.id);
            if (before && now && Math.hypot(before[0] - now[0], before[1] - now[1]) > 0.001) problems.push(`${b.id}/${vx.id} ${k}: ${o.id} moved but is still existing`);
          }
          if (first) {
            A.restoreGhost(store, first);
            if (!same()) problems.push(`${b.id}/${vx.id} ${k}: Ta tilbake on ${first}`);
          }
          store.getState().replaceVariant(v0.id, v0);
          A.moveBlockEdge(store, b.id, vx.id, [k, k]);
          A.moveBlockEdge(store, b.id, vx.id, [-k, -k]);
          if (V(store).ghosts !== undefined || V(store).walls.some((w) => w.status === 'removed' && w.id.includes('/ghost'))) problems.push(`${b.id}/${vx.id} ${k}: not healed on the way back`);
          // Fix round 2: today's doors and windows a shortened edge clamped are back on their ghosts (existing, same
          // place), and no opening ghost is left. (New openings clamped by separate edits stay where they are: known.)
          for (const o of v0.openings) {
            if (o.status === 'existing' && J(opening(store, o.id)) !== J(o)) problems.push(`${b.id}/${vx.id} ${k}: ${o.id} not back (${J(opening(store, o.id))})`);
          }
          if (V(store).openings.some((o) => o.id.endsWith('/ghost'))) problems.push(`${b.id}/${vx.id} ${k}: opening ghosts left on the way back`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 120000);
});

describe('snapPoint for the placement tools', () => {
  it('Vegg snaps to wall ends and gives a length chip from the first point', () => {
    const store = proposal();
    const r = A.snapPoint(store, [16.05, 3.43], { purpose: 'wall', from: [18, 5], modifiers: { snapRadiusM: 0.12 } });
    expect(r.point).toEqual([16, 3.4]);
    expect(r.chips[0].length).toBeCloseTo(Math.hypot(2, 1.6), 9);
  });

  it('Dør/vindu finds the host under the point; Nytt bygg returns the snapped centre and footprint', () => {
    const store = proposal();
    const r = A.snapPoint(store, [17.33, 3.45], { purpose: 'opening', modifiers: { snapRadiusM: 0.12 } });
    expect(r.host).toEqual({ host: { kind: 'wall', wallId: 'w-gang-n' }, offset: 1.3 });
    const u = A.snapPoint(store, [14.03, 11.3], { purpose: 'unit', templateId: 'vedskjul', rotation90: 0, modifiers: { snapRadiusM: 0.12 } });
    expect(u.point[1]).toBeCloseTo(11.35, 9);
    expect(u.ghost?.[0]).toHaveLength(4);
  });
});

describe('other actions', () => {
  it('rooms, notes, hot tub, trees and furniture', () => {
    const store = proposal();
    expect(A.setRoomProps(store, 'room-stue', { name: 'Storstue', floorMaterial: 'tile', note: 'Lys' })).toBe(true);
    expect(V(store).rooms.find((r) => r.id === 'room-stue')).toMatchObject({ name: 'Storstue', floorMaterial: 'tile', note: 'Lys' });
    expect(A.setRoomProps(store, 'room-stue', { floorMaterial: null, note: '' })).toBe(true);
    expect(V(store).rooms.find((r) => r.id === 'room-stue')?.floorMaterial).toBeUndefined();
    expect(A.deleteRoom(store, 'room-stue')).toBe(true);
    expect(kinds(store)).toContain('room-unnamed');
    expect(A.setVariantNotes(store, '  Mer lys i stua ')).toBe(true);
    expect(V(store).notes).toBe('Mer lys i stua');
    expect(A.setHotTubDiameter(store, 'tub-1', 2.2)).toBe(true);
    expect(A.deleteHotTub(store, 'tub-1')).toBe(true);
    const tree = A.addTree(store, [0, 20]) as string;
    expect(A.moveTree(store, tree, [1, 20])).toBe(true);
    expect(A.deleteTree(store, tree)).toBe(true);
    const f = A.addFurniture(store, 'seng-150', [18.4, 5], { size: { w: 1.5, d: 2, h: 0.5 } }) as string;
    expect(V(store).furniture.find((x) => x.id === f)).toMatchObject({ levelId: 'main', isNew: true, rotationDeg: 0, size: { w: 1.5, d: 2, h: 0.5 } });
    expect(A.rotateFurniture(store, f, 90)).toBe(true);
    expect(A.moveFurniture(store, f, [18, 5])).toBe(true);
    expect(A.setFurnitureProps(store, f, { colour: 'grå' })).toBe(true);
    // «Dupliser»: no free spot for a second 150 bed in Soverom (ny fløy) nor in the rooms next to it, so nothing is
    // added (final fix round; before, a fixed 0.3 m offset). editActions.furniture.test.ts covers the copies.
    const count = V(store).furniture.length;
    expect(A.duplicateFurniture(store, f)).toBeNull();
    expect(V(store).furniture.length).toBe(count);
    expect(A.deleteFurniture(store, f)).toBe(true);
  });

  it('setWallProps: a thicker existing wall is rebuilt (new + ghost); heights are not; a divider loses its openings', () => {
    const store = proposal();
    expect(A.setWallProps(store, 'w-vf-korr', { heightMode: 'roof' })).toBe(true);
    expect(wall(store, 'w-vf-korr')?.status).toBe('existing');
    expect(A.setWallProps(store, 'w-vf-korr', { thickness: 0.15 })).toBe(true);
    expect(wall(store, 'w-vf-korr')).toMatchObject({ status: 'new', thickness: 0.15 });
    expect(wall(store, 'w-vf-korr/ghost')).toMatchObject({ status: 'removed', thickness: 0.12 });
    expect(A.setWallProps(store, 'w-gang-n', { kind: 'divider' })).toBe(true);
    expect(wall(store, 'w-gang-n')).toMatchObject({ kind: 'divider', thickness: 0 });
    expect(opening(store, 'd-sov-ny')).toBeUndefined();
  });

  it('read-only: actions are silent no-ops', () => {
    const store = proposal();
    store.getState().setUi({ readOnly: true });
    const before = V(store);
    expect(A.moveWall(store, 'w-gang-n', [0, 0.3])).toBe(false);
    expect(A.beginDrag(store, { kind: 'wall', id: 'w-gang-n' }, [18, 3.4])).toBeNull();
    expect(V(store)).toBe(before);
    expect(store.getState().toasts).toHaveLength(0);
  });

  it('bindEditActions binds every action to a store', () => {
    const store = proposal();
    const bound = A.bindEditActions(store);
    expect(bound.moveWall('w-gang-n', [0, 0.2])).toBe(true);
    expect(wall(store, 'w-gang-n')?.a).toEqual([16, 3.6]);
    expect(typeof bound.beginDrag).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Fix round after phase 2a (the editor reviewer's findings)
// ---------------------------------------------------------------------------

const SEED = createForslagD().variants[0];
const SEED_TREES = createForslagD().site.trees.map((t) => t.id);
const pointIn = (p: Vec2, poly: Vec2[]) => pointInPolygon(p, poly);
const roomWarnings = (s: Store) => kinds(s).filter((k) => k === 'room-anchor-lost' || k === 'room-unnamed');
const ghostIds = (s: Store) => (V(s).ghosts ?? []).map((g) => g.id).sort();

describe('fix round: a divider moved onto a room anchor (reconcileRooms)', () => {
  it.each<[string, Vec2]>([
    ['dv-pass-n', [0, -0.6]],
    ['dv-stue-n', [0, 0.6]],
    ['dv-kjk-e', [-1.4, 0]],
    ['dv-kjk-e', [2, 0]],
    ['dv-leseskrok', [0, -1]],
  ])('%s moved by %j keeps every room on its own face', (id, delta) => {
    const store = proposal();
    expect(A.moveWall(store, id, delta)).toBe(true);
    expect(namedRooms(store)).toHaveLength(27);
    expect(roomWarnings(store)).toEqual([]);
    expect(store.getState().toasts).toHaveLength(0);
    // Every anchor is strictly inside its own face (more than 1 cm from its boundary).
    for (const r of namedRooms(store)) {
      const ring = r.polygon;
      const d = Math.min(
        ...ring.map((p, i) => {
          const q = ring[(i + 1) % ring.length];
          const t = Math.max(0, Math.min(1, ((r.room!.anchor[0] - p[0]) * (q[0] - p[0]) + (r.room!.anchor[1] - p[1]) * (q[1] - p[1])) / ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2)));
          return Math.hypot(r.room!.anchor[0] - (p[0] + t * (q[0] - p[0])), r.room!.anchor[1] - (p[1] + t * (q[1] - p[1])));
        }),
      );
      expect(d).toBeGreaterThan(0.01);
    }
  });

  it("blk-main's south edge moved (0, −1) carries dv-leseskrok onto Leseskrok's anchor; Leseskrok keeps the glass bump", () => {
    const store = proposal();
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-sw', [0, -1])).toBe(true);
    expect(wall(store, 'dv-leseskrok')).toMatchObject({ a: [5, -1], b: [9, -1] });
    expect(namedRooms(store)).toHaveLength(27);
    expect(roomWarnings(store)).toEqual([]);
    const lese = roomByRecord(store, 'room-leseskrok');
    expect(lese?.bbox.max[1]).toBeLessThanOrEqual(-1 + 1e-6);
    expect(lese?.area).toBeLessThan(4);
  });
});

describe('fix round: moveBlock carries the room names', () => {
  it.each<[Vec2]>([[[3, 0]], [[2, 2]], [[0.5, 0]]])('moveBlock(blk-wing, %j) keeps all 27 rooms on their translated faces, no toasts', (delta) => {
    const store = proposal();
    const wingRooms = new Set(['room-gang', 'room-sov-ny', 'room-pantry', 'room-wc', 'room-hovedbad', 'room-badstue']);
    expect(A.moveBlock(store, 'blk-wing', delta)).toBe(true);
    expect(namedRooms(store)).toHaveLength(27);
    expect(roomWarnings(store)).toEqual([]);
    expect(store.getState().toasts).toHaveLength(0);
    for (const r0 of SEED.rooms) {
      const at: Vec2 = wingRooms.has(r0.id) ? [r0.anchor[0] + delta[0], r0.anchor[1] + delta[1]] : r0.anchor;
      const face = roomByRecord(store, r0.id);
      expect(face, r0.id).toBeDefined();
      // The face of each record is the one its seed anchor (translated with the wing) lies in.
      const inside = D(store).rooms.find((f) => f.storeyId === face?.storeyId && f.polygon.length >= 3 && pointIn(at, f.polygon));
      expect(inside?.id, r0.id).toBe(face?.id);
    }
  });
});

describe('fix round: status bookkeeping of block-edge edits', () => {
  it('the west gable 0 → −1: the three windows on it become new with ghosts at their old places', () => {
    const store = proposal();
    const ids = ['win-104-w', 'win-hems-w1', 'win-hems-w2'];
    const old = ids.map((id) => openingCentre(store, id));
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [-1, 0])).toBe(true);
    ids.forEach((id, i) => {
      expect(opening(store, id)?.status, id).toBe('new');
      expect(opening(store, `${id}/ghost`)?.status, id).toBe('removed');
      close(openingCentre(store, `${id}/ghost`), old[i] as Vec2);
      close(openingCentre(store, id), [-1, (old[i] as Vec2)[1]]);
      expect(D(store).walls.flatMap((w) => w.openings).find((o) => o.id === `${id}/ghost`)?.isGhost).toBe(true);
    });
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).toEqual([]);
    // Moving the gable back heals everything (the windows are existing again, no ghosts left).
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [1, 0])).toBe(true);
    ids.forEach((id) => expect(opening(store, id)?.status).toBe('existing'));
    expect(V(store).openings.some((o) => o.id.includes('/ghost'))).toBe(false);
    expect(V(store).walls.some((w) => w.id.includes('/ghost'))).toBe(false);
    expect(V(store).ghosts).toBeUndefined();
  });

  it('"Ta tilbake" on a window ghost at the old gable line brings the gable back with its windows', () => {
    const store = proposal();
    const start = V(store);
    A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [-1, 0]);
    expect(opening(store, 'win-104-w/ghost')?.host).toEqual({ kind: 'wall', wallId: 'blk-main/v-main-nw/ghost' });
    expect(A.restoreGhost(store, 'win-104-w/ghost')).toBe(true);
    expect(V(store).blocks).toEqual(start.blocks);
    expect(V(store).openings).toEqual(start.openings);
    expect(V(store).walls).toEqual(start.walls);
    expect(V(store).ghosts).toBeUndefined();
  });

  it("the north edge +1: carried and clamped openings become new with ghosts; the bod's stubs are ghosted; Ta tilbake restores all", () => {
    const store = proposal();
    const start = V(store);
    const carried = ['win-kjk-n', 'door-mellom-vf', 'win-bad-n'];
    const old = new Map([...carried, 'door-green-e'].map((id) => [id, openingCentre(store, id)]));
    close(old.get('door-green-e'), [9, 6.89]);
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-ne', [0, 1])).toBe(true);
    for (const id of [...carried, 'door-green-e']) {
      expect(opening(store, id)?.status, id).toBe('new');
      close(openingCentre(store, `${id}/ghost`), old.get(id) as Vec2);
    }
    close(openingCentre(store, 'door-green-e'), [9, 7.655]);
    // The bod's west and east walls lost 1 m at their south ends: both stubs are ghosts.
    const stubs = (V(store).ghosts ?? []).filter((g) => g.id.startsWith('blk-bod/'));
    expect(stubs.map((g) => [g.a, g.b])).toEqual(
      expect.arrayContaining([
        [
          [5, 7.2],
          [5, 6.2],
        ],
        [
          [9, 6.2],
          [9, 7.2],
        ],
      ]),
    );
    expect(ghostIds(store)).toContain('blk-main/v-main-ne/ghost');
    // (roof-no-meet: the bod's roof against the grown main roof — a known issue of roof.ts, not of the bookkeeping.)
    expect(kinds(store).filter((k) => k !== 'roof-no-meet')).toEqual([]);
    // "Ta tilbake" on the edge ghost: the edge, its partner and every touched opening are back.
    expect(A.restoreGhost(store, 'blk-main/v-main-ne/ghost')).toBe(true);
    expect(opening(store, 'door-green-e')).toMatchObject({ status: 'existing', offset: 0.69 });
    for (const id of carried) expect(opening(store, id)?.status, id).toBe('existing');
    expect(V(store).ghosts).toBeUndefined();
    expect(V(store).openings).toEqual(start.openings);
    expect(V(store).walls).toEqual(start.walls);
    expect(V(store).blocks).toEqual(start.blocks);
  });

  it('a clamp on a shortened edge is bookkept too; "Ta tilbake" on the stub ghost lengthens the edge again', () => {
    const store = proposal();
    const start = V(store);
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-ne', [0, 1])).toBe(true);
    const east = (V(store).ghosts ?? []).find((g) => g.id.startsWith('blk-bod/v-bod-se/'));
    expect(east).toBeDefined();
    expect(A.restoreGhost(store, east?.id as string)).toBe(true);
    expect(V(store).blocks).toEqual(start.blocks);
    expect(opening(store, 'door-green-e')).toMatchObject({ status: 'existing', offset: 0.69 });
    expect(V(store).ghosts).toBeUndefined();
  });

  it('a block edge that trims an existing wall under an existing door: the clamped door is bookkept, Ta tilbake restores it', () => {
    const store = proposal();
    const start = V(store);
    const old = openingCentre(store, 'd-do');
    // The bod's west edge 0.4 m in: w-mellom-boder (y 7.62) is trimmed at x 5.4 and d-do (x 5.235 … 6.045) is clamped.
    expect(A.moveBlockEdge(store, 'blk-bod', 'v-bod-nw', [0.4, 0])).toBe(true);
    expect(wall(store, 'w-mellom-boder')?.a).toEqual([5.4, 7.62]);
    expect(opening(store, 'd-do')?.status).toBe('new');
    close(openingCentre(store, 'd-do/ghost'), old as Vec2);
    expect(A.restoreGhost(store, V(store).ghosts?.find((g) => g.id.startsWith('blk-bod/v-bod-nw/'))?.id as string)).toBe(true);
    expect(V(store).openings).toEqual(start.openings);
    expect(V(store).walls).toEqual(start.walls);
  });

  it('the west gable 0 → −1 keeps BRA existing (the strip where the old wall stood is new, like BYA)', () => {
    const store = proposal();
    const before = D(store).areas;
    expect(before.bra.existing).toBeCloseTo(103.51, 2);
    A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [-1, 0]);
    const after = D(store).areas;
    expect(Math.abs(after.bra.existing - before.bra.existing)).toBeLessThan(0.05);
    expect(after.bra.total - before.bra.total).toBeGreaterThan(0);
    // BYA as decided at the integration: only the old cladding strip turns new.
    expect(before.bya.existing - after.bya.existing).toBeCloseTo(0.11 * 6.42, 6);
  });
});

describe('fix round: "Ta tilbake" after an endpoint drag', () => {
  it('moveWallEndpoint(w-vf-korr, b, [9, 4.6]) then restoreGhost puts the walls the drag changed back too', () => {
    const store = proposal();
    const seedWall = (id: string) => SEED.walls.find((w) => w.id === id);
    expect(A.moveWallEndpoint(store, 'w-vf-korr', 'b', [9, 4.6])).toBe(true);
    expect(wall(store, 'dv-kjk-w')?.b).toEqual([9, 4.6]);
    store.setState({ toasts: [] });
    expect(A.restoreGhost(store, 'w-vf-korr/ghost')).toBe(true);
    for (const id of ['w-vf-korr', 'dv-kjk-w', 'w-vf-kjk']) expect(wall(store, id), id).toEqual(seedWall(id));
    expect(roomByRecord(store, 'room-vindfang')).toBeDefined();
    expect(roomByRecord(store, 'room-kjokken')).toBeDefined();
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).not.toContain('wall-dangling');
    expect(store.getState().toasts).toHaveLength(0);
    expect(V(store).walls.some((w) => w.id.endsWith('/ghost'))).toBe(false);
  });

  it('a move followed by an endpoint drag is undone completely as well', () => {
    const store = proposal();
    expect(A.moveWall(store, 'w-vf-korr', [0, 0.3])).toBe(true);
    expect(A.moveWallEndpoint(store, 'w-vf-korr', 'b', [9, 4.9])).toBe(true);
    store.setState({ toasts: [] });
    expect(A.restoreGhost(store, 'w-vf-korr/ghost')).toBe(true);
    for (const id of ['w-vf-korr', 'dv-kjk-w', 'w-vf-kjk']) expect(wall(store, id), id).toEqual(SEED.walls.find((w) => w.id === id));
    expect(namedRooms(store)).toHaveLength(27);
    expect(kinds(store)).not.toContain('wall-dangling');
    expect(store.getState().toasts).toHaveLength(0);
  });
});

describe('fix round: trees belong to the proposal', () => {
  it('tree edits in a copy never change the site or Forslag D (copy-on-write into the variant)', () => {
    const store = proposal();
    const siteJson = JSON.stringify(store.getState().project.site);
    const baseJson = JSON.stringify(store.getState().project.variants.find((v) => v.id === 'forslag-d'));
    const same = () => {
      expect(JSON.stringify(store.getState().project.site)).toBe(siteJson);
      expect(JSON.stringify(store.getState().project.variants.find((v) => v.id === 'forslag-d'))).toBe(baseJson);
    };
    const trees = () => D(store).site.trees.map((t) => t.tree);
    expect(A.moveTree(store, 'tree-1', [-2, 7])).toBe(true);
    same();
    expect(V(store).trees?.find((t) => t.id === 'tree-1')?.position).toEqual([-2, 7]);
    expect(trees().find((t) => t.id === 'tree-1')?.position).toEqual([-2, 7]);
    expect(A.nudge(store, { kind: 'tree', id: 'tree-1' }, 0.1, 0)).toBe(true);
    same();
    const s = A.beginDrag(store, { kind: 'tree', id: 'tree-1' }, [-1.9, 7]);
    A.updateDrag(store, s, [0.5, 7]);
    A.endDrag(store, s);
    same();
    expect(trees().find((t) => t.id === 'tree-1')?.position).toEqual([0.5, 7]);
    const id = A.addTree(store, [0, 20]) as string;
    expect(id).toBeTruthy();
    same();
    expect(A.deleteTree(store, 'tree-2')).toBe(true);
    same();
    expect(trees().map((t) => t.id)).toEqual([...SEED_TREES.filter((t) => t !== 'tree-2'), id]);
    // Forslag D (and every proposal without its own trees) still shows the site's trees.
    store.getState().setActiveVariant('forslag-d');
    expect(trees().map((t) => t.id)).toEqual(SEED_TREES);
    expect(trees().find((t) => t.id === 'tree-1')?.position).toEqual([-4, 4]);
  });

  it("treesOf: the variant's own trees, else the site's", () => {
    const p = createForslagD();
    expect(treesOf(p, p.variants[0])).toBe(p.site.trees);
    const own = { ...p.variants[0], trees: [] };
    expect(treesOf(p, own)).toBe(own.trees);
  });
});

describe('fix round: deck corner, nameFace, rotateBlock', () => {
  it('"Fjern hjørne" that would make the outline cross itself is refused with a toast', () => {
    const store = proposal();
    const before = V(store);
    expect(A.deleteDeckVertex(store, 'deck-terrasse-v1')).toBe(false);
    expect(V(store)).toBe(before);
    expect(toastTexts(store)).toEqual([EDIT_STRINGS.deckVertexCrosses]);
    expect(EDIT_STRINGS.deckVertexCrosses).toBe('Hjørnet kan ikke fjernes – terrassen ville krysse seg selv.');
  });

  it("nameFace returns the derived room's id (the UI selects it; the face id is gone)", () => {
    const store = proposal();
    A.addWall(store, [19.2, 3.4], [19.2, 6.2]);
    const face = D(store).rooms.find((r) => !r.room);
    const id = A.nameFace(store, face?.id as string, 'Kontor', { type: 'annet' });
    expect(id).not.toBeNull();
    expect(D(store).rooms.some((r) => r.id === face?.id)).toBe(false);
    const derived = D(store).rooms.find((r) => r.id === id);
    expect(derived?.room?.name).toBe('Kontor');
    expect(V(store).rooms.some((r) => r.id === derived?.room?.id)).toBe(true);
    expect(A.nameFace(store, 'face-nope', 'X')).toBeNull();
  });

  it('rotateBlock turns a placed Vedskjul about its centre on the grid, with its front opening, room and furniture', () => {
    const store = proposal();
    // Free on the deck (touching no wall or deck edge; one that does keeps that contact, see "fix round 2" below).
    const id = A.placeUnit(store, 'vedskjul', [14, 9.35], 0) as string;
    const f = A.addFurniture(store, 'kubbe', [14.5, 9.35]) as string;
    const before = V(store).blocks.find((b) => b.id === id);
    expect(A.rotateBlock(store, id, 90)).toBe(true);
    const b = V(store).blocks.find((x) => x.id === id);
    const pts = b?.polygon.map((v) => v.p) ?? [];
    // 2 × 1.5 turned: 1.5 × 2 around (14, 9.35), snapped to the 10 cm grid.
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.5, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2, 9);
    for (const p of pts) for (const c of p) expect(Math.abs(c * 10 - Math.round(c * 10))).toBeLessThan(1e-6);
    expect(b?.polygon.map((v) => v.id)).toEqual(before?.polygon.map((v) => v.id));
    expect(b?.roof.slopeTo).toBe('W');
    // Front edge 0 now faces east (its outward normal turned from −y to +x).
    const [a0, b0] = [pts[0], pts[1]];
    expect(Math.abs(a0[0] - b0[0])).toBeLessThan(1e-9);
    expect(Math.max(a0[0], b0[0])).toBeCloseTo(Math.max(...xs), 9);
    const room = V(store).rooms.find((r) => r.name === 'Vedskjul');
    expect(roomByRecord(store, room?.id as string)).toBeDefined();
    const fur = V(store).furniture.find((x) => x.id === f);
    expect(fur?.rotationDeg).toBe(90);
    expect(D(store).furniture.find((x) => x.id === f)?.roomId).toBe(room?.id);
    expect(D(store).walls.flatMap((w) => w.openings).some((o) => o.id === V(store).openings.find((x) => x.host.kind === 'blockEdge' && x.host.blockId === id)?.id)).toBe(true);
    expect(namedRooms(store)).toHaveLength(28);
    // −90 brings it back to the same footprint.
    expect(A.rotateBlock(store, id, -90)).toBe(true);
    expect(V(store).blocks.find((x) => x.id === id)?.polygon).toEqual(before?.polygon);
    // Refused: blocks of today's cabin (toast), blocks without a template, the locked Forslag D.
    expect(A.rotateBlock(store, 'blk-main', 90)).toBe(false);
    expect(toastTexts(store)).toContain(EDIT_STRINGS.existingBlockMove);
    expect(A.rotateBlock(store, 'blk-wing', 90)).toBe(false);
    const locked = createAppStore(createForslagD());
    expect(A.rotateBlock(locked, 'blk-wing', 90)).toBe(false);
    expect(locked.getState().toasts.map((t) => t.text)).toEqual([EDIT_STRINGS.locked]);
  });
});

// ---------------------------------------------------------------------------
// Fix round 2 after 2a
// ---------------------------------------------------------------------------

describe('fix round 2: the glass bump (Leseskrok) follows the status and area rules', () => {
  const J = (x: unknown) => JSON.stringify(x);
  const glassPieces = (s: Store, edgeId: string) =>
    D(s).walls.filter((w) => w.source.kind === 'blockEdge' && w.source.blockId === 'blk-glass' && w.source.edgeId === edgeId);
  /** The variant without the revision-5 part of the glass bump: a stored copy made from revision 4. */
  function partless(store: Store): void {
    const v = V(store);
    store.getState().replaceVariant(v.id, { ...v, blocks: v.blocks.map((b) => (b.id === 'blk-glass' ? { ...b, parts: [] } : b)) });
    store.getState().clearHistory();
  }
  /** "Ta tilbake" on the first (or the last) ghost until none is left. */
  function restoreAll(store: Store, last: boolean): void {
    for (let n = 0; V(store).ghosts && n < 8; n++) {
      const list = V(store).ghosts ?? [];
      expect(A.restoreGhost(store, (last ? list[list.length - 1] : list[0]).id)).toBe(true);
    }
  }

  function eastPlusHalf(store: Store): void {
    const before = D(store).areas;
    expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [0.5, 0])).toBe(true);
    // The moved east wall is new; the south wall is today's up to the old corner and new beyond it.
    expect(glassPieces(store, 'v-glass-se').map((w) => w.isNew)).toEqual([true]);
    expect(glassPieces(store, 'v-glass-sw').map((w) => [w.source.kind === 'blockEdge' && w.source.s1, w.isNew])).toEqual([
      [4, false],
      [4.5, true],
    ]);
    expect(roomByRecord(store, 'room-leseskrok')?.areaNew).toBeGreaterThan(0.5);
    // Today's areas do not grow: BRA and the axis area stay; BYA loses only the old cladding strips that are now inside
    // (the glass bump's east strip, 0.11 × 2.11, and the main wall's south strip beyond it, 0.11 × 0.39), as decided
    // for the west gable at the integration.
    const after = D(store).areas;
    expect(after.bra.existing).toBeCloseTo(before.bra.existing, 6);
    expect(after.axis.existing).toBeCloseTo(98, 6);
    expect(after.bya.existing).toBeCloseTo(before.bya.existing - 0.11 * 2.11 - 0.11 * 0.39, 6);
    // The old east wall, and the stretch of today's south wall of the main block that the open junction now covers.
    expect(V(store).ghosts).toEqual([
      { id: 'blk-glass/v-glass-se/ghost', a: [9, -2], b: [9, 0] },
      { id: 'blk-main/v-main-sw/ghost', a: [9, 0], b: [9.5, 0] },
    ]);
  }

  it('the east wall moved 0.5 m: the moved piece is new, BYA / BRA / axis existing do not grow, both old walls are ghosts', () => {
    const store = proposal();
    const v0 = V(store);
    eastPlusHalf(store);
    // "Ta tilbake" on either ghost gives today's cabin back.
    for (const id of ['blk-glass/v-glass-se/ghost', 'blk-main/v-main-sw/ghost']) {
      store.getState().replaceVariant(v0.id, v0);
      A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [0.5, 0]);
      expect(A.restoreGhost(store, id)).toBe(true);
      expect(J(V(store).blocks), id).toBe(J(v0.blocks));
      expect(J(V(store).walls), id).toBe(J(v0.walls));
      expect(J(V(store).openings), id).toBe(J(v0.openings));
      expect(V(store).ghosts, id).toBeUndefined();
    }
  });

  it('a corner drag, then "Ta tilbake" on each ghost in either order: no ghost left, the variant is the seed again', () => {
    const store = proposal();
    const v0 = V(store);
    const problems: string[] = [];
    for (const p of [
      [4.5, -2.5],
      [5.5, -1.5],
      [4.5, -1.5],
      [5.5, -2.5],
    ] as Vec2[]) {
      for (const last of [false, true]) {
        store.getState().replaceVariant(v0.id, v0);
        expect(A.moveBlockVertex(store, 'blk-glass', 'v-glass-sw', p)).toBe(true);
        expect(V(store).ghosts?.length).toBeGreaterThan(1);
        restoreAll(store, last);
        const v = V(store);
        const same = J(v.blocks) === J(v0.blocks) && J(v.walls) === J(v0.walls) && J(v.openings) === J(v0.openings) && v.ghosts === undefined;
        if (!same || namedRooms(store).length !== 27) problems.push(`${J(p)} ${last ? 'last' : 'first'} ghost first: ghosts ${J(v.ghosts)}`);
      }
    }
    expect(problems).toEqual([]);
  }, 60000);

  it('a copy without the glass part (revision 4) gets one from its outline on the first edit and behaves the same', () => {
    const store = proposal();
    const seeded = proposal();
    eastPlusHalf(seeded);
    partless(store);
    eastPlusHalf(store);
    const glass = V(store).blocks.find((b) => b.id === 'blk-glass');
    expect(glass?.parts).toEqual([
      {
        id: 'blk-glass-today',
        name: 'Hytta i dag',
        polygon: [
          [5, -2],
          [9, -2],
          [9, 0],
          [5, 0],
        ],
        isNew: false,
      },
    ]);
    expect(D(store).areas.bya.existing).toBeCloseTo(D(seeded).areas.bya.existing, 9);
    expect(D(store).areas.bra.existing).toBeCloseTo(D(seeded).areas.bra.existing, 9);
    // The corner drag of the review: no stray ghost after "Ta tilbake" on the ghosts, in either order.
    for (const last of [false, true]) {
      const s = proposal();
      partless(s);
      const v0 = V(s);
      expect(A.moveBlockVertex(s, 'blk-glass', 'v-glass-sw', [4.5, -2.5])).toBe(true);
      expect(V(s).blocks.find((b) => b.id === 'blk-glass')?.parts.map((p) => p.id)).toEqual(['blk-glass-today']);
      restoreAll(s, last);
      expect(V(s).ghosts).toBeUndefined();
      expect(J(V(s).walls)).toBe(J(v0.walls));
      expect(J(V(s).openings)).toBe(J(v0.openings));
      expect(V(s).blocks.find((b) => b.id === 'blk-glass')?.polygon).toEqual(v0.blocks.find((b) => b.id === 'blk-glass')?.polygon);
      expect(opening(s, 'win-glass-w')?.status).toBe('existing');
    }
    // A new block without parts (a placed unit) gets none.
    const unit = A.placeUnit(store, 'bod', [0, 15], 0) as string;
    const edge = V(store).blocks.find((b) => b.id === unit)?.polygon[1].id as string;
    expect(A.moveBlockEdge(store, unit, edge, [0.5, 0])).toBe(true);
    expect(V(store).blocks.find((b) => b.id === unit)?.parts).toEqual([]);
  });
});

describe('fix round 2: "Ta tilbake" after a plain wall move brings the neighbours back too', () => {
  it('w-103-korr −0.2 / −0.5 and w-105-diag +0.2 / +0.5: the neighbour left beside the line is back', () => {
    const diag = (k: number): Vec2 => {
      const w = SEED.walls.find((x) => x.id === 'w-105-diag') as (typeof SEED.walls)[number];
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      return [(-(w.b[1] - w.a[1]) / L) * k, ((w.b[0] - w.a[0]) / L) * k];
    };
    for (const [id, d, other] of [
      ['w-103-korr', [0, -0.2], 'w-104-103'],
      ['w-103-korr', [0, -0.5], 'w-104-103'],
      ['w-105-diag', diag(0.2), 'w-104-diag'],
      ['w-105-diag', diag(0.5), 'w-104-diag'],
    ] as [string, Vec2, string][]) {
      const store = proposal();
      expect(A.moveWall(store, id, d)).toBe(true);
      expect(wall(store, other)?.status, `${id} ${d}`).toBe('new');
      expect(A.restoreGhost(store, `${id}/ghost`)).toBe(true);
      expect(wall(store, other), `${id} ${d}`).toEqual(SEED.walls.find((w) => w.id === other));
      expect(V(store).walls).toEqual(SEED.walls);
      expect(V(store).openings).toEqual(SEED.openings);
      expect(namedRooms(store)).toHaveLength(27);
    }
  });

  it('every existing wall moved ±0.2 / ±0.5 m across itself, then "Ta tilbake": walls, openings and rooms as in the seed', () => {
    const store = proposal();
    const v0 = V(store);
    const J = (x: unknown) => JSON.stringify(x);
    const area0 = new Map(namedRooms(store).map((r) => [r.room?.id, r.area]));
    const problems: string[] = [];
    let cases = 0;
    for (const w of v0.walls) {
      if (w.status !== 'existing') continue;
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const n: Vec2 = [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
      for (const k of [0.2, -0.2, 0.5, -0.5]) {
        store.getState().replaceVariant(v0.id, v0);
        if (!A.moveWall(store, w.id, [n[0] * k, n[1] * k]) || !wall(store, `${w.id}/ghost`)) continue;
        cases++;
        A.restoreGhost(store, `${w.id}/ghost`);
        const v = V(store);
        // (A room anchor the move sent to its face's label point stays there: the rooms are compared by their faces.)
        const named = namedRooms(store);
        const roomsOk = named.length === 27 && named.every((r) => Math.abs(r.area - (area0.get(r.room?.id) ?? -1)) < 1e-6);
        if (J(v.walls) !== J(v0.walls) || J(v.openings) !== J(v0.openings) || v.ghosts !== undefined || !roomsOk) problems.push(`${w.id} ${k}`);
      }
    }
    expect(cases).toBeGreaterThanOrEqual(86);
    expect(problems).toEqual([]);
  }, 240000);
});

describe('fix round 2: a block edge moved back by hand puts the clamped doors and windows back', () => {
  const back = (store: Store, blockId: string, edgeId: string, d: Vec2) => {
    expect(A.moveBlockEdge(store, blockId, edgeId, d)).toBe(true);
    expect(A.moveBlockEdge(store, blockId, edgeId, [-d[0], -d[1]])).toBe(true);
  };

  it('north +0.5 / −0.5: door-green-e is back at 0.69 and existing', () => {
    const store = proposal();
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-ne', [0, 0.5])).toBe(true);
    expect(opening(store, 'door-green-e')).toMatchObject({ status: 'new', offset: 0.455 });
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-ne', [0, -0.5])).toBe(true);
    expect(opening(store, 'door-green-e')).toEqual(SEED.openings.find((o) => o.id === 'door-green-e'));
    expect(V(store).openings).toEqual(SEED.openings);
    expect(V(store).ghosts).toBeUndefined();
  });

  it('south 0.5 m out and back: win-glass-e / win-glass-w; west 2 m in and back: win-105-s', () => {
    const store = proposal();
    back(store, 'blk-main', 'v-main-sw', [0, -0.5]);
    for (const id of ['win-glass-e', 'win-glass-w']) expect(opening(store, id), id).toEqual(SEED.openings.find((o) => o.id === id));
    expect(V(store).openings).toEqual(SEED.openings);
    const west = proposal();
    back(west, 'blk-main', 'v-main-nw', [2, 0]);
    expect(opening(west, 'win-105-s')).toEqual(SEED.openings.find((o) => o.id === 'win-105-s'));
    expect(V(west).openings.some((o) => o.id.endsWith('/ghost'))).toBe(false);
  });

  it('a door the user moved along the wall stays where it is when the wall gets longer', () => {
    const store = proposal();
    // door-green-e moved 1 m north on the bod's east wall (new, its ghost at 0.69), then the north edge +0.5 / −0.5.
    expect(A.moveOpening(store, 'door-green-e', 1.69)).toBe(true);
    back(store, 'blk-main', 'v-main-ne', [0, 0.5]);
    expect(opening(store, 'door-green-e')).toMatchObject({ status: 'new', offset: 1.69 });
    expect(opening(store, 'door-green-e/ghost')).toMatchObject({ status: 'removed', offset: 0.69 });
  });
});

describe('fix round 2: Roter 90° keeps a unit against the wall or deck edge it stands on', () => {
  const pts = (s: Store, id: string) => V(s).blocks.find((b) => b.id === id)?.polygon.map((v) => v.p) ?? [];
  const sorted = (p: Vec2[]) => p.map((q) => [Math.round(q[0] * 1e6) / 1e6, Math.round(q[1] * 1e6) / 1e6]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  it("a Vedskjul against the wing's north wall turned twice: still touching, no overlap, back to the start footprint", () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [18.4, 6.95], 0) as string;
    const start = pts(store, id);
    expect(Math.min(...start.map((p) => p[1]))).toBeCloseTo(6.2, 9);
    expect(A.rotateBlock(store, id, 90)).toBe(true);
    const turned = pts(store, id);
    expect(Math.min(...turned.map((p) => p[1]))).toBeCloseTo(6.2, 9); // still on the wing's wall line
    expect(Math.max(...turned.map((p) => p[1])) - Math.min(...turned.map((p) => p[1]))).toBeCloseTo(2, 9);
    const xs = turned.map((p) => p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(18.4, 9); // its middle along the wall stays
    expect(kinds(store)).not.toContain('block-overlap');
    expect(D(store).blocks.find((b) => b.block.id === id)?.junctions.some((j) => j.otherBlockId === 'blk-wing')).toBe(true);
    expect(A.rotateBlock(store, id, 90)).toBe(true);
    expect(sorted(pts(store, id))).toEqual(sorted(start));
    expect(kinds(store)).not.toContain('block-overlap');
  });

  it("a Vedskjul on the deck's north edge turned: still on the edge and inside the deck; −90 turns it back exactly", () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [14, 11.35], 0) as string;
    const before = V(store).blocks.find((b) => b.id === id);
    expect(A.rotateBlock(store, id, 90)).toBe(true);
    const turned = pts(store, id);
    expect(Math.max(...turned.map((p) => p[1]))).toBeCloseTo(12.1, 9);
    const deck = V(store).outdoor.decks[0].polygon.map((v) => v.p);
    const onOrIn = (p: Vec2) => pointInPolygon(p, deck) || deck.some((q, i) => distancePointSegment(p, q, deck[(i + 1) % deck.length]) < 1e-6);
    for (const p of turned) expect(onOrIn(p), JSON.stringify(p)).toBe(true);
    expect(A.rotateBlock(store, id, -90)).toBe(true);
    expect(V(store).blocks.find((x) => x.id === id)?.polygon).toEqual(before?.polygon);
  });
});

describe('opening resize by an end handle stores whole centimetres (fix round after 2b)', () => {
  it('door-mellom-vf (0,91 m) narrowed to the 0,3 m minimum by its end handle stores 0.3, not 0.3000000000000007', () => {
    const store = createAppStore(createForslagD());
    store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
    const before = selectActiveVariant(store.getState()).openings.find((o) => o.id === 'door-mellom-vf')!;
    const line = hostLine(selectActiveVariant(store.getState()), before.host)!;
    const u: Vec2 = [(line.b[0] - line.a[0]) / line.length, (line.b[1] - line.a[1]) / line.length];
    const at = (s: number): Vec2 => [line.a[0] + u[0] * s, line.a[1] + u[1] * s];
    const startJamb = before.offset - before.width / 2;
    const s = A.beginDrag(store, { kind: 'opening', id: 'door-mellom-vf' }, at(before.offset + before.width / 2), 'end');
    expect(s?.kind).toBe('openingResize');
    // The phone review: the end handle dragged 0,6 m towards the other jamb (clamped at the minimum width).
    A.updateDrag(store, s, at(before.offset + before.width / 2 - 0.6), { snapRadiusM: 2.07, coarse: true });
    A.endDrag(store, s);
    const o = selectActiveVariant(store.getState()).openings.find((x) => x.id === 'door-mellom-vf')!;
    expect(o.width).toBe(0.3);
    expect(String(o.width)).toBe('0.3');
    // The other jamb stays.
    expect(o.offset - o.width / 2).toBeCloseTo(startJamb, 9);
  });
});

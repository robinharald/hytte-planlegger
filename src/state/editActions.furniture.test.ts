/**
 * Furniture actions (docs/phase2-plan.md §3.6 / §4) on the furnished seed: placement with the catalogue preset and the
 * level under the point, moves that follow the floor's level, turns, Egenskaper (size keeps the back, stretch ranges,
 * presets, catalogue changes, colour), duplicate / delete, the lock, one undo step each, and items following a moved
 * wall face (stored walls, block edges, thickness, drags, "Ta tilbake").
 */
import { describe, expect, it } from 'vitest';
import { backEdge } from '../geometry/furnitureDerive';
import { distancePointSegment } from '../geometry/polygon';
import type { DerivedVariant } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Variant, Vec2 } from '../model/types';
import * as A from './editActions';
import { nb } from '../i18n/nb';
import { EDIT_STRINGS } from './editStrings';
import { createAppStore, selectActiveVariant } from './store';
import { deriveForState } from './useDerived';

type Store = ReturnType<typeof createAppStore>;

function proposal(): Store {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

const V = (s: Store): Variant => selectActiveVariant(s.getState());
const D = (s: Store): DerivedVariant => deriveForState(s.getState());
const item = (s: Store, id: string) => V(s).furniture.find((f) => f.id === id);
const pos = (s: Store, id: string): Vec2 => item(s, id)!.position;
const steps = (s: Store) => s.getState().history().past.length;
const near = (a: Vec2, b: Vec2, tol = 1e-9) => {
  expect(Math.abs(a[0] - b[0])).toBeLessThan(tol);
  expect(Math.abs(a[1] - b[1])).toBeLessThan(tol);
};

describe('the lock', () => {
  it('every furniture action refuses Forslag D with the toast and changes nothing', () => {
    const store = createAppStore(createForslagD());
    const before = V(store);
    const calls: (() => unknown)[] = [
      () => A.addFurniture(store, 'stol', [14, 5]),
      () => A.moveFurniture(store, 'fu-stue-3', [14, 1]),
      () => A.rotateFurniture(store, 'fu-stue-3', 90),
      () => A.setFurnitureProps(store, 'fu-stue-3', { colour: '#2b2b2b' }),
      () => A.duplicateFurniture(store, 'fu-stue-3'),
      () => A.deleteFurniture(store, 'fu-stue-3'),
      () => A.nudge(store, { kind: 'furniture', id: 'fu-stue-3' }, 0.01, 0),
      () => A.moveWall(store, 'w-sauna-n', [0, 0.3]),
    ];
    for (const call of calls) {
      const r = call();
      expect(r === null || r === false, String(call)).toBe(true);
      expect(V(store)).toBe(before);
    }
    expect(store.getState().toasts.map((t) => t.text)).toContain(EDIT_STRINGS.locked);
  });
});

describe('placing and editing', () => {
  it('addFurniture: the preset size and key, the level under the point, a normalised turn; one undo step', () => {
    const store = proposal();
    const id = A.addFurniture(store, 'seng-90', [18, 5], { rotationDeg: -90 }) as string;
    expect(item(store, id)).toMatchObject({ catalogId: 'seng-90', size: { w: 0.9, d: 2, h: 0.5 }, sizeVariant: '90x200', levelId: 'main', rotationDeg: 270, isNew: true });
    expect(steps(store)).toBe(1);
    const lower = A.addFurniture(store, 'kommode', [1.0, 4.2]) as string;
    expect(item(store, lower)?.levelId).toBe('lower');
    expect(D(store).furniture.find((f) => f.id === lower)).toMatchObject({ roomId: 'room-sov1', floorZ: -1 });
    const short = A.addFurniture(store, 'seng-90', [18, 5], { sizeVariant: '90x190' }) as string;
    expect(item(store, short)?.size).toEqual({ w: 0.9, d: 1.9, h: 0.5 });
    // An explicit size wins; an unknown entry gets the 1 m box and derives with 'furniture-unknown'.
    const big = A.addFurniture(store, 'benkeskap', [10, 3], { size: { w: 2, d: 0.6, h: 0.9 } }) as string;
    expect(item(store, big)?.size).toEqual({ w: 2, d: 0.6, h: 0.9 });
    const odd = A.addFurniture(store, 'rakett', [14, 5]) as string;
    expect(item(store, odd)?.size).toEqual({ w: 1, d: 1, h: 1 });
    expect(D(store).warnings).toContainEqual({ kind: 'furniture-unknown', furnitureId: odd, catalogId: 'rakett' });
  });

  it('moveFurniture: the level follows the floor under the item (Korridor (øvre) → Soverom 1); unchanged → false', () => {
    const store = proposal();
    const id = A.addFurniture(store, 'kommode', [6, 3.6]) as string;
    expect(item(store, id)?.levelId).toBe('main');
    expect(A.moveFurniture(store, id, [1.0, 4.2])).toBe(true);
    expect(item(store, id)).toMatchObject({ position: [1.0, 4.2], levelId: 'lower' });
    expect(D(store).furniture.find((f) => f.id === id)?.floorZ).toBe(-1);
    const n = steps(store);
    expect(A.moveFurniture(store, id, [1.0, 4.2])).toBe(false);
    expect(steps(store)).toBe(n);
    // Arrow-key nudges of one item are one undo step.
    for (let k = 0; k < 3; k++) A.nudge(store, { kind: 'furniture', id }, 0.01, 0);
    near(pos(store, id), [1.03, 4.2]);
    expect(steps(store)).toBe(n + 1);
  });

  it('rotateFurniture: quarter turns about the centre, kept in [0, 360); a full turn is no change', () => {
    const store = proposal();
    const before = pos(store, 'fu-stue-3');
    expect(A.rotateFurniture(store, 'fu-stue-3')).toBe(true);
    expect(item(store, 'fu-stue-3')?.rotationDeg).toBe(90);
    expect(A.rotateFurniture(store, 'fu-stue-3', -180)).toBe(true);
    expect(item(store, 'fu-stue-3')?.rotationDeg).toBe(270);
    expect(A.rotateFurniture(store, 'fu-stue-3', 360)).toBe(false);
    expect(pos(store, 'fu-stue-3')).toEqual(before);
    expect(A.rotateFurniture(store, 'nope')).toBe(false);
  });

  it('setFurnitureProps: depth keeps the back on its wall; stretch ranges; presets; another entry; colour', () => {
    const store = proposal();
    // The kitchen counter, back on the north wall (y 6.04).
    expect(A.setFurnitureProps(store, 'fu-kjokken-2', { size: { w: 9, d: 0.5, h: 0.9 } })).toBe(true);
    const counter = item(store, 'fu-kjokken-2')!;
    expect(counter.size).toEqual({ w: 6, d: 0.5, h: 0.9 });
    expect(counter.position[1] + counter.size.d / 2).toBeCloseTo(6.04, 9);
    // The bed in Soverom 3 (back north on 2.12): a 90 × 200 preset keeps the head on the wall.
    expect(A.setFurnitureProps(store, 'fu-sov3-1', { sizeVariant: '90x200' })).toBe(true);
    const bed = item(store, 'fu-sov3-1')!;
    expect(bed).toMatchObject({ sizeVariant: '90x200', size: { w: 0.9, d: 2, h: 0.5 } });
    expect(bed.position[1] + 1).toBeCloseTo(2.12, 9);
    // Another entry takes its default preset; a wall-backed one turned east (270) keeps its back at x 20.64.
    expect(A.setFurnitureProps(store, 'fu-sov-ny-2', { catalogId: 'kommode' })).toBe(true);
    const k = item(store, 'fu-sov-ny-2')!;
    expect(k).toMatchObject({ catalogId: 'kommode', sizeVariant: '80', size: { w: 0.8, d: 0.45, h: 0.8 } });
    expect(k.position[0] + k.size.d / 2).toBeCloseTo(20.64, 9);
    // Colour on and off; an unchanged patch is no change and no undo step.
    expect(A.setFurnitureProps(store, 'fu-stue-2', { colour: '#5d7590' })).toBe(true);
    expect(item(store, 'fu-stue-2')?.colour).toBe('#5d7590');
    const n = steps(store);
    expect(A.setFurnitureProps(store, 'fu-stue-2', { colour: '#5d7590' })).toBe(false);
    expect(steps(store)).toBe(n);
    expect(A.setFurnitureProps(store, 'fu-stue-2', { colour: null })).toBe(true);
    expect(item(store, 'fu-stue-2')?.colour).toBeUndefined();
    expect(A.setFurnitureProps(store, 'fu-stue-2', { levelId: 'main' })).toBe(false);
  });

  it('duplicate (Ctrl+D, Dupliser): beside the original on a free spot, everything else equal, new; one undo step; delete (toast)', () => {
    const store = proposal();
    A.setFurnitureProps(store, 'fu-stue-5', { colour: '#7b7d80' });
    const before = steps(store);
    const copyId = A.duplicateFurniture(store, 'fu-stue-5') as string;
    expect(steps(store)).toBe(before + 1);
    const src = item(store, 'fu-stue-5')!;
    const copy = item(store, copyId)!;
    expect(copyId).not.toBe('fu-stue-5');
    expect(copy).toMatchObject({ catalogId: 'lenestol', size: src.size, rotationDeg: src.rotationDeg, colour: '#7b7d80', levelId: 'main', isNew: true });
    // Not the old fixed 0.3 m east + south (into the Stue's outer wall and the original): free, in the same room, beside it.
    const d = D(store);
    const derivedCopy = d.furniture.find((f) => f.id === copyId)!;
    expect(derivedCopy.collisions).toEqual([]);
    expect(derivedCopy.blocksDoors).toEqual([]);
    expect(derivedCopy.roomId).toBe('room-stue');
    expect(d.warnings.filter((w) => JSON.stringify(w).includes(copyId))).toEqual([]);
    expect(d.warnings.filter((w) => w.kind === 'furniture-in-wall' || w.kind === 'furniture-overlap' || w.kind === 'door-blocked')).toEqual([]);
    const gap = Math.hypot(copy.position[0] - src.position[0], copy.position[1] - src.position[1]);
    expect(gap).toBeGreaterThanOrEqual(0.7 - 1e-9); // the armchair is 0.7 × 0.7: no overlap with the original …
    expect(gap).toBeLessThanOrEqual(1.0); // … and right beside it
    expect(A.deleteFurniture(store, copyId)).toBe(true);
    expect(item(store, copyId)).toBeUndefined();
    expect(store.getState().toasts.map((t) => t.text)).toContain(EDIT_STRINGS.deleted);
    expect(A.deleteFurniture(store, copyId)).toBe(false);
  });

  it('duplicate: a back-to-wall item goes to the free wall spot nearest the original, against the wall; a full room never puts it in a wall', () => {
    const store = proposal();
    // Nattbord fu-sov-ny-2 (back to the east wall of Soverom (ny)): the copy stands with its back on a wall too.
    const copyId = A.duplicateFurniture(store, 'fu-sov-ny-2') as string;
    const d = D(store);
    const copy = d.furniture.find((f) => f.id === copyId)!;
    expect(copy.collisions).toEqual([]);
    expect(copy.blocksDoors).toEqual([]);
    expect(copy.roomId).toBe('room-sov-ny');
    const src = item(store, 'fu-sov-ny-2')!;
    expect(Math.hypot(copy.item.position[0] - src.position[0], copy.item.position[1] - src.position[1])).toBeLessThan(0.5);
    const room = d.rooms.find((r) => r.id === 'room-sov-ny')!;
    const [a, b] = backEdge(copy.item);
    const onEdge = (p: Vec2) => room.polygon.some((q, i) => distancePointSegment(p, q, room.polygon[(i + 1) % room.polygon.length]) < 1e-6);
    expect(onEdge(a) && onEdge(b)).toBe(true);
    // The kitchen's tall cabinet has no free spot left in Kjøkken (before the final fix round it overlapped the
    // counter and the island). Last fix round: Kjøkken has no door or opening to another room (only dividers), so
    // nothing is added (before: the copy went into the Vindfang).
    const n = V(store).furniture.length;
    expect(A.duplicateFurniture(store, 'fu-kjokken-1')).toBeNull();
    expect(V(store).furniture.length).toBe(n);
    expect(store.getState().toasts.map((t) => t.text)).toContain(nb.editor.duplicateNoSpace);
  });

  it('duplicate into another room (last fix round): only through a door or opening, within 3 m, never a new warning; the toast names the room', () => {
    // The review's copies that made no sense are refused: the sauna bench (before: into Stue, 11.5 m away), the
    // washing machine (before: into Bod, with 'furniture-needs-wet-room'), the dining table for 8 (before: into
    // Passasje, behind a divider), and the toilet, the 90 bed, the pantry shelf and the reading nook's rug.
    for (const id of ['fu-badstue-1', 'fu-teknisk-1', 'fu-spiseplass-1', 'fu-wc-1', 'fu-sov3-1', 'fu-pantry-1', 'fu-leseskrok-5']) {
      const store = proposal();
      const n = V(store).furniture.length;
      const warnings = D(store).warnings.length;
      expect(A.duplicateFurniture(store, id), id).toBeNull();
      expect(V(store).furniture.length, id).toBe(n);
      expect(D(store).warnings.length, id).toBe(warnings);
      expect(store.getState().toasts.map((t) => t.text), id).toEqual([nb.editor.duplicateNoSpace]);
    }
    // The Mellombygg's bench: no room beside it, so the copy goes through door-mellom-vf into the Vindfang, 0.62 m
    // away, with the toast; Gang's rug through d-sov-ny into Soverom (ny fløy).
    for (const [id, roomId, name] of [
      ['fu-mellombygg-1', 'room-vindfang', 'Vindfang'],
      ['fu-gang-1', 'room-sov-ny', 'Soverom (ny fløy)'],
    ] as const) {
      const store = proposal();
      const warnings = D(store).warnings.length;
      const copyId = A.duplicateFurniture(store, id) as string;
      expect(copyId, id).toBeTruthy();
      const d = D(store);
      const copy = d.furniture.find((f) => f.id === copyId)!;
      expect(copy.roomId, id).toBe(roomId);
      expect(Math.hypot(copy.item.position[0] - pos(store, id)[0], copy.item.position[1] - pos(store, id)[1]), id).toBeLessThanOrEqual(3);
      expect(copy.collisions, id).toEqual([]);
      expect(copy.blocksDoors, id).toEqual([]);
      expect(d.warnings.length, id).toBe(warnings);
      expect(store.getState().toasts.map((t) => t.text), id).toEqual([`Kopien står i «${name}».`]);
    }
    // The armchair in Soverom (ny fløy): four copies fit in the room itself (no toast), then nothing is added.
    const store = proposal();
    let cur = 'fu-sov-ny-6';
    for (let k = 0; k < 4; k++) {
      cur = A.duplicateFurniture(store, cur) as string;
      expect(D(store).furniture.find((f) => f.id === cur)?.roomId, `copy ${k + 1}`).toBe('room-sov-ny');
    }
    expect(store.getState().toasts).toEqual([]);
    expect(A.duplicateFurniture(store, cur)).toBeNull();
    expect(store.getState().toasts.map((t) => t.text)).toEqual([nb.editor.duplicateNoSpace]);
  });

  it('duplicate with no free spot in the room nor next to it (fu-sov1-1): refused with the toast, never into a wall', () => {
    const store = proposal();
    expect(D(store).furniture.find((f) => f.id === 'fu-sov1-1')?.roomId).toBe('room-sov1');
    // Before: the copy went 0.3 m east and south, into w-104-103, w-103-korr and w-104-diag (+5 warnings). Now no
    // second bed fits in Soverom 1 or the rooms next to it (Soverom 2, Bad, the lower corridor): nothing is added.
    const before = D(store).warnings.length;
    const n = V(store).furniture.length;
    expect(A.duplicateFurniture(store, 'fu-sov1-1')).toBeNull();
    expect(V(store).furniture.length).toBe(n);
    expect(steps(store)).toBe(0);
    expect(store.getState().toasts.map((t) => t.text)).toContain(nb.editor.duplicateNoSpace);
    expect(D(store).warnings.length).toBe(before);
    // The review's other copies into walls (a bed, the corner sofa, the log stack) are refused the same way.
    for (const id of ['fu-sov2-1', 'fu-stue-2', 'fu-ved-1']) expect(A.duplicateFurniture(store, id), id).toBeNull();
    expect(V(store).furniture.length).toBe(n);
    expect(D(store).warnings.filter((w) => w.kind === 'furniture-in-wall' || w.kind === 'furniture-overlap')).toEqual([]);
  });
});

describe('items following a moved wall face (§4)', () => {
  it('a stored wall moved across itself carries the items backed onto either face; the others stay; undo', () => {
    const store = proposal();
    const before = new Map(V(store).furniture.map((f) => [f.id, f.position]));
    expect(A.moveWall(store, 'w-sauna-n', [0, 0.3])).toBe(true);
    // South face: the sauna bench; north face: the pantry's south shelf and the WC's sink.
    for (const id of ['fu-badstue-1', 'fu-pantry-2', 'fu-wc-2']) near(pos(store, id), [before.get(id)![0], before.get(id)![1] + 0.3]);
    const moved = V(store).furniture.filter((f) => f.position !== before.get(f.id) && (f.position[0] !== before.get(f.id)![0] || f.position[1] !== before.get(f.id)![1]));
    expect(moved.map((f) => f.id).sort()).toEqual(['fu-badstue-1', 'fu-pantry-2', 'fu-wc-2']);
    expect(steps(store)).toBe(1);
    store.getState().undo();
    expect(pos(store, 'fu-badstue-1')).toEqual(before.get('fu-badstue-1'));
  });

  it('a thicker wall pushes the items on its faces out by the change of each face', () => {
    const store = proposal();
    const bench = pos(store, 'fu-badstue-1');
    const shelf = pos(store, 'fu-pantry-2');
    expect(A.setWallProps(store, 'w-sauna-n', { thickness: 0.2 })).toBe(true);
    near(pos(store, 'fu-badstue-1'), [bench[0], bench[1] - 0.04]);
    near(pos(store, 'fu-pantry-2'), [shelf[0], shelf[1] + 0.04]);
  });

  it('a block edge carries the items on its inner and outer face; Ta tilbake brings them back', () => {
    const store = proposal();
    const before = new Map(V(store).furniture.map((f) => [f.id, f.position]));
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-ne', [0, 0.5])).toBe(true);
    // Inside: the kitchen counter and the lower bathroom's toilet (its floor zone grows with the edge); outside (in the
    // Mellombygg): the bench on the old wall's outer face.
    near(pos(store, 'fu-kjokken-2'), [10.505, 6.24]);
    near(pos(store, 'fu-bad-1'), [3.4, 6.215]);
    near(pos(store, 'fu-mellombygg-1'), [5.95, 6.985]);
    expect(D(store).furniture.find((f) => f.id === 'fu-bad-1')).toMatchObject({ levelId: 'lower', roomId: 'room-bad', collisions: [] });
    expect(D(store).furniture.find((f) => f.id === 'fu-kjokken-2')?.collisions).toEqual([]);
    expect(A.restoreGhost(store, 'blk-main/v-main-ne/ghost')).toBe(true);
    for (const f of V(store).furniture) expect(f.position, f.id).toEqual(before.get(f.id));
  });

  it('an item is never carried onto the floor of another level', () => {
    const store = proposal();
    // w-103-102 (x 5.05) parts the lower Bad (x < 4.99, level −1.0) from the Vindfang (x > 5.11, main).
    const up = A.addFurniture(store, 'kommode', [5.11 + 0.225, 5.2], { rotationDeg: 90 }) as string;
    const down = A.addFurniture(store, 'kommode', [4.99 - 0.225, 5.0], { rotationDeg: 270 }) as string;
    expect([item(store, up)?.levelId, item(store, down)?.levelId]).toEqual(['main', 'lower']);
    expect(A.moveWall(store, 'w-103-102', [-0.3, 0])).toBe(true);
    // The Vindfang's kommode would land west of the floor step (x 5.05), on the lower floor: it stays.
    expect(pos(store, up)).toEqual([5.335, 5.2]);
    near(pos(store, down), [4.465, 5.0]);
  });

  it('a wall drag carries them frame by frame from the pointer-down base; cancel restores', () => {
    const store = proposal();
    const bench = pos(store, 'fu-badstue-1');
    const session = A.beginDrag(store, { kind: 'wall', id: 'w-sauna-n' }, [17, 0], undefined, { snapRadiusM: 0.01 });
    expect(session).not.toBeNull();
    A.updateDrag(store, session, [17, 0.2], { snapRadiusM: 0.01 });
    near(pos(store, 'fu-badstue-1'), [bench[0], bench[1] + 0.2], 1e-6);
    A.updateDrag(store, session, [17, 0.1], { snapRadiusM: 0.01 });
    near(pos(store, 'fu-badstue-1'), [bench[0], bench[1] + 0.1], 1e-6);
    A.cancelDrag(store, session);
    expect(pos(store, 'fu-badstue-1')).toEqual(bench);
  });

  it('followWallFaces is pure and leaves a variant without moved faces alone', () => {
    const store = proposal();
    const v = V(store);
    const d = D(store);
    expect(A.followWallFaces(v, d, v, d)).toBe(v);
  });
});

/**
 * Small things at small zooms on the real seed (UX review of phase 2a, "handles hide small things"): what a press on
 * a selected door, window or new unit grabs at the iPhone's starting zoom (11,6 px/m, 14 px handles), on the laptop
 * (23,5 px/m, 7 px handles) and zoomed in (138 px/m). A press is resolved like the plan does it: the topmost handle
 * whose circle contains the point (the DOM hit), then editModel.ts `pressTarget`.
 */
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import * as A from '../state/editActions';
import { createAppStore } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { CORRIDOR_COARSE_PX, CORRIDOR_PX, HANDLE_RADIUS_COARSE_PX, HANDLE_RADIUS_PX, cornerHandlesShown, endHandlesShown, findOpening, handlesFor, pressTarget } from './editModel';
import type { PlanHandle } from './editModel';
import type { PlanSelection } from './editTypes';

function seedStore() {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

const seed = deriveForState(seedStore().getState());

/** The handle a press at p hits on screen: the topmost (drawn last) whose circle contains p. */
function handleAt(handles: readonly PlanHandle[], p: Vec2, scale: number, r: number): PlanHandle | null {
  for (let i = handles.length - 1; i >= 0; i--) {
    const h = handles[i];
    if (h.shape === 'edge') continue;
    if (Math.hypot(h.p[0] - p[0], h.p[1] - p[1]) * scale <= r) return h;
  }
  return null;
}

function press(d: DerivedVariant, sel: PlanSelection, p: Vec2, scale: number, coarse: boolean) {
  const r = coarse ? HANDLE_RADIUS_COARSE_PX : HANDLE_RADIUS_PX;
  const handles = handlesFor(d, sel, { scale, handleR: r });
  const tolM = (coarse ? CORRIDOR_COARSE_PX : CORRIDOR_PX) / 2 / scale;
  return pressTarget(d, sel, handleAt(handles, p, scale, r), false, p, tolM, r / scale);
}

function openingCentre(d: DerivedVariant, id: string): Vec2 {
  const hit = findOpening(d, id)!;
  const { wall, opening } = hit;
  const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const t = opening.offset / L;
  return [wall.a[0] + (wall.b[0] - wall.a[0]) * t, wall.a[1] + (wall.b[1] - wall.a[1]) * t];
}

const DOOR: PlanSelection = { kind: 'opening', id: 'door-mellom-vf' };

describe('a press on a small selected thing moves it', () => {
  it('iPhone (11,6 px/m): the centre of door-mellom-vf (0,91 m) starts a move, not a resize; its end handles sit outside it', () => {
    // Fix round after 2b: on touch the end handles show at any zoom, one radius beyond the jambs.
    expect(handlesFor(seed, DOOR, { scale: 11.6, handleR: HANDLE_RADIUS_COARSE_PX }).map((h) => h.key)).toEqual(['oe:start', 'oe:end']);
    expect(press(seed, DOOR, openingCentre(seed, 'door-mellom-vf'), 11.6, true)).toEqual({ kind: 'body', target: DOOR });
  });

  it('laptop (23,5 px/m): 0,6 m windows (win-bad-n, win-do-w, win-bad-e1) move from their middle', () => {
    for (const id of ['win-bad-n', 'win-do-w', 'win-bad-e1']) {
      const sel: PlanSelection = { kind: 'opening', id };
      expect(press(seed, sel, openingCentre(seed, id), 23.5, false)).toEqual({ kind: 'body', target: sel });
    }
  });

  it('a new 2 × 1,5 m unit (Vedskjul) is draggable by its body on the phone and on the laptop', () => {
    const store = seedStore();
    const id = A.placeUnit(store, 'vedskjul', [14, 11.35], 0);
    expect(id).toBeTruthy();
    const d = deriveForState(store.getState());
    const sel: PlanSelection = { kind: 'block', id: id! };
    const poly = d.blocks.find((b) => b.block.id === id)!.block.polygon.map((v) => v.p);
    const c: Vec2 = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
    expect(handlesFor(d, sel, { scale: 11.6, handleR: HANDLE_RADIUS_COARSE_PX })).toEqual([]);
    for (const off of [
      [0, 0],
      [0.6, 0.4],
      [-0.7, -0.5],
    ] as Vec2[]) {
      expect(press(d, sel, [c[0] + off[0], c[1] + off[1]], 11.6, true)).toEqual({ kind: 'body', target: { kind: 'block', id } });
      expect(press(d, sel, [c[0] + off[0], c[1] + off[1]], 23.5, false)).toEqual({ kind: 'body', target: { kind: 'block', id } });
    }
    // Zoomed in (60 px/m) the corners have their handles again; the body still moves from inside.
    const corner = press(d, sel, poly[2], 60, false);
    expect(corner?.kind).toBe('handle');
    expect(corner?.kind === 'handle' && corner.handle.shape).toBe('vertex');
    expect(press(d, sel, c, 60, false)).toEqual({ kind: 'body', target: { kind: 'block', id } });
  });
});

describe('zoomed in, the handles are back', () => {
  it('138 px/m: the door has its end handles, just outside the jambs; its centre still moves it, a handle resizes', () => {
    const r = HANDLE_RADIUS_COARSE_PX;
    const handles = handlesFor(seed, DOOR, { scale: 138, handleR: r });
    expect(handles.map((h) => h.key)).toEqual(['oe:start', 'oe:end']);
    for (const h of handles) {
      // Drawn one handle radius beyond the jamb it acts on.
      expect(h.anchor).toBeDefined();
      expect(Math.hypot(h.p[0] - h.anchor![0], h.p[1] - h.anchor![1]) * 138).toBeCloseTo(r, 6);
    }
    const c = openingCentre(seed, 'door-mellom-vf');
    expect(Math.hypot(handles[0].anchor![0] - c[0], handles[0].anchor![1] - c[1])).toBeCloseTo(0.455, 6);
    expect(press(seed, DOOR, c, 138, true)).toEqual({ kind: 'body', target: DOOR });
    const onHandle = press(seed, DOOR, handles[1].p, 138, true);
    expect(onHandle?.kind === 'handle' && onHandle.handle.handle).toBe('end');
  });

  it('a press inside the body wins even over a handle that covers it', () => {
    // Without a screen (the old placement: on the jambs), the start handle covers the door's start; a press inside
    // the footprint there still moves the door.
    const handles = handlesFor(seed, DOOR);
    const start = handles[0];
    const c = openingCentre(seed, 'door-mellom-vf');
    const inside: Vec2 = [start.p[0] + (c[0] - start.p[0]) * 0.1, start.p[1] + (c[1] - start.p[1]) * 0.1];
    expect(pressTarget(seed, DOOR, start, false, inside, 0.1, 0.05)).toEqual({ kind: 'body', target: DOOR });
  });
});

describe('second fix round: end handles appear at the usual zooms (they sit outside the ends)', () => {
  const MOUSE = { scale: 23.5, handleR: HANDLE_RADIUS_PX };

  it('endHandlesShown / cornerHandlesShown: one handle diameter for end handles, three for corner handles', () => {
    expect(endHandlesShown(0.91, MOUSE)).toBe(true);
    expect(endHandlesShown(0.5, MOUSE)).toBe(false);
    expect(endHandlesShown(0.3, { scale: 11.6, handleR: HANDLE_RADIUS_COARSE_PX })).toBe(false);
    expect(endHandlesShown(0.3)).toBe(true);
    expect(cornerHandlesShown(2, MOUSE)).toBe(true);
    expect(cornerHandlesShown(1.5, MOUSE)).toBe(false);
    expect(cornerHandlesShown(1.5, { scale: 11.6, handleR: HANDLE_RADIUS_COARSE_PX })).toBe(false);
    expect(cornerHandlesShown(1.5, { scale: 60, handleR: HANDLE_RADIUS_PX })).toBe(true);
  });

  it('laptop (23,5 px/m): door-mellom-vf (0,91 m) has its end handles; a press in its middle still moves it', () => {
    expect(handlesFor(seed, DOOR, MOUSE).map((h) => h.key)).toEqual(['oe:start', 'oe:end']);
    expect(press(seed, DOOR, openingCentre(seed, 'door-mellom-vf'), 23.5, false)).toEqual({ kind: 'body', target: DOOR });
    const end = handlesFor(seed, DOOR, MOUSE)[1];
    const onHandle = press(seed, DOOR, end.p, 23.5, false);
    expect(onHandle?.kind === 'handle' && onHandle.handle.handle).toBe('end');
    // Walls too: w-104-103 (1,96 m) on the laptop, w-gang-n (4,8 m) on the phone.
    expect(handlesFor(seed, { kind: 'wall', id: 'w-104-103' }, MOUSE).map((h) => h.key)).toEqual(['we:a', 'we:b']);
    expect(handlesFor(seed, { kind: 'wall', id: 'w-gang-n' }, { scale: 11.6, handleR: HANDLE_RADIUS_COARSE_PX })).toHaveLength(2);
  });

  it('a 0,3 m window at 11,6 px/m shows none with the mouse, two outside it on touch; its middle moves it', () => {
    const store = seedStore();
    expect(A.setOpeningProps(store, 'win-bad-n', { width: 0.3 })).toBe(true);
    const d = deriveForState(store.getState());
    const sel: PlanSelection = { kind: 'opening', id: 'win-bad-n' };
    expect(findOpening(d, 'win-bad-n')!.opening.width).toBeCloseTo(0.3, 9);
    expect(handlesFor(d, sel, { scale: 11.6, handleR: HANDLE_RADIUS_PX })).toEqual([]);
    // Fix round after 2b: on touch the end handles show at any zoom (outside the jambs, so the middle still moves it).
    expect(handlesFor(d, sel, { scale: 11.6, handleR: HANDLE_RADIUS_COARSE_PX }).map((h) => h.key)).toEqual(['oe:start', 'oe:end']);
    expect(press(d, sel, openingCentre(d, 'win-bad-n'), 11.6, true)).toEqual({ kind: 'body', target: sel });
  });
});

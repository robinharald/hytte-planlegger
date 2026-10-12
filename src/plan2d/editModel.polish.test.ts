/**
 * editModel.ts, editor polish (phase 2b, plan side; the second review's leftovers on the real seed):
 *  - the 5 px touch threshold for presses on the selection (10 px elsewhere, 5 px with a mouse);
 *  - opening end handles on touch from half a handle diameter (door-mellom-vf at 23 px/m);
 *  - a second tap on a selected opening over a ghost selects the ghost (zoomed in, the ghost is wholly under it);
 *  - the label box format the plan writes on its label hit areas.
 */
import { describe, expect, it } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import { createAppStore } from '../state/store';
import { deriveForState } from '../state/useDerived';
import {
  DRAG_THRESHOLD_TOUCH_SELECTED_PX,
  HANDLE_RADIUS_COARSE_PX,
  HANDLE_RADIUS_PX,
  OPENING_END_HANDLE_MIN_DIAMETERS_TOUCH,
  bandLines,
  cycleFurnitureRoom,
  cycleOpeningGhost,
  dragThresholdPx,
  endHandlesShown,
  findOpening,
  formatLabelBox,
  handlesFor,
  labelTap,
  openingEndHandlesShown,
  parseLabelBox,
  wallsById,
} from './editModel';
import type { PlanSelection } from './editTypes';

function seed() {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  return deriveForState(store.getState());
}

const d = seed();
const DOOR: PlanSelection = { kind: 'opening', id: 'door-mellom-vf' };
const TOUCH = (scale: number) => ({ scale, handleR: HANDLE_RADIUS_COARSE_PX });
const MOUSE = (scale: number) => ({ scale, handleR: HANDLE_RADIUS_PX });

describe('drag thresholds', () => {
  it('touch: 5 px on the selection (body or handle), 10 px elsewhere; mouse and pen: 5 px', () => {
    expect(DRAG_THRESHOLD_TOUCH_SELECTED_PX).toBe(5);
    expect(dragThresholdPx('touch', true)).toBe(5);
    expect(dragThresholdPx('touch', false)).toBe(10);
    expect(dragThresholdPx('touch')).toBe(10);
    expect(dragThresholdPx('mouse', true)).toBe(5);
    expect(dragThresholdPx('pen', true)).toBe(5);
    // A 0,5 m nudge at the phone's starting zoom (11,56 px/m) is 5,8 px: a drag, where 10 px made it a tap.
    expect(0.5 * 11.56).toBeGreaterThan(dragThresholdPx('touch', true));
    expect(0.5 * 11.56).toBeLessThan(dragThresholdPx('touch'));
  });
});

describe('opening end handles on touch: at any zoom', () => {
  it('door-mellom-vf (0,91 m) at 23 px/m on touch has its end handles (before: from 31 px/m)', () => {
    expect(OPENING_END_HANDLE_MIN_DIAMETERS_TOUCH).toBe(0);
    const handles = handlesFor(d, DOOR, TOUCH(23));
    expect(handles.map((h) => h.key)).toEqual(['oe:start', 'oe:end']);
    // They sit one handle radius outside the jambs and act on them.
    const { wall, opening } = findOpening(d, 'door-mellom-vf')!;
    const l = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const u: Vec2 = [(wall.b[0] - wall.a[0]) / l, (wall.b[1] - wall.a[1]) / l];
    const jamb: Vec2 = [wall.a[0] + u[0] * (opening.offset - opening.width / 2), wall.a[1] + u[1] * (opening.offset - opening.width / 2)];
    expect(handles[0].anchor![0]).toBeCloseTo(jamb[0], 9);
    expect(handles[0].anchor![1]).toBeCloseTo(jamb[1], 9);
    expect(Math.hypot(handles[0].p[0] - jamb[0], handles[0].p[1] - jamb[1]) * 23).toBeCloseTo(HANDLE_RADIUS_COARSE_PX, 6);
  });

  it('at the phone\'s starting zoom too (fix round after 2b), outside the jambs; walls and the mouse keep one diameter', () => {
    // 0,91 m × 11,56 px/m = 10,5 px: before, under half a diameter (14 px), no handles at all.
    const handles = handlesFor(d, DOOR, TOUCH(11.56));
    expect(handles.map((h) => h.key)).toEqual(['oe:start', 'oe:end']);
    // Each sits one handle radius beyond its jamb, away from the door: neither covers the opening.
    const { wall, opening } = findOpening(d, 'door-mellom-vf')!;
    const l = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const u: Vec2 = [(wall.b[0] - wall.a[0]) / l, (wall.b[1] - wall.a[1]) / l];
    const along = (p: Vec2) => (p[0] - wall.a[0]) * u[0] + (p[1] - wall.a[1]) * u[1];
    expect((opening.offset - opening.width / 2 - along(handles[0].p)) * 11.56).toBeCloseTo(HANDLE_RADIUS_COARSE_PX, 6);
    expect((along(handles[1].p) - opening.offset - opening.width / 2) * 11.56).toBeCloseTo(HANDLE_RADIUS_COARSE_PX, 6);
    expect(openingEndHandlesShown(0.91, TOUCH(15.4))).toBe(true);
    expect(openingEndHandlesShown(0.91, TOUCH(15.3))).toBe(true);
    expect(openingEndHandlesShown(0.3, TOUCH(2))).toBe(true);
    // An explicit `coarse` wins over the radius.
    expect(openingEndHandlesShown(0.91, { scale: 23, handleR: HANDLE_RADIUS_COARSE_PX, coarse: false })).toBe(false);
    expect(openingEndHandlesShown(0.91, { scale: 9, handleR: HANDLE_RADIUS_PX, coarse: true })).toBe(true);
    // Mouse: one diameter (14 px) as before; walls on touch: one diameter (28 px).
    expect(handlesFor(d, DOOR, MOUSE(23.5)).map((h) => h.key)).toEqual(['oe:start', 'oe:end']);
    expect(openingEndHandlesShown(0.91, MOUSE(15))).toBe(false);
    expect(endHandlesShown(0.91, TOUCH(23))).toBe(false);
    expect(openingEndHandlesShown(0.91)).toBe(true);
  });
});

describe('a second tap on a selected opening over a ghost selects the ghost', () => {
  const WIN: PlanSelection = { kind: 'opening', id: 'win-106-s' };
  const centre = (id: string): Vec2 => {
    const { wall, opening } = findOpening(d, id)!;
    const l = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    return [wall.a[0] + ((wall.b[0] - wall.a[0]) * opening.offset) / l, wall.a[1] + ((wall.b[1] - wall.a[1]) * opening.offset) / l];
  };

  it('win-106-s selected, a tap on it over the door-106-old ghost: the ghost; not selected: the window', () => {
    const c = centre('win-106-s');
    expect(cycleOpeningGhost(d, WIN, WIN, c, 0.1)).toEqual({ kind: 'ghost', id: 'door-106-old' });
    expect(cycleOpeningGhost(d, null, WIN, c, 0.1)).toBe(WIN);
    expect(cycleOpeningGhost(d, { kind: 'ghost', id: 'door-106-old' }, WIN, c, 0.1)).toBe(WIN);
    // Past the ghost's jamb (the window is 1,1 m, the old door 0,91 m): the window stays.
    expect(cycleOpeningGhost(d, WIN, WIN, [c[0] + 0.5, c[1]], 0.1)).toBe(WIN);
  });

  it('an opening with no ghost under it, and other kinds: as tapped', () => {
    const sel: PlanSelection = { kind: 'opening', id: 'door-mellom-vf' };
    expect(cycleOpeningGhost(d, sel, sel, centre('door-mellom-vf'), 0.1)).toBe(sel);
    const wall: PlanSelection = { kind: 'wall', id: 'w-gang-n' };
    expect(cycleOpeningGhost(d, wall, wall, [0, 0], 0.1)).toBe(wall);
    expect(cycleOpeningGhost(d, WIN, null, centre('win-106-s'), 0.1)).toBeNull();
  });
});

describe('label boxes and band lines', () => {
  it('formats and parses data-label-box ("x0 y0 x1 y1", plan metres)', () => {
    const text = formatLabelBox([5.42993, 10.14922], [8.57007, 11.10078]);
    expect(text).toBe('5.4299 10.1492 8.5701 11.1008');
    expect(parseLabelBox(text)).toEqual({ min: [5.4299, 10.1492], max: [8.5701, 11.1008] });
    expect(parseLabelBox('8 2 1 0')).toEqual({ min: [1, 0], max: [8, 2] });
    expect(parseLabelBox('')).toBeNull();
    expect(parseLabelBox('1 2 x 4')).toBeNull();
    expect(parseLabelBox(null)).toBeNull();
  });

  it('bandLines: a wall\'s pieces, an opening between its jambs, a ghost opening or edge ghost', () => {
    const [w] = wallsById(d.walls, 'w-bod-ved');
    expect(bandLines(d, { kind: 'wall', id: 'w-bod-ved' })[0]).toMatchObject({ a: w.a, b: w.b });
    const win = bandLines(d, { kind: 'opening', id: 'win-106-s' });
    expect(win).toHaveLength(1);
    expect(Math.hypot(win[0].b[0] - win[0].a[0], win[0].b[1] - win[0].a[1])).toBeCloseTo(1.1, 9);
    expect(bandLines(d, { kind: 'ghost', id: 'door-106-old' })).toHaveLength(1);
    expect(bandLines(d, { kind: 'room', id: 'x' })).toEqual([]);
  });

  it('labelTap leaves anything but walls, openings and ghosts alone, and needs a scale', () => {
    const box = { roomId: 'r', min: [0, 0] as Vec2, max: [10, 10] as Vec2 };
    const room: PlanSelection = { kind: 'room', id: 'other' };
    expect(labelTap(d, room, [1, 1], [box], 11.56)).toBe(room);
    expect(labelTap(d, null, [1, 1], [box], 11.56)).toBeNull();
    const wall: PlanSelection = { kind: 'wall', id: 'w-gang-n' };
    expect(labelTap(d, wall, [1, 1], [box], 0)).toBe(wall);
    // An unknown wall id has no line to measure from: as tapped.
    const gone: PlanSelection = { kind: 'wall', id: 'gone' };
    expect(labelTap(d, gone, [1, 1], [box], 11.56)).toBe(gone);
  });
});

describe('a second tap reaches what lies under the selection: furniture ↔ room (integration, phase 2b)', () => {
  const bed: PlanSelection = { kind: 'furniture', id: 'fu-sov-ny-1', levelId: 'main' };
  const room: PlanSelection = { kind: 'room', id: 'room-sov-ny', levelId: 'main' };
  const onBed: Vec2 = [19.64, 4.75];

  it('a tap on the selected bed selects the bedroom; a tap there on the selected bedroom the bed again', () => {
    expect(cycleFurnitureRoom(d, 'ground', null, bed, onBed)).toEqual(bed);
    expect(cycleFurnitureRoom(d, 'ground', bed, bed, onBed)).toEqual(room);
    expect(cycleFurnitureRoom(d, 'ground', room, room, onBed)).toEqual(bed);
    // On the room's floor beside the bed there is nothing under the room.
    expect(cycleFurnitureRoom(d, 'ground', room, room, [17.3, 3.8])).toEqual(room);
    // Another element tapped: as it is.
    expect(cycleFurnitureRoom(d, 'ground', room, bed, onBed)).toEqual(bed);
  });

  it('solid items above rugs: the room over the Leseskrok rug and its coffee table gives the table', () => {
    const lese: PlanSelection = { kind: 'room', id: 'room-leseskrok', levelId: 'main' };
    expect(cycleFurnitureRoom(d, 'ground', lese, lese, [7.0, -1.35])).toMatchObject({ kind: 'furniture', id: 'fu-leseskrok-3' });
    expect(cycleFurnitureRoom(d, 'ground', lese, lese, [6.4, -0.5])).toMatchObject({ kind: 'furniture', id: 'fu-leseskrok-5' });
  });
});

/**
 * Walk mode kinematics (walk.ts): collision slide, doors and windows, floor height on stairs, deck and terrain,
 * the joystick, and the start pose on the real Forslag D seed.
 */
import { describe, expect, it } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import type { DerivedOpening, DerivedVariant, DerivedWall } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { TerrainAsset, Vec2 } from '../model/types';
import { groundZFn } from './ground';
import * as W from './walk';
import type { WalkDerived, WalkPose, WalkWorld } from './walk';

const FWD = { forward: 1, strafe: 0, run: false };

/** Walks with a constant input for `seconds` at 30 fps; the per-frame poses. */
function walk(world: WalkWorld, pose: WalkPose, seconds: number, input = FWD): WalkPose[] {
  const out: WalkPose[] = [];
  let p = pose;
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    p = W.stepWalk(world, p, input, 1 / 30);
    out.push(p);
  }
  return out;
}
const last = (ps: WalkPose[]) => ps[ps.length - 1];

// ---------------------------------------------------------------------------
// A small hand-made world
// ---------------------------------------------------------------------------

function wall(id: string, a: Vec2, b: Vec2, thickness: number, openings: Partial<DerivedOpening>[] = []): DerivedWall {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const h = thickness / 2;
  const footprint: Vec2[] = [
    [a[0] - n[0] * h, a[1] - n[1] * h],
    [b[0] - n[0] * h, b[1] - n[1] * h],
    [b[0] + n[0] * h, b[1] + n[1] * h],
    [a[0] + n[0] * h, a[1] + n[1] * h],
  ];
  return {
    id,
    source: { kind: 'wall', wallId: id },
    a,
    b,
    thickness,
    faceLeft: h,
    faceRight: h,
    footprint,
    ends: { start: 'butt', end: 'butt' },
    isExterior: false,
    isDivider: false,
    status: 'existing',
    isNew: false,
    isGhost: false,
    levelId: 'main',
    levelIds: ['main'],
    storeyIds: ['ground'],
    baseZ: 0,
    topZ: 2.4,
    topProfile: [
      { t: 0, z: 2.4 },
      { t: 1, z: 2.4 },
    ],
    openings: openings.map(
      (o, i) =>
        ({
          id: `${id}-o${i}`,
          type: 'door',
          status: 'existing',
          isNew: false,
          isGhost: false,
          levelId: 'main',
          offset: 1,
          width: 0.9,
          sillZ: 0,
          headZ: 2.1,
          footprint: [],
          ...o,
        }) as DerivedOpening,
    ),
    patches: [],
  };
}

const square = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function world(over: Partial<WalkDerived> = {}, ground: (x: number, y: number) => number = () => -0.5): WalkWorld {
  const base: WalkDerived = {
    walls: [],
    floors: [{ id: 'f', levelId: 'main', polygon: square(-10, -10, 10, 10), holes: [], z: 0, thickness: 0, material: 'wood', isNew: false, kind: 'room' }],
    structure: [],
    outdoor: { decks: [], railings: [], steps: [], hotTubs: [] },
    roofs: [],
    levels: [{ id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 }],
    bounds: { min: [-10, -10], max: [10, 10] },
    site: { trees: [] },
  };
  return W.buildWalkWorld({ ...base, ...over }, ground);
}

const pose = (pos: Vec2, heading: number, feetZ = 0): WalkPose => ({ pos, feetZ, eyeZ: feetZ + W.WALK_EYE_HEIGHT, heading, pitch: 0 });

describe('collisions', () => {
  // a wall along y = 0 from x −5 to 5, 0.12 thick, with a 0.9 m door centred at x = 1 (offset 6 from a)
  const doorWall = wall('w', [-5, 0], [5, 0], 0.12, [{ offset: 6, width: 0.9 }]);

  it('slides along a wall when walking into it at an angle', () => {
    const w = world({ walls: [wall('w', [-5, 0], [5, 0], 0.12)] });
    // from (−3, −1) heading 60° towards the wall
    const ps = walk(w, pose([-3, -1], Math.PI / 3), 2);
    const end = last(ps);
    expect(end.pos[1]).toBeCloseTo(-0.06 - W.WALK_RADIUS, 6); // stopped at the wall face
    expect(end.pos[0]).toBeGreaterThan(-3 + 1.4 * 2 * Math.cos(Math.PI / 3) - 0.6); // kept moving along it
    for (const p of ps) expect(p.pos[1]).toBeLessThanOrEqual(-0.06 - W.WALK_RADIUS + 1e-9);
  });

  it('walks through a door opening but not through the wall beside it', () => {
    const w = world({ walls: [doorWall] });
    expect(last(walk(w, pose([1, -1], Math.PI / 2), 2)).pos[1]).toBeGreaterThan(1); // through the door
    expect(last(walk(w, pose([-2, -1], Math.PI / 2), 2)).pos[1]).toBeCloseTo(-0.06 - W.WALK_RADIUS, 6); // wall
    // a little off the door's centre line: guided through by the jamb
    expect(last(walk(w, pose([1.3, -1], Math.PI / 2), 2)).pos[1]).toBeGreaterThan(1);
  });

  it('treats windows, high sills and ghost openings as wall', () => {
    for (const o of [{ type: 'window' as const, sillZ: 0 }, { sillZ: 0.8 }, { isGhost: true }, { status: 'removed' as const }]) {
      const w = world({ walls: [wall('w', [-5, 0], [5, 0], 0.12, [{ offset: 6, width: 1.2, ...o }])] });
      expect(last(walk(w, pose([1, -1], Math.PI / 2), 2)).pos[1], JSON.stringify(o)).toBeLessThan(0);
    }
    expect(W.isPassable({ type: 'glassDoor', isGhost: false, status: 'new', sillZ: 0, headZ: 2.05, width: 1.6 }, 0)).toBe(true);
    expect(W.isPassable({ type: 'opening', isGhost: false, status: 'new', sillZ: 0, headZ: 2.1, width: 1.2 }, 0)).toBe(true);
    expect(W.isPassable({ type: 'window', isGhost: false, status: 'new', sillZ: 0, headZ: 2.1, width: 1.2 }, 0)).toBe(false);
  });

  it('cuts the footprint at the door jambs', () => {
    const pieces = W.wallSolidPieces(doorWall, () => 0);
    expect(pieces).toHaveLength(2);
    const xs = pieces.map((p) => [Math.min(...p.map((q) => q[0])), Math.max(...p.map((q) => q[0]))]);
    expect(xs[0][0]).toBeCloseTo(-5, 9);
    expect(xs[0][1]).toBeCloseTo(0.55, 9);
    expect(xs[1][0]).toBeCloseTo(1.45, 9);
    expect(xs[1][1]).toBeCloseTo(5, 9);
  });

  it('stops at railings and hot tubs, not at a low knee wall it can step over', () => {
    const w = world({
      outdoor: {
        decks: [],
        railings: [{ id: 'd/railing', deckId: 'd', baseZ: 0, height: 1, style: 'glass', panels: [{ a: [-5, 0, 0], b: [5, 0, 0] }], posts: [], isNew: true }],
        steps: [],
        hotTubs: [{ id: 't', centre: [0, -4], diameter: 2, baseZ: 0, rimZ: 1.05, isNew: true }],
      },
    });
    expect(last(walk(w, pose([3, -1], Math.PI / 2), 2)).pos[1]).toBeCloseTo(-W.WALK_RADIUS, 6);
    expect(last(walk(w, pose([0, -1], -Math.PI / 2), 2)).pos[1]).toBeGreaterThan(-3 + W.WALK_RADIUS - 0.05);
    const low = world({ walls: [{ ...wall('w', [-5, 0], [5, 0], 0.12), topZ: 0.3 }] });
    expect(last(walk(low, pose([3, -1], Math.PI / 2), 2)).pos[1]).toBeGreaterThan(1);
  });
});

describe('floor height', () => {
  it('climbs a stair tread by tread and eases the eye; never more than MAX_EYE_LAG below its target', () => {
    // a stair going +x from z 0 to 1.2 in 6 treads of 0.2 m, then a landing
    const treads = Array.from({ length: 6 }, (_, i) => ({ polygon: square(i * 0.25, -0.5, (i + 1) * 0.25, 0.5), z: 0.2 * (i + 1) }));
    const w = world({
      floors: [
        { id: 'low', levelId: 'main', polygon: square(-5, -2, 0, 2), holes: [], z: 0, thickness: 0, material: 'wood', isNew: false, kind: 'room' },
        { id: 'top', levelId: 'main', polygon: square(1.5, -2, 6, 2), holes: [], z: 1.2, thickness: 0.17, material: 'wood', isNew: false, kind: 'room' },
      ],
      structure: [
        {
          id: 's',
          kind: 'stair',
          element: {} as never,
          footprint: square(0, -0.5, 1.5, 0.5),
          fromZ: 0,
          toZ: 1.2,
          upDirection: 'E',
          riser: 0.2,
          going: 0.25,
          treads,
          arrow: { a: [0, 0], b: [1.5, 0] },
          isNew: false,
        },
      ],
    });
    const ps = walk(w, pose([-1, 0], 0), 3);
    const feet = ps.map((p) => p.feetZ);
    for (let i = 1; i < feet.length; i++) expect(feet[i] - feet[i - 1]).toBeLessThanOrEqual(0.2 + 1e-9); // one tread at a time
    expect(last(ps).feetZ).toBeCloseTo(1.2, 9);
    expect(last(ps).pos[0]).toBeGreaterThan(2);
    for (const p of ps) expect(p.eyeZ).toBeGreaterThanOrEqual(W.eyeTargetAt(w, p.pos, p.feetZ) - W.MAX_EYE_LAG - 1e-9);
    // eased: the eye rises less than the feet in the frame of a step, and settles at 1.65 above the landing
    const settled = last(walk(w, last(ps), 1, W.NO_INPUT));
    expect(settled.eyeZ).toBeCloseTo(1.2 + W.WALK_EYE_HEIGHT, 3);
    // a wall of a raised floor (0.6 m, no tread) is not climbed
    const ledge = world({
      floors: [
        { id: 'low', levelId: 'main', polygon: square(-5, -2, 0, 2), holes: [], z: 0, thickness: 0, material: 'wood', isNew: false, kind: 'room' },
        { id: 'high', levelId: 'main', polygon: square(0, -2, 5, 2), holes: [], z: 0.6, thickness: 0, material: 'wood', isNew: false, kind: 'room' },
      ],
    });
    const stopped = last(walk(ledge, pose([-1, 0], 0), 2));
    expect(stopped.pos[0]).toBeLessThanOrEqual(0 + W.EDGE_TOLERANCE);
    expect(stopped.feetZ).toBe(0);
  });

  it('stands on the deck, steps down to the terrain, and is kept off a deck edge too high to climb', () => {
    const deck = {
      id: 'd',
      polygon: square(0, 0, 4, 4),
      vertexIds: ['a', 'b', 'c', 'd'],
      pieces: [[square(0, 0, 4, 4)]],
      topZ: -0.02,
      thickness: 0.15,
      skirtBottomZ: [[-1, -1, -1, -1]],
      boardDirection: 'x' as const,
      isNew: true,
      freeRuns: [],
    };
    // the ground slopes down to the south: z = −0.4 + 0.3·y (−0.4 at the deck's south edge, −1.6 four metres out)
    const ground = (_x: number, y: number) => -0.4 + 0.3 * Math.min(0, y);
    const w = world({ floors: [], outdoor: { decks: [deck], railings: [], steps: [], hotTubs: [] } }, ground);
    const down = walk(w, pose([2, 2], -Math.PI / 2, -0.02), 3);
    expect(down[0].feetZ).toBe(-0.02);
    const end = last(down);
    expect(end.pos[1]).toBeLessThan(-2);
    expect(end.feetZ).toBeCloseTo(ground(end.pos[0], end.pos[1]), 9); // on the terrain, never below it
    for (const p of down) expect(p.feetZ).toBeGreaterThanOrEqual(ground(p.pos[0], p.pos[1]) - 1e-9);
    // back north up the slope: near the edge (ground −0.4) the deck (−0.02) is one step up
    const back = last(walk(w, { ...end, heading: Math.PI / 2 }, 4));
    expect(back.pos[1]).toBeGreaterThan(0.5);
    expect(back.feetZ).toBe(-0.02);
    // with the ground 1.2 m down, the deck edge is a ledge: the walker stays below it, on the terrain
    const low = world({ floors: [], outdoor: { decks: [deck], railings: [], steps: [], hotTubs: [] } }, (_x, y) => (y < 0 ? -1.2 : -0.4));
    const off = last(walk(low, pose([2, 2], -Math.PI / 2, -0.02), 2));
    expect(off.feetZ).toBe(-1.2);
    const blocked = last(walk(low, { ...off, heading: Math.PI / 2 }, 2));
    expect(blocked.pos[1]).toBeLessThanOrEqual(W.EDGE_TOLERANCE);
    expect(blocked.feetZ).toBe(-1.2);
  });

  it('never goes into open water', () => {
    const w = world({ floors: [], site: { trees: [], waterZ: -2 } }, (_x, y) => (y < 0 ? -2.5 : -1));
    const end = last(walk(w, pose([0, 2], -Math.PI / 2, -1), 3));
    expect(end.pos[1]).toBeGreaterThanOrEqual(0 - 1e-9);
  });

  it('ducks under a low ceiling and stays below it', () => {
    const w = world({
      floors: [
        { id: 'f', levelId: 'main', polygon: square(-10, -10, 10, 10), holes: [], z: 0, thickness: 0, material: 'wood', isNew: false, kind: 'room' },
        { id: 'slab', levelId: 'loft', polygon: square(0, -10, 10, 10), holes: [], z: 1.67, thickness: 0.17, material: 'wood', isNew: false, kind: 'slab' },
      ],
    });
    expect(W.eyeTargetAt(w, [-1, 0], 0)).toBeCloseTo(W.WALK_EYE_HEIGHT, 9);
    expect(W.eyeTargetAt(w, [1, 0], 0)).toBeCloseTo(1.5 - W.CEILING_GAP, 9);
    const ps = walk(w, pose([-1, 0], 0), 2);
    for (const p of ps) if (p.pos[0] > 0.05) expect(p.eyeZ).toBeLessThan(1.5);
  });
});

describe('inputs', () => {
  it('joystick vector: dead zone, direction, clamped length', () => {
    expect(W.joystickVector(5, -5, 50)).toEqual({ strafe: 0, forward: 0 }); // inside the dead zone
    const up = W.joystickVector(0, -50, 50);
    expect(up.forward).toBeCloseTo(1, 9);
    expect(up.strafe).toBeCloseTo(0, 9);
    const far = W.joystickVector(300, 0, 50);
    expect(far.strafe).toBeCloseTo(1, 9);
    const diag = W.joystickVector(-30, 30, 50);
    expect(diag.strafe).toBeLessThan(0);
    expect(diag.forward).toBeLessThan(0);
    expect(Math.hypot(diag.strafe, diag.forward)).toBeLessThanOrEqual(1);
    // rescaled from the dead zone's edge
    const half = W.joystickVector(0, -0.575 * 50, 50, 0.15);
    expect(half.forward).toBeCloseTo(0.5, 9);
    expect(W.joystickKnob(80, 60, 50)).toEqual([40, 30]);
    expect(W.joystickKnob(10, 0, 50)).toEqual([10, 0]);
  });

  it('keys: W A S D and arrows, Shift runs; the direction follows the heading', () => {
    const keys = new Set(['KeyW', 'KeyD', 'ShiftLeft']);
    expect(W.keyInput(keys)).toEqual({ forward: 1, strafe: 1, run: true });
    expect(W.keyInput(new Set(['ArrowDown', 'ArrowLeft']))).toEqual({ forward: -1, strafe: -1, run: false });
    // facing +y, «right» is +x
    const d = W.moveDirection(Math.PI / 2, { forward: 0, strafe: 1 });
    expect(d[0]).toBeCloseTo(1, 9);
    expect(d[1]).toBeCloseTo(0, 9);
    const diag = W.moveDirection(0, { forward: 1, strafe: 1 });
    expect(Math.hypot(diag[0], diag[1])).toBeCloseTo(1, 9);
    const run = last(walk(world(), pose([0, 0], 0), 1, { forward: 1, strafe: 0, run: true }));
    expect(run.pos[0]).toBeCloseTo(W.RUN_SPEED, 6);
  });

  it('look: mouse right turns right, up looks up, pitch clamped', () => {
    const p = W.applyLook(pose([0, 0], Math.PI / 2), 100, 0, 0.01);
    expect(p.heading).toBeCloseTo(Math.PI / 2 - 1, 9);
    expect(W.applyLook(p, 0, -1e6, 0.01).pitch).toBe(W.PITCH_LIMIT);
    expect(W.walkFov(16 / 9)).toBeGreaterThanOrEqual(50);
    expect(W.walkFov(0.6)).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// The real seed
// ---------------------------------------------------------------------------

describe('on the Forslag D seed', () => {
  const project = createForslagD();
  const terrain = terrainJson as unknown as TerrainAsset;
  const derived: DerivedVariant = deriveVariant(project.variants[0], project.site, terrain);
  const ground = groundZFn(terrain, project.site, derived.groundWorks);
  const w = W.buildWalkWorld(derived, ground);
  const stue = derived.rooms.find((r) => r.room?.type === 'stue')!;

  it('starts inside the Stue at eye height, facing the terrace through the glass door', () => {
    const s = W.defaultWalkStart(derived, w);
    expect(W.livingRoom(derived)?.id).toBe(stue.id);
    expect(s.feetZ).toBe(0);
    expect(s.eyeZ).toBeCloseTo(W.WALK_EYE_HEIGHT, 9);
    expect(stue.polygon.length).toBeGreaterThan(2);
    // a metre or more back from door-stue-s (x 9.7–11.3 on y = 0), looking out (plan −y, towards the deck and the lake)
    expect(s.pos[0]).toBeGreaterThan(9.7);
    expect(s.pos[0]).toBeLessThan(11.3);
    expect(s.pos[1]).toBeGreaterThan(1);
    expect(Math.cos(s.heading)).toBeCloseTo(0, 6);
    expect(Math.sin(s.heading)).toBeCloseTo(-1, 6);
    // walking straight on goes out through the door onto the deck
    const out = last(walk(w, s, 3));
    expect(out.pos[1]).toBeLessThan(-1);
    expect(out.feetZ).toBe(derived.outdoor.decks[0].topZ);
  });

  it('keeps the glass bump windows (Leseskrok) as walls', () => {
    const p = W.poseAt(w, [7, -0.9], 0, -Math.PI / 2, 0);
    const end = last(walk(w, p, 3));
    expect(end.pos[1]).toBeGreaterThan(-1.84); // the inner face of the bump's south wall
    expect(end.feetZ).toBe(0);
  });

  it('goes down the split-level stair smoothly to the lower floor', () => {
    const p = W.poseAt(w, [6.2, 3.67], 0, Math.PI, 0);
    const ps = walk(w, p, 2.5);
    const end = last(ps);
    expect(end.feetZ).toBe(-1);
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i - 1].feetZ - ps[i].feetZ).toBeLessThanOrEqual(0.17 + 1e-6);
      expect(ps[i - 1].eyeZ - ps[i].eyeZ).toBeLessThan(0.1);
    }
  });

  it('goes down the south deck steps to the terrain and back up', () => {
    const top = W.poseAt(w, [12.3, -3.5], -0.02, -Math.PI / 2, 0);
    const down = last(walk(w, top, 3));
    expect(down.pos[1]).toBeLessThan(-7);
    expect(down.feetZ).toBeCloseTo(ground(down.pos[0], down.pos[1]), 9);
    const up = last(walk(w, { ...down, heading: Math.PI / 2 }, 4));
    expect(up.pos[1]).toBeGreaterThan(-4.6);
    expect(up.feetZ).toBe(-0.02);
  });

  it('starts at the clicked point when entered from a selection', () => {
    const s = W.selectionWalkStart(derived, w, { kind: 'room', id: stue.id }, { point: [13, 1], z: 0 }, [30, -20], 2);
    expect(s).not.toBeNull();
    expect(Math.hypot(s!.pos[0] - 13, s!.pos[1] - 1)).toBeLessThan(0.31);
    expect(s!.heading).toBe(2);
    expect(s!.feetZ).toBe(0);
    // no pick: a selected room's label point
    const r = W.selectionWalkStart(derived, w, { kind: 'room', id: stue.id }, null, [30, -20], 0);
    expect(Math.hypot(r!.pos[0] - stue.labelPoint[0], r!.pos[1] - stue.labelPoint[1])).toBeLessThan(0.25);
    // a selection without a point: none (the caller falls back to the default start)
    expect(W.selectionWalkStart(derived, w, { kind: 'wall', id: 'x' }, null, [0, 0], 0)).toBeNull();
  });
});

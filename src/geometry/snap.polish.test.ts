/**
 * geometry/snap.ts, polish round (phase 2b): the snapped point's displacement in a drag (reach and half-drag rules on
 * |snapped − raw|, no guides from walls on another level), the "Nytt bygg" ghost reaching the whole pointer radius,
 * and contact targets of moved polygons (the drag threshold's reach, pushing an edge back out of a block it entered).
 */
import { describe, expect, it } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import { deriveVariant } from './derive';
import { buildSnapContext, LINE_SNAP_MAX_M, snap, snapPolygon } from './snap';

const project = createForslagD();
const seed = project.variants[0];
const derived = deriveVariant(seed, project.site, null);
const storeyOf = (levelId: string) => seed.levels.find((l) => l.id === levelId)?.storeyId as string;

/** px/m at the laptop's and the phone's starting zoom (UX reviews of 2a). */
const LAPTOP = 23.5;
const PHONE = 11.6;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** A Vedskjul footprint (2 × 1,5 m) with its south-west corner at (x0, y0). */
const shed = (x0: number, y0: number): Vec2[] => [
  [x0, y0],
  [x0 + 2, y0],
  [x0 + 2, y0 + 1.5],
  [x0, y0 + 1.5],
];

describe('point drags: the displacement of the snapped point', () => {
  const wall = seed.walls.find((w) => w.id === 'w-do-109');
  if (!wall) throw new Error('w-do-109 missing');
  const dragCtx = buildSnapContext(derived, { storeyId: storeyOf(wall.levelId), exclude: [wall.id], origin: { point: wall.a, levelId: wall.levelId } });

  it('w-do-109 end a dragged 0.5 / 0.7 m west lands within 0.25 m of the pointer (a lower-floor guide pulled it to x 5.42)', () => {
    for (const scale of [LAPTOP, PHONE]) {
      for (const k of [0.5, 0.7]) {
        const raw: Vec2 = [wall.a[0] - k, wall.a[1]];
        const r = snap(dragCtx, raw, { radius: (scale === PHONE ? 24 : 12) / scale, from: wall.b });
        expect(dist(r.point, raw), `${scale} px/m, ${k} m`).toBeLessThanOrEqual(LINE_SNAP_MAX_M + 1e-9);
        // No guide of w-104-diag (lower level) in a main-level wall's drag.
        expect(r.indicators.some((i) => i.kind === 'extension' && i.a && Math.abs(i.a[0] - 3.05) < 1e-6 && Math.abs(i.a[1] - 4.24) < 1e-6)).toBe(false);
      }
    }
  });

  it('without the drag origin (the Vegg tool) the guides of every level stay', () => {
    const toolCtx = buildSnapContext(derived, { storeyId: storeyOf(wall.levelId), exclude: [wall.id] });
    const all = toolCtx.lines.filter((l) => l.kind === 'wall').map((l) => l.levelId);
    expect(new Set(all).size).toBeGreaterThan(1);
    expect(dragCtx.origin?.levelId).toBe(wall.levelId);
  });

  it('a snap never adds more than half the drag along it, nor takes back more than half', () => {
    // From (6.2, 7.62) a 0.1 m drag west: no target may move the point more than 0.05 m along x.
    const raw: Vec2 = [wall.a[0] - 0.1, wall.a[1]];
    const r = snap(dragCtx, raw, { radius: 12 / LAPTOP, from: wall.b });
    expect(Math.abs(r.point[0] - raw[0])).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});

describe('moved polygons: placement reach and contact targets', () => {
  const ctx = buildSnapContext(derived, { storeyId: 'ground' });
  /** The wing's north wall is y 6.2 for x 16..20.8. */
  const WING_N = 6.2;

  it('the "Nytt bygg" ghost (no drag) attaches 0.4 m from the wing\'s north wall at the phone\'s zoom (24 px)', () => {
    const r = snapPolygon(ctx, shed(17.4, WING_N + 0.4), { radius: 24 / PHONE });
    expect(r.delta[1]).toBeCloseTo(-0.4, 9);
    // The laptop's 12 px at 23,5 px/m are 0.51 m: it attaches there too.
    expect(snapPolygon(ctx, shed(17.4, WING_N + 0.4), { radius: 12 / LAPTOP }).delta[1]).toBeCloseTo(-0.4, 9);
  });

  it('a ghost overlapping the wing is pushed out against its wall rather than aligned elsewhere', () => {
    const r = snapPolygon(ctx, shed(17.4, WING_N - 0.3), { radius: 24 / PHONE });
    expect(r.delta[1]).toBeCloseTo(0.3, 9);
  });

  it('in a drag a contact target reaches the drag threshold; other targets keep 0.25 m', () => {
    const start = shed(17.4, WING_N + 1.4);
    const dragCtx = buildSnapContext(derived, { storeyId: 'ground', origin: { polygon: start } });
    const moved = start.map((p): Vec2 => [p[0], p[1] - 1]); // 1 m south: 0.4 m short of the wall
    const threshold = 10 / PHONE;
    expect(snapPolygon(dragCtx, moved, { radius: 24 / PHONE }).delta[1]).toBeCloseTo(0, 9);
    expect(snapPolygon(dragCtx, moved, { radius: 24 / PHONE, contactReach: threshold }).delta[1]).toBeCloseTo(-0.4, 9);
  });

  it('in a drag an edge that entered the wing is pushed back out against its wall (up to the reach, never past the start)', () => {
    const start = shed(17.4, WING_N + 0.4);
    const dragCtx = buildSnapContext(derived, { storeyId: 'ground', origin: { polygon: start } });
    const moved = start.map((p): Vec2 => [p[0], p[1] - 1]); // 0.6 m into the wing
    const r = snapPolygon(dragCtx, moved, { radius: 24 / PHONE, contactReach: 10 / PHONE });
    expect(moved[0][1] + r.delta[1]).toBeCloseTo(WING_N, 9);
    // Without the contact reach (0.25 m) it cannot: the drag rules keep it where the pointer put it.
    expect(snapPolygon(dragCtx, moved, { radius: 24 / PHONE }).delta[1]).toBeCloseTo(0, 9);
    // A deck edge is no block: a unit may stand on the deck (no push-out across a deck edge).
    const deckCtx = buildSnapContext(derived, { storeyId: 'ground', origin: { polygon: shed(13, 12.5) } });
    const onto = shed(13, 11.5); // 0.6 m over the deck's north edge (y 12.1) from outside
    expect(snapPolygon(deckCtx, onto, { radius: 24 / PHONE, contactReach: 10 / PHONE }).delta[1]).toBeCloseTo(0, 9);
  });
});

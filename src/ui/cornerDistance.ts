/**
 * "Avstand fra hjørne" of an opening (docs/phase2-plan.md §3.7): from the inner face of the nearer crossing wall to
 * the near edge of the opening, measured along the opening's host. Pure, unit-tested on the seed.
 *
 * Host coordinates: s = distance from the STORED host's start along it (block edge from its start vertex, stored
 * wall from `a`), the same frame as `Opening.offset`, so a new distance turns straight into a new stored offset for
 * `moveOpening`.
 *
 * Crossing walls: every derived wall that is not a ghost, not a divider, not the host itself (for a block edge: no
 * piece of that edge), stands on the opening's level (`levelIds`), runs at least 20° off the host direction, and
 * whose reference segment, extended by the host's thickness + 5 cm (a partition may stop at the host's inner face),
 * reaches the host line within the host's extent (± the crossing wall's thickness + 5 cm, for the walls meeting at a
 * corner). Each crossing wall's body along the host is the interval between its two face lines; walls before the
 * opening measure to the opening's start edge, walls after it to its end edge; walls through the opening are skipped.
 * The nearest one wins (ties: the one before the opening).
 */
import type { DerivedOpening, DerivedVariant, DerivedWall } from '../model/derived';
import type { Id, Vec2 } from '../model/types';

export interface CornerDistance {
  /** Distance (m) from the crossing wall's face to the opening's near edge (≥ 0 unless they overlap slightly). */
  distance: number;
  /** 'start': the crossing wall is on the host-start side of the opening; 'end': on the host-end side. */
  side: 'start' | 'end';
  /** Host coordinate of the crossing wall's face towards the opening. */
  face: number;
  crossingWallId: Id;
  /** Temporary dimension (plan): from the face to the near edge, drawn just inside the host's left face. */
  a: Vec2;
  b: Vec2;
}

export interface HostLine {
  a: Vec2;
  b: Vec2;
  /** Ids of derived walls that are the host itself. */
  isHost: (w: DerivedWall) => boolean;
  /** Reach of the host's faces from its reference line (m). */
  reach: number;
  faceLeft: number;
}

const MIN_SIN = Math.sin((20 * Math.PI) / 180);
const TOL = 0.005;

/** The stored host of an opening as a line in plan coordinates, or null when it cannot be found. */
export function hostLineOf(derived: Pick<DerivedVariant, 'blocks' | 'walls'>, opening: DerivedOpening, hostWall: DerivedWall): HostLine | null {
  const host = opening.opening.host;
  const reach = Math.max(hostWall.faceLeft, hostWall.faceRight);
  if (host.kind === 'blockEdge') {
    const block = derived.blocks.find((b) => b.block.id === host.blockId);
    const edge = block?.edges.find((e) => e.edgeId === host.edgeId);
    if (!edge) return null;
    return {
      a: edge.a,
      b: edge.b,
      isHost: (w) => w.source.kind === 'blockEdge' && w.source.blockId === host.blockId && w.source.edgeId === host.edgeId,
      reach,
      faceLeft: hostWall.faceLeft,
    };
  }
  const wall = derived.walls.find((w) => w.id === host.wallId) ?? hostWall;
  return { a: wall.a, b: wall.b, isHost: (w) => w.id === host.wallId, reach, faceLeft: wall.faceLeft };
}

export function cornerDistance(
  derived: Pick<DerivedVariant, 'blocks' | 'walls'>,
  opening: DerivedOpening,
  hostWall: DerivedWall,
): CornerDistance | null {
  const line = hostLineOf(derived, opening, hostWall);
  if (!line) return null;
  const L = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
  if (L < 1e-6) return null;
  const u: Vec2 = [(line.b[0] - line.a[0]) / L, (line.b[1] - line.a[1]) / L];
  const n: Vec2 = [-u[1], u[0]];
  const off = opening.opening.offset;
  const half = opening.opening.width / 2;
  const e0 = off - half;
  const e1 = off + half;
  let best: { distance: number; side: 'start' | 'end'; face: number; id: Id } | null = null;

  for (const w of derived.walls) {
    if (w.isGhost || w.isDivider || line.isHost(w)) continue;
    if (!w.levelIds.includes(opening.levelId)) continue;
    const lw = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (lw < 1e-6) continue;
    const d: Vec2 = [(w.b[0] - w.a[0]) / lw, (w.b[1] - w.a[1]) / lw];
    const nw: Vec2 = [-d[1], d[0]];
    const un = u[0] * nw[0] + u[1] * nw[1]; // = sin of the angle between the host and the wall
    if (Math.abs(un) < MIN_SIN) continue;
    // Host line ∩ wall line: s along the host, t along the wall.
    const rel: Vec2 = [line.a[0] - w.a[0], line.a[1] - w.a[1]];
    const sC = -(rel[0] * nw[0] + rel[1] * nw[1]) / un;
    const p: Vec2 = [line.a[0] + sC * u[0], line.a[1] + sC * u[1]];
    const tC = (p[0] - w.a[0]) * d[0] + (p[1] - w.a[1]) * d[1];
    const ext = line.reach + 0.05;
    if (tC < -ext || tC > lw + ext) continue;
    const wallReach = Math.max(w.faceLeft, w.faceRight) / Math.abs(un) + 0.05;
    if (sC < -wallReach || sC > L + wallReach) continue;
    const sL = sC + w.faceLeft / un;
    const sR = sC - w.faceRight / un;
    const bodyMin = Math.min(sL, sR);
    const bodyMax = Math.max(sL, sR);
    let cand: { distance: number; side: 'start' | 'end'; face: number } | null = null;
    if (bodyMax <= e0 + TOL) cand = { distance: e0 - bodyMax, side: 'start', face: bodyMax };
    else if (bodyMin >= e1 - TOL) cand = { distance: bodyMin - e1, side: 'end', face: bodyMin };
    if (!cand) continue;
    if (!best || cand.distance < best.distance - 1e-9) best = { ...cand, id: w.id };
  }
  if (!best) return null;
  const near = best.side === 'start' ? e0 : e1;
  const inset = line.faceLeft + 0.15;
  const at = (s: number): Vec2 => [line.a[0] + s * u[0] + inset * n[0], line.a[1] + s * u[1] + inset * n[1]];
  return { distance: Math.max(0, best.distance), side: best.side, face: best.face, crossingWallId: best.id, a: at(best.face), b: at(near) };
}

/** Stored offset (host start → centre) that puts the near edge `distance` m from the crossing wall's face. */
export function offsetForCornerDistance(cd: Pick<CornerDistance, 'side' | 'face'>, width: number, distance: number): number {
  return cd.side === 'start' ? cd.face + distance + width / 2 : cd.face - distance - width / 2;
}

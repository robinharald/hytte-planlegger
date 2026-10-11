import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../model/types';
import { buildPlanarGraph, extractFaces } from './planarGraph';
import type { GraphSegment, PlanarGraph } from './planarGraph';
import { signedArea } from './polygon';

const seg = (id: string, a: Vec2, b: Vec2): GraphSegment => ({ id, a, b });

/** Closed polyline through the points as segments `${prefix}0`, `${prefix}1`, … */
function loop(prefix: string, pts: Vec2[]): GraphSegment[] {
  return pts.map((p, i) => seg(`${prefix}${i}`, p, pts[(i + 1) % pts.length]));
}

const square = (prefix: string, x0: number, y0: number, x1: number, y1: number): GraphSegment[] =>
  loop(prefix, [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);

function edgeBetween(g: PlanarGraph, p: Vec2, q: Vec2, tol = 1e-9) {
  const near = (n: number, r: Vec2) => Math.hypot(g.nodes[n][0] - r[0], g.nodes[n][1] - r[1]) <= tol;
  return g.edges.find((e) => (near(e.from, p) && near(e.to, q)) || (near(e.from, q) && near(e.to, p)));
}

function nodeNear(g: PlanarGraph, p: Vec2, tol = 1e-9): number {
  return g.nodes.findIndex((n) => Math.hypot(n[0] - p[0], n[1] - p[1]) <= tol);
}

function degree(g: PlanarGraph, n: number): number {
  return g.edges.filter((e) => e.from === n || e.to === n).length;
}

function components(g: PlanarGraph): number {
  const parent = g.nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of g.edges) parent[find(e.from)] = find(e.to);
  return new Set(parent.map((_, i) => find(i))).size;
}

function boundedFaces(g: PlanarGraph) {
  return extractFaces(g).filter((f) => !f.isOuter);
}

describe('buildPlanarGraph — basics', () => {
  it('returns an empty graph for no segments', () => {
    expect(buildPlanarGraph([])).toEqual({ nodes: [], edges: [], dangling: [] });
  });

  it('builds a square with 4 nodes and 4 edges', () => {
    const g = buildPlanarGraph(square('s', 0, 0, 4, 3));
    expect(g.nodes).toHaveLength(4);
    expect(g.edges).toHaveLength(4);
    expect(g.dangling).toEqual([]);
    for (const e of g.edges) expect(e.from).toBeLessThan(e.to);
    for (let n = 0; n < 4; n++) expect(degree(g, n)).toBe(2);
  });

  it('splits crossing segments at their intersection', () => {
    const g = buildPlanarGraph([
      ...square('s', 0, 0, 2, 2),
      seg('d1', [0, 0], [2, 2]),
      seg('d2', [2, 0], [0, 2]),
    ]);
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(8);
    const c = nodeNear(g, [1, 1]);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(degree(g, c)).toBe(4);
  });

  it('splits at T-junctions and keeps the junction node exactly on the through wall', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [3, 0], [3, 4])]);
    expect(g.dangling).toEqual([]);
    expect(g.edges).toHaveLength(7);
    expect(edgeBetween(g, [0, 0], [3, 0])?.segmentIds).toEqual(['s0']);
    expect(edgeBetween(g, [3, 0], [6, 0])?.segmentIds).toEqual(['s0']);
    expect(edgeBetween(g, [3, 0], [3, 4])?.segmentIds).toEqual(['t']);
  });

  it('connects a T-junction whose end is within eps of the other wall (no snapping needed)', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [3, 0.006], [3, 3.996])], { snap: 0 });
    expect(g.dangling).toEqual([]);
    expect(boundedFaces(g)).toHaveLength(2);
  });

  it('merges a fully contained collinear segment into ONE edge carrying both ids', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 4, 2), seg('o', [1, 0], [3, 0])]);
    expect(g.edges).toHaveLength(6);
    expect(edgeBetween(g, [1, 0], [3, 0])?.segmentIds).toEqual(['s0', 'o']);
    expect(edgeBetween(g, [0, 0], [1, 0])?.segmentIds).toEqual(['s0']);
    expect(edgeBetween(g, [3, 0], [4, 0])?.segmentIds).toEqual(['s0']);
  });

  it('merges partial and reversed collinear overlaps', () => {
    const g = buildPlanarGraph([seg('a', [0, 0], [3, 0]), seg('b', [5, 0], [2, 0])], { snap: 0 });
    // Everything dangles (open polyline), so inspect before pruning by closing it into a loop instead.
    expect(g.dangling).toEqual(['a', 'b']);
    const closed = buildPlanarGraph([
      seg('a', [0, 0], [3, 0]),
      seg('b', [5, 0], [2, 0]),
      seg('c', [5, 0], [5, 1]),
      seg('d', [5, 1], [0, 1]),
      seg('e', [0, 1], [0, 0]),
    ]);
    expect(closed.dangling).toEqual([]);
    expect(edgeBetween(closed, [0, 0], [2, 0])?.segmentIds).toEqual(['a']);
    expect(edgeBetween(closed, [2, 0], [3, 0])?.segmentIds).toEqual(['a', 'b']);
    expect(edgeBetween(closed, [3, 0], [5, 0])?.segmentIds).toEqual(['b']);
  });

  it('merges nearly collinear overlaps (5 mm apart) into shared edges', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 10, 3), seg('o', [3, 0.005], [6, 0.005])]);
    const shared = g.edges.filter((e) => e.segmentIds.includes('o'));
    expect(shared).toHaveLength(1);
    expect(shared[0].segmentIds).toEqual(['s0', 'o']);
    expect(boundedFaces(g)).toHaveLength(1);
  });

  it('merges nodes within eps and keeps the first endpoint as the node position', () => {
    const g = buildPlanarGraph([
      seg('a', [0, 0], [1, 0]),
      seg('b', [1.005, 0.003], [1, 1]),
      seg('c', [1, 1], [0, 0]),
    ]);
    expect(g.nodes).toHaveLength(3);
    expect(nodeNear(g, [1, 0])).toBeGreaterThanOrEqual(0);
    expect(boundedFaces(g)).toHaveLength(1);
  });

  it('respects a custom eps', () => {
    const segs = [seg('a', [0, 0], [1, 0]), seg('b', [1.03, 0], [1, 1]), seg('c', [1, 1], [0, 0])];
    expect(buildPlanarGraph(segs, { eps: 0.05, snap: 0 }).dangling).toEqual([]);
    expect(buildPlanarGraph(segs, { eps: 0.01, snap: 0 }).dangling).toEqual(['a', 'b', 'c']);
  });
});

describe('buildPlanarGraph — snapping and dangling edges', () => {
  it('snaps a free end 3 cm short onto the wall and splits that wall there', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [3, 0], [3, 3.97])]);
    expect(g.dangling).toEqual([]);
    const top = nodeNear(g, [3, 4]);
    expect(top).toBeGreaterThanOrEqual(0); // moved exactly onto the wall line
    expect(degree(g, top)).toBe(3);
    expect(edgeBetween(g, [6, 4], [3, 4])?.segmentIds).toEqual(['s2']);
    expect(edgeBetween(g, [3, 4], [0, 4])?.segmentIds).toEqual(['s2']);
    expect(boundedFaces(g)).toHaveLength(2);
  });

  it('snaps free ends exactly 5 cm away (floating-point slack) but not 6 cm away', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [2.6, 0.05], [2.6, 3.95])]);
    expect(g.dangling).toEqual([]);
    expect(nodeNear(g, [2.6, 0])).toBeGreaterThanOrEqual(0);
    expect(nodeNear(g, [2.6, 4], 1e-12)).toBeGreaterThanOrEqual(0);
    const g2 = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [2.6, 0.06], [2.6, 3.94])]);
    expect(g2.dangling).toEqual(['t']);
  });

  it('merges a snapped end into the node its projection lands on instead of splitting next to it', () => {
    const g = buildPlanarGraph([
      ...square('s', 0, 0, 4, 3),
      seg('u', [0, 1.5], [2, 1.5]),
      seg('v', [2, 1.5], [4, 1.5]),
      seg('t', [2, 3], [2, 1.53]),
    ]);
    expect(g.dangling).toEqual([]);
    expect(g.nodes).toHaveLength(8);
    const junction = nodeNear(g, [2, 1.5]);
    expect(degree(g, junction)).toBe(3);
    expect(boundedFaces(g).map((f) => f.area).sort((x, y) => x - y)).toEqual([3, 3, 6]);
  });

  it('moves the free end that comes first in node order when two free ends meet at a corner', () => {
    // Both a's start (0,0) and d's end (0,0.03) are free; node (0,0) was created first and snaps onto d.
    const g = buildPlanarGraph([
      seg('a', [0, 0], [4, 0]),
      seg('b', [4, 0], [4, 3]),
      seg('c', [4, 3], [0, 3]),
      seg('d', [0, 3], [0, 0.03]),
    ]);
    expect(g.dangling).toEqual([]);
    expect(g.nodes).toHaveLength(4);
    expect(nodeNear(g, [0, 0.03])).toBeGreaterThanOrEqual(0);
    expect(boundedFaces(g)[0].area).toBeCloseTo(12 - 0.06, 12);
  });

  it('closes a 3 cm gap between two collinear free ends', () => {
    const g = buildPlanarGraph([
      seg('a', [0, 0], [2.985, 0]),
      seg('b', [3.015, 0], [6, 0]),
      seg('c', [6, 0], [6, 2]),
      seg('d', [6, 2], [0, 2]),
      seg('e', [0, 2], [0, 0]),
    ]);
    expect(g.dangling).toEqual([]);
    expect(boundedFaces(g)).toHaveLength(1);
  });

  it('folds a 3 cm overshoot back onto the crossing (no stub, no warning)', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [3, 0], [3, 4.03])]);
    expect(g.dangling).toEqual([]);
    expect(g.nodes).toHaveLength(6);
    expect(g.edges).toHaveLength(7);
  });

  it('reports a wall 10 cm short as dangling and removes its edge', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [3, 0], [3, 3.9])]);
    expect(g.dangling).toEqual(['t']);
    expect(g.edges.some((e) => e.segmentIds.includes('t'))).toBe(false);
    expect(g.nodes).toHaveLength(5); // the T-node on the south wall stays (degree 2)
    expect(boundedFaces(g)).toHaveLength(1);
  });

  it('removes dangling chains iteratively and reports every segment of the chain', () => {
    const g = buildPlanarGraph([
      ...square('s', 0, 0, 6, 4),
      seg('c1', [3, 0], [3, 2]),
      seg('c2', [3, 2], [4, 3]),
      seg('c3', [4, 3], [4.5, 3]),
    ]);
    expect(g.dangling).toEqual(['c1', 'c2', 'c3']);
    expect(g.edges.every((e) => e.segmentIds.every((id) => id.startsWith('s')))).toBe(true);
  });

  it('reports a wall whose end sticks out 20 cm but keeps its bounding part', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [3, 0], [3, 4.2])]);
    expect(g.dangling).toEqual(['t']);
    expect(edgeBetween(g, [3, 0], [3, 4])?.segmentIds).toEqual(['t']);
    expect(boundedFaces(g)).toHaveLength(2);
  });

  it('reports isolated, zero-length and non-finite segments', () => {
    const g = buildPlanarGraph([
      ...square('s', 0, 0, 2, 2),
      seg('lonely', [5, 5], [7, 5]),
      seg('zero', [1, 1], [1, 1]),
      seg('tiny', [1, 1], [1.005, 1]),
      seg('nan', [Number.NaN, 0], [1, 1]),
    ]);
    expect(g.dangling).toEqual(['lonely', 'zero', 'tiny', 'nan']);
    expect(g.nodes).toHaveLength(4);
  });

  it('reports duplicate ids once and only isolated-node-free graphs', () => {
    const g = buildPlanarGraph([seg('x', [0, 0], [1, 0]), seg('x', [5, 0], [6, 0])]);
    expect(g.dangling).toEqual(['x']);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it('does not snap when snap is 0', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [3, 0], [3, 3.97])], { snap: 0 });
    expect(g.dangling).toEqual(['t']);
  });

  it('is deterministic', () => {
    const segs = [...square('s', 0, 0, 6, 4), seg('t', [3, 0], [3, 3.97]), seg('u', [0, 2], [6, 2])];
    expect(buildPlanarGraph(segs)).toEqual(buildPlanarGraph(segs));
  });
});

describe('extractFaces', () => {
  it('returns no faces for an empty graph', () => {
    expect(extractFaces({ nodes: [], edges: [], dangling: [] })).toEqual([]);
  });

  it('finds the inner CCW face and the outer CW face of a square', () => {
    const g = buildPlanarGraph(square('s', 0, 0, 4, 3));
    const faces = extractFaces(g);
    expect(faces).toHaveLength(2);
    const inner = faces.find((f) => !f.isOuter);
    const outer = faces.find((f) => f.isOuter);
    expect(inner?.area).toBeCloseTo(12, 12);
    expect(signedArea(inner?.polygon ?? [])).toBeGreaterThan(0);
    expect(outer?.area).toBeCloseTo(12, 12);
    expect(signedArea(outer?.polygon ?? [])).toBeLessThan(0);
  });

  it('fills nodeIndices / edgeIndices consistently with the polygon', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 6, 4), seg('t', [3, 0], [3, 4])]);
    for (const f of extractFaces(g)) {
      expect(f.nodeIndices).toHaveLength(f.polygon.length);
      expect(f.edgeIndices).toHaveLength(f.polygon.length);
      f.nodeIndices.forEach((n, i) => {
        expect(f.polygon[i]).toEqual(g.nodes[n]);
        const e = g.edges[f.edgeIndices[i]];
        const next = f.nodeIndices[(i + 1) % f.nodeIndices.length];
        expect([e.from, e.to].sort()).toEqual([n, next].sort());
      });
    }
  });

  it('uses every edge exactly twice (once per side)', () => {
    const g = buildPlanarGraph([...square('s', 0, 0, 2, 2), seg('d1', [0, 0], [2, 2]), seg('d2', [2, 0], [0, 2])]);
    const uses = new Array<number>(g.edges.length).fill(0);
    for (const f of extractFaces(g)) for (const e of f.edgeIndices) uses[e]++;
    expect(uses.every((u) => u === 2)).toBe(true);
    const bounded = boundedFaces(g);
    expect(bounded).toHaveLength(4);
    for (const f of bounded) expect(f.area).toBeCloseTo(1, 12);
  });

  it('gives one outer face per connected component', () => {
    const g = buildPlanarGraph([...square('a', 0, 0, 2, 2), ...square('b', 5, 0, 7, 3)]);
    const faces = extractFaces(g);
    expect(faces.filter((f) => f.isOuter)).toHaveLength(2);
    expect(faces.filter((f) => !f.isOuter).map((f) => f.area).sort()).toEqual([4, 6]);
  });

  it('walks a bridge twice in the same face (weakly simple polygon with the right area)', () => {
    const g = buildPlanarGraph([...square('o', 0, 0, 8, 6), ...square('i', 3, 2, 5, 4), seg('br', [4, 0], [4, 2])]);
    const bounded = boundedFaces(g);
    expect(bounded.map((f) => f.area).sort((x, y) => x - y)).toEqual([4, 44]);
    const big = bounded.find((f) => f.area > 10);
    const brEdge = g.edges.findIndex((e) => e.segmentIds.includes('br'));
    expect(big?.edgeIndices.filter((e) => e === brEdge)).toHaveLength(2);
  });

  it('ignores self-loops and coincident nodes in hand-built graphs', () => {
    const faces = extractFaces({
      nodes: [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 1],
      ],
      edges: [
        { from: 0, to: 1, segmentIds: ['a'] },
        { from: 1, to: 2, segmentIds: ['b'] },
        { from: 2, to: 0, segmentIds: ['c'] },
        { from: 1, to: 1, segmentIds: ['loop'] },
        { from: 2, to: 3, segmentIds: ['zero'] },
      ],
      dangling: [],
    });
    expect(faces).toHaveLength(2);
    expect(faces.find((f) => !f.isOuter)?.area).toBeCloseTo(0.5, 12);
  });
});

describe('robustness', () => {
  /** n × n grid of unit cells, every cell edge a segment, plus long lines overlapping all of them. */
  function gridSegments(n: number): GraphSegment[] {
    const segs: GraphSegment[] = [];
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j < n; j++) {
        segs.push(seg(`h${i}-${j}`, [j, i], [j + 1, i]));
        segs.push(seg(`v${i}-${j}`, [i, j], [i, j + 1]));
      }
      segs.push(seg(`H${i}`, [n, i], [0, i]));
      segs.push(seg(`V${i}`, [i, 0], [i, n]));
    }
    return segs;
  }

  it('handles ~130 overlapping segments of a 7 × 7 grid (Euler, areas, shared ids)', () => {
    const segs = gridSegments(7);
    expect(segs.length).toBe(128);
    const t0 = performance.now();
    const g = buildPlanarGraph(segs);
    const faces = extractFaces(g);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    expect(g.dangling).toEqual([]);
    expect(g.nodes).toHaveLength(64);
    expect(g.edges).toHaveLength(112);
    for (const e of g.edges) expect(e.segmentIds).toHaveLength(2);
    // Euler: V − E + F = 1 + C (F counts every component's outer face).
    expect(g.nodes.length - g.edges.length + faces.length).toBe(1 + components(g));
    const bounded = faces.filter((f) => !f.isOuter);
    expect(bounded).toHaveLength(49);
    for (const f of bounded) expect(f.area).toBeCloseTo(1, 9);
  });

  it('handles 120 long crossing lines (60 × 60 grid with jittered ends)', () => {
    const segs: GraphSegment[] = [];
    for (let i = 0; i < 60; i++) {
      const j = ((i * 7) % 5) * 0.002; // ends up to 8 mm off
      segs.push(seg(`x${i}`, [i * 0.5, -j], [i * 0.5, 29.5 + j]));
      segs.push(seg(`y${i}`, [-j, i * 0.5], [29.5 + j, i * 0.5]));
    }
    const g = buildPlanarGraph(segs);
    const faces = extractFaces(g);
    expect(g.dangling).toEqual([]);
    expect(g.nodes.length - g.edges.length + faces.length).toBe(1 + components(g));
    const bounded = faces.filter((f) => !f.isOuter);
    expect(bounded).toHaveLength(59 * 59);
    for (const f of bounded) expect(Math.abs(f.area - 0.25)).toBeLessThan(0.01);
    // The bounded faces tile the outer face exactly (the jittered ends become its boundary nodes).
    const total = bounded.reduce((s, f) => s + f.area, 0);
    const outer = faces.filter((f) => f.isOuter);
    expect(outer).toHaveLength(1);
    expect(total).toBeCloseTo(outer[0].area, 6);
    expect(Math.abs(total - 29.5 * 29.5)).toBeLessThan(1);
  });
});

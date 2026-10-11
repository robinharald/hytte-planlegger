/**
 * Planar graph of wall reference lines and its faces — room detection, docs/architecture.md "Derivation pipeline"
 * step 4. Pure functions (no React, no three), plan frame, metres.
 *
 * buildPlanarGraph(segments, { eps = 0.01, snap = 0.05 })
 *  1. Segments not longer than `eps` (or with non-finite coordinates) get no edge.
 *  2. Split points of every segment: its endpoints, every crossing / touching point with another segment
 *     (`segmentIntersection`), and the projection of every other segment's endpoint that lies within `eps` of it
 *     (T-junctions, and the ends of collinear overlaps).
 *  3. Nodes: points are merged greedily within `eps`. All segment endpoints are inserted first (input order), so
 *     wall endpoints are the node positions; a later point joins the NEAREST existing node within `eps`.
 *  4. Edges: the split points of a segment, sorted along it and mapped to nodes, form a node chain (a chain that
 *     returns to a node it already visited is cut back, so jitter inside one node cluster never leaves spurs).
 *     Edges are keyed by their unordered node pair, so a shared sub-segment of overlapping segments is ONE edge
 *     carrying all their ids (in input order).
 *  5. Snap (repeated until stable): a node of degree 1 that lies within `snap` of an edge not incident to it is
 *     projected onto the nearest such edge, which is split there; when the projection lies within `eps` of an end
 *     of that edge the node is merged into that end instead. A free end 3 cm short of a wall closes; a 3 cm
 *     overshoot past a crossing folds back onto the crossing and disappears. Nodes are visited in creation order,
 *     so when two free ends are within `snap` of each other's walls, the one created first moves.
 *  6. Dangling edges are removed iteratively (the edge of a degree-1 node, until none is left). `dangling` lists,
 *     in input order and without duplicates, every segment id that lost an edge this way or has no edge at all
 *     (degenerate or collapsed segments). This includes walls that still bound rooms but have a free end sticking
 *     out more than `snap`.
 *  7. Isolated nodes are dropped; the remaining nodes keep their creation order. Edge `from` < `to`.
 *  Known limits: a snapped node moves by at most `snap` without re-checking crossings with other edges; node
 *  merging is greedy (no transitive chains).
 *
 * extractFaces(graph)
 *  Half-edge walk. Outgoing half-edges are sorted by angle around each node; after arriving at node v along u→v
 *  the walk continues with the outgoing half-edge that comes first CLOCKWISE from v→u (the sharpest left turn,
 *  i.e. the smallest clockwise rotation from the reverse direction). The face is therefore always on the LEFT:
 *  bounded faces come out CCW (positive signed area) and the unbounded face of every connected component comes
 *  out CW. `isOuter` = signed area ≤ 0. `area` is the absolute shoelace area. A component lying inside a bounded
 *  face of another component has its own CW outer face (a hole of that face; rooms.ts handles it). Bridges are
 *  walked twice by the same face (weakly simple polygon). Edges whose two nodes coincide are ignored.
 */
import type { Vec2 } from '../model/types';
import { distancePointSegment, projectPointOnSegment, segmentIntersection, signedArea } from './polygon';

export interface GraphSegment {
  id: string;
  a: Vec2;
  b: Vec2;
}

export interface PlanarGraph {
  nodes: Vec2[];
  edges: { from: number; to: number; segmentIds: string[] }[];
  dangling: string[];
}

export interface Face {
  polygon: Vec2[];
  nodeIndices: number[];
  edgeIndices: number[];
  area: number;
  isOuter: boolean;
}

const DEFAULT_EPS = 0.01;
const DEFAULT_SNAP = 0.05;
/** Slack on eps / snap comparisons: a gap of exactly 0.05 m (0.0499… in floating point) still snaps. */
const TOL = 1e-9;

// ---------------------------------------------------------------------------
// Mutable working graph (internal)
// ---------------------------------------------------------------------------

interface WorkEdge {
  a: number;
  b: number;
  ids: string[];
}

interface WorkGraph {
  eps: number;
  nodes: Vec2[];
  /** Keys of the edges incident to each node. */
  adj: Set<string>[];
  edges: Map<string, WorkEdge>;
}

function dist(p: Vec2, q: Vec2): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function otherEnd(e: WorkEdge, n: number): number {
  return e.a === n ? e.b : e.a;
}

/** Node for point p: the nearest node within eps, else a new one. */
function nodeAt(g: WorkGraph, p: Vec2): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const d = dist(g.nodes[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best >= 0 && bestD <= g.eps + TOL) return best;
  g.nodes.push([p[0], p[1]]);
  g.adj.push(new Set());
  return g.nodes.length - 1;
}

/** Adds edge a–b (merging ids into an existing edge between the same nodes). Self-loops are dropped. */
function addEdge(g: WorkGraph, a: number, b: number, ids: readonly string[]): void {
  if (a === b) return;
  const key = edgeKey(a, b);
  const existing = g.edges.get(key);
  if (existing) {
    for (const id of ids) if (!existing.ids.includes(id)) existing.ids.push(id);
    return;
  }
  g.edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), ids: [...ids] });
  g.adj[a].add(key);
  g.adj[b].add(key);
}

function removeEdge(g: WorkGraph, key: string): WorkEdge | undefined {
  const e = g.edges.get(key);
  if (!e) return undefined;
  g.edges.delete(key);
  g.adj[e.a].delete(key);
  g.adj[e.b].delete(key);
  return e;
}

/** Re-attaches every edge of node n to node `into` (n becomes isolated). */
function mergeNode(g: WorkGraph, n: number, into: number): void {
  for (const key of [...g.adj[n]]) {
    const e = removeEdge(g, key);
    if (e) addEdge(g, into, otherEnd(e, n), e.ids);
  }
}

// ---------------------------------------------------------------------------
// buildPlanarGraph
// ---------------------------------------------------------------------------

function isUsable(s: GraphSegment, eps: number): boolean {
  const finite = [s.a[0], s.a[1], s.b[0], s.b[1]].every(Number.isFinite);
  return finite && dist(s.a, s.b) > eps;
}

function boxesOverlap(s: GraphSegment, t: GraphSegment, eps: number): boolean {
  return (
    Math.min(s.a[0], s.b[0]) - eps <= Math.max(t.a[0], t.b[0]) &&
    Math.min(t.a[0], t.b[0]) - eps <= Math.max(s.a[0], s.b[0]) &&
    Math.min(s.a[1], s.b[1]) - eps <= Math.max(t.a[1], t.b[1]) &&
    Math.min(t.a[1], t.b[1]) - eps <= Math.max(s.a[1], s.b[1])
  );
}

/** Pushes onto `out` the projections onto `onto` of the endpoints of `from` that lie within eps of it. */
function addEndpointProjections(out: Vec2[], onto: GraphSegment, from: GraphSegment, eps: number): void {
  for (const p of [from.a, from.b]) {
    if (distancePointSegment(p, onto.a, onto.b) <= eps + TOL) out.push(projectPointOnSegment(p, onto.a, onto.b).point);
  }
}

/** Split points of every segment (endpoints, crossings, nearby endpoints of the others), unsorted. */
function collectSplitPoints(segs: GraphSegment[], eps: number): Vec2[][] {
  const pts: Vec2[][] = segs.map((s) => [s.a, s.b]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const si = segs[i];
      const sj = segs[j];
      if (!boxesOverlap(si, sj, eps)) continue;
      const x = segmentIntersection(si.a, si.b, sj.a, sj.b);
      if (x) {
        pts[i].push(x.point);
        pts[j].push(x.point);
      }
      addEndpointProjections(pts[i], si, sj, eps);
      addEndpointProjections(pts[j], sj, si, eps);
    }
  }
  return pts;
}

/** Node chain of one segment: split points sorted along it, mapped to nodes, loops cut back. */
function nodeChain(g: WorkGraph, s: GraphSegment, points: Vec2[]): number[] {
  const dx = s.b[0] - s.a[0];
  const dy = s.b[1] - s.a[1];
  const sorted = points
    .map((p) => ({ p, t: (p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy }))
    .sort((u, v) => u.t - v.t);
  const chain: number[] = [];
  for (const { p } of sorted) {
    const n = nodeAt(g, p);
    const seen = chain.lastIndexOf(n);
    if (seen >= 0) chain.length = seen + 1;
    else chain.push(n);
  }
  return chain;
}

/** Snaps one degree-1 node (see header, step 5). Returns true when the graph changed. */
function snapNode(g: WorkGraph, n: number, snap: number): boolean {
  const p = g.nodes[n];
  let bestKey: string | null = null;
  let bestD = Infinity;
  for (const [key, e] of g.edges) {
    if (e.a === n || e.b === n) continue;
    const d = distancePointSegment(p, g.nodes[e.a], g.nodes[e.b]);
    if (d < bestD) {
      bestD = d;
      bestKey = key;
    }
  }
  const e = bestKey === null ? undefined : g.edges.get(bestKey);
  if (bestKey === null || e === undefined || bestD > snap + TOL) return false;
  const q = projectPointOnSegment(p, g.nodes[e.a], g.nodes[e.b]).point;
  const dA = dist(q, g.nodes[e.a]);
  const dB = dist(q, g.nodes[e.b]);
  if (Math.min(dA, dB) <= g.eps + TOL) {
    mergeNode(g, n, dA <= dB ? e.a : e.b);
    return true;
  }
  removeEdge(g, bestKey);
  g.nodes[n] = q;
  addEdge(g, e.a, n, e.ids);
  addEdge(g, n, e.b, e.ids);
  return true;
}

function snapFreeEnds(g: WorkGraph, snap: number): void {
  let changed = true;
  for (let pass = 0; changed && pass <= g.nodes.length; pass++) {
    changed = false;
    for (let n = 0; n < g.nodes.length; n++) {
      if (g.adj[n].size === 1 && snapNode(g, n, snap)) changed = true;
    }
  }
}

/** Removes dangling edges iteratively; returns the segment ids of the removed edges. */
function pruneDangling(g: WorkGraph): Set<string> {
  const removedIds = new Set<string>();
  const stack: number[] = [];
  for (let n = 0; n < g.nodes.length; n++) if (g.adj[n].size === 1) stack.push(n);
  while (stack.length > 0) {
    const n = stack.pop() as number;
    if (g.adj[n].size !== 1) continue;
    const [key] = g.adj[n];
    const e = removeEdge(g, key);
    if (!e) continue;
    for (const id of e.ids) removedIds.add(id);
    const other = otherEnd(e, n);
    if (g.adj[other].size === 1) stack.push(other);
  }
  return removedIds;
}

/** Compacts the working graph into the public shape (isolated nodes dropped). */
function finish(g: WorkGraph, segments: GraphSegment[], prunedIds: Set<string>): PlanarGraph {
  const remap = new Map<number, number>();
  const nodes: Vec2[] = [];
  for (let n = 0; n < g.nodes.length; n++) {
    if (g.adj[n].size === 0) continue;
    remap.set(n, nodes.length);
    nodes.push(g.nodes[n]);
  }
  const edges = [...g.edges.values()].map((e) => ({
    from: remap.get(e.a) as number,
    to: remap.get(e.b) as number,
    segmentIds: e.ids,
  }));
  const used = new Set(edges.flatMap((e) => e.segmentIds));
  const dangling: string[] = [];
  const seen = new Set<string>();
  for (const s of segments) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if (prunedIds.has(s.id) || !used.has(s.id)) dangling.push(s.id);
  }
  return { nodes, edges, dangling };
}

export function buildPlanarGraph(segments: GraphSegment[], opts?: { eps?: number; snap?: number }): PlanarGraph {
  const eps = opts?.eps ?? DEFAULT_EPS;
  const snap = opts?.snap ?? DEFAULT_SNAP;
  const segs = segments.filter((s) => isUsable(s, eps));
  const g: WorkGraph = { eps, nodes: [], adj: [], edges: new Map() };
  for (const s of segs) {
    nodeAt(g, s.a);
    nodeAt(g, s.b);
  }
  const splitPoints = collectSplitPoints(segs, eps);
  segs.forEach((s, i) => {
    const chain = nodeChain(g, s, splitPoints[i]);
    for (let k = 1; k < chain.length; k++) addEdge(g, chain[k - 1], chain[k], [s.id]);
  });
  snapFreeEnds(g, snap);
  const pruned = pruneDangling(g);
  return finish(g, segments, pruned);
}

// ---------------------------------------------------------------------------
// extractFaces
// ---------------------------------------------------------------------------

export function extractFaces(graph: PlanarGraph): Face[] {
  const { nodes, edges } = graph;
  const halfCount = edges.length * 2;
  /** Half-edge h runs from(h) → from(h ^ 1); h = 2e runs edge e from → to, 2e + 1 the other way. */
  const from = (h: number): number => (h & 1 ? edges[h >> 1].to : edges[h >> 1].from);
  const usable = (e: number): boolean => edges[e].from !== edges[e].to && dist(nodes[edges[e].from], nodes[edges[e].to]) > 0;

  const outgoing: number[][] = nodes.map(() => []);
  const angle = new Float64Array(halfCount);
  for (let h = 0; h < halfCount; h++) {
    if (!usable(h >> 1)) continue;
    const p = nodes[from(h)];
    const q = nodes[from(h ^ 1)];
    angle[h] = Math.atan2(q[1] - p[1], q[0] - p[0]);
    outgoing[from(h)].push(h);
  }
  const position = new Int32Array(halfCount);
  for (const list of outgoing) {
    list.sort((h1, h2) => angle[h1] - angle[h2]);
    list.forEach((h, i) => (position[h] = i));
  }

  const visited = new Uint8Array(halfCount);
  const faces: Face[] = [];
  for (let start = 0; start < halfCount; start++) {
    if (visited[start] || !usable(start >> 1)) continue;
    const polygon: Vec2[] = [];
    const nodeIndices: number[] = [];
    const edgeIndices: number[] = [];
    let h = start;
    for (let steps = 0; steps < halfCount && !visited[h]; steps++) {
      visited[h] = 1;
      nodeIndices.push(from(h));
      polygon.push(nodes[from(h)]);
      edgeIndices.push(h >> 1);
      const twin = h ^ 1;
      const around = outgoing[from(twin)];
      h = around[(position[twin] - 1 + around.length) % around.length];
    }
    const signed = signedArea(polygon);
    faces.push({ polygon, nodeIndices, edgeIndices, area: Math.abs(signed), isOuter: signed <= 0 });
  }
  return faces;
}

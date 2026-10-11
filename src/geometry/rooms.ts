/**
 * Room detection for one storey — docs/architecture.md "Derivation pipeline" step 4. Pure functions.
 *
 * detectRooms(lines, { minArea = 0.3, eps = 0.01, snap = 0.05 })
 *  1. One planar graph from the wall reference lines (`buildPlanarGraph`: split at crossings / T-junctions /
 *     overlaps, merge nodes within eps, snap free ends within snap, drop dangling edges). `dangling` is the graph's.
 *  2. Faces (`extractFaces`); outer faces (CW) and faces with area < minArea are dropped. Level assignment, the
 *     'add'-zone filter of the loft and room-record attachment are the caller's job (derive.ts).
 *  3. Islands: a connected component lying inside a bounded face of another component (e.g. a closed loop of
 *     walls standing free in a room) is a hole of the SMALLEST such face: its outline is cut out of that face and
 *     its walls count as boundary walls of the face (wall ids, footprints).
 *  4. wallIds = sorted (UTF-16 order) unique ids of the segments on the face boundary (incl. islands);
 *     faceId = 'face-' + fnv1a(wallIds.join('|')). Should two faces get the same id (same bounding walls), the
 *     later ones get '-2', '-3', … appended (order of the faces).
 *  5. Inner polygon = largest piece (by outer-ring area) of difference(face polygon, footprints of the boundary
 *     walls + island outlines), with its holes. Dividers have footprint [] and subtract nothing. Walls reported as
 *     dangling are NOT subtracted (they do not bound the face; a wall drawn to the inner face of another wall
 *     would otherwise cut the room in two). A face whose inner polygon is empty (filled by wall bodies) is
 *     dropped. innerPolygon is CCW; holes are CW (polygon-clipping's convention).
 *  6. area = inner outer ring − holes; labelPoint = pole of inaccessibility (holes respected); bbox and dims of
 *     the inner outer ring (`rectDims`: approx when the area differs > 2 % from the box).
 *  7. Robustness: when the difference in step 5 fails on every snap grid (`ClipError`), the footprints are
 *     subtracted one at a time, skipping those that fail; when none can be subtracted the face polygon itself is
 *     used. Such rooms are flagged `approximate` (derive.ts turns the flag into a warning); fallbacks are reported
 *     with `where` = ROOM_FACE_FALLBACK.
 */
import type { Vec2 } from '../model/types';
import { buildPlanarGraph, extractFaces } from './planarGraph';
import type { Face, PlanarGraph } from './planarGraph';
import { area, bbox, differenceMulti, differencePolygons, ensureCCW, fnv1a, labelPoint, pointInPolygon, rectDims, withClipFallback } from './polygon';
import type { MultiPoly } from './polygon';

export interface WallLine {
  id: string;
  a: Vec2;
  b: Vec2;
  footprint: Vec2[] /* [] for dividers */;
}

export interface DetectedRoom {
  faceId: string;
  facePolygon: Vec2[];
  innerPolygon: Vec2[];
  holes: Vec2[][];
  area: number;
  labelPoint: Vec2;
  bbox: { min: Vec2; max: Vec2 };
  dims: { w: number; h: number; approx: boolean };
  wallIds: string[];
  /** Set when the inner polygon could not be computed exactly (see the header, step 7). */
  approximate?: true;
}

/** `where` of the fallbacks taken for inner polygons (see `withClipFallback`). */
export const ROOM_FACE_FALLBACK = 'room-face';

const DEFAULT_MIN_AREA = 0.3;
/** Inner polygons with less net area than this (m²) count as empty. */
const EMPTY_AREA = 1e-9;

/** Connected component index of every node (union-find over the edges). */
function componentOfNodes(graph: PlanarGraph): number[] {
  const parent = graph.nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const e of graph.edges) parent[find(e.from)] = find(e.to);
  return parent.map((_, i) => find(i));
}

/** Outer faces of components lying inside a bounded face of another component, keyed by that face's index. */
function islandsByFace(graph: PlanarGraph, faces: Face[]): Map<number, Face[]> {
  const component = componentOfNodes(graph);
  const result = new Map<number, Face[]>();
  for (const island of faces) {
    if (!island.isOuter || island.nodeIndices.length === 0) continue;
    const own = component[island.nodeIndices[0]];
    const probe = island.polygon[0];
    let best = -1;
    faces.forEach((f, fi) => {
      if (f.isOuter || f.nodeIndices.length === 0 || component[f.nodeIndices[0]] === own) return;
      if (!pointInPolygon(probe, f.polygon)) return;
      if (best < 0 || f.area < faces[best].area) best = fi;
    });
    if (best >= 0) result.set(best, [...(result.get(best) ?? []), island]);
  }
  return result;
}

function footprintsById(lines: WallLine[]): Map<string, Vec2[][]> {
  const map = new Map<string, Vec2[][]>();
  for (const l of lines) {
    if (l.footprint.length < 3) continue;
    map.set(l.id, [...(map.get(l.id) ?? []), l.footprint]);
  }
  return map;
}

function boundaryWallIds(graph: PlanarGraph, faces: Face[]): string[] {
  const ids = new Set<string>();
  for (const f of faces) for (const ei of f.edgeIndices) for (const id of graph.edges[ei].segmentIds) ids.add(id);
  return [...ids].sort();
}

/** Largest polygon of a MultiPolygon by outer-ring area, or undefined. */
function largestPolygon(mp: Vec2[][][]): Vec2[][] | undefined {
  let best: Vec2[][] | undefined;
  let bestArea = -1;
  for (const poly of mp) {
    const a = poly.length > 0 ? area(poly[0]) : 0;
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  return best;
}

/** face minus the cut polygons; on failure one cut at a time (skipping failing ones), else the face itself. */
function innerPieces(face: Vec2[], cut: Vec2[][]): { pieces: MultiPoly; approximate: boolean } {
  let approximate = false;
  const pieces = withClipFallback(
    ROOM_FACE_FALLBACK,
    () => differencePolygons([face], cut),
    () => {
      approximate = true;
      let current: MultiPoly = [[ensureCCW(face)]];
      for (const c of cut) current = withClipFallback(ROOM_FACE_FALLBACK, () => differenceMulti(current, [[c]]), () => current);
      return current;
    },
  );
  return { pieces, approximate };
}

/** Room geometry of one bounded face; undefined when nothing is left inside the walls. */
function roomOfFace(
  graph: PlanarGraph,
  face: Face,
  islands: Face[],
  footprints: Map<string, Vec2[][]>,
): Omit<DetectedRoom, 'faceId'> | undefined {
  const wallIds = boundaryWallIds(graph, [face, ...islands]);
  const cut: Vec2[][] = [
    ...wallIds.flatMap((id) => footprints.get(id) ?? []),
    ...islands.map((island) => ensureCCW(island.polygon)),
  ];
  const { pieces, approximate } = innerPieces(face.polygon, cut);
  const piece = largestPolygon(pieces);
  if (piece === undefined) return undefined;
  const innerPolygon = ensureCCW(piece[0]);
  const holes = piece.slice(1);
  const net = area(innerPolygon) - holes.reduce((sum, h) => sum + area(h), 0);
  if (!(net > EMPTY_AREA)) return undefined;
  const room: Omit<DetectedRoom, 'faceId'> = {
    facePolygon: face.polygon,
    innerPolygon,
    holes,
    area: net,
    labelPoint: labelPoint(innerPolygon, holes),
    bbox: bbox(innerPolygon),
    dims: rectDims(innerPolygon),
    wallIds,
  };
  if (approximate) room.approximate = true;
  return room;
}

export function detectRooms(
  lines: WallLine[],
  opts?: { minArea?: number; eps?: number; snap?: number },
): { rooms: DetectedRoom[]; dangling: string[] } {
  const minArea = opts?.minArea ?? DEFAULT_MIN_AREA;
  const graph = buildPlanarGraph(
    lines.map((l) => ({ id: l.id, a: l.a, b: l.b })),
    { eps: opts?.eps, snap: opts?.snap },
  );
  const faces = extractFaces(graph);
  const islands = islandsByFace(graph, faces);
  const footprints = footprintsById(lines);
  const idCount = new Map<string, number>();
  const rooms: DetectedRoom[] = [];
  faces.forEach((face, fi) => {
    if (face.isOuter || face.area < minArea) return;
    const room = roomOfFace(graph, face, islands.get(fi) ?? [], footprints);
    if (room === undefined) return;
    const baseId = `face-${fnv1a(room.wallIds.join('|'))}`;
    const n = (idCount.get(baseId) ?? 0) + 1;
    idCount.set(baseId, n);
    rooms.push({ faceId: n === 1 ? baseId : `${baseId}-${n}`, ...room });
  });
  return { rooms, dangling: graph.dangling };
}

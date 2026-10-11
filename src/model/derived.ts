/**
 * Derived model — everything the 2D plan and the 3D view render.
 * Produced by `deriveVariant(variant, site)` in src/geometry/derive.ts from the stored `Variant`.
 * Renderers must never compute geometry from the raw Variant; they consume this.
 *
 * Heights: metres relative to the main floor (level "main" = 0). Plan coords as in types.ts.
 */
import type {
  Block,
  BlockPart,
  FloorMaterial,
  Id,
  Level,
  Opening,
  OpeningType,
  Room,
  Vec2,
  Vec3,
} from './types';

export interface DerivedVariant {
  variantId: Id;
  levels: Level[];
  walls: DerivedWall[];
  rooms: DerivedRoom[];
  roofs: DerivedRoof[];
  floors: DerivedFloor[];
  blocks: DerivedBlock[];
  areas: AreaSummary;
  warnings: ModelWarning[];
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export type WallSource =
  | { kind: 'blockEdge'; blockId: Id; edgeId: Id }
  | { kind: 'wall'; wallId: Id };

/**
 * One physical wall piece. Exterior walls come from block edges (split where the edge crosses
 * a part boundary, so the new/existing colour can differ along one edge, and cut away where a
 * junction is 'open'). Interior walls come from stored `Wall`s.
 */
export interface DerivedWall {
  id: Id;
  source: WallSource;
  /** Reference line start/end. For block edges: on the axis line, in edge direction. For walls: a→b. */
  a: Vec2;
  b: Vec2;
  thickness: number;
  /**
   * Offset of the wall's two faces from the reference line, measured along the LEFT normal (-dy, dx) of a→b.
   * Exterior block edge (CCW polygon → interior is on the left): left = +(thickness - outerOffset), right = -outerOffset.
   * Interior wall: left = +thickness/2, right = -thickness/2.
   */
  faceLeft: number;
  faceRight: number;
  /** Plan footprint polygon (4 points, CCW), already offset. */
  footprint: Vec2[];
  isExterior: boolean;
  isNew: boolean;
  levelId: Id;
  /** Bottom of the wall (floor of its level). */
  baseZ: number;
  /**
   * Top edge as a profile along the reference line: t in [0,1] from a to b, z absolute.
   * Piecewise linear. For walls under a gable this follows the roof; at least two points.
   */
  topProfile: { t: number; z: number }[];
  openings: DerivedOpening[];
}

export interface DerivedOpening {
  id: Id;
  opening: Opening;
  type: OpeningType;
  /** Distance along the reference line from `a` to the opening centre. */
  offset: number;
  width: number;
  /** Absolute z of sill and head. */
  sillZ: number;
  headZ: number;
  /** Plan rectangle of the opening cut through the wall (4 points). */
  footprint: Vec2[];
  /** Door swing arc, if a door: hinge point, the free corner of the closed leaf, and the free corner of the open leaf (plan coords). */
  swing?: { hinge: Vec2; closed: Vec2; open: Vec2; /** +1 CCW, -1 CW from closed to open */ sweep: 1 | -1 };
  /** Outward normal of the wall at this opening (for exterior walls), unit vector. */
  outward?: Vec2;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// Rooms, floors
// ---------------------------------------------------------------------------

export interface DerivedRoom {
  /** Room id if a Room record is attached, otherwise a stable face id ("face-<level>-<n>"). */
  id: Id;
  room?: Room;
  levelId: Id;
  /** Inner-face polygon (CCW). */
  polygon: Vec2[];
  area: number; // m², net (inner faces)
  /** Axis-aligned bounding box of the polygon. */
  bbox: { min: Vec2; max: Vec2 };
  /** Inner dimensions for the label: bbox width/height; `approx` when the polygon is not a rectangle. */
  dims: { w: number; h: number; approx: boolean };
  /** Good position for the label (inside the polygon). */
  labelPoint: Vec2;
  /** The room lies in a new block part (or a new block). */
  isNew: boolean;
  /** Block the room belongs to (block containing the label point). */
  blockId?: Id;
  floorMaterial: FloorMaterial;
  /** Centre-line polygon of the detected face (wall axis lines) — used by the editor. */
  facePolygon: Vec2[];
}

export interface DerivedFloor {
  id: Id;
  levelId: Id;
  polygon: Vec2[];
  z: number; // top of floor, absolute
  material: FloorMaterial;
  roomId?: Id;
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

export interface DerivedRoof {
  blockId: Id;
  isNew: boolean;
  material: 'turf' | 'metal' | 'shingle';
  /** Vertical thickness of the slab. */
  thickness: number;
  /** One per slope (2 for gable, 1 for mono/flat). */
  slopes: RoofSlope[];
  /** Ridge line (gable), absolute z at the UNDERSIDE. */
  ridge?: { a: Vec3; b: Vec3 };
  /** Barge boards / fascias as 3D segments on the roof's top surface edge, for trim rendering. */
  trims: { a: Vec3; b: Vec3; kind: 'barge' | 'fascia' }[];
  /** Plan outline of the whole roof (with overhangs), for the 2D roof-plan toggle. */
  outline: Vec2[];
}

export interface RoofSlope {
  /** Top-surface outline (underside + thickness), CCW seen from above. Planar. 4 points for a simple slope. */
  polygon: Vec3[];
  /** Unit normal of the slope, pointing up/out. */
  normal: Vec3;
  /** Direction the slope faces (down-slope direction), plan cardinal. */
  facing: 'N' | 'S' | 'E' | 'W';
}

// ---------------------------------------------------------------------------
// Blocks, areas, warnings
// ---------------------------------------------------------------------------

export interface DerivedBlock {
  block: Block;
  /** Outline at the outside of the cladding (BYA line). */
  outer: Vec2[];
  /** Outline at the inner wall face. */
  inner: Vec2[];
  /** Axis-line polygon (the stored one, as plain points). */
  axis: Vec2[];
  parts: { part: BlockPart; outer: Vec2[]; inner: Vec2[] }[];
  /** Outer dimensions on the axis line, e.g. 12.0 × 6.2 (bbox). */
  axisDims: { w: number; h: number };
  /** Function-free helper: eave underside z (absolute) and ridge underside z (absolute). */
  eaveZ: number;
  ridgeZ: number;
}

export interface AreaSummary {
  /** Bebygd areal, NS 3940: to the outside of the exterior cladding. Union of block outer outlines. */
  bya: AreaSplit & { perBlock: { blockId: Id; name: string; area: number; isNew: boolean; parts: { partId: Id; name: string; area: number; isNew: boolean }[] }[] };
  /** Bruksareal, NS 3940: inside the exterior walls (inner face), interior walls included. Sum over levels. */
  bra: AreaSplit & { perLevel: { levelId: Id; name: string; area: number }[] };
  /** Axis-line footprint (the convention used in the Forslag D spec: 170.2 m²). */
  axis: AreaSplit;
  /** Net area per room (inner faces). */
  rooms: { roomId: Id; name: string; levelId: Id; area: number; isNew: boolean }[];
}

export interface AreaSplit {
  total: number;
  existing: number;
  new: number;
}

export type ModelWarning =
  | { kind: 'room-unnamed'; faceId: Id; levelId: Id; area: number }
  | { kind: 'room-anchor-lost'; roomId: Id }
  | { kind: 'opening-outside-host'; openingId: Id }
  | { kind: 'opening-overlap'; openingIds: Id[] }
  | { kind: 'door-blocked'; openingId: Id; by: Id }
  | { kind: 'area-limit'; limit: number; actual: number }
  | { kind: 'room-small'; roomId: Id; area: number; min: number }
  | { kind: 'generic'; message: string };

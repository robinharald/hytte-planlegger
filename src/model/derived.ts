/**
 * Derived model — everything the 2D plan and the 3D view render.
 * Produced by `deriveVariant(variant, site, terrain)` in src/geometry/derive.ts from the stored `Variant`.
 * Renderers must never compute building geometry from the raw Variant; they consume this. (Terrain, water
 * and trees are rendered from `site` + the terrain asset through geometry/terrain.ts and geo.ts helpers.)
 *
 * Heights: metres relative to the main floor (level "main" = 0). Plan coords as in types.ts.
 * Ids of derived objects are stable across unrelated edits (see architecture.md "Derived ids").
 *
 * Ghosts (docs/phase2-plan.md §1.2): walls and openings with status 'removed' are "ghosts" (`isGhost`). They stay in
 * `walls` / `openings` for the plan (dashed, "Fjernet") but take no part in room detection, areas or 3D. Moved
 * existing block edges leave `ghosts` (outline segments).
 */
import type { FurnitureCatalogItem } from '../furniture/catalog';
import type {
  Block,
  BlockPart,
  Cardinal,
  ElementStatus,
  FloorMaterial,
  FurnitureItem,
  GroundWork,
  Id,
  Level,
  Opening,
  OpeningType,
  Room,
  StructureElement,
  Tree,
  Vec2,
  Vec3,
} from './types';

/** Level id at plan point p on a storey (see geometry/levels.ts). */
export { levelAt } from '../geometry/levels';

export interface DerivedVariant {
  variantId: Id;
  /** The variant is the bundled base proposal (`Variant.locked`): every edit action refuses it. */
  locked: boolean;
  levels: Level[];
  storeys: { id: Id; name: string; levelIds: Id[] }[];
  blocks: DerivedBlock[];
  walls: DerivedWall[];
  /** Union of wall footprints per storey and status, for the plan's outline/hatch and clean corners. */
  wallUnion: { storeyId: Id; status: ElementStatus; polygons: Vec2[][][] }[];
  rooms: DerivedRoom[];
  floors: DerivedFloor[];
  roofs: DerivedRoof[];
  outdoor: { decks: DerivedDeck[]; railings: DerivedRailing[]; steps: DerivedSteps[]; hotTubs: DerivedHotTub[] };
  structure: DerivedStructure[];
  /** Furniture with footprints (phase 2b fills in catalogue data, clearances and collisions). */
  furniture: DerivedFurniture[];
  /** Old places of moved existing block edges (`Variant.ghosts`), drawn dashed in the plan with "Vis hva som er nytt". */
  ghosts: { id: Id; a: Vec2; b: Vec2 }[];
  foundations: DerivedFoundation[];
  dimensions: DerivedDimension[];
  site: { trees: { tree: Tree; baseZ: number }[]; waterZ?: number };
  /**
   * Terrain cuts the renderer and all terrain queries must apply: `Site.groundWorks` plus one implicit cut per
   * block (its outer outline, maxZ = lowestFloorZ − 0.1) so the ground never rises into a floor.
   */
  groundWorks: GroundWork[];
  /** Bounding box of everything built (outer outlines, decks), plan coords. */
  bounds: { min: Vec2; max: Vec2 };
  areas: AreaSummary;
  warnings: ModelWarning[];
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface DerivedBlock {
  block: Block;
  /** Axis-line polygon (the stored one, as plain points). */
  axis: Vec2[];
  /** Outline at the outside of the cladding: axis offset by +outerOffset along edges that are exterior in the union; 0 along shared/open edges. */
  outer: Vec2[];
  /** Outline at the inner wall face, per edge: own inner offset where this block keeps the wall; the other block's outerOffset where the other block keeps a 'wall' junction; 0 where 'open'. */
  inner: Vec2[];
  /**
   * Parts clipped to the block; includes the implicit remainder (`isImplicit`, id `${blockId}-implicit`). The
   * remainder of a block WITH explicit parts is new (`isNew: true`); without explicit parts it has the block's isNew.
   * Outer/inner offsets only along block-boundary edges.
   */
  parts: { part: BlockPart; outer: Vec2[]; inner: Vec2[]; isImplicit: boolean }[];
  /** Floor zones clipped to the block polygon (kind 'replace' and 'add'). */
  zones: { zoneId: Id; levelId: Id; kind: 'replace' | 'add'; polygon: Vec2[] }[];
  edges: { edgeId: Id; a: Vec2; b: Vec2; length: number; outward: Vec2 }[];
  /** Outer dimensions on the axis line (bbox), e.g. 12.0 × 6.2 */
  axisDims: { w: number; h: number };
  /** Absolute z: roof underside at the axis line (eave) and at the ridge; effective pitch. */
  eaveZ: number;
  ridgeZ: number;
  pitchDeg: number;
  /** Lowest floor elevation present in the block (base level or 'replace' zones). */
  lowestFloorZ: number;
  /** Minimum terrain height under the outer outline (after ground works). */
  groundZ: number;
  /**
   * Edge segments shared with other blocks (collinear within 1 cm / 0.5°, opposite directions, overlap > 1 cm), per
   * edge of this block: distances s0 < s1 along edge `edgeIndex` from its start, the partner block and its edge
   * index, and what happens to this block's wall there: 'owner' = this block keeps the one wall, 'removed' = the
   * partner keeps it (this block's piece is cut away), 'open' = no wall.
   */
  junctions: DerivedJunction[];
}

export interface DerivedJunction {
  edgeIndex: number;
  s0: number;
  s1: number;
  otherBlockId: Id;
  otherEdgeIndex: number;
  role: 'owner' | 'removed' | 'open';
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export type WallSource =
  /** s0 / s1: the piece's range as distances from the start of the block edge (s0 < s1). */
  | { kind: 'blockEdge'; blockId: Id; edgeId: Id; partId: Id; zoneId: Id | null; s0: number; s1: number }
  | { kind: 'wall'; wallId: Id };

/**
 * One physical wall piece. Exterior walls come from block edges, split where the edge crosses a part boundary
 * or a floor-zone boundary (so colour and base height can differ along one edge), cut away where a junction is
 * 'open' or owned by the other block. Interior walls and dividers come from stored `Wall`s.
 */
export interface DerivedWall {
  /** Exterior piece: `${blockId}/${edgeId}/${partId}/${zoneId ?? 'base'}`; stored wall: the wall id. */
  id: Id;
  source: WallSource;
  /** Reference line start/end. For block edges: on the axis line, in edge direction. For walls: a→b. */
  a: Vec2;
  b: Vec2;
  /** 0 for dividers. */
  thickness: number;
  /**
   * Distance of the wall's two faces from the reference line, both positive: `faceLeft` along the LEFT normal
   * (-dy, dx), `faceRight` along the right normal. Exterior block edge: left = thickness - outerOffset (inside),
   * right = outerOffset (outside). Interior wall: thickness/2 each unless overridden.
   */
  faceLeft: number;
  faceRight: number;
  /**
   * Plan footprint polygon (CCW). At block vertices the corners are mitred (intersection of the adjacent edges'
   * offset lines); ends at part/zone splits and stored-wall ends are square ("butt"). Empty for dividers.
   */
  footprint: Vec2[];
  ends: { start: 'miter' | 'butt'; end: 'miter' | 'butt' };
  isExterior: boolean;
  isDivider: boolean;
  status: ElementStatus;
  isNew: boolean;
  /** status === 'removed': drawn dashed in the plan only; no room detection, areas or 3D. */
  isGhost: boolean;
  /** Level whose floor is `baseZ`. */
  levelId: Id;
  /** All levels whose room graph the wall takes part in (z range covers level.elevation + 1.0). */
  levelIds: Id[];
  storeyIds: Id[];
  /** Bottom of the wall. */
  baseZ: number;
  /** Highest point of `topProfile`. */
  topZ: number;
  /**
   * Top edge as a profile along the reference line: t in [0,1] from a to b, z absolute. Exact piecewise linear:
   * breakpoints at both ends, ridge crossings, roof-outline entries/exits and roof-plane intersections. Follows the
   * UPPER envelope of all roofs covering the point, or the level ceiling for 'auto' walls on a level with one,
   * or `height` for 'fixed' walls (still clipped by the roof envelope).
   */
  topProfile: { t: number; z: number }[];
  openings: DerivedOpening[];
  /** Infill patches where a 'removed' opening used to be (new work in an existing wall). */
  patches: { offset: number; width: number; sillZ: number; headZ: number }[];
}

export interface DerivedOpening {
  id: Id;
  opening: Opening;
  type: OpeningType;
  status: ElementStatus;
  isNew: boolean;
  /** status === 'removed' (see DerivedWall.isGhost). Ghost openings still leave infill `patches` in their wall. */
  isGhost: boolean;
  /**
   * Level whose floor the sill is measured from: `opening.levelId`, else the floor zone containing the point 0.2 m
   * inside the host at the centre, else the host's level.
   */
  levelId: Id;
  /** Distance along the reference line from `a` to the opening centre. */
  offset: number;
  width: number;
  /** Absolute z of sill and head (head = top profile at the centre for fullHeight openings). */
  sillZ: number;
  headZ: number;
  /** Plan rectangle of the opening cut through the wall (4 points). Empty for dividers. */
  footprint: Vec2[];
  /** Door swing arc: hinge point, free corner of the closed leaf, free corner of the open leaf (plan coords), sweep +1 CCW / -1 CW. */
  swing?: { hinge: Vec2; closed: Vec2; open: Vec2; sweep: 1 | -1 };
  /** Second leaf of a double door (Opening.leaves === 2), hinged at the other jamb. */
  swing2?: { hinge: Vec2; closed: Vec2; open: Vec2; sweep: 1 | -1 };
  /** Outward normal of the wall at this opening (exterior walls only), unit vector. */
  outward?: Vec2;
  /** Rendering hints resolved from type + style. */
  glazed: boolean;
  leaf: 'solid' | 'glass' | 'none';
  frameColour: 'white' | 'green' | 'wood' | 'black';
  leafColour: 'white' | 'green' | 'wood' | 'glass';
  panes: [number, number];
  frameDepth: number; // 0.1
  /** Position of the glass/leaf plane as a signed offset from the reference line along the left normal (default mid-thickness). */
  glassPlane: number;
}

// ---------------------------------------------------------------------------
// Rooms, floors
// ---------------------------------------------------------------------------

export interface DerivedRoom {
  /** Room id if a Room record is attached, otherwise a stable face id `face-<hash of sorted bounding wall ids>`. */
  id: Id;
  room?: Room;
  levelId: Id;
  storeyId: Id;
  /** Inner-face polygon (CCW): face polygon minus the footprints of the walls on its boundary (largest ring). */
  polygon: Vec2[];
  /** Holes inside the room (e.g. the chimney). */
  holes: Vec2[][];
  area: number; // m², net (inner faces, holes excluded)
  /** Split of `area` by existing/new block parts. */
  areaExisting: number;
  areaNew: number;
  /** areaNew > areaExisting */
  isNew: boolean;
  /** Axis-aligned bounding box of the polygon. */
  bbox: { min: Vec2; max: Vec2 };
  /** Inner dimensions for the label: bbox width/height; `approx` when the polygon is not a rectangle (area differs > 2 %). */
  dims: { w: number; h: number; approx: boolean };
  /** Good position for the label (inside the polygon). */
  labelPoint: Vec2;
  /** Block containing the label point. */
  blockId?: Id;
  floorMaterial: FloorMaterial;
  /** Reference-line polygon of the detected face (wall axis lines) — used by the editor. */
  facePolygon: Vec2[];
  /** Derived wall ids bounding the face. */
  wallIds: Id[];
}

export interface DerivedFloor {
  id: Id;
  levelId: Id;
  polygon: Vec2[];
  holes: Vec2[][];
  z: number; // top of floor, absolute
  /** Slab thickness below `z` (Level.floorThickness; 0 for ground floors). */
  thickness: number;
  material: FloorMaterial;
  roomId?: Id;
  isNew: boolean;
  /**
   * 'room' = one per room (inner polygon); 'threshold' = floor piece under a door/opening between two rooms at the
   * lower room's z, so no gap is visible; 'slab' = whole-storey slab under a floor zone / mezzanine (used as the
   * ceiling seen from below and for walking); 'ceiling' = flat ceiling of a block with `Block.ceilingHeight`
   * (z = top of the ceiling board, thickness 0.05, drawn from below; hidden in interior mode).
   */
  kind: 'room' | 'threshold' | 'slab' | 'ceiling';
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

export interface DerivedRoof {
  blockId: Id;
  material: 'turf' | 'metal' | 'shingle';
  /** Vertical thickness of the slab. */
  thickness: number;
  /** Slope pieces (2 for gable, 1 for mono/flat), split at part boundaries so new/existing can be tinted separately. */
  slopes: RoofSlope[];
  /** Ridge line (gable), absolute z at the UNDERSIDE. */
  ridge?: { a: Vec3; b: Vec3 };
  /** Barge boards (free gable ends only) and fascias (eave segments outside other roofs' outlines) on the top-surface edge. */
  trims: { a: Vec3; b: Vec3; kind: 'barge' | 'fascia' }[];
  /** Plan outline of the whole roof (with overhangs and extensions), for the 2D roof-plan toggle. */
  outline: Vec2[];
}

export interface RoofSlope {
  /** Top-surface outline (underside + thickness), CCW seen from above, planar. May have more than 4 points where an extension is clipped. */
  polygon: Vec3[];
  /** Unit normal of the slope, pointing up/out. */
  normal: Vec3;
  /** Down-slope direction, plan cardinal. */
  facing: Cardinal;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// Outdoor, structure, furniture, foundations, dimensions
// ---------------------------------------------------------------------------

export interface DerivedDeck {
  id: Id;
  /** The stored outline (plain points, stored order). */
  polygon: Vec2[];
  /** Vertex ids parallel to `polygon`; edge i (vertex i → i+1) has the id `vertexIds[i]`. */
  vertexIds: Id[];
  /**
   * The deck minus every block's outer outline (what is actually built): MultiPolygon [piece][ring][point], open
   * rings, ring 0 the outer ring (CCW), further rings holes (CW; a unit standing on the deck). The stored outline
   * itself when the clipping fails.
   */
  pieces: Vec2[][][];
  topZ: number;
  thickness: number; // 0.15
  /** Bottom of the skirt board at each vertex of each piece's OUTER ring (terrain z there minus 0.05): [piece][vertex]. */
  skirtBottomZ: number[][];
  boardDirection: 'x' | 'y';
  isNew: boolean;
  /**
   * Free runs: the parts of the stored edges that remain on the boundary of `pieces` and do not run along any
   * block's outer outline (within 1 mm). `edgeId` = the stored edge; `s0 < s1` distances from the edge start, `a` /
   * `b` the end points. Ordered by edge, then by s0. Railings and steps live on free runs.
   */
  freeRuns: { edgeId: Id; a: Vec2; b: Vec2; s0: number; s1: number }[];
}

export interface DerivedRailing {
  /** `${deckId}/railing` */
  id: Id;
  deckId: Id;
  baseZ: number; // deck top
  height: number;
  style: 'glass' | 'boards';
  /**
   * Straight panel segments at base height (z = baseZ): the free runs minus `noRailingEdges` minus the step gaps,
   * chained where runs meet at a deck corner and split at the corners.
   */
  panels: { a: Vec3; b: Vec3 }[];
  /** Post positions (corners, run ends, gap ends, every <= 1.5 m), at base height. */
  posts: Vec3[];
  isNew: boolean;
}

export interface DerivedSteps {
  /** `DeckSteps.id` */
  id: Id;
  deckId: Id;
  edgeId: Id;
  /** Centre on the stored deck edge and the outward (away from the deck) unit normal of that edge. */
  at: Vec2;
  outward: Vec2;
  width: number;
  topZ: number; // deck top
  bottomZ: number; // terrain at the foot
  risers: number; // ceil(drop / 0.18)
  riserHeight: number;
  going: number; // 0.3
  treads: { polygon: Vec2[]; z: number }[];
  /**
   * The centre is not on a free run of its edge (a building stands there, or the edge is gone): warning
   * 'deck-steps-blocked'; the steps stay in the data and in the plan, but get no railing gap and no 3D mesh.
   */
  blocked: boolean;
}

export interface DerivedHotTub {
  id: Id;
  centre: Vec2;
  diameter: number;
  baseZ: number; // deck top (or terrain)
  rimZ: number; // baseZ + 1.05
  isNew: boolean;
}

export type DerivedStructure =
  | { id: Id; kind: 'post'; element: StructureElement; position: Vec2; size: number; bottomZ: number; topZ: number; isNew: boolean }
  | { id: Id; kind: 'beam'; element: StructureElement; a: Vec2; b: Vec2; width: number; bottomZ: number; topZ: number; isNew: boolean }
  | { id: Id; kind: 'chimney'; element: StructureElement; min: Vec2; max: Vec2; bottomZ: number; topZ: number; roofExitZ: number | null; isNew: boolean }
  | {
      id: Id;
      kind: 'stair';
      element: StructureElement;
      footprint: Vec2[];
      fromZ: number;
      toZ: number;
      upDirection: Cardinal;
      riser: number;
      going: number;
      treads: { polygon: Vec2[]; z: number }[];
      /** Arrow for the plan, from the bottom step to the top. */
      arrow: { a: Vec2; b: Vec2 };
      isNew: boolean;
    };

/** Catalogue data a derived furniture item carries: the full catalogue entry (src/furniture/catalog.ts). */
export type DerivedFurnitureCatalog = FurnitureCatalogItem;

export interface DerivedFurniture {
  id: Id;
  item: FurnitureItem;
  /** The catalogue entry, null when the catalogue id is unknown ('furniture-unknown'). */
  catalog: DerivedFurnitureCatalog | null;
  /** Plan footprint: the item's size rectangle rotated by rotationDeg about its position (CCW). */
  footprint: Vec2[];
  bbox: { min: Vec2; max: Vec2 };
  /**
   * The level the item stands on: the level of the room under its centre on the item's storey (geometry wins over the
   * stored `item.levelId`). A centre in a wall or doorway takes the floor there; one over a void (or outside every
   * floor) keeps the stored level.
   */
  levelId: Id;
  /** Room (derived room id) on the item's storey containing the item's position. */
  roomId?: Id;
  /** Floor z under the item: its level's elevation, else the deck top (on the deck), else the terrain. */
  floorZ: number;
  /** Bottom z of the item (floorZ + the catalogue elevation, e.g. a wall cabinet). */
  z: number;
  /** Clearance zones (plan polygons) in front of / around the item. */
  clearances: Vec2[][];
  /**
   * Ids of what the item's footprint collides with (same level and overlapping z range): other furniture, walls,
   * structure (chimney, posts, stairs) and hot tubs. Flat items (rugs, drains) never collide. A door or window the item
   * fits through vertically counts as open.
   */
  collisions: Id[];
  /** Ids of doors whose swing this item blocks. */
  blocksDoors: Id[];
  /** The item needs a drain (WC, shower): 'furniture-needs-wet-room' when it is not in a wet room. */
  needsDrain: boolean;
  isNew: boolean;
}

export interface DerivedFoundation {
  blockId: Id;
  /** Outer outline of the block (cladding line). */
  polygon: Vec2[];
  topZ: number; // lowest floor of the block
  bottomZ: number; // groundZ - 0.3
}

export interface DerivedDimension {
  a: Vec2;
  b: Vec2;
  /** Perpendicular offset for the dimension line from the a–b line, positive to the LEFT of a→b. */
  offset: number;
  text: string;
  kind: 'axisChain' | 'axisTotal' | 'room';
  levelId?: Id;
}

// ---------------------------------------------------------------------------
// Areas, warnings
// ---------------------------------------------------------------------------

export interface AreaSummary {
  /** Bebygd areal (NS 3940): buildings to the outside of the cladding + decks more than 0.5 m above terrain. */
  bya: AreaSplit & {
    buildings: number;
    decks: number;
    perBlock: { blockId: Id; name: string; area: number; isNew: boolean; parts: { partId: Id; name: string; area: number; isNew: boolean }[] }[];
  };
  /** Bruksareal (NS 3940): inside the exterior walls, interior walls included, only where free height >= 1.9 m (+0.6 m strip). */
  bra: AreaSplit & { perLevel: { levelId: Id; name: string; gross: number; area: number }[] };
  /** Axis-line footprint (the convention used in the Forslag D spec: 170.2 m²). */
  axis: AreaSplit;
  /** Net area per room (inner faces). */
  rooms: { roomId: Id; name: string; levelId: Id; area: number; areaExisting: number; areaNew: number; isNew: boolean }[];
}

export interface AreaSplit {
  total: number;
  existing: number;
  new: number;
}

export type ModelWarning =
  | { kind: 'room-unnamed'; faceId: Id; levelId: Id; area: number }
  | { kind: 'room-anchor-lost'; roomId: Id }
  | { kind: 'room-small'; roomId: Id; area: number; min: number }
  | { kind: 'opening-outside-host'; openingId: Id }
  | { kind: 'opening-overlap'; openingIds: Id[] }
  | { kind: 'opening-above-roof'; openingId: Id; headZ: number; roofZ: number }
  | { kind: 'opening-on-removed-edge'; openingId: Id }
  | { kind: 'door-blocked'; openingId: Id; by: Id }
  | { kind: 'wall-dangling'; wallId: Id }
  | { kind: 'block-overlap'; blockIds: [Id, Id] }
  /** The block's axis polygon crosses or touches itself (e.g. two vertices swapped). */
  | { kind: 'block-self-intersecting'; blockId: Id }
  | { kind: 'parts-overlap'; blockId: Id }
  | { kind: 'roof-no-meet'; blockId: Id; end: 'start' | 'end' }
  | { kind: 'area-limit'; limit: number; actual: number }
  /** Two furniture items overlap in plan and height on the same storey (phase 2b). */
  | { kind: 'furniture-overlap'; furnitureIds: [Id, Id] }
  /** A furniture item stands in a wall (phase 2b). */
  | { kind: 'furniture-in-wall'; furnitureId: Id; wallId: Id }
  /** A furniture item is outside every room and every deck (phase 2b). */
  | { kind: 'furniture-outside'; furnitureId: Id }
  /** The catalogue has no entry for the item's catalogId (drawn as a plain box). */
  | { kind: 'furniture-unknown'; furnitureId: Id; catalogId: string }
  /** An item that needs a drain stands outside a wet room (phase 2b). */
  | { kind: 'furniture-needs-wet-room'; furnitureId: Id; roomId?: Id }
  /** Deck steps whose centre is not on a free run of their edge (a building stands there, or the edge is gone). */
  | { kind: 'deck-steps-blocked'; stepsId: Id; deckId: Id }
  /**
   * Phase 3, the drainage helper: a fixture that needs a drain stands too far from the drain stack (`distance`: the run
   * in m). Not from `deriveVariant`: added by state/plumbingActions.ts `withDrainWarnings` while «Avløp og sluk» is on.
   */
  | { kind: 'drain-far'; furnitureId: Id; catalogId: string; roomId?: Id; distance: number }
  | { kind: 'generic'; message: string };

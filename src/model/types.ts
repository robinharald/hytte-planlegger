/**
 * Project data model — the single JSON document that everything is generated from.
 *
 * Conventions (see docs/architecture.md):
 *  - Units: metres, degrees. Plan coordinates: x = "plan east", y = "plan north".
 *    The plan frame is rotated relative to true north: `Site.planNorthBearing` is the
 *    compass bearing of the plan +y axis (106° for Merkesvatnet).
 *  - Heights (z) are metres relative to the main floor (level "main" = 0), unless stated.
 *  - Block polygons are drawn on the AXIS LINE = outside face of the timber frame
 *    (the architect's grid lines). Cladding sits `WallBuildUp.outerOffset` outside it.
 *  - Polygons are counter-clockwise (CCW) in plan coordinates. Edge i runs from vertex i to i+1.
 *  - Ids are stable strings. Seed data uses readable ids ("blk-main"); user-created ids use nanoid.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Id = string;

// ---------------------------------------------------------------------------
// Project / site
// ---------------------------------------------------------------------------

export interface Project {
  schemaVersion: number;
  id: Id;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  site: Site;
  variants: Variant[];
  activeVariantId: Id;
}

export interface Site {
  /** Geographic position of the plan origin (0,0). */
  originLatLon: { lat: number; lon: number };
  /** Compass bearing (deg, clockwise from true north) of the plan +y axis. */
  planNorthBearing: number;
  /** Metres above sea level of the main floor (z = 0). */
  floorElevation: number;
  /** Lake surface, metres above sea level. Rendered where terrain is below it. */
  waterLevel?: number;
  /** Terrain heightmap in the plan frame, z relative to the main floor. */
  terrain?: TerrainGrid;
  /** IANA time zone used for the sun study. */
  timezone: string;
  trees: Tree[];
}

export interface TerrainGrid {
  x0: number; // plan x of column 0
  y0: number; // plan y of row 0
  dx: number; // spacing in x (m)
  dy: number; // spacing in y (m)
  nx: number;
  ny: number;
  /** Row-major: z[j * nx + i], metres relative to the main floor. */
  z: number[];
}

export interface Tree {
  id: Id;
  position: Vec2;
  height: number;
  kind: 'bjork';
}

// ---------------------------------------------------------------------------
// Variant
// ---------------------------------------------------------------------------

export interface Variant {
  id: Id;
  name: string;
  description?: string;
  createdAt: string;
  /** Id of the variant this one was duplicated from. */
  basedOnId?: Id;
  levels: Level[];
  blocks: Block[];
  /** Stored walls (interior walls, and old exterior walls that are now inside). Exterior walls are derived from blocks. */
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: FurnitureItem[];
  outdoor: Outdoor;
  structure: StructureElement[];
  settings: VariantSettings;
}

export interface Level {
  id: Id;
  name: string;
  /** Floor elevation relative to the main floor (m). main = 0, lower = -1.0, loft = 1.47 */
  elevation: number;
  /**
   * Height of a flat ceiling above this level's floor, if the level has one.
   * Undefined = open to the roof (walls are cut by the roof planes).
   */
  ceilingHeight?: number;
}

export interface VariantSettings {
  /** Default build-up for exterior walls of NEW blocks. */
  defaultExteriorWall: WallBuildUp;
  /** Default thickness for new interior walls (m). */
  defaultInteriorThickness: number;
  /** Optional area limit (m² BYA) that triggers a warning. null = none. */
  areaLimit: number | null;
}

/** Exterior wall build-up relative to the block polygon line (axis line). */
export interface WallBuildUp {
  /** Total thickness (m), e.g. 0.27 */
  thickness: number;
  /** Part of the thickness OUTSIDE the axis line (cladding + battens), e.g. 0.11. Inner part = thickness - outerOffset. */
  outerOffset: number;
}

// ---------------------------------------------------------------------------
// Blocks (building volumes) and roofs
// ---------------------------------------------------------------------------

export interface Block {
  id: Id;
  name: string;
  /** CCW polygon on the axis line. Edge i runs from vertex i to vertex i+1; its id is vertex i's id. */
  polygon: BlockVertex[];
  /** Base level of the block floor. */
  levelId: Id;
  /** Regions of the block whose floor is on another level (e.g. the lower bedroom part of the main block). */
  floorZones: FloorZone[];
  /**
   * Sub-areas flagged existing/new for colouring and area split.
   * If empty, the whole block has the block's `isNew` flag. Parts must tile the block polygon.
   */
  parts: BlockPart[];
  isNew: boolean;
  /** Exterior wall build-up for this block. */
  wall: WallBuildUp;
  /** Underside of the roof at the outer wall face (axis line), above the block's level floor. 2.22 for the existing cabin. */
  eaveHeight: number;
  roof: Roof;
  /** How edges shared with other blocks are treated. Missing entry = 'wall'. */
  junctions: Junction[];
}

export interface BlockVertex {
  id: Id;
  p: Vec2;
}

export interface FloorZone {
  id: Id;
  polygon: Vec2[];
  levelId: Id;
  /**
   * 'replace': the block's base floor is removed here and replaced by a floor on `levelId` (the lower bedroom part).
   * 'add': an additional floor on `levelId` above/below the base floor (the loft over the bedroom part).
   */
  kind: 'replace' | 'add';
}

export interface BlockPart {
  id: Id;
  name: string;
  polygon: Vec2[];
  isNew: boolean;
}

export interface Junction {
  otherBlockId: Id;
  /**
   * 'open'  = no wall where the two block polygons share an edge (one continuous room, e.g. glass bump / living room).
   * 'wall'  = keep THIS block's exterior wall along the shared edge (e.g. the main house north wall against the bod wing).
   * Only the block listed first in `Variant.blocks` needs the entry; if both have entries, 'open' wins.
   */
  policy: 'open' | 'wall';
}

export type RoofType = 'gable' | 'mono' | 'flat';
export type Cardinal = 'N' | 'S' | 'E' | 'W';

export interface Roof {
  type: RoofType;
  /** Gable: axis the ridge runs along. Ridge is centred on the block's extent across that axis. */
  ridgeAxis: 'x' | 'y';
  /** Mono-pitch: side the roof slopes DOWN towards (plan cardinal). */
  slopeTo?: Cardinal;
  /** Which value drives the geometry: 'pitch' keeps pitchDeg when the block resizes, 'height' keeps ridgeHeight. */
  drive: 'pitch' | 'height';
  /** Roof pitch in degrees. 28 for the existing cabin. */
  pitchDeg: number;
  /** Underside of the roof at the ridge, above the block's level floor (gable/mono). 3.87 for the main house. */
  ridgeHeight: number;
  /** Vertical thickness of the roof build-up (m). 0.31 (tro + papp + lekter + torv). */
  thickness: number;
  /** Horizontal overhang beyond the axis line at the eaves (m). 0.51 */
  overhangEave: number;
  /** Horizontal overhang beyond the axis line at the gables (m). 0.35 */
  overhangGable: number;
  material: 'turf' | 'metal' | 'shingle';
  /**
   * Manual override of how far (m) the roof continues beyond the block polygon along the ridge axis,
   * at the low (start) and high (end) coordinate ends. Undefined = automatic (extend until it meets the adjacent roof).
   */
  extend?: { start?: number; end?: number };
}

// ---------------------------------------------------------------------------
// Walls and openings
// ---------------------------------------------------------------------------

export type WallKind =
  /** Ordinary interior partition, centred on the a→b line. */
  | 'interior'
  /** A former exterior wall that is now inside (e.g. the bod wing's old north gable). Centred on a→b, but thick. */
  | 'exterior-old';

export interface Wall {
  id: Id;
  a: Vec2;
  b: Vec2;
  thickness: number;
  levelId: Id;
  isNew: boolean;
  kind: WallKind;
  /**
   * Height rule. Default 'auto': from the level floor up to the level ceiling if it has one, otherwise to the roof underside.
   * 'fixed': from the level floor to `height` metres above it (e.g. a half-height wall).
   */
  heightMode?: 'auto' | 'fixed';
  height?: number;
}

export type OpeningType =
  | 'window'
  | 'door'
  | 'glassDoor'
  | 'slidingDoor'
  | 'saunaDoor'
  /** Frameless opening: passage between rooms, or the open front of the woodshed. */
  | 'opening';

export type OpeningHost =
  | { kind: 'blockEdge'; blockId: Id; edgeId: Id }
  | { kind: 'wall'; wallId: Id };

export interface Opening {
  id: Id;
  type: OpeningType;
  host: OpeningHost;
  /** Distance (m) from the host's start point (block vertex / wall point a) to the CENTRE of the opening, measured along the host. */
  offset: number;
  width: number;
  height: number;
  /** Sill/threshold height above the floor of `levelId` (0 for doors). */
  sill: number;
  /** Level whose floor the sill is measured from. Default: the host wall's level / the block's level at that point. */
  levelId?: Id;
  /**
   * Door swing. `hinge` is the side of the hinge when you look at the door from the OUTSIDE of the block
   * (exterior) or from the LEFT side of the host line a→b (interior walls, i.e. the side the normal (-dy, dx) points to).
   * `direction`: 'out' = opens away from that viewpoint, 'in' = opens towards it.
   */
  swing?: { hinge: 'left' | 'right'; direction: 'in' | 'out' };
  style: OpeningStyle;
  isNew: boolean;
}

export interface OpeningStyle {
  frameColour: 'white' | 'green' | 'wood' | 'black';
  /** Window muntin grid: [columns, rows] of panes. */
  mullions?: [number, number];
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type RoomType =
  | 'stue'
  | 'kjokken'
  | 'spiseplass'
  | 'soverom'
  | 'bad'
  | 'wc'
  | 'badstue'
  | 'gang'
  | 'vindfang'
  | 'bod'
  | 'teknisk'
  | 'pantry'
  | 'hems'
  | 'leseskrok'
  /** Void / opening in a floor (stairwell). Not counted in BRA, no floor rendered. */
  | 'apning'
  | 'annet';

export type FloorMaterial = 'wood' | 'tile' | 'sauna' | 'concrete' | 'deck';

/**
 * A room record. Its geometry is NOT stored: rooms are detected as faces of the wall graph on a level,
 * and a Room is attached to the face that contains `anchor`.
 */
export interface Room {
  id: Id;
  name: string;
  type: RoomType;
  levelId: Id;
  anchor: Vec2;
  /**
   * Zone inside an open-plan face (e.g. "Kjøkken" inside the big living-room face). The derived room is
   * zonePolygon ∩ the containing face's inner polygon, and it is listed under the face's own room.
   * `anchor` must lie inside the zone polygon. Zones never affect room detection.
   */
  zonePolygon?: Vec2[];
  /** Override of the floor material implied by `type`. */
  floorMaterial?: FloorMaterial;
  note?: string;
}

// ---------------------------------------------------------------------------
// Furniture (phase 3; types defined now so the schema is stable)
// ---------------------------------------------------------------------------

export interface FurnitureItem {
  id: Id;
  /** Key into the furniture catalogue, e.g. "seng-150", "sofa-3", "toalett". */
  catalogId: string;
  position: Vec2; // centre, plan coordinates
  rotationDeg: number; // CCW, 0 = catalogue default orientation
  levelId: Id;
  /** Size variant key when the catalogue item has several (e.g. bed width). */
  sizeVariant?: string;
  colour?: string;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// Outdoor
// ---------------------------------------------------------------------------

export interface Outdoor {
  decks: Deck[];
  railings: Railing[];
  hotTubs: HotTub[];
}

export interface Deck {
  id: Id;
  polygon: Vec2[];
  /** Top of deck boards, metres relative to the main floor (0 = flush with the main floor). */
  topHeight: number;
  isNew: boolean;
}

export interface Railing {
  id: Id;
  /** Open polyline along the deck edge. */
  path: Vec2[];
  height: number; // 1.05
  style: 'glass' | 'boards';
  /** Gaps (steps) as distances along the path from its start: [from, to]. */
  gaps: [number, number][];
  isNew: boolean;
}

export interface HotTub {
  id: Id;
  centre: Vec2;
  diameter: number;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// Structure (decorative but informative: posts, beams, chimney, stairs)
// ---------------------------------------------------------------------------

export type StructureElement =
  | { id: Id; kind: 'post'; position: Vec2; size: number; levelId: Id; bottom: number; top: number; isNew: boolean }
  | { id: Id; kind: 'beam'; a: Vec2; b: Vec2; width: number; bottom: number; top: number; levelId: Id; isNew: boolean }
  | { id: Id; kind: 'chimney'; min: Vec2; max: Vec2; top: number; isNew: boolean }
  | {
      id: Id;
      kind: 'stair';
      /** Footprint rectangle [min, max] in plan. */
      min: Vec2;
      max: Vec2;
      fromLevelId: Id;
      toLevelId: Id;
      /** Direction of travel UP, as a plan cardinal. */
      upDirection: Cardinal;
      isNew: boolean;
    };

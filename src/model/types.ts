/**
 * Project data model — the single JSON document that everything is generated from.
 *
 * Conventions (see docs/architecture.md):
 *  - Units: metres, degrees. Plan coordinates: x = "plan east", y = "plan north" (a right-handed frame, y up
 *    when drawn). The plan frame is rotated relative to true north: `Site.planNorthBearing` is the compass
 *    bearing of the plan +y axis (106° for Merkesvatnet).
 *  - Heights (z) are metres relative to the main floor (level "main" = 0), unless stated. Structure and
 *    outdoor heights are absolute in that sense (never relative to a level).
 *  - Block polygons are drawn on the AXIS LINE = outside face of the timber frame (the architect's grid
 *    lines). Cladding sits `WallBuildUp.outerOffset` outside it.
 *  - Polygons are counter-clockwise (CCW). Edge i runs from vertex i to i+1. The LEFT side of a CCW edge
 *    (normal (-dy, dx)) is the inside of the block.
 *  - Ids are stable strings. Seed data uses readable ids ("blk-main"); user-created ids use nanoid.
 *  - The terrain heightmap is NOT part of the project document (too large for links/undo); the site only
 *    references a bundled asset by id.
 *
 * Schema history (src/model/migrate.ts):
 *  - 1: phase 1.
 *  - 2: phase 2 (docs/phase2-plan.md §2). Decks carry their railing (`Deck.railing`, `noRailingEdges`) and their
 *       steps (`DeckSteps`, hosted on a deck edge like an opening); deck vertices have stable ids; `Outdoor.railings`
 *       is gone. Variants gain `notes`, `locked` (the bundled base proposal), `meta` and `ghosts`; blocks gain
 *       `template`, `templateFrontEdgeId`, `floorMaterial`; furniture items store their `size`.
 */

export const CURRENT_SCHEMA_VERSION = 2;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Id = string;

/** Lifecycle of an element in the design: part of today's cabin, planned new work, or demolished. */
export type ElementStatus = 'existing' | 'new' | 'removed';

// ---------------------------------------------------------------------------
// Project / site
// ---------------------------------------------------------------------------

export interface Project {
  schemaVersion: number;
  id: Id;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Revision of the bundled seed this project was created from (see seed/forslagD.ts SEED_REVISION). */
  seedRevision: number;
  /** Set when the project was created as "my own copy" of a shared link. */
  basedOnProjectId?: Id;
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
  /** Id of the bundled terrain asset (TerrainAsset.id). The asset itself is loaded by the app, never stored here. */
  terrainId: string;
  /** Terrain modifications: inside each polygon the terrain is CUT down to at most `maxZ` (relative to the main floor). */
  groundWorks: GroundWork[];
  /** IANA time zone used for the sun study (the instant is built from local wall-clock time here, never from the device zone). */
  timezone: string;
  trees: Tree[];
}

export interface GroundWork {
  id: Id;
  polygon: Vec2[];
  /** Maximum terrain height inside the polygon, metres relative to the main floor. */
  maxZ: number;
}

/**
 * Bundled terrain asset (src/model/seed/terrain-<id>.json). Grids are in the plan frame, z in metres above
 * sea level, ordered finest first; a point is sampled from the first grid that covers it (bilinear).
 */
export interface TerrainAsset {
  id: string;
  grids: TerrainGrid[];
}

export interface TerrainGrid {
  x0: number; // plan x of column 0
  y0: number; // plan y of row 0
  dx: number; // spacing in x (m)
  dy: number; // spacing in y (m)
  nx: number;
  ny: number;
  /** Row-major: z[j * nx + i], metres above sea level. */
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
  /** Stored walls: interior walls, old exterior walls that are now inside, and zero-thickness dividers. Exterior walls are derived from blocks. */
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: FurnitureItem[];
  outdoor: Outdoor;
  structure: StructureElement[];
  settings: VariantSettings;
  /** Free-text notes about the proposal ("Merknader"). */
  notes?: string;
  /** The bundled base proposal (Forslag D): read-only in the UI and in every edit action. Copies are unlocked. */
  locked?: boolean;
  /** Shared-store metadata (undefined for the bundled base). */
  meta?: VariantMeta;
  /**
   * Outlines of existing block edges that were moved (status bookkeeping, docs/phase2-plan.md §3.4): drawn dashed
   * ("Fjernet") in the plan while "Vis hva som er nytt" is on, never in 3D. Undefined = none.
   */
  ghosts?: VariantGhost[];
  /**
   * The proposal's own trees, copied from `Site.trees` on its first tree edit (copy-on-write) so that editing a tree
   * in one proposal never changes another one or Forslag D. Undefined = the site's trees. Read through
   * `treesOf(project, variant)` (geometry/derive.ts). Optional, no schema bump: older documents have none.
   */
  trees?: Tree[];
}

export interface VariantMeta {
  author?: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
}

/** The old place of a moved existing block edge (plan coordinates, axis line). */
export interface VariantGhost {
  id: Id;
  a: Vec2;
  b: Vec2;
}

/**
 * A floor level. Levels are grouped into storeys: the architect's "Hovedplan" shows the lower bedroom level
 * and the main level together (storey "ground"), the loft is storey "loft". Room detection runs per storey.
 */
export interface Level {
  id: Id;
  name: string;
  storeyId: Id;
  /** Floor elevation relative to the main floor (m). main = 0, lower = -1.0, loft = 1.47 */
  elevation: number;
  /**
   * Height of a flat ceiling above this level's floor, if the level has one (lower = 2.3, the underside of the
   * loft floor). Undefined = open to the roof. Only affects stored walls with heightMode 'auto' and the
   * measurable-area rule; exterior walls always run to the roof.
   */
  ceilingHeight?: number;
  /** Thickness of this level's floor slab below its elevation (loft 0.17; 0 for floors on the ground slab). */
  floorThickness: number;
}

export interface VariantSettings {
  /** Default build-up for exterior walls of NEW blocks. */
  defaultExteriorWall: WallBuildUp;
  /** Default thickness for new interior walls (m). */
  defaultInteriorThickness: number;
  /** Optional BYA limit (m²). null = none. Robin asked for no limiter; kept for compatibility, no UI in phase 1. */
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
  /**
   * Regions of the block whose floor is on another level. Polygons are clipped to the block polygon at derive time
   * (no tiling invariant); the uncovered remainder is the base level.
   */
  floorZones: FloorZone[];
  /**
   * Sub-areas flagged existing/new for colouring and the area split. Clipped to the block polygon at derive time;
   * the uncovered remainder is an implicit part that is NEW (`isNew: true`): an explicit existing part never grows, so
   * a block edge dragged outwards adds new area (docs/phase2-plan.md §3.4). Empty = the whole block is `isNew`.
   */
  parts: BlockPart[];
  isNew: boolean;
  /** Exterior wall build-up for this block. */
  wall: WallBuildUp;
  /** Underside of the roof at the AXIS LINE (0.11 m inside the cladding face), above the block's level floor. 2.22 for the existing cabin. */
  eaveHeight: number;
  /**
   * Flat ceiling inside this block, metres above the block's level floor (the new wing: 2.4). Stored walls with
   * heightMode 'auto' inside the block stop there, a 'ceiling' floor is derived, and the space above is a cold loft.
   * Undefined = open to the roof.
   */
  ceilingHeight?: number;
  roof: Roof;
  /** How edges shared with other blocks are treated. Missing entry = 'wall'. */
  junctions: Junction[];
  /** Unit template the block was placed from ('vedskjul', 'bod', 'badstue', 'anneks', 'eget'); undefined for drawn blocks. */
  template?: string;
  /** Edge (vertex id) that is the template's front (the open front of a woodshed). */
  templateFrontEdgeId?: Id;
  /** Floor material of the block's rooms when their Room records do not set one (a woodshed: 'deck'). */
  floorMaterial?: FloorMaterial;
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
   * 'replace': the base floor is carved out and replaced by a floor on `levelId` (the lower bedroom part, -1.0).
   *            Its boundary acts as a zero-thickness divider in room detection (the corridor splits at the step).
   * 'add':     an additional floor on `levelId` stacked over the base (the loft over the bedroom part). Its boundary
   *            bounds the room graph of that level's storey; faces outside every 'add' zone are discarded there.
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
   * What happens where this block's polygon shares an edge segment with `otherBlockId`'s polygon
   * (collinear within 1 cm / 0.5°, opposite directions, overlap > 1 cm):
   *  'open' = no wall (one continuous room, e.g. glass bump / living room, living room / new wing).
   *  'wall' = ONE exterior wall is kept there, owned by the block whose entry says 'wall' (if both or neither
   *           say so, by the block listed first in `Variant.blocks`); the other block's coincident piece is removed.
   *  'open' in either block's entry wins over 'wall'.
   */
  policy: 'open' | 'wall';
}

export type RoofType = 'gable' | 'mono' | 'flat';
export type Cardinal = 'N' | 'S' | 'E' | 'W';

export interface Roof {
  type: RoofType;
  /** Gable: axis the ridge runs along. Ridge is centred on the block's extent across that axis. Ignored for flat; for mono it is perpendicular to `slopeTo`. */
  ridgeAxis?: 'x' | 'y';
  /** Mono-pitch: side the roof slopes DOWN towards (plan cardinal). */
  slopeTo?: Cardinal;
  /** Which value drives the geometry when the block resizes: 'pitch' keeps pitchDeg, 'height' keeps ridgeHeight. Derive always recomputes the other. */
  drive: 'pitch' | 'height';
  /** Roof pitch in degrees. 28 for the existing cabin. */
  pitchDeg: number;
  /** Underside of the roof at the ridge (gable) / at the high wall (mono), above the block's level floor. 3.87 for the main house. */
  ridgeHeight: number;
  /** Vertical thickness of the roof build-up (m). 0.31 (tro + papp + lekter + torv). */
  thickness: number;
  /** Horizontal overhang beyond the axis line at the eaves (m). 0.51. Mono: both low and high side; flat: all sides. */
  overhangEave: number;
  /** Horizontal overhang beyond the axis line at the gable ends (m). 0.51 on every block of Forslag D (IFC). */
  overhangGable: number;
  material: 'turf' | 'metal' | 'shingle';
  /**
   * Manual override of how far (m) the roof continues beyond the axis line along the ridge axis at the low (start)
   * and high (end) coordinate ends. Replaces BOTH the automatic extension and overhangGable at that end.
   * Undefined = automatic (extend until it meets the adjacent roof, else overhangGable).
   */
  extend?: { start?: number; end?: number };
}

// ---------------------------------------------------------------------------
// Walls and openings
// ---------------------------------------------------------------------------

export type WallKind =
  /** Ordinary interior partition, centred on the a→b line (unless faceLeft/faceRight are given). */
  | 'interior'
  /** A former exterior wall that is now inside (e.g. the bod wing's old north gable). Thick; may be asymmetric. */
  | 'exterior-old'
  /**
   * Zero-thickness room boundary: an edge in the room graph (splits open-plan areas into Kjøkken / Stue / ...),
   * dashed hairline in the plan, nothing in 3D, no openings, no area deduction.
   */
  | 'divider';

export interface Wall {
  id: Id;
  a: Vec2;
  b: Vec2;
  /** 0 for dividers. */
  thickness: number;
  /** Level whose floor the wall stands on. */
  levelId: Id;
  status: ElementStatus;
  kind: WallKind;
  /**
   * 'auto'  (default): from the level floor to the level's ceiling if it has one, otherwise to the roof envelope.
   * 'roof': from the level floor to the roof envelope, ignoring the level ceiling (walls that run from the lower
   *         floor up through the loft, e.g. x = 5.05 between the bathroom and the vindfang).
   * 'fixed': from the level floor to `height` metres above it (still clipped by the roof envelope).
   */
  heightMode: 'auto' | 'fixed' | 'roof';
  height?: number;
  /**
   * Optional asymmetric faces: distance from the a→b line to the face on the LEFT ((-dy, dx)) side and on the
   * RIGHT side, both positive. Default thickness/2 each. Used for 'exterior-old' walls whose body is not centred
   * on the axis line.
   */
  faceLeft?: number;
  faceRight?: number;
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
  /** Cut the full wall height up to the top profile (open shed front); `height` is then ignored. */
  fullHeight?: boolean;
  /** Number of door leaves (1 default, 2 = double door with two half-width leaves hinged at both jambs). */
  leaves?: 1 | 2;
  /** Sill/threshold height above the floor of `levelId` (0 for doors). */
  sill: number;
  /**
   * Level whose floor the sill is measured from. Default: the level of the floor zone containing the point 0.2 m
   * inside the host at the opening centre, else the block/wall level. The loft windows set 'loft' explicitly.
   */
  levelId?: Id;
  /**
   * Door swing, defined on the host reference line only:
   *  hinge: 'start' = hinge at the jamb nearer the host start, 'end' = nearer the host end.
   *  side:  side of the host line a→b that the leaf opens INTO: 'left' = (-dy, dx) side (= inside the block for
   *         exterior edges), 'right' = outside for exterior edges. Exterior doors that swing outwards are 'right'.
   */
  swing?: { hinge: 'start' | 'end'; side: 'left' | 'right' };
  style: OpeningStyle;
  status: ElementStatus;
}

export interface OpeningStyle {
  frameColour: 'white' | 'green' | 'wood' | 'black';
  /** Door leaf. Default by type: door → 'white', glassDoor/saunaDoor → 'glass'. */
  leaf?: 'white' | 'green' | 'wood' | 'glass';
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
 * A room record. Its geometry is NOT stored: rooms are detected as faces of the wall graph of a storey,
 * and a Room is attached to the face that contains `anchor`. Use dividers (WallKind 'divider') to split
 * open-plan areas into separately named rooms.
 */
export interface Room {
  id: Id;
  name: string;
  type: RoomType;
  levelId: Id;
  anchor: Vec2;
  /** Override of the floor material implied by `type`. */
  floorMaterial?: FloorMaterial;
  note?: string;
}

// ---------------------------------------------------------------------------
// Furniture (phase 2b fills the catalogue; the schema is fixed now)
// ---------------------------------------------------------------------------

export interface FurnitureItem {
  id: Id;
  /** Key into the furniture catalogue, e.g. "seng-150", "sofa-3", "toalett". */
  catalogId: string;
  position: Vec2; // centre, plan coordinates
  rotationDeg: number; // CCW, 0 = catalogue default orientation
  levelId: Id;
  /**
   * Dimensions (m) written at placement from the chosen preset: w along the item's local x, d along its local y,
   * h the height. Catalogue changes never resize saved items.
   */
  size: { w: number; d: number; h: number };
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
  hotTubs: HotTub[];
}

export interface Deck {
  id: Id;
  /**
   * Outline on the deck's own line, with stable vertex ids (edge i runs from vertex i to i+1; its id is vertex i's
   * id). May overlap buildings: derive trims it by every block's outer outline (`DerivedDeck.pieces`).
   */
  polygon: DeckVertex[];
  /** Top of deck boards, metres relative to the main floor (0 = flush with the main floor). */
  topHeight: number;
  isNew: boolean;
  /** Railing along every free run (parts of edges not touching a building), unless the edge id is in noRailingEdges. */
  railing?: { style: 'glass' | 'boards'; height: number };
  /** Edge ids whose free runs get no railing. */
  noRailingEdges: Id[];
  steps: DeckSteps[];
}

export interface DeckVertex {
  id: Id;
  p: Vec2;
}

/** Steps down from the deck, hosted like an opening: on an edge, offset (m) from the edge start to the centre, width. */
export interface DeckSteps {
  id: Id;
  edgeId: Id;
  offset: number;
  width: number;
}

export interface HotTub {
  id: Id;
  centre: Vec2;
  diameter: number;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// Structure (posts, beams, chimney, stairs). All z values are absolute (relative to the main floor).
// ---------------------------------------------------------------------------

export type StructureElement =
  | { id: Id; kind: 'post'; position: Vec2; size: number; bottom: number; top: number; isNew: boolean }
  | { id: Id; kind: 'beam'; a: Vec2; b: Vec2; width: number; bottom: number; top: number; isNew: boolean }
  | { id: Id; kind: 'chimney'; min: Vec2; max: Vec2; bottom: number; top: number; isNew: boolean }
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

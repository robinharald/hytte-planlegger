# Architecture

Web-based 2D/3D planner for extending the cabin at Merkesvatnet (Hadsel, Vesterålen). Robin and his family
use it to develop "Forslag D". UI language is Norwegian bokmål; code, comments and docs are English.

Stack: Vite 8, React 19, TypeScript 6 (strict, `verbatimModuleSyntax`, no enums), three.js via
@react-three/fiber 9 + drei 10, zustand 5 + zundo (undo/redo) + immer, polygon-clipping (boolean ops),
lz-string (share links), suncalc, Vitest, Playwright.

## Core principle: everything is data

One plain JSON document (`Project`, see `src/model/types.ts`) holds the whole design: site, variants, blocks,
walls, openings, rooms, furniture, outdoor, structure. Everything on screen is generated from it by
`deriveVariant(variant, site, terrain)` (`src/geometry/derive.ts`) into a `DerivedVariant`
(`src/model/derived.ts`). Renderers (2D plan, 3D view, schedule) only read the derived model (plus the
terrain asset through `geometry/terrain.ts` helpers). Edits only change the JSON through store actions, undo/redo
is a history of the JSON, saving/sharing is storing the JSON.

## Folder layout and ownership

```
src/
  model/       types.ts (schema), derived.ts (render contract), migrate.ts (schema versions),
               seed/forslagD.ts (Forslag D built from calibrated numbers, exports SEED_REVISION),
               seed/terrain-merkesvatnet.json (TerrainAsset, built by scripts/build-terrain.mjs)
  geometry/    pure functions, fully unit-tested, no React/three imports:
               polygon.ts planarGraph.ts rooms.ts roof.ts walls.ts outdoor.ts areas.ts derive.ts geo.ts terrain.ts
  state/       store.ts (zustand + zundo + immer), selection.ts, persistence.ts (autosave, versions, share link)
  plan2d/      SVG plan: PlanView.tsx and parts
  view3d/      R3F scene: View3D.tsx, Scene.tsx, coords.ts, materials.ts, Walls.tsx, Roofs.tsx, Floors.tsx,
               Openings.tsx, Outdoor.tsx, Terrain.tsx, Trees.tsx, Labels.tsx, StructureMeshes.tsx, cameras.ts, SunLight.tsx
  ui/          App shell, panels, theme.css, format.ts, components
  i18n/        nb.ts — every user-visible string lives here
  furniture/   catalogue + components (phase 3)
e2e/           Playwright smoke test and screenshots (e2e/screenshots/*.png, committed)
docs/          this file, kalibrering-ifc.md (IFC facts), seed-brief-forslag-d.md (what the seed contains)
data/geo/      raw Kartverket elevation grids and the IFC element dump (inputs for scripts)
scripts/       build-terrain.mjs (data/geo → src/model/seed/terrain-merkesvatnet.json)
public/fonts/  self-hosted Barlow + Barlow Semi Condensed (woff2)
```

## Coordinate systems

- **Plan frame** (all stored geometry): x, y in metres, right-handed (y "up" on paper). Origin = SW corner of
  the existing main building on the axis line. Plan +x runs along the main house towards the living room / new
  wing (compass bearing 196°), plan +y runs towards the bod wing (bearing 106°). The glass bump (low y) faces the
  lake (WNW). `Site.planNorthBearing = 106` is the bearing of plan +y.
- **Bearings ↔ plan directions** (`geometry/geo.ts`, unit-tested): a compass bearing β (clockwise from true north)
  is the plan unit vector `planDirOfBearing(β) = (sin(β − B), cos(β − B))` with `B = planNorthBearing`.
  True north (β = 0) = `(sin(−106°), cos(−106°)) = (−0.961, −0.276)`, i.e. 106° COUNTER-clockwise from plan +y.
  Inverse: `bearingOfPlanDir(v) = atan2(v.x, v.y) + B`. Plan → geo offsets from the address point as in
  docs/kalibrering-ifc.md "Site georeference".
- **Heights** z: metres relative to the main floor (level `main`, 0). `lower` = −1.0, `loft` = +1.47.
  `Site.floorElevation` (161.0 m a.s.l.) converts to sea level. Terrain asset grids are in metres a.s.l.;
  `terrainZAt(terrain, site, x, y)` returns the height RELATIVE to the main floor after ground works (cuts).
- **three.js world**: `X = x, Y = z, Z = −y` (a proper rotation, det +1, same as the old model's `W(x,y,h)`).
  Helpers `toWorld(x, y, z)` / `fromWorld(v)` in `view3d/coords.ts`. A `THREE.Shape` built in plan (x, y) needs
  `rotation.x = −π/2`; keep face winding consistent (shapes are CCW in plan).
- **SVG plan**: y points down on screen, so ALL plan geometry is drawn inside one root
  `<g transform="matrix(s 0 0 -s tx ty)">`; text/labels are placed in screen space (or in a counter-flipped
  group) so they read correctly. The result matches the architect's drawings: lake side at the bottom, new wing
  on the right. The north arrow uses `planDirOfBearing(0)` (points down-left).
- **Sun** (`sunInPlan(site, instant)`): `const p = SunCalc.getPosition(instant, lat, lon)`; suncalc azimuth is
  measured from SOUTH, positive towards WEST, so `bearing = p.azimuth + π`; `d = planDirOfBearing(bearing)`;
  `dir = (d.x·cos(alt), d.y·cos(alt), sin(alt))` (unit vector towards the sun); `isUp = alt > 0`. The instant is
  built from (date, local minutes) in `Site.timezone` via an Intl offset lookup (`localInstant`), never from the
  device zone. Midnight sun / polar night: altitude ≤ 0 → light intensity 0, shadows off, note "under horisonten".

## Data model conventions (see types.ts for the fields)

- Polygons are CCW. Block polygons sit on the **axis line** (outside of the timber frame = the architect's grid).
  Exterior walls are **derived** from block edges: `outerOffset` (0.11 m cladding+battens) lies outside the axis
  line, `thickness − outerOffset` (0.16 m) inside. Existing cabin: thickness 0.27. New blocks: the same build-up
  by default (`VariantSettings.defaultExteriorWall`) so the room sizes match the spec; Robin can change it.
- **Junctions** where two block polygons share an edge segment (collinear within 1 cm / 0.5°, opposite directions,
  overlap > 1 cm): `'open'` removes the wall (glass bump ↔ living room, new wing ↔ living room extension);
  `'wall'` keeps ONE wall owned by the block whose entry says 'wall' (if both or neither: the block listed first in
  `Variant.blocks`); the other block's coincident piece is removed (also from the room graph). 'open' in either
  entry wins. Base z of a kept junction wall = min of both blocks' floor elevations along the segment. Openings
  whose centre lies on a removed segment → warning `opening-on-removed-edge`. Blocks overlapping in area →
  `block-overlap` (BYA still via union).
- **Parts** split one block into existing/new areas without splitting its roof: the main house is one block
  [0,16]×[0,6.2] with parts "eksisterende" [0,12] and "stueforlengelse" [12,16]; the bod wing is one block
  [5,9]×[6.2,12.1] with parts [6.2,10.1] existing and [10.1,12.1] new. Parts and floor zones are clipped to the
  block polygon at derive time; the uncovered remainder is an implicit part/zone (no tiling invariant, so dragging a
  block edge just works). Overlapping parts → `parts-overlap`.
- **Floor zones**: `replace` zones carve the base floor (the lower bedroom part x < 5.1, floor −1.0); their boundary
  acts as a divider in room detection (the corridor splits at the step). `add` zones stack a floor on another level
  (the loft over the bedroom part); their boundary bounds that storey's room graph. Exterior wall pieces are split
  at zone boundaries and take `baseZ` from the zone they run along (test: piece midpoint nudged 1 cm inside).
- **Levels and storeys**: `lower` (−1.0, ceiling 2.3, storey ground), `main` (0, open to roof, storey ground),
  `loft` (1.47, floorThickness 0.17, storey loft). Exterior walls always run to the roof envelope. Stored walls:
  `auto` stops at the level ceiling if any (lower-level partitions stop under the loft floor at 1.3), `roof` runs
  to the roof envelope (x = 5.05 bathroom/vindfang, x = 5.1 and y = 2.18 next to room 106), `fixed` uses `height`
  (existing main-level partitions 2.3 m = tie-beam level, new wing partitions 2.4 m).
- **Dividers** (`WallKind 'divider'`, thickness 0) split open-plan areas into named rooms (Leseskrok | Stue,
  Stue | Kjøkken, Kjøkken | Passasje | Spiseplass, Korridor | Kjøkken). They are graph edges only: dashed hairline in
  the plan, nothing in 3D, no openings, no area deduction.
- **Openings** are hosted on a block edge or a stored wall, positioned by `offset` (m from the host start to the
  opening centre). An opening may touch the host end (|end − hostLength| ≤ 1 mm) without a warning; `fullHeight`
  cuts up to the top profile (open woodshed front). Sill is measured from `levelId`'s floor (default: the floor zone
  containing the point 0.2 m inside the host at the centre, else the host level). Swing: `hinge: 'start'|'end'`
  (jamb nearer the host start/end), `side: 'left'|'right'` of the host line a→b that the leaf opens into
  (left = inside for exterior edges; exterior doors swinging out are 'right'). `status` 'removed' keeps demolished
  openings for the plan ("rives", dashed) and generates infill `patches`; removed openings are excluded from 3D
  and validation.
- **Rooms** are records with an anchor point and a level; geometry comes from room detection.

## Derivation pipeline (`geometry/derive.ts`), all pure and unit-tested

1. `deriveBlocks(variant, site, terrain)` → axis/outer/inner outlines with per-edge offsets (own inner offset where
   the block keeps the wall, the other block's `outerOffset` where the other block keeps a 'wall' junction, 0 where
   'open'; `outer` offsets only along edges that are exterior in the union), parts and zones clipped, edges with
   outward normals, eaveZ/ridgeZ/pitch, lowestFloorZ, groundZ.
2. `buildRoofs(variant, blocks)` (`roof.ts`) → `DerivedRoof[]` with automatic ridge extension (below), slopes split
   at part boundaries (isNew), trims, outline. Exposes `roofUndersideAt(roof, x, y)` and
   `combinedUndersideAt(roofs, x, y)` = MAX over roofs whose outline contains the point (null if none) — the single
   function used by wall tops, opening head checks, chimney exit, measurable area and walk mode.
3. `deriveWalls(variant, blocks, roofs)` (`walls.ts`) → exterior pieces (split at part + zone boundaries, junction
   handling, mitred corners at block vertices, butt ends elsewhere) + stored walls (interior, exterior-old,
   divider); each with footprint, `topProfile` (exact piecewise-linear upper envelope; level ceiling / fixed height
   where applicable), `levelIds` (z range covers level.elevation + 1.0), openings resolved (sillZ/headZ, swing arc,
   rendering hints, `opening-above-roof` when headZ > envelope − 0.05), patches for removed openings, validation
   (fit inside host incl. the end-touch rule, overlaps).
4. `detectRooms(...)` (`planarGraph.ts` + `rooms.ts`) per storey: ONE planar graph from the reference lines of all
   walls whose `storeyIds` include the storey (exterior pieces take part in every storey of their block), plus the
   `replace` zone boundaries (as dividers) and, for the loft storey, the `add` zone boundaries. Split segments at
   crossings/T-junctions/overlaps, merge nodes within 1 cm, snap a free wall end onto any wall within 5 cm, then
   drop remaining dangling edges with warning `wall-dangling`. Extract faces (half-edge walk, smallest left turn),
   discard the outer face, faces < 0.3 m², and (loft) faces whose label point is outside every `add` zone. Each face
   gets the level of the zone containing its label point, else the block level. A Room attaches to the face
   containing its anchor (a face with several anchors keeps the first and warns). Inner polygon =
   polygon-clipping difference(face polygon, union of the footprints of the walls on its boundary), largest ring,
   holes kept; dividers subtract nothing. `areaExisting/areaNew` by clipping with part polygons.
5. Floors: one `room` floor per room (type `apning` → none), `threshold` pieces under openings between rooms at the
   lower room's z, `slab` per zone / level (with stair footprints as holes on the arrival level).
6. `deriveOutdoor` (`outdoor.ts`): decks (skirt bottoms from terrain), railings (panels between gaps, posts at
   corners/gap ends/≤ 1.5 m), steps in gaps with `steps: true` (risers = ceil(drop / 0.18), going 0.3, drop from the
   deck top to the terrain 0.5 m outside the gap), hot tubs (z from the deck under the centre, else terrain).
7. `deriveStructure`: posts/beams/chimney with absolute z (`roofExitZ` from the roof envelope + thickness), stairs
   as treads (n = ceil(dz / 0.18), going = length / n, arrow from bottom to top).
8. `computeAreas` (`areas.ts`), foundations (outer outline, topZ = lowestFloorZ, bottomZ = groundZ − 0.3), site
   trees with terrain baseZ, dimensions (one axis chain per cardinal side of the union of blocks + a total),
   bounds, warnings.

`deriveVariant` is memoised on (variant, site, terrain) object identities (nested WeakMaps).

### Derived ids (stable across unrelated edits)

Exterior piece: `${blockId}/${edgeId}/${partId}/${zoneId ?? 'base'}`; stored wall: the wall id; face without a
room: `face-<fnv1a hash of the sorted bounding wall ids>`; floors: `${roomId}/floor`, `${openingId}/threshold`,
`${blockId}/${zoneId ?? 'base'}/slab`; steps: `${railingId}/steps/${gapIndex}`.

### Roof rules

- Gable: ridge centred across the block's bbox perpendicular to `ridgeAxis`. Underside at the axis line =
  `eaveHeight` above the block's level floor; underside at the ridge = `ridgeHeight` (or from `pitchDeg` when
  `drive === 'pitch'`). Top surface = underside + `thickness` (vertical). Eave overhang 0.51 m beyond the axis
  line, gable overhang 0.35 m. Mono: high side opposite `slopeTo`, overhangEave on low and high sides, overhangGable
  on the ends. Flat: overhangEave all round, underside = eaveHeight.
- **Automatic ridge extension**: for each ridge-axis end E of block B, if the midpoint of B's end edge lies within
  1 cm of another block's polygon edge, walk from the end edge along the ridge line and take the first distance d
  where the upper envelope of the OTHER roofs' undersides ≥ B's ridge underside (equal ridges → the other ridge
  line). Examples (28°, heights above main floor): glass bump (ridge 3.28) runs north into the main roof (3.87) →
  meets at y = 3.1 − (3.87−3.28)/tan 28° = 1.99; bod wing likewise to y = 4.21; the main roof (3.87) runs east to the
  new wing's ridge at x = 18.4. The slab region beyond B's polygon is clipped in plan to the union of the other
  roofs' outlines (polygon-clipping) and gets no overhang of its own; no barge board on extended ends; fascias only
  on eave segments outside other roofs' outlines. If the envelope never reaches the ridge height, E is a free gable
  (overhangGable) with warning `roof-no-meet`. `Roof.extend.start/end` = total distance beyond the axis line,
  replacing both the automatic extension and overhangGable.
- Valleys are not computed as geometry: overlapping slabs render correctly from the outside.

### Areas (shown with an on-screen explanation, `AreaSummary`)

- **BYA** (bebygd areal, NS 3940): `buildings` = area of the union of block outer outlines (outside of cladding);
  `decks` = deck area (minus buildings) where deck top − terrain > 0.5 m (grid-sampled at 0.25 m);
  `total = buildings + decks`. Existing/new = partition of the union outline by parts (each point belongs to the
  part containing it, else the nearest). Invariants (tested on the seed): `existing + new = total`,
  `perBlock` are per-block (not unioned) and documented as such.
- **BRA** (bruksareal): per level, `gross` = area inside the union of block inner outlines restricted to that level
  (base polygon minus `replace` zones, or the zone / `add` zone polygon), `area` = measurable part: for levels
  without a ceiling only where `combinedUndersideAt − level.elevation ≥ 1.9` expanded by a 0.6 m strip (per slope
  a half-plane parallel to the ridge), minus `apning` rooms. Loft counts only its measurable part.
- **Aksemål**: the spec's convention (170.2 m²), for comparison only.
- **Rom (netto)**: inner-face polygon area per room, split existing/new.
- No area limiter in phase 1 (Robin's decision); `areaLimit` stays null and the `area-limit` warning is dormant.

## 2D plan (SVG, `plan2d/`)

Metres → pixels through the flipped root group and one `viewBox`; pan/zoom with pointer events (drag, wheel,
pinch; `touch-action: none`). Layers (bottom→top): grid (1 m, 5 m darker), terrain shade (optional), decks,
floors (material tint), wall union outlines (existing: fill #2b2b2b; new: fill #c8742a tint, outline #8a4d1c;
removed: dashed grey), dividers (dashed hairline), openings (windows: triple line; doors: leaf + swing arc from
`DerivedOpening.swing`; frameless openings: gap), structure (posts, chimney hatched, stairs with arrow and
tread lines), railings/steps, room labels (name, `b × d` with comma decimals, `m²`), dimension lines
(`DerivedDimension`), north arrow, scale bar. Label density: ≥ 25 px/m full label, 12–25 px/m name only,
< 12 px/m none. Numbers use Norwegian formatting (`formatM`, `formatM2` in `ui/format.ts`: `2,2 × 4,2 m`, `13,4 m²`).
Plan tabs: "Plan 1" (storey ground: lower + main) and "Hems" (storey loft); other storeys' walls as faint outlines.

## 3D view (R3F, `view3d/`)

`<Canvas dpr={[1, 1.5]} frameloop="demand" shadows>` with `invalidate()` on store changes and control changes;
shadow map 2048 (1024 and no soft shadows on `(pointer: coarse)`). Groups: `exterior` (walls + roofs + openings +
foundations), `interior` (floors, interior walls, structure, furniture), `base` (terrain, water, decks, railings,
steps, hot tub, trees). Modes: `ute` (all), `inne` (roofs hidden; storeys above the active storey hidden; each
visible wall piece rebuilt with top = min(topProfile, level.elevation + cutHeight) and a cap material — geometry
rebuild memoised per cut height, NOT renderer clipping planes). Wall meshes: per piece, sub-prisms (piers between
openings, lintels, sills) over slices of the footprint with per-vertex top z from the profile; never overlapping
volumes with coplanar faces. Materials ported from the old model (`materials.ts`: canvas textures for dark vertical
boards, turf, deck boards, pine floor, tiles, logs; sage-green trim #6f8170; white/green frames; exterior glass
#27313a with opacity 0.35, interior pane 0x9cc3dd 45 %). "Marker det som er nytt" tints new parts orange
(emissive) using separate material sets. Labels via drei `<Html occlude>` (name + dims + area, ≤ 30 visible,
same density rule by camera distance), toggleable. Camera presets defined in plan coords relative to `bounds`
(from the old model's Forslag D views): oversikt p(36,−25,26) t(11.5,4.5,1.5); terrassen p(29,19,8) t(14.5,8,1.2);
framsiden p(38,2,4.5) t(16,2.5,2); baksiden p(−14,22,8) t(8,5,2); ovenfra p(12,4.49,54) t(12,4.5,0);
naert-tilbygget p(26,−9,12) t(17.5,2.5,0.6); inne-stua p(9.5,1.2,1.6) t(15,2.5,1.3). OrbitControls damped,
maxPolarAngle 0.495·π, minDistance 3, animated transitions (~900 ms, skipped with reduced motion).
Sun: directional light from `sunInPlan` for the chosen date/time (default 21 June 15:00 local).

## State (`state/store.ts`)

```ts
interface AppState {
  project: Project;                       // tracked by zundo (partialize: project only, limit 200), autosaved
  ui: { activeView: 'plan'|'3d'|'split'; planStorey: 'ground'|'loft'; activeStoreyId: Id; mode3d: 'ute'|'inne';
        cutHeight: number; showLabels: boolean; showDims: boolean; showGrid: boolean; showRoofPlan: boolean;
        highlightNew: boolean; showTrees: boolean; showTerrain: boolean; preset: CameraPreset;
        selection: Selection | null; tool: 'select'|'measure'; sun: { date: string; minutes: number };
        readOnly: boolean; source: 'local'|'link'|'version' };
  // project actions — every edit goes through an action
  setProject(p), updateVariant(id, recipe, opts?: { transaction?: string }), duplicateVariant(id, name),
  setActiveVariant(id), renameVariant(id, name), deleteVariant(id), renameRoom(roomId, name), ...
  beginTransaction(label) / commitTransaction()   // drags and sliders = ONE undo step (zundo pause/resume)
  undo(), redo(), canUndo, canRedo
  setUi(partial)
}
```
`selection.ts`: `type Selection = { kind: 'wall'|'blockEdge'|'blockVertex'|'opening'|'room'|'block'|'deck'|
'railing'|'hotTub'|'structure'|'furniture'|'tree'; id: Id; levelId?: Id }`; selectors return null for a dangling
selection after undo. While `ui.readOnly` every project action is a no-op and autosave is off; "Lag min egen kopi"
assigns a new project id (+ `basedOnProjectId`), clears readOnly and removes `#d=` with `history.replaceState`.
Derived model via `useDerived()` = `deriveVariant(activeVariant, site, terrainAsset)`.

`persistence.ts`: autosave of `project` (debounced 500 ms) to localStorage `hytte-planlegger:project`; UI prefs
under `hytte-planlegger:ui`; named versions `hytte-planlegger:versions` = `{ id, name, savedAt, projectId,
schemaVersion, project }[]`, listed for the current projectId newest first, capped at 30 with size shown; export /
import JSON file; share link `#d=` + lz-string `compressToEncodedURIComponent(JSON of { v, project })` encoding
only the active variant by default ("del alle varianter" toggle), size shown, warning above ~8 kB with "send som
JSON-fil" fallback; never includes terrain. All storage access in try/catch; listen to the `storage` event and do
not overwrite a newer `updatedAt` from another tab. Seed updates: `Project.seedRevision` vs the bundled
`SEED_REVISION` → offer "Hent ny Forslag D" (adds the new seed as a variant, keeps the user's variants) and
"Tilbakestill til Forslag D". `migrate.ts`: `migrateProject(raw)` applies `migrations[v]` in order, throws
`SchemaTooNewError` when `schemaVersion > CURRENT_SCHEMA_VERSION` (UI: "Last siden på nytt"); runs on autosave,
versions, imports and links; one Vitest fixture per schema version.

Editing invariants (phase 2, documented now): moving a block vertex / wall endpoint re-offsets openings on the
affected host so their plan position is preserved (clamped, `opening-outside-host` if it no longer fits); stored
walls whose endpoint lies within 1 cm of a moved block edge are extended/trimmed along their own direction.

## UI (`ui/`)

Layout: top bar (title, variant selector + duplicate/rename, undo/redo, Lagre versjon / Versjoner / Eksporter /
Importer / Del lenke, Hjelp) · left column (view tabs Plan/3D/Begge, plan storey tabs, 3D mode + cut height +
presets, toggles, sun date/time) · centre (plan and/or 3D) · right column (Romskjema table, Arealer with
explanations, Egenskaper for the selection, Advarsler). Headline numbers always visible: BYA total / eksisterende /
nytt, BRA per level. Phone (< 800 px): stacked, 3D first, panels collapsible, heights in `100dvh`, canvas and SVG
with `touch-action: none`. Read-only (shared link): banner with "Lag min egen kopi"; edit panels/tools hidden, view
controls, schedule and areas kept. Theme tokens from the old model (self-hosted Barlow / Barlow Semi Condensed,
`--accent #4f6b55`, `--new #c8742a`, light + dark). All strings in `i18n/nb.ts`.

## Component contracts (fixed so modules can be built in parallel)

```tsx
// src/plan2d/PlanView.tsx
export interface PlanViewProps {
  derived: DerivedVariant;
  site: Site;
  planStorey: 'ground' | 'loft';
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  showLabels: boolean; showDims: boolean; showGrid: boolean; showRoofPlan: boolean; highlightNew: boolean;
}
export const PlanView: ForwardRefExoticComponent<PlanViewProps & RefAttributes<PlanViewHandle>>; // root <svg data-testid="plan-view">
export interface PlanViewHandle { fitView(): void; getSvg(): SVGSVGElement | null }

// src/view3d/View3D.tsx
export interface View3DProps {
  derived: DerivedVariant;
  site: Site;
  terrain: TerrainAsset | null;
  mode: 'ute' | 'inne';
  activeStoreyId: Id;
  cutHeight: number;              // metres above each level floor, interior mode (1.2–2.6)
  showLabels: boolean; highlightNew: boolean; showTrees: boolean; showTerrain: boolean;
  sun: { dir: Vec3; isUp: boolean };   // unit vector towards the sun, plan frame
  preset: CameraPreset;            // changing it animates the camera
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  onReady?: () => void;            // first frame rendered
}
export type CameraPreset = 'oversikt' | 'terrassen' | 'framsiden' | 'baksiden' | 'ovenfra' | 'naert-tilbygget' | 'inne-stua';
export function View3D(props: View3DProps): JSX.Element   // root <div data-testid="view-3d"> containing the <Canvas>

// src/state/selection.ts
export type Selection = { kind: 'wall'|'blockEdge'|'blockVertex'|'opening'|'room'|'block'|'deck'|'railing'|'hotTub'|'structure'|'furniture'|'tree'; id: Id; levelId?: Id };
```

Test hooks the UI must provide: `data-testid` = `view-tab-plan`, `view-tab-3d`, `view-tab-split`, `mode-ute`,
`mode-inne`, `preset-<CameraPreset>`, `plan-storey-ground`, `plan-storey-loft`, `room-schedule`, `area-totals`,
`toggle-labels`, `toggle-new`; and `window.__hytte = { ready: boolean; project: Project; derived: DerivedVariant }`
kept current (`ready` after the first 3D frame).

## Geometry API (signatures the modules agree on)

```ts
// geometry/polygon.ts
export const EPS: number;                                  // 1e-6
export function signedArea(poly: Vec2[]): number;          // >0 for CCW
export function area(poly: Vec2[]): number;
export function isCCW(poly: Vec2[]): boolean;
export function ensureCCW(poly: Vec2[]): Vec2[];
export function centroid(poly: Vec2[]): Vec2;
export function bbox(poly: Vec2[]): { min: Vec2; max: Vec2 };
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean;   // boundary counts as inside
export function offsetPolygon(poly: Vec2[], d: number): Vec2[];   // d > 0 = outward for a CCW polygon, mitre joins
export function offsetPolygonPerEdge(poly: Vec2[], outward: number[]): Vec2[]; // outward[i] for edge i (vertex i → i+1), negative = inward
export function unionArea(polys: Vec2[][]): number;        // polygon-clipping union, holes respected
export function unionPolygons(polys: Vec2[][]): Vec2[][][]; // MultiPolygon [poly][ring][pt], ring 0 = outer
export function intersectPolygons(a: Vec2[][], b: Vec2[][]): Vec2[][][];
export function differencePolygons(a: Vec2[][], b: Vec2[][]): Vec2[][][];
export function multiPolygonArea(mp: Vec2[][][]): number;
export function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): { point: Vec2; ta: number; tb: number } | null;
export function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null;
export function distancePointSegment(p: Vec2, a: Vec2, b: Vec2): number;
export function projectPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2 };
export function collinearOverlap(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2, eps?: number, angleEps?: number): [Vec2, Vec2] | null;
export function labelPoint(poly: Vec2[], holes?: Vec2[][]): Vec2;  // pole of inaccessibility (simplified)
export function rectDims(poly: Vec2[]): { w: number; h: number; approx: boolean };
export function simplifyCollinear(poly: Vec2[], eps?: number): Vec2[];
export function fnv1a(s: string): string;                  // short stable hash for derived ids

// geometry/planarGraph.ts
export interface GraphSegment { id: string; a: Vec2; b: Vec2 }
export interface PlanarGraph { nodes: Vec2[]; edges: { from: number; to: number; segmentIds: string[] }[]; dangling: string[] }
export function buildPlanarGraph(segments: GraphSegment[], opts?: { eps?: number; snap?: number }): PlanarGraph;
export interface Face { polygon: Vec2[]; nodeIndices: number[]; edgeIndices: number[]; area: number; isOuter: boolean }
export function extractFaces(graph: PlanarGraph): Face[];

// geometry/rooms.ts
export interface WallLine { id: string; a: Vec2; b: Vec2; footprint: Vec2[] /* [] for dividers */ }
export interface DetectedRoom { faceId: string; facePolygon: Vec2[]; innerPolygon: Vec2[]; holes: Vec2[][]; area: number; labelPoint: Vec2; bbox: { min: Vec2; max: Vec2 }; dims: { w: number; h: number; approx: boolean }; wallIds: string[] }
export function detectRooms(lines: WallLine[], opts?: { minArea?: number; eps?: number; snap?: number }): { rooms: DetectedRoom[]; dangling: string[] };

// geometry/roof.ts
export function roofParams(block: Block, level: Level): { eaveZ: number; ridgeZ: number; pitchDeg: number; pitchRad: number; ridgeLine: { a: Vec2; b: Vec2 }; halfWidth: number };
export function ridgeExtension(block: Block, variant: Variant): { start: number; end: number; startFree: boolean; endFree: boolean };
export function buildRoof(block: Block, variant: Variant, blocks: DerivedBlock[]): DerivedRoof;
export function buildRoofs(variant: Variant, blocks: DerivedBlock[]): DerivedRoof[];
export function roofUndersideAt(roof: DerivedRoof, x: number, y: number): number | null;
export function combinedUndersideAt(roofs: DerivedRoof[], x: number, y: number): number | null;

// geometry/walls.ts
export function deriveBlocks(variant: Variant, site: Site, terrain: TerrainAsset | null): DerivedBlock[];
export function deriveWalls(variant: Variant, blocks: DerivedBlock[], roofs: DerivedRoof[]): { walls: DerivedWall[]; warnings: ModelWarning[] };

// geometry/outdoor.ts
export function deriveOutdoor(variant: Variant, site: Site, terrain: TerrainAsset | null): DerivedVariant['outdoor'];
export function deriveStructure(variant: Variant, roofs: DerivedRoof[]): DerivedStructure[];

// geometry/areas.ts
export function computeAreas(input: { variant: Variant; blocks: DerivedBlock[]; rooms: DerivedRoom[]; roofs: DerivedRoof[]; decks: DerivedDeck[]; site: Site; terrain: TerrainAsset | null }): AreaSummary;

// geometry/terrain.ts
export function sampleTerrainAsl(terrain: TerrainAsset, x: number, y: number): number | null;   // finest grid covering the point, bilinear
export function terrainZAt(terrain: TerrainAsset | null, site: Site, x: number, y: number): number; // relative to main floor, after ground works; fallback -0.5 when no data

// geometry/geo.ts
export function planDirOfBearing(site: Site, bearingDeg: number): Vec2;
export function bearingOfPlanDir(site: Site, v: Vec2): number;
export function trueNorthInPlan(site: Site): Vec2;
export function planToLatLon(site: Site, p: Vec2): { lat: number; lon: number };
export function latLonToPlan(site: Site, lat: number, lon: number): Vec2;
export function localInstant(site: Site, dateISO: string, minutes: number): Date;   // wall-clock in site.timezone → instant
export function sunInPlan(site: Site, instant: Date): { dir: Vec3; altitudeDeg: number; bearingDeg: number; isUp: boolean };

// geometry/derive.ts
export function deriveVariant(variant: Variant, site: Site, terrain: TerrainAsset | null): DerivedVariant;
```

## Testing

- `npm test` → Vitest (`src/**/*.test.ts`): geometry, room detection (incl. the seed: korridor nedre/øvre, bad,
  vindfang, hems 1/2 all detected and named), roofs (extension distances 1.99 / 4.21 / 18.4; wall x = 16 profile
  peaks at 3.87; wall y = 6.2 x 5–9 peaks at 3.26), areas (invariants above, axis total 170.16), migrations, seed invariants.
- `npm run e2e` → Playwright (Chromium) loads the app, waits for `window.__hytte.ready`, screenshots plan, 3D
  exterior (oversikt), 3D interior (inne-stua) and a 375 px phone view into `e2e/screenshots/`.
- `npm run build` must pass with zero TypeScript errors; `npm run lint` (oxlint) clean.

## Rules for contributors (humans and agents)

- Do not change files you do not own in a parallel task; propose instead. Do not add dependencies without noting it.
- No geometry in renderers; no React in `geometry/`. Keep functions small and tested.
- Never silently change Robin's design: if the spec is contradictory, keep the spec and add a `ModelWarning` or a note.
- Norwegian in UI, comma decimals, `m²`. English in code.
- Keep `STATUS.md` current: done / next / known issues.

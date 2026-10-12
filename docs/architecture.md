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
               seed/frozen/forslagD.schema1.json + seed/frozenSeed.ts (the phase-1 seed, schema 1 / revision 3,
               frozen for decoding phase-1 share links; never edited),
               seed/terrain-merkesvatnet.json (TerrainAsset, built by scripts/build-terrain.mjs)
               unitTemplates.ts ("Nytt bygg" templates: Vedskjul, Bod, Badstue, Anneks, Eget bygg; names from nb.ts)
  geometry/    pure functions, fully unit-tested, no React/three imports:
               polygon.ts planarGraph.ts rooms.ts roof.ts walls.ts outdoor.ts areas.ts derive.ts geo.ts terrain.ts
               levels.ts (which level's floor is at a point: room detection and `levelAt`)
               edit.ts (phase 2: every edit rule as `apply…(draft, ctx, …)`, status bookkeeping, reconcileRooms)
               snap.ts (phase 2: snapping and dimension chips)
  state/       store.ts (zustand + zundo + immer), selection.ts, persistence.ts (autosave, versions, share link),
               editActions.ts (phase 2: the edit API and the drag protocol on a store; `useEditActions()`),
               editStrings.ts (= nb.editor)
  plan2d/      SVG plan: PlanView.tsx and parts; editing: usePlanEditing.ts (gestures, tools), editModel.ts (handles,
               hit tests), editTypes.ts (the plan's side of the edit contract), editFeedback.ts, planSnap.ts,
               layers/EditOverlay.tsx, Legend.tsx, GhostLayer.tsx, FurnitureLayer.tsx
  view3d/      R3F scene: View3D.tsx, Scene.tsx, coords.ts, materials.ts, Walls.tsx, Roofs.tsx, Floors.tsx,
               Openings.tsx, Outdoor.tsx, Terrain.tsx (+ ground.ts), Trees.tsx, Labels.tsx (+ labelDefs.ts), StructureMeshes.tsx,
               cameras.ts, SunLight.tsx; phase 2: selection3d.ts (click selection tags), sceneParts.ts (group reuse),
               drop.ts + dropEvent.ts (furniture drop target), FurnitureMeshes.tsx (placeholder boxes)
  ui/          App shell, panels, theme.css, format.ts, components; phase 2: Toolbar, HintLine, Toasts, NumberField,
               PropertiesEditor / PropertiesPanel (+ editors/), BottomSheet, SelectionMiniBar, LibraryPanel,
               FirstRunCard, editorBridge.ts (UiEditActions context, tools, lock helpers), commands.ts, overlay.ts
  i18n/        nb.ts — every user-visible string lives here
  furniture/   catalogue + components (phase 3)
e2e/           Playwright: smoke.spec.ts, editing.spec.ts (desktop), phone-editing.spec.ts (iPhone project), helpers.ts,
               screenshots (e2e/screenshots/*.png, committed)
docs/          this file, kalibrering-ifc.md (IFC facts), seed-brief-forslag-d.md (what the seed contains)
data/geo/      raw Kartverket elevation grids and the IFC element dump (inputs for scripts)
scripts/       build-terrain.mjs (data/geo → src/model/seed/terrain-merkesvatnet.json),
               freeze-seed-schema1.mjs (one-off: wrote seed/frozen/forslagD.schema1.json; refuses to run on a newer seed)
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
  `terrainZAt(terrain, site, x, y, extra?)` returns the height RELATIVE to the main floor after the site's ground
  works (cuts) and the `extra` ones; renderers pass `derived.groundWorks` (site cuts + one implicit cut per block).
- **three.js world**: `X = x, Y = z, Z = −y` (a proper rotation, det +1, same as the old model's `W(x,y,h)`).
  Helpers `toWorld(x, y, z)` / `fromWorld(v)` in `view3d/coords.ts`. A `THREE.Shape` built in plan (x, y) needs
  `rotation.x = −π/2`; keep face winding consistent (shapes are CCW in plan).
- **SVG plan**: y points down on screen, so ALL plan geometry is drawn inside one root
  `<g transform="matrix(s 0 0 -s tx ty)">`; text/labels are placed in screen space (or in a counter-flipped
  group) so they read correctly. The result matches the architect's drawings: lake side at the bottom, new wing
  on the right. The north arrow uses `planDirOfBearing(0)` (points down-left).
- **Sun** (`sunInPlan(site, instant)`): `const p = SunCalc.getPosition(instant, lat, lon)`. The installed suncalc
  is v2: it returns DEGREES, the azimuth is already a compass bearing (from north, clockwise) and the altitude is
  refraction-corrected, so `bearing = p.azimuth` (the v1 convention "from south, `+ π`" does not apply);
  `d = planDirOfBearing(bearing)`; `dir = (d.x·cos(alt), d.y·cos(alt), sin(alt))` (unit vector towards the sun);
  `isUp = alt > 0`. The instant is built from (date, local minutes) in `Site.timezone` via an Intl offset lookup
  (`localInstant`), never from the device zone. Midnight sun / polar night: altitude ≤ 0 → light intensity 0,
  shadows off, note "under horisonten". (21 June 15:00 at Merkesvatnet: altitude ≈ 41°, bearing ≈ 217°.)

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
  [5,9]×[6.2,12.1] with parts [6.2,10.1] existing and [10.1,12.1] new; the glass bump [5,9]×[−2,0] has one existing
  part `part-glass-old` over its whole outline (`SEED_REVISION` 5). Parts and floor zones are clipped to the
  block polygon at derive time; the uncovered remainder is an implicit part/zone (no tiling invariant, so dragging a
  block edge just works). The implicit remainder of a block WITH explicit parts is new (`isNew: true`, phase 2): an
  explicit existing part never grows, so dragging an edge of today's cabin outwards adds new area and the existing
  BYA stays (`walls.ts implicitIsNew`; the same rule in roof.ts and in the fallback regions of areas.ts). An EXISTING
  block without parts (a copy saved before revision 5) gets its pre-edit outline as the existing part `${id}-today`
  ("Hytta i dag") the first time an edit changes its outline (copy-on-write, `edit.ts todayPart` in
  `applyBlockPolygons`), so the same rule covers it. Overlapping parts → `parts-overlap`.
- **Ghosts** (phase 2, docs/phase2-plan.md §1.2): walls and openings with status `removed` (`DerivedWall.isGhost`,
  `DerivedOpening.isGhost`) stay in the derived walls / openings and the `removed` wall unions for the plan, which
  draws them dashed ("Fjernet") only while "Vis hva som er nytt" is on. They take no part in room detection, areas,
  thresholds, validation or 3D (removed openings still leave infill `patches` in their wall). Moved existing block
  edges leave `Variant.ghosts` (`{ id, a, b }`, passed through as `DerivedVariant.ghosts`, dashed lines in the plan),
  and so do the ranges a shortened existing edge lost (partner stubs included; first free id `…/ghost`, `…/ghost/2`).
  Existing openings that a block-edge move carries or clamps turn new and leave their ghost at the old centre, hosted
  on a removed `'exterior-old'` wall with the edge ghost's id (`ensureGhostHost`), so the plan draws the old wall band
  with its windows and "Ta tilbake" on the edge ghost puts the edge and those openings back. When an `'open'` junction
  newly covers a stretch of today's wall on a partner edge that did not move (the glass bump's east wall +0.5 m opens
  blk-main's south wall x 9..9.5), that stretch gets an edge ghost too (`edit.ts addJunctionGhosts`; stretches that
  were open already get none); `healGhosts` keeps it while the junction still covers it, and its "Ta tilbake" moves
  the other block's edge back (`uncoverJunction`).
- **Trees** (fix round after 2a): `Site.trees` are today's trees. A proposal gets its own copy in the optional
  `Variant.trees` on its first tree edit (copy-on-write in `editActions.ts`: add, move, delete, drag, nudge), so the
  site and Forslag D never change. Every reader goes through `treesOf(project, variant)` (geometry/derive.ts) =
  `variant.trees ?? site.trees`; derive places them per variant in `DerivedVariant.site.trees`, which the plan, 3D and
  selection read. No schema bump; share links carry the field as a changed top-level variant value.
- **Locked variant**: the bundled Forslag D has `Variant.locked: true` (`DerivedVariant.locked`); it is the
  read-only base proposal. `duplicateVariant` makes an unlocked copy; migrated phase-1 variants are not locked.
- **Decks** (schema 2): `Deck.polygon` is a list of `DeckVertex { id, p }` (edge i runs from vertex i to i + 1 and has
  vertex i's id) on the deck's own line; it may overlap buildings. `Deck.railing { style, height }` (optional) runs
  along every FREE run of the deck's edges except the edges in `noRailingEdges`; `Deck.steps` are `DeckSteps { id,
  edgeId, offset, width }` hosted on an edge like an opening (offset from the edge start to the centre). There is no
  stored railing path any more (`Outdoor.railings` is gone): the railing follows the buildings automatically.
- **Floor zones**: `replace` zones carve the base floor (the lower bedroom part x < 5.1, floor −1.0); their boundary
  acts as a divider in room detection (the corridor splits at the step). `add` zones stack a floor on another level
  (the loft over the bedroom part); their boundary bounds that storey's room graph. Exterior wall pieces are split
  at zone boundaries and take `baseZ` from the zone they run along (test: piece midpoint nudged 1 cm inside).
- **Levels and storeys**: `lower` (−1.0, ceiling 2.3, storey ground), `main` (0, open to roof, storey ground),
  `loft` (1.47, floorThickness 0.17, storey loft). Exterior walls always run to the roof envelope. Stored walls:
  `auto` stops at the level ceiling if any (lower-level partitions stop under the loft floor at 1.3), else at the
  ceiling of the block it stands in (`Block.ceilingHeight`: the new wing has a flat ceiling at 2.4, so its
  partitions stop there; the bod wing has none, so `w-bod-ved` runs to the roof), `roof` runs to the roof envelope
  (x = 5.05 bathroom/vindfang, x = 5.1 and y = 2.18 next to room 106, x = 16 stue | new wing, which peaks under the
  main ridge at 3.87), `fixed` uses `height` (existing main-level partitions 2.5 m = top of the tie beams, IFC).
- **Dividers** (`WallKind 'divider'`, thickness 0) split open-plan areas into named rooms (Leseskrok | Stue,
  Stue | Kjøkken, Kjøkken | Passasje | Spiseplass, Korridor | Kjøkken). They are graph edges only: dashed hairline in
  the plan, nothing in 3D, no openings, no area deduction.
- **Openings** are hosted on a block edge or a stored wall, positioned by `offset` (m from the host start to the
  opening centre). An opening may touch the host end (|end − hostLength| ≤ 1 mm) without a warning; `fullHeight`
  cuts up to the top profile (open woodshed front). Sill is measured from `levelId`'s floor (default: the floor zone
  containing the point 0.2 m inside the host at the centre, else the host level). Swing: `hinge: 'start'|'end'`
  (jamb nearer the host start/end), `side: 'left'|'right'` of the host line a→b that the leaf opens into
  (left = inside for exterior edges; exterior doors swinging out are 'right'). `leaves: 2` = double door: two
  half-width leaves hinged at both jambs (`DerivedOpening.swing` + `swing2`; `door-stue-s` has two 0.8 m leaves).
  `status` 'removed' keeps demolished openings for the plan ("Fjernet", dashed) and generates infill `patches`
  (the rectangles of the openings that stay in the same wall piece are subtracted, so one patch can become several
  rectangles); removed openings are excluded from 3D and validation.
- **Rooms** are records with an anchor point and a level; geometry comes from room detection.

## Derivation pipeline (`geometry/derive.ts`), all pure and unit-tested

1. `deriveBlocks(variant, site, terrain)` (+ `block-self-intersecting` for an axis polygon whose boundary crosses
   itself) → axis/outer/inner outlines with per-edge offsets (own inner offset where
   the block keeps the wall, the other block's `outerOffset` where the other block keeps a 'wall' junction, 0 where
   'open'; `outer` offsets only along edges that are exterior in the union), parts and zones clipped, edges with
   outward normals, eaveZ/ridgeZ/pitch, lowestFloorZ, groundZ.
2. `buildRoofs(variant, blocks)` (`roof.ts`) → `DerivedRoof[]` with automatic ridge extension (below), overhangs
   inside other blocks dropped, slopes cut at their valley lines and split at part boundaries (isNew), trims,
   outline. Exposes `roofUndersideAt(roof, x, y)` and
   `combinedUndersideAt(roofs, x, y)` = MAX over roofs whose outline contains the point (null if none) — the single
   function used by wall tops, opening head checks, chimney exit, measurable area and walk mode.
3. `deriveWalls(variant, blocks, roofs)` (`walls.ts`; = `deriveWallPieces` then `attachWallOpenings`, which the
   derive stages call separately) → exterior pieces (split at part + zone boundaries, junction
   handling, mitred corners at block vertices, butt ends elsewhere) + stored walls (interior, exterior-old,
   divider); each with footprint, `topProfile` (exact piecewise-linear upper envelope; level ceiling / fixed height
   where applicable), `levelIds` (stored walls: their own level plus every higher level whose elevation + 1.0 + 0.3
   the wall's topZ reaches AND that has a floor at the wall's midpoint — a block with it as base level or a zone of
   it, for the loft the 'add' zone — probed at the midpoint and 1 cm beyond either face, so walls along the zone
   boundary count; the 2.5 m corridor walls `w-vf-korr` / `w-korr-stue` stay out of the loft, `w-106-korr`,
   `w-103-102` and `w-106-stue` (to the roof, along the loft zone) are in it; exterior pieces: the block's base
   level plus the level of every floor zone the piece runs along), openings
   resolved (sillZ/headZ, swing arc, rendering hints, `opening-above-roof` when headZ > envelope − 0.05), patches
   for removed openings, validation (fit inside host incl. the end-touch rule, overlaps in plan AND height).
4. `detectRooms(...)` (`planarGraph.ts` + `rooms.ts`) per storey: ONE planar graph from the reference lines of all
   non-removed walls whose `storeyIds` include the storey (an exterior piece is in the storeys of its levels, so the
   main block's walls beside the loft zone bound the loft, the rest of them do not), plus the floor-zone edges as
   zero-thickness lines (`replace` zones on the zone's storey and the block base level's storey; `add` zones on the
   zone's storey). Split segments at crossings/T-junctions/overlaps, merge nodes within 1 cm, snap a free wall end
   onto any wall within 5 cm, then drop remaining dangling edges. Extract faces (half-edge walk, smallest left turn),
   discard the outer face and faces < 0.3 m². Each face is located by its label point: the zone of the storey
   containing it, else the block's base level when that is on the storey (and no `replace` zone carves the point
   out); faces outside every block or without a floor on the storey are dropped (this removes the loft faces
   outside every `add` zone). A Room attaches to the face of its storey whose inner polygon contains its anchor
   (else whose face polygon does); a second anchor in the same face, or an anchor in no face → `room-anchor-lost`;
   faces without a Room → `room-unnamed`; rooms < 0.5 m² → `room-small`. `wall-dangling` only for stored walls
   that dangle and bound no room on any storey (a partition with a free end that still forms rooms is fine).
   Inner polygon = polygon-clipping difference(face polygon, union of the footprints of the walls on its boundary),
   largest ring, holes kept; dividers subtract nothing. `areaExisting/areaNew` by clipping with the parts' inner
   polygons (`splitAreaByParts`).
5. Floors: one `room` floor per room (type `apning` → none); a `threshold` under every door / glass door /
   frameless opening with a room on at least one side (probed 5 cm beyond each wall face), at the lower room's z
   and material; a `slab` per floor zone and block base level whose level has `floorThickness > 0` (zone ∩ block
   inner outline). Stairwells: every stair footprint is cut out of all room floors, thresholds and slabs whose z
   lies above the stair's bottom and at most at its top (the level stair is a notch in Korridor (øvre)); a floor
   that falls apart keeps its id for the largest piece, the others get `/2`, `/3`, …; where nothing at or below
   the stair's bottom covers the footprint, a zero-thickness `slab` `${stairId}/stairwell` is added at the bottom
   z (`stair-level/stairwell` at −1; the loft stair needs none). A `ceiling` floor per block with `ceilingHeight`:
   the inner outline at level + ceilingHeight + 0.05 (top of a 5 cm board), id `${blockId}/ceiling`
   (`blk-wing/ceiling` at 2.45). Room floors can therefore have holes or several pieces.
6. Terrain: `DerivedVariant.groundWorks` = `site.groundWorks` + `blockGroundWorks(blocks)` (one implicit cut
   `gw-<blockId>` per block: its outer outline, maxZ = lowestFloorZ − 0.1), so the ground never rises into a floor
   (it did under the lower bathroom). Every terrain query in derive (blocks' groundZ, deck skirts, steps, hot tubs,
   trees, deck BYA) and in the renderers applies this list. Blocks whose outline touches another block's cut get
   that cut's depth (the bod and glass-bump foundations go down to about −1.4).
   `deriveOutdoor` (`outdoor.ts`, with `opts.blocks` = the derived blocks): decks — `pieces` = the stored outline
   minus every block's OUTER outline (holes where a unit stands on the deck), skirt bottoms per piece outer-ring vertex,
   `freeRuns` = the parts of the stored edges not inside or within 1 mm of a block outline (with the stored edge id
   and s0/s1 along it; runs < 1 cm dropped); one railing per deck with `railing` (id `${deckId}/railing`): the free
   runs minus `noRailingEdges` minus the gaps of the (not blocked) steps, chained in ring order where runs meet at a
   corner (the last chain joins the first), panels per straight segment, posts at chain ends, corners and every
   ≤ 1.5 m; `outdoor.steps` per `DeckSteps` projected on its own edge (at = edge start + offset, outward = the edge's
   outward normal; risers = ceil(drop / 0.18), going 0.3, drop from the deck top to the terrain 0.5 m outside);
   steps whose centre is not on a free run are `blocked` (warning `deck-steps-blocked`, no railing gap, no 3D mesh;
   steps on an unknown edge only warn); hot tubs (z from the deck piece under the centre, else terrain). For Forslag D
   the railing runs (9; −2,11) → (9; −4,6) → (23,2; −4,6) → (23,2; 12,1) → (9,11; 12,1) with the three stair gaps.
7. `deriveStructure`: posts/beams/chimney with absolute z (`roofExitZ` from the roof envelope + thickness), stairs
   as treads (n = ceil(dz / 0.18), going = length / n, arrow from bottom to top).
8. `computeAreas` (`areas.ts`), foundations (outer outline, topZ = lowestFloorZ, bottomZ = groundZ − 0.3), site
   trees with terrain baseZ, dimensions (one axis chain per cardinal side: the outermost block edges seen from that
   side, broken at block and part vertices, pieces set back more than 6.5 m left out, chain 1.0 m and a total
   1.8 m outside the outermost edge, running counter-clockwise so the offsets are negative), bounds (outer outlines
   + decks), wall unions per storey and status, warnings (blocks, roofs, walls/openings, rooms, decks, `area-limit`).
9. Furniture (placeholder until phase 2b): `DerivedFurniture` with `footprint` = the item's `size` rectangle rotated
   by `rotationDeg` about its position (`furnitureFootprint`), bbox, floorZ = z = the level elevation, `roomId` = the
   room of the item's storey containing the position, `catalog: null`, no clearances / collisions / warnings yet.

**Memo split** (docs/phase2-plan.md §2): `deriveVariant` is memoised on (variant, site, terrain) and is assembled from
stages, each memoised on the identities of what it reads (nested WeakMaps, `IdentityMemo` in derive.ts):
- building — (site, terrain, levels, blocks, walls, rooms, structure, ghosts): blocks, roofs, the wall pieces WITHOUT
  openings (`deriveWallPieces`), rooms, floors without the door thresholds, structure, foundations, dimensions, wall
  unions, ground works, BRA / axis / room areas (`computeBuildingAreas`) and their warnings;
- openings (second fix round after 2a) — (building, openings): the openings attached to copies of the pieces that
  hold them (`attachWallOpenings`; pieces without openings stay the same objects), the door thresholds (the stairwell
  floors are recomputed only when a threshold lies under a stair), the opening warnings (the warning order is kept);
- trees — (building, `treesOf(project, variant)`);
- outdoor — (building, outdoor.decks, outdoor.hotTubs): decks, railings, steps, hot tubs, BYA (`computeBya`, it
  needs the deck pieces), bounds, deck warnings;
- furniture — (building, furniture).
With immer's structural sharing an edit of the furniture (or of the outdoor) reuses the building and opening stages:
the derived `walls`, `rooms`, `floors` … are the same array instances (tested); an opening edit reuses rooms, roofs,
areas and the outdoor stage and re-derives only the opening stage (tested deep-equal to a derive from scratch). Seed
timings (this machine, Node, 20 runs each, 2026-10-12): an opening-only change 0.2–0.9 ms (median 0.3; limit 8), a
stored-wall move ≈ 41 ms, a block-edge change ≈ 40 ms (target 60; the test allows × 1.5 locally, where the files run
in parallel, × 3 on CI), a hot-tub move ≈ 4 ms, a furniture-only change ≈ 0.01 ms (limit 5).
`DerivedVariant` additions: `locked`, `ghosts`, `outdoor.steps`, `DerivedBlock.junctions` (`{ edgeIndex, s0, s1,
otherBlockId, otherEdgeIndex, role: 'owner' | 'removed' | 'open' }`), `WallSource` (blockEdge) `s0` / `s1` (the piece's
range on its edge), `DerivedWall.isGhost`, `DerivedOpening.levelId` (the level the sill is measured from) /
`isGhost`, `DerivedDeck.vertexIds` / `pieces` / `freeRuns`. `levelAt(derived, storeyId, p)` (model/derived.ts,
from geometry/levels.ts) = the level whose floor is at p on that storey (zones first, then the block's level; else the
storey's level closest to the main floor).

**Robustness.** `polygon.ts` is the only module that calls polygon-clipping (`areas.ts` uses its wrappers too). It
snaps every coordinate to a 1e-7 m grid, retries a failing operation on 1e-6, 1e-5 and 1e-4 m, and only then throws
`ClipError`. Every boolean operation in the pipeline has a local fallback (`withClipFallback`): a room subtracts its
wall footprints one at a time, else keeps the face polygon; the room area split is skipped; wall unions use the
individual footprints; part splits leave a slope unsplit; exact BRA falls back to the grid. Each pipeline stage is
also guarded, so a failing operation never throws out of `deriveVariant`. Each fallback taken becomes a `'generic'`
warning whose message starts with `GEOMETRY_FALLBACK` ("geometry fallback:"); `nb.ts` shows it as
`nb.warnings.geometryFallback(detail)`. Tests: `robustness.test.ts` (the seed rotated by 0.5°, 30° and every 2°, a
moved vertex, swapped vertices) and `clipFailure.test.ts` (polygon-clipping mocked to always fail, and to fail
every first attempt: no throw, all 27 rooms).

### Derived ids (stable across unrelated edits)

Exterior piece: `${blockId}/${edgeId}/${partId}/${zoneId ?? 'base'}`; stored wall: the wall id; face without a
room: `face-<fnv1a hash of the sorted bounding wall ids>`; floors: `${roomId}/floor`, `${openingId}/threshold`,
`${blockId}/${zoneId ?? 'base'}/slab`; railing: `${deckId}/railing`; steps: the stored `DeckSteps.id` (Forslag D's
are `rail-terrasse/steps/0..2`, the ids the v1 → v2 migration gives the phase-1 railing gaps).

### Roof rules

- Gable: ridge centred across the block's bbox perpendicular to `ridgeAxis`. Underside at the axis line =
  `eaveHeight` above the block's level floor; underside at the ridge = `ridgeHeight` (or from `pitchDeg` when
  `drive === 'pitch'`). Top surface = underside + `thickness` (vertical). Eave overhang 0.51 m beyond the axis
  line, gable overhang 0.51 m (every gable in the IFC). Mono: high side opposite `slopeTo`, overhangEave on low and high sides, overhangGable
  on the ends. Flat: overhangEave all round, underside = eaveHeight.
- **Automatic ridge extension**: for each ridge-axis end E of block B, if the midpoint of B's end edge lies within
  1 cm of another block's polygon edge, walk from the end edge along the ridge line and take the first distance d
  where the upper envelope of the OTHER roofs' undersides ≥ B's ridge underside (equal ridges → the other ridge
  line). Examples (28°, heights above main floor): glass bump (ridge 3.283 from 28° over 2 m) runs north into the
  main roof (3.868) → meets at y = 3.1 − (3.868−3.283)/tan 28° = 2.00; bod wing likewise to y = 4.20; the main roof
  runs east to the new wing's ridge at x = 18.4 (equal ridges). The slab region beyond B's polygon is clipped in plan
  to the union of the other roofed blocks' POLYGONS (axis lines, i.e. inside their walls — clipping to their roof
  outlines let the main roof poke out under the wing's gable overhang) and gets no overhang of its own; no barge
  board on extended ends; fascias only on eave segments outside other roofs' outlines. If the envelope never reaches
  the ridge height, E is a free gable (overhangGable) with warning `roof-no-meet`. `Roof.extend.start/end` = total
  distance beyond the axis line, replacing both the automatic extension and overhangGable.
- **No slab inside another block.** Overhang strips (eave and gable overhangs beyond the block's own bbox,
  extensions excluded) that fall inside another roofed block's axis polygon are dropped. Then every slope keeps only
  the region where its roof is the upper envelope (underside ≥ the other roofs' undersides − 1 cm): for planar
  slopes that is a half-plane per neighbouring slope, so both sides of a valley are cut exactly at the valley line.
  `combinedUndersideAt` is unchanged; the seed test samples every room at 0.1 m and finds no slab below the
  envelope (the turf at head height in the stue and the hems is gone).

### Areas (shown with an on-screen explanation, `AreaSummary`)

- **BYA** (bebygd areal, NS 3940): `buildings` = area of the union of block outer outlines (outside of cladding);
  `decks` = deck area (the deck `pieces`, minus buildings) where deck top − terrain > 0.5 m (grid-sampled at 0.25 m);
  `total = buildings + decks`. Existing/new = partition of the union outline by parts (each point belongs to the
  part containing it, else the nearest). Invariants (tested on the seed): `existing + new = total`,
  `perBlock` are per-block (not unioned) and documented as such.
- **BRA** (bruksareal): per level, `gross` = area inside the union of block inner outlines restricted to that level
  (base polygon minus `replace` zones, or the zone / `add` zone polygon), `area` = measurable part: for levels
  without a ceiling only where `combinedUndersideAt − level.elevation ≥ 1.9` expanded by a 0.6 m strip, minus
  `apning` rooms. Loft counts only its measurable part. Implementation (`measurableRegion`): EXACT — per planar
  roof slope the region beyond its 1.9 m line (a half-plane), plus floor points under no roof, grown by 0.6 m
  (Minkowski sum with a 64-gon disc) and clipped to the level's region; derive passes `roofs` to `computeAreas` for
  this. Without `roofs`, or when a boolean operation fails, it falls back to the 0.25 m grid (strip 0.375–0.625 m).
  Forslag D's hems: 12.54 m² measurable of 26.34 gross (the grid gave 11.22). Levels with a ceiling count fully
  when it is ≥ 1.9 m.
- **Old wall strips** (fix round after 2a, `areas.ts ghostWallBands`): where an existing block edge was moved or
  shortened (an edge ghost), the strip between the old axis line and the old inner face counts as NEW in BRA, ahead of
  every part, the same way BYA counts the old cladding strip as new. Moving the old west gable 0 → −1 keeps BRA
  existing at 103.51 (BYA existing 102.18 → 101.47, the integrator's decision; the glass bump's east wall +0.5 m:
  BRA and axis existing unchanged, BYA existing 102.18 → 101.905, its old cladding strips being inside). A junction
  shift may shrink an
  EXISTING partner block (blk-main's north edge +1 moves blk-bod's south edge: the bod's existing part loses 1 m); the
  lost stubs are edge ghosts. BRA existing can still rise when a larger roof gives the loft more free height (north
  edge +1: 104.72).
- **Aksemål**: the spec's convention (170.2 m²), for comparison only.
- **Rom (netto)**: inner-face polygon area per room, split existing/new.
- No area limiter in phase 1 (Robin's decision); `areaLimit` stays null and the `area-limit` warning is dormant.

## 2D plan (SVG, `plan2d/`)

Metres → pixels through the flipped root group and one `viewBox`; pan/zoom with pointer events (drag, wheel,
pinch; `touch-action: none`). Layers (bottom→top): grid (1 m, 5 m darker), terrain shade (optional), decks (their
`pieces`, even-odd fill),
floors (tinted by material only; new floors get the orange mix only with "Vis hva som er nytt"; flat-ceiling
floors are not drawn), wall union outlines (existing: fill #2b2b2b; new: fill #c8742a tint, outline #8a4d1c;
removed ("Fjernet"): dashed #6f6f6f over the same grey at 18 % opacity, only with "Vis hva som er nytt"), dividers
(dashed hairline), block-edge ghosts (dashed 2 px, only with "Vis hva som er nytt", drawn on every storey), openings
(removed ones dashed with the grey fill, only with "Vis hva som er nytt"; windows: triple line;
doors: leaf + swing arc from
`DerivedOpening.swing`, both leaves when `swing2` is present; frameless openings: gap), structure (posts, chimney
hatched, stairs with arrow and tread lines; a stair is also drawn on the storey it arrives at, with the treads above
the lower storey's 1.2 m cut solid, the rest dashed, a slanted cut line and the arrow; the "opp" text sits on the
walking line inside the symbol and is left out when the stair is too small on screen), railings and deck steps
(`outdoor.steps`), room labels
(name, `b × d` with comma decimals, `m²`), dimension lines (`DerivedDimension`), north arrow (54 px backdrop, in the
viewport corner that covers the least of the drawing incl. dimension chains, never over the scale bar), scale bar.
Label density (`labelDensity`): ≥ 20 px/m full label (compact "name / m²" fallback), 8–20 px/m name only (small
font below 12), < 8 px/m none; dimension chains only from 8 px/m (small font 8–12). Labels (`labelLayout.ts`
`layoutRoomLabels`): text widths from the real Barlow glyph metrics; per room the full label is tried, then the
full label in a smaller font, then "name / 7,9 m²", then the name alone; long narrow rooms get
"name / 4,6 × 1,1 m · 4,9 m²" on two lines; a name is never wrapped into a line shorter than 3 characters. The
actual text rectangle must lie inside the room's inner polygon, clear of its holes and of stair, chimney and post
footprints (0.5 px off walls); if it does not fit at the label point it moves towards the room's centre, then to
the nearest free spot. Numbers use Norwegian formatting (`formatM`, `formatM2` in `ui/format.ts`: `2,2 × 4,2 m`,
`13,4 m²`). Plan tabs: "Plan 1" (storey ground: lower + main) and "Hems" (storey loft); other storeys' walls as
faint outlines. With "Vis hva som er nytt" (on by default) a legend "Hytta i dag / Nytt / Fjernet" sits in the
bottom-right corner (the north arrow keeps clear of it).

**Editing in the plan** (phase 2a, docs/phase2-plan.md §3.1–3.3; `usePlanEditing.ts`, `editModel.ts`). Only with
`editable` (an unlocked proposal, not read-only) and `editActions`; otherwise the plan is the phase-1 viewer (Mål still
works). Gestures, mouse and touch alike: a tap selects; a press on the SELECTED element (by geometry, so a selected
block can be grabbed through its rooms) or on a handle starts a drag after 5 px (10 px touch) through the drag
protocol (`beginDrag` → `updateDrag` per move → `endDrag`; Esc, pointercancel, lostpointercapture and a second finger
`cancelDrag`); any other one-pointer drag pans, two fingers / the wheel zoom. A selected exterior wall piece drags as
its block edge. Handles: white circles with an accent border, 7 px radius (14 px on `(pointer: coarse)`): block
vertices and edge midpoints, deck vertices, deck edges and the "+" midpoints (a tap inserts a vertex; a drag inserts
and drags it in ONE undo step through `beginDrag({ kind: 'deckEdge', id }, p, 'insert')`), stored wall ends, opening
jambs. Small things keep their body (fix rounds after 2a, `editModel.ts handlesFor(…, { scale, radius })`): wall and
opening end handles are left out only while the object is shorter on screen than one handle diameter
(`endHandlesShown`; a 0.91 m door has them from about 16 px/m with a mouse), block corner and edge handles (and those
of a selected exterior piece) below three diameters (`cornerHandlesShown`); wall and
opening end handles sit one handle radius OUTSIDE the ends (`anchor`: a drag on one acts as if the end itself was
grabbed); a press inside the object's body moves it even over a handle (`pressTarget` / `pressInBody`; blocks and
exterior pieces count as body one handle radius inside their outline, so their corner and edge handles stay usable).
Hit corridors: 12 px with a mouse; on touch `hitBandPx` = 0.25 m × zoom clamped to 10–24 px (`TOUCH_BAND_MIN_PX`;
the svg carries it as `data-hit-band` next to `data-scale`) for walls, ghosts and openings. Every drawn room label is
a hit area for its room, drawn BELOW the walls, ghosts and openings (`LabelHitLayer` after `OtherStoreyLayer`; the
label text stays on top without pointer events): at the phone's starting zoom (11.6 px/m) a tap ±4 px from a wall or
a door selects it, and a tap on a room's name the room (23 of 24 rooms). With "Vis hva som er nytt" the label layout
treats the ghosts (removed walls and openings, edge-ghost strips) as obstacles (`storeyData.ts ghostObstacles`). A
tap on a placed single-room template unit (a Vedskjul) selects the unit, the next tap its room, the next the unit
again (`tapSelection`). Rendering during a drag: `planLayerData` with `stable.ts shareEqual` / `useShared.ts` keeps
unchanged parts identical between frames and walls, openings, labels, floors and rooms are memoised per item, so a
wall drag re-renders neither structure, dimensions, outdoor, furniture, blocks nor ghosts (jsdom, dev build: about
7–8 ms per w-gang-n frame, 4.5 ms per door frame). Pointer moves during a drag are coalesced to one `updateDrag` per animation frame (the first at drag start,
the last position flushed before `endDrag`, a cancel drops it). On the locked base proposal a drag that starts on
the selected element calls `onLocked` once (else the refusing `beginDrag`) and neither pans nor drags. With
`viewportInsets` (the parts of the plan's box that a bottom sheet or the screen edges cover) the plan pans, never
zooms, just enough to bring the selection's box into the uncovered part with a 12 px margin (`viewport.ts
revealPan`). Tools (`tool` prop): Velg; Vegg (two taps, the new wall
selected, the tool stays until Esc / Velg); Dør/vindu (a tap on a wall or block edge, centre on the 10 cm grid along
the host; if the default-size opening would overlap one already in that wall piece it moves to the nearest free
centre in the piece, `freeOpeningOffset`); Nytt bygg (a snapped ghost of the template follows the pointer, a tap places it); Møbler (a tap calls
`onDropFurniture`); Mål (two taps). Dør/vindu and Nytt bygg return to Velg with the new element selected. Snapping:
`editActions.snapPoint` (geometry/snap.ts), radius 12 px (24 px coarse) converted to metres at the current zoom, line
targets (and every target in a drag) capped at 0.25 m, the Nytt bygg ghost attaching within 0.25 m (see Editing →
Snapping); the
overlay draws snap indicators, dimension chips, the dragged element's base outline, wall starts, the measurement, the
unit ghost and the Egenskaper highlight (`overlay.highlight`: the wall a room-size field moves, "Avstand fra hjørne"
as a temporary dimension). Esc is the plan's only while something is in progress (a drag, a wall start, a
measurement); then the app's Esc (tool → Velg, clear the selection) is skipped. The phone mini-bar anchor
(`onSelectionBar`) is the top centre of the selection's screen box plus `rect`, its unclamped box in viewport px
(null while dragging); it is re-reported after every render (pans, zooms, edits) and on window scroll / resize (at
most once per frame).

## 3D view (R3F, `view3d/`)

`<Canvas dpr={[1, 1.5]} frameloop="demand" shadows>` with `invalidate()` on store changes and control changes;
shadow map 2048 (1024 and no soft shadows on `(pointer: coarse)`). Groups (phase 2, `sceneParts.ts`): `building` (walls,
roofs, openings, foundations, floors, ceilings, structure), `outdoor` (decks (their `pieces`: boards on top, skirts
along each piece's outer ring), one railing per deck, every deck steps that is not blocked as its own mesh tinted like
its deck, hot tubs), `furniture` (placeholder pine boxes: footprint × stored height, cut in "Inne"; phase 2b) and
`site` (terrain, water, trees). `sceneParts(derived, prev)` reuses a group's object while its contents are unchanged,
so a furniture or deck edit keeps the wall, roof and floor meshes, and a wall edit rebuilds only that wall.
Visibility depends only on levels and storeys. Ghosts (removed walls / openings) are never built.
**Click selection** (`selection3d.ts`): every object carries tags (what a click selects, plus the selections that also
highlight it); a click (one pointer, < 5 px movement, 10 px for touch) selects: an exterior wall piece →
`{ kind: 'blockEdge', id: edgeId }` (it also lights up for the plan's piece selection and for its block), a stored wall
→ `wall`, an opening (or its door threshold) → `opening`, a room floor → `room`, a flat ceiling, roof or foundation →
`block`, decks, the railing (`${deckId}/railing`), steps (`steps`, also lit when the deck is selected), hot tubs,
structure, trees and furniture → their own kind; slabs select nothing (a click there clears the selection). The
highlight is a translucent overlay plus a blue outline drawn through everything. No dragging in 3D. **Furniture drop
target** (`dropEvent.ts`, no three.js import): the library calls `dispatchFurnitureDrop(clientX, clientY, catalogId)`,
which sends an event to the element under the pointer; View3D answers with `onDropFurniture(catalogId, planPoint,
hit)` where the ray through walls and roofs lands on the nearest visible floor (room, threshold or slab, never a
ceiling), deck piece or the shown ground (phase 2b wires it). Modes: `ute` (all), `inne` (roofs hidden; storeys above the active storey hidden; each
visible wall piece rebuilt with top = min(topProfile, level.elevation + cutHeight) and a cap material — geometry
rebuild memoised per cut height, NOT renderer clipping planes). Wall meshes: per piece, sub-prisms (piers between
openings, lintels, sills) over slices of the footprint with per-vertex top z from the profile; never overlapping
volumes with coplanar faces. Materials ported from the old model (`materials.ts`: canvas textures for dark vertical
boards, turf, deck boards, pine floor, tiles, logs; sage-green trim #6f8170; white/green frames; exterior glass
#27313a with opacity 0.35, interior pane 0x9cc3dd 45 %). `highlightNew` tints new parts orange (emissive) using
separate material sets; the app feeds it the 3D view's own switch `ui.highlightNew3d` ("Vis hva som er nytt i 3D",
OFF by default since the fix round after 2a: natural colours), not the plan's "Vis hva som er nytt". Floors of kind `ceiling` render as a thin pine slab (at least 2 cm, so
it is visible from below), shown in `ute` and hidden in `inne`. Double doors (`swing2`): a solid door gets two leaves
with a 6 mm seam, a glazed one two panes with a centre frame bar. Terrain (`Terrain.tsx`, `ground.ts`) applies
`derived.groundWorks` through `terrainZAt(…, extra)`, with a fine 0.25 m patch over the cut area (a cut edge on the
2 m asset grid would otherwise be smeared over a whole cell); without a terrain asset a flat plane 2 cm below the
lowest block ground level. Labels are plain DOM tags in one layer over the canvas, positioned every rendered frame
by projecting their anchors and hidden when the building is hit first by a ray from the camera (name + dims + area,
≤ 30 visible, same density rule by camera distance), toggleable. Overlaps are resolved by importance: room area
halved at 15 m distance, so a 24 m² room 15 m away beats a 2.7 m² pantry 3 m away; block labels (outside) use the
BYA area over the cube of the distance, so the nearest block wins against a bigger one behind it (from 'framsiden'
the new wing beats the main house, from 'oversikt' the main house wins); the 30-label cap uses the same order. A
block label is shown only while the block can be seen: rays to three probes just above its ridge (25 / 50 / 75 %
of the ridge over the block) must not all hit another block first (the block's own roof, walls, openings and
foundation do not count unless the camera is inside it); a partly hidden block's tag sits over its visible probes.
A block tag that would overlap a placed one tries ±8 / ±16 px sideways, then one and two tag heights higher, then
below its anchor before it is hidden. The label of the room the camera stands in always comes first and is never
hidden (pinned to the bottom-right corner, 12 px inset, when its point is behind the camera or off-screen); the
navigation hint's rectangle is reserved (a pinned tag moves up above it, other tags avoid it); every other tag is
shown only when its whole rectangle fits inside the layer. (drei `<Html>` was dropped: it creates a React root per label
and unmounts it synchronously, which races with React 19 rendering.) Camera presets defined in plan coords relative
to `bounds` (from the old model's Forslag D views): oversikt p(36,−25,26) t(11.5,4.5,1.5); terrassen p(29,19,8)
t(14.5,8,1.2); framsiden p(38,2,4.5) t(16,2.5,2) (the new wing's long east side with the white glass door, as in the
old model); baksiden p(−14,22,8) t(8,5,2); langsiden p(11,−27,5) t(12.5,0,2) (the lake facade, from the old model);
ovenfra p(12,4.49,54) t(12,4.5,0); naert-tilbygget p(26,−9,12) t(17.5,2.5,0.6); inne-stua p(6.3,0.9,1.55)
t(15.5,4.5,1.3) (eye level in the stue, looking along stue, passasje and spiseplass; the Stue's label point is at
(8.03, 1.31), so the camera stands west of it). The interior cut height is not a user setting (the slider
"Snitthøyde" was removed after Robin's review, he found it confusing): `cutHeightFor(preset)` (`state/store.ts`) gives
1.3 (`INTERIOR_CUT`) for every preset and 2.3 (`EYE_LEVEL_CUT`) for 'inne-stua', so the walls rise above the eye
there; `ui/Stage.tsx` passes it to View3D. OrbitControls damped, maxPolarAngle 0.495·π,
minDistance 3, animated transitions (~900 ms, skipped with reduced motion).
Sun: directional light from `sunInPlan` for the chosen date/time (default 21 June 15:00 local).

## State (`state/store.ts`)

```ts
interface AppState {
  project: Project;                       // tracked by zundo (partialize: project only, limit 200), autosaved
  ui: { activeView: 'plan'|'3d'|'split'; planStorey: 'ground'|'loft'; activeStoreyId: Id; mode3d: 'ute'|'inne';
        showLabels: boolean; showDims: boolean; showGrid: boolean; showRoofPlan: boolean;
        highlightNew: boolean; highlightNew3d: boolean; showTrees: boolean; showTerrain: boolean; preset: CameraPreset;
        selection: Selection | null; sun: { date: string; minutes: number };
        tool: 'select'|'wall'|'opening'|'unit'|'furniture'|'measure';            // phase 2 (never persisted)
        toolOptions: { openingType?; unitTemplate?; unitRotation90?; furnitureItem? }; showClearances: boolean;
        hint: string | null;                                                     // tool-specific hint line text
        readOnly: boolean; source: 'local'|'link'|'version' };
  toasts: { id; text; undo?: boolean; action?: 'newProposal'; seq? }[];        // never in the history, at most 3
  // project actions — every edit goes through an action
  setProject(p), updateVariant(id, recipe, opts?: { transaction?: string }), duplicateVariant(id, name) /* copy is never locked */,
  replaceVariant(id, variant, opts?: { transaction?: string }), updateSite(recipe, opts?),   // phase 2 (editActions.ts)
  setActiveVariant(id), renameVariant(id, name), deleteVariant(id), renameRoom(roomId, name), ...
  beginTransaction(label) / commitTransaction() / cancelTransaction() / transactionBase()   // drags = ONE undo step
  undo(), redo(), canUndo, canRedo
  setUi(partial), select(sel), showToast(t) → id, dismissToast(id)
}
```
`selection.ts`: `type Selection = { kind: 'wall'|'blockEdge'|'blockVertex'|'opening'|'room'|'block'|'deck'|
'railing'|'hotTub'|'structure'|'furniture'|'tree'|'deckVertex'|'deckEdge'|'steps'|'ghost'; id: Id; levelId?: Id }` (a
railing's id is `${deckId}/railing` since schema 2; 'deckVertex' / 'deckEdge' use the deck vertex id (the edge id is
its start vertex id), 'steps' the DeckSteps id, 'ghost' a removed wall / opening id or a `Variant.ghosts` id;
`resolveSelection` resolves a ghost only to a ghost); selectors return null for a dangling selection after undo.
While `ui.readOnly` every project action is a no-op and autosave is off. Defaults: `activeView` 'plan' on every
screen (phase 2a, docs/phase2-plan.md §6: editing happens in the plan) until the user picks a view tab;
`highlightNew` ("Vis hva som er nytt", the plan) on; `highlightNew3d` (the 3D view's own switch) off; `preset`
'oversikt'. The
interior cut height is not stored: `cutHeightFor(ui.preset)` = 1.3 (below the 'inne-stua' eye height), 2.3 with
'inne-stua'. `commitTransaction` / `cancelTransaction` reset the
`updateVariant` merge key, so a later edit with the same label gets its own undo step. Every change of the project
(undo, redo and `setProject` included) gets a fresh `updatedAt` from `nextStamp()` (never repeats, never goes
backwards).
Shared links (`appStore.ts`): opening one in a tab that shows the user's own project keeps that project and its
undo history aside. "Lag min egen kopi" ADDS the shared variant(s) to the user's own project (new variant ids,
" (delt)" / " (delt 2)" on name clashes, one undo step, the copy becomes active), clears readOnly and removes
`#d=` with `history.replaceState`; with no own project the link becomes the project (new id +
`basedOnProjectId`). "Tilbake til mitt prosjekt" returns to the kept project or the autosave (the button says
"Vis Forslag D" when there is none).
Derived model via `useDerived()` = `deriveVariant(activeVariant, site, terrainAsset)`; when derive throws, an empty
model with the warning `nb.warnings.deriveFailed(detail)`.

`persistence.ts`: autosave of `project` (debounced 500 ms) to localStorage `hytte-planlegger:project`, written once
at start-up when nothing is stored (so a fresh project keeps its id across a reload); `saveNamedVersion` forces a
save first. Without storage (localStorage blocked) `startAutosave` does nothing and never reports a failed write: the
start-up notice 'storage-unavailable' already says so. UI prefs under `hytte-planlegger:ui` with `v` =
`PREFS_VERSION` (older prefs keep everything but the view; the view is only remembered once the user clicked a view
tab; `cutHeight` / `cutHeightBeforePreset` saved by the removed slider are ignored and dropped on the next save;
`PREFS_VERSION` 3: `highlightNew` is read only from prefs of version 3 on, since older prefs saved the old default
`false` whether or not the user chose it; `PREFS_VERSION` 4 adds `highlightNew3d`, which older prefs lack, so 3D starts
in natural colours);
named versions `hytte-planlegger:versions` = `{ id, name, savedAt, projectId, schemaVersion, project }[]`, listed for
the current projectId newest first, capped at 30 with size shown; export / import JSON file (a share-link delta is
also accepted as a file). Share link `#d=` + lz-string `compressToEncodedURIComponent(JSON of payload)`: a DELTA
against the bundled Forslag D (per variant the changed top-level fields and, per collection, added / changed entities
in full, removed ids and the order; outdoor collections keyed `outdoor.decks` / `outdoor.hotTubs`,
`OUTDOOR_COLLECTIONS`) whenever it is smaller than the full `{ v, project }` — also for a project of an older seed
revision, whose revision travels in `project.seedRevision` (a migrated revision-3 project is well under 2 kB);
timestamps are never sent. A delta of an older schema (`v` < CURRENT_SCHEMA_VERSION: a phase-1 link) is rebuilt on
the FROZEN schema-1 seed (`model/seed/frozenSeed.ts`, revision 3, incl. `outdoor.railings`) and then migrated, so a
phase-1 link keeps its railing and its three steps. An autosave of an older schema is copied to
`hytte-planlegger:project.backup-v1` right before the first write that replaces it. Only the active variant by default ("del alle varianter" toggle), size
shown, warning above 8 kB with "send som JSON-fil" fallback; never includes terrain. Unchanged Forslag D is about
210 characters, one renamed room under 1.5 kB. A delta made against an older seed revision than its base (the
current seed, or the frozen revision 3 for a phase-1 link) is applied to that base (banner `link-rebased`); one
from a newer revision than the bundled seed is treated as too new; old full-format links still open (and migrate).
**Any change to Forslag D's content must bump `SEED_REVISION`**, otherwise old links decode against the changed seed.
Revision 5 (second fix round after 2a) only adds the glass bump's existing part. A stored revision-4 copy
(autosave, file, version) keeps `parts: []` and gets the part from its outline the first time an edit changes that
outline (`todayPart`); a revision-4 share link decodes against the revision-5 seed, so an unchanged glass bump gets
the seed's part. A glass bump already enlarged under revision 4 keeps that growth as today's cabin.
All storage access in try/catch. Other tabs: a saved document is identified by `id@updatedAt`; autosave remembers
what this tab last wrote and treats only a different stored document as another tab's. This tab then stops saving
until the user picks "Hent endringene" or "Behold mine endringer" (closing the tab without choosing loses its
unsaved edits). Seed updates: `Project.seedRevision` vs the bundled
`SEED_REVISION` → offer "Hent ny Forslag D" (adds the new seed as a variant, keeps the user's variants) and
"Tilbakestill til Forslag D". `migrate.ts`: `migrateProject(raw)` applies `migrations[v]` in order, throws
`SchemaTooNewError` when `schemaVersion > CURRENT_SCHEMA_VERSION` (UI: "Last siden på nytt"); runs on autosave,
versions, imports and links; one Vitest fixture per schema version.

## Editing (phase 2a: `geometry/edit.ts`, `geometry/snap.ts`, `state/editActions.ts`)

The contract is docs/phase2-plan.md §1 and §3; the file headers hold the details. In short:

- **Lock.** `isLocked(variant)` = `variant.locked === true`: only the bundled Forslag D (and every "Hent ny Forslag D" /
  "Tilbakestill" copy of it) is locked. Every edit action refuses it with the toast "Forslag D er grunnlaget og kan ikke
  endres. Lag et nytt forslag for å endre." and a "Nytt forslag" button (`duplicateVariant` = an unlocked copy). The UI
  greys the editing tools (still clickable: the click shows the toast), makes fields read-only and shows the hint
  line text with "Nytt forslag".
- **Every action** (`editActions.ts`, store first: `moveWall(store, id, delta)`; `useEditActions()` binds them to the
  app store) is a no-op while read-only, refused when locked, computes `produce(base, recipe)` with the pure
  `apply…` function from edit.ts (drags: from the pointer-down base), heals ghosts, derives the result, runs
  `reconcileRooms` against the base's derived model and stores it with `replaceVariant`: ONE undo step (drags and
  nudge runs: one per gesture / run). Creations return the new id; deletes toast "Slettet." with [Angre]. Opening
  and outdoor drags (openings, deck, steps, hot tub, trees, furniture) skip `reconcileRooms` and its derive per frame;
  the render's derive then reuses the building stage (an opening drag frame ≈ 1 ms in Node, a hot-tub frame ≈ 8 ms).
  Wall and block-edge drags still derive the building stage once per frame (≈ 40–48 ms in Node).
- **Status bookkeeping.** Moving or resizing an existing stored wall / opening makes it 'new' and leaves a 'removed'
  copy `${id}/ghost` at the old place; deleting an existing one marks it 'removed' in place; moving an existing block
  edge records its old line in `Variant.ghosts`. Anything moved back onto its ghost heals (existing again, ghost gone).
  "Ta tilbake" = `restoreGhost(id)` (also revives Room records a merge deleted earlier in the session). After an
  endpoint drag it first drags each end back through the same cascades (`endpointsBack`), so walls the drag carried,
  trimmed or extended return too; on an edge ghost it moves the edge back (for a stub, the adjacent edge) and restores
  the openings parked on the old line; on an opening ghost whose host wall is gone it restores that wall or edge as
  well. Existing openings clamped in a wall-move cascade are bookkept like moved ones. After a plain wall move it also
  brings back the neighbours the forward move left just beside the moved wall's line (their ghost end on the restored
  ghost, their live end within 5 cm of the moved wall or on the line it moved to: `neighbourEnds` /
  `bringBackNeighbours`; w-105-diag → w-104-diag, w-103-korr → w-104-103), and `endpointsBack` no longer drags
  existing walls that have no ghost (`applyMoveWallEndpoint` option `keep`). When a host gets longer again (a block
  edge or a wall moved back by hand), an opening returns to its ghost if, before that edit, it was pressed against
  the host's end (or centred on a host too short for it), its ghost is on the same host and it fits there without
  overlapping another opening (`edit.ts pullBackOpenings`, after block edits, wall moves and endpoint drags); a door
  the user moved along its wall stays where it is.
- **Drag rules.** Wall moves: an endpoint with a non-parallel support (block edge, zone edge, a wall whose interior
  holds it) slides along it; a free node moves with its coincident walls; T-junction walls are trimmed / extended.
  Block edges move along their normal, junction partners follow, openings keep their plan position, collinear stored
  walls are carried along, floor zones follow; gable / mono blocks stay rectangles (corner = both edges); whole
  existing blocks cannot be moved or deleted. Openings are clamped to their piece and re-hosted onto another wall
  within the snap radius. Decks: vertex / edge / whole-deck drags, insert / delete vertex (min 3; a corner whose
  removal would make the outline cross itself is refused with the toast `nb.editor.deckVertexCrosses`), steps along
  their edge. Units: `placeUnit(template, centre, rotation90)` makes a new block with one room and its door / open
  front; `rotateBlock(id, 90 | −90)` turns a placed template unit a quarter turn about a centre on the grid (walls,
  openings, rooms, furniture, the roof's ridge axis, slope side and extensions turn with it; +90 then −90 gives the same
  footprint); refused for blocks with existing area (toast), blocks without a template and Forslag D. A unit whose
  edge lies on another block's edge or a deck edge turns about its middle and is then shifted back onto that line (onto
  both lines in a corner; `contactsOf` / `contactTurn`), so a Vedskjul against the wing stays against it (no
  `block-overlap`) and one on the deck's north edge keeps its back on y 12.1; free units turn on the 10 cm grid as
  before, units with a contact can sit 5 cm off it.
- **Rooms under edits.** `reconcileRooms`: a Room keeps the face its previous inner polygon overlaps; one Room per
  face, as many Rooms kept as possible, then the largest total overlap (`matchRoomsToFaces`, exact per connected
  component), so dragging a wall past the middle of the next room moves the boundary instead of swapping or merging
  the rooms; fewer faces than Rooms (a deleted wall) → the larger previous room stays, the other is deleted with the
  toast "«A» og «B» er nå ett rom." (the UI shows it in one message with the action's own text); a split face → the
  larger piece keeps the Room, the other is named with "Gi navn" (`nameFace` returns the new room's derived id, which
  the UI selects). An anchor on a face boundary (or within 1 cm of it) counts as outside, so a divider moved onto it
  sends it to the face's label point. Whole-block moves and rotations hand the carried rooms to reconcile
  (`EditContext.carried`), which shifts their previous polygons the same way before matching.
- **Drag protocol** (plan → actions): `beginDrag(selection, p, handle?)` → session (null: nothing to drag, then the
  plan pans), `updateDrag(session, p, modifiers)` → `{ indicators, chips, ghost }`, `endDrag` / `cancelDrag`. Handles
  'a' / 'b' (wall ends), 'start' / 'end' (opening jambs), 'insert' (deck "+").
- **Snapping** (`snap.ts`): grid 0.10 m (0.01 with Alt); wall ends / midpoints, block axis vertices and edges (never
  cladding faces), deck edges and vertices, collinear extensions and perpendiculars (within 6 m of the ends), ortho
  from the start point; polygons (units, blocks) snap axis to axis; furniture back to wall; hot tubs to deck edges.
  Radius 12 px / 24 px coarse at the current zoom, but line targets reach at most 0.25 m (`LINE_SNAP_MAX_M`, also in
  `snap()`); a dragged line (`snapLineOffset`) never snaps to its own starting line or lines collinear with it, stays
  at its start while the pointer is within 5 cm of it, and a snap never takes back more than half the drag; Alt turns
  line targets off (and the grid to 1 cm). Drags (second fix round; the drag start reaches snap.ts as
  `SnapContext.origin`, set by `editActions.dragSnapContext`): `snap()` (wall ends, block / deck vertices, free walls)
  drops point targets at the dragged point's start or coincident with it, caps point reach at 0.25 m too, turns points
  off with Alt, and no target — point, intersection, line or ortho guide — may take back more than half the drag;
  `snapPolygon` / `snapFootprint` / `snapCircle` (unit, block and deck moves, furniture, the hot tub) reach at most
  0.25 m per direction, never put an edge back on its own starting line, never take back more than half the drag nor
  add more than `SNAP_ADD_FRACTION` = 0.5 of it, and keep an axis at its start while it has moved under 5 cm. Without
  a drag (the placement tools) point targets and the ortho guides through the start keep the full radius; unit
  placement gets the 0.25 m reach only.
- **Strings**: nb.ts `nb.editor` (editor core), `nb.plan2d.edit` (legend, hints, handle tooltips; the hints are
  `nb.hints`, one source each); the unit template names (`nb.editor.units`) become project data when a unit is placed.
- **Toasts and undo** (fix round after 2a, `ui/toastRegistry.ts`): the store keeps plain toast records; the UI ties
  every undo toast to the undo entry on top when it appeared. Its Angre undoes only while that entry is still on top;
  any later step (an edit, Angre / Gjør om in the toolbar, a cleared history) closes it, and a button whose step is
  gone is disabled. The toasts of one step show as ONE message, the action's text first ("Slettet. «Soverom 1» og
  «Bad» er nå ett rom."). "Nytt forslag" toasts have no Angre. A NEW warning after an edit shows once as "Ny
  advarsel: …" with "Vis" (opens Advarsler; `ui/warningToasts.ts`), and the toolbar carries a warning count badge;
  warnings name walls and openings by type and place ("døra i veggen mellom Gang og Soverom (ny fløy)", directions
  from true north), never by id (`ui/warnings.ts`); `opening-on-removed-edge` names the opening from its block's edge
  and the building part standing outside it ("Vinduet i ytterveggen mot øst i Soverom (ny fløy) sitter i en vegg som
  nå er dekket av «Vedskjul»."), `roof-no-meet` the end ("i enden mot øst"), `deck-steps-blocked` the side and the
  part in the way; a lookup that does not know the place falls back to the plain sentence, never an id
  (`NameLookup` kinds in nb.ts). A warning toast is bound to the undo step like the undo toasts (any later step closes
  it, `toastRegistry.markShowsWarnings`), closes as soon as none of its warnings is left (`warningToasts.ts
  retireResolved`, on every derive outside a drag), and a newer one replaces it: one at a time. On phones the toast
  stack sits 8 px below the tool row and the hint line (`toastLayout.ts phoneToastTop(toolbarBottom())`, updated on
  scroll and resize; the CSS default at the top of the screen when the tool row is scrolled away).

## UI (`ui/`)

Layout (phase 2a): top bar (title, "Forslag:" selector with a "Grunnlag" tag on Forslag D, "+ Nytt forslag" (asks for a
name, copies the proposal on screen; the primary button on Forslag D), Gi nytt navn, Slett (asks twice; not for Forslag
D), Lagre versjon / Versjoner / Eksporter / Importer, "Send forslaget", Hjelp with the tools and shortcuts) · left
column (view tabs Plan/3D/Begge, plan storey tabs, 3D mode + presets, toggles, sun date/time; no cut-height control:
'Inne' cuts the walls 1.3 m above each floor, 2.3 m with 'Inne i stua'; while the Møbler tool is active the furniture
library replaces it) · centre: toolbar (Velg · Vegg · Dør/vindu · Nytt bygg · Møbler · Mål, then Angre / Gjør om; the
type chooser of Dør/vindu and the template chooser + "Roter" of Nytt bygg below it), hint line, then the plan and/or
3D, the first-run card ("Slik kommer du i gang", hidden for good with "Skjønner") and toasts at the bottom centre ·
right column, `clamp(360px, 24vw, 440px)` wide (340 px between 1100 and 1279 px): Egenskaper first (the editors per
selection kind: basic fields, "Mer", action buttons, status tag "Hytta i dag" / "Nytt" / "Fjernet"; number fields
accept "2,4" / "2,40" / "2.40", −/+ 10 cm, Enter / Tab / blur commit, Esc restores), Romskjema, Arealer with
explanations, Advarsler. Keyboard: Delete, arrows (1 cm, Shift 10 cm), R, Ctrl+D, Ctrl+Z / Ctrl+Y, Esc. Wording:
proposals are "Forslag", statuses "Hytta i dag" / "Nytt" / "Fjernet" (never "rives"), the toggle is "Vis hva som er
nytt". Romskjema columns: Rom · Bygningsdel · Status ·
Mål (m) · Areal, fixed table layout, rows grouped per level with level sums; a room that is part existing, part new
shows both tags and both shares. Headline always visible: "BYA 235,5 m² · bygg 178,3 (eks. 102,2 · nytt 76,1) ·
terrasse 57,2 — BRA 170,1 m² (per level)", with BYA / BRA / eks. expanded in tooltips; the Arealer panel shows
Bygninger with its own eks./nytt split and the deck on its own line (the building-only split is worked out in
`ui/areaFigures.ts` from whether the decks are new; none is shown for mixed decks). Buttons, toggles, tabs and presets have tooltips.
Phone (< 800 px): stacked, panels collapsible, heights in `100dvh`, canvas and SVG with `touch-action: none`; the
six tools sit in a 6-column grid (icon above a label that may wrap; "Dør/vindu" breaks after the slash), Angre / Gjør
om as icons; no Egenskaper panel in the right column: a floating mini-bar (Egenskaper · Roter / "Roter 90°" for a
placed unit · Slett; the room of a placed single-room unit also gets the unit's "Roter 90°" and "Velg bygningsdelen",
`commands.ts unitOfRoom` / `rotateUnit`, and with four buttons the bar is compact, icon above a short label;
`miniBarPlacement.ts placeMiniBar` from the plan's `anchor.rect`: above the selection, flipped
below it when there is no room, never over the toolbar, the hint line or an open sheet, hidden while the plan reports
no anchor) opens the properties as a bottom sheet (schedule rows too). The sheet opens LOW (40dvh, basic fields only)
and "Vis mer" / the handle opens it to 88dvh with everything; it reports its height (`overlay.ts setSheetHeight`),
opening it scrolls the toolbar to the top of the screen, and `Stage.tsx` hands the plan the covered parts of its box
as `viewportInsets` (`planInsets.ts`) while a sheet is open. The furniture library is a bottom sheet; below 600 px "Send forslaget" and Hjelp are icon buttons in the title row and Lagre versjon
/ Versjoner / Eksporter / Importer sit in a "Mer" menu. Read-only (shared link): banner with "Lag min egen kopi";
edit panels/tools hidden, view controls, schedule and areas kept. Wording (fix round after 2a): "Trykk" in every
hint, "Roter" the only rotate verb, `device.ts undoHow()` = "Angre" on touch and "Angre eller Ctrl+Z" with a keyboard;
the ghost tag reads "Fra hytta i dag"; Romskjema, headline and Arealer say "i dag" ("Herav hytta i dag"); read-only
rows use the editors' names ("Høyde over gulv", "Trinn"); a selected door or window is tagged "Dør/vindu"; the help
heading is "Slik bruker du planleggeren". The first-run card and the hint
line on Forslag D say it is the fixed base and that "+ Nytt forslag" makes a copy to change; "Nytt forslag" closes the
first-run card for good (`firstRun.ts`) and, while the card is open, toasts move above it (`toastLayout.ts`). Theme tokens from the old model (self-hosted Barlow / Barlow Semi Condensed,
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
  // phase 2 (all optional; without editable + editActions the plan is the phase-1 viewer)
  editable?: boolean; tool?: PlanTool; toolOptions?: PlanToolOptions;
  editActions?: PlanEditActions;   // structural (plan2d/editTypes.ts); the app passes useEditActions()
  showClearances?: boolean;
  overlay?: PlanOverlay;           // { highlight?: PanelHighlight, cornerDimensionFor?, dimensions?, highlightWalls? }
  onSelectionBar?: (anchor: SelectionBarAnchor | null) => void;   // phone mini-bar: viewport x / y (+ localX / localY)
  onToolChange?: (tool: PlanTool) => void;   // 'select' after Dør/vindu and Nytt bygg placed something
  onHint?: (hint: string | null) => void;    // hint line text of the active tool and step
  onDropFurniture?: (catalogId: string, planPoint: Vec2) => void;
  coarsePointer?: boolean;                   // default: matchMedia('(pointer: coarse)')
  onLocked?: () => void;                     // locked base: a drag that starts on the selection (once per gesture)
  viewportInsets?: ViewportInsets;           // { top, right, bottom, left } px of the plan's box covered by other UI
}
// SelectionBarAnchor = { x, y, localX, localY, box, rect: { top, left, width, height } }   (rect: viewport px, unclamped)
export const PlanView: ForwardRefExoticComponent<PlanViewProps & RefAttributes<PlanViewHandle>>; // root <svg data-testid="plan-view">
export interface PlanViewHandle {
  fitView(): void; getSvg(): SVGSVGElement | null;
  clientToPlan(clientX: number, clientY: number): Vec2 | null; visibleCenter(): Vec2;
  furnitureDragOver(catalogId: string | null, clientX: number, clientY: number): boolean;   // library drags
  dropFurniture(catalogId: string, clientX: number, clientY: number): boolean;
  cancelInteraction(): boolean;
}
// The plan's root <svg> also carries data-plan-tool, data-plan-editable, data-plan-dragging; handles data-handle /
// data-handle-shape ('vertex' | 'mid' | 'edge' | 'insert' | 'end'); elements data-sel-kind / data-sel-id.

// src/view3d/View3D.tsx
export interface View3DProps {
  derived: DerivedVariant;
  site: Site;
  terrain: TerrainAsset | null;
  mode: 'ute' | 'inne';
  activeStoreyId: Id;
  cutHeight: number;              // metres above each level floor, interior mode (cutHeightFor(preset): 1.3 / 2.3)
  showLabels: boolean; highlightNew: boolean; showTrees: boolean; showTerrain: boolean;   // highlightNew ← ui.highlightNew3d
  sun: { dir: Vec3; isUp: boolean };   // unit vector towards the sun, plan frame
  preset: CameraPreset;            // changing it animates the camera
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  onReady?: () => void;            // first frame rendered
  onDropFurniture?: (catalogId: string, planPoint: Vec2, hit: DropHit) => void;   // phase 2b (drop.ts / dropEvent.ts)
}
export type CameraPreset = 'oversikt' | 'terrassen' | 'framsiden' | 'baksiden' | 'langsiden' | 'ovenfra' | 'naert-tilbygget' | 'inne-stua';
export function View3D(props: View3DProps): JSX.Element   // root <div data-testid="view-3d"> containing the <Canvas>

// src/state/selection.ts
export type Selection = { kind: 'wall'|'blockEdge'|'blockVertex'|'opening'|'room'|'block'|'deck'|'railing'|'hotTub'|'structure'|'furniture'|'tree'
                               |'deckVertex'|'deckEdge'|'steps'|'ghost'; id: Id; levelId?: Id };

// src/ui/editorBridge.ts — the UI's edit actions come from a context: App.tsx provides
// uiEditActionsFrom(useEditActions()) through EditActionsProvider (rotateBlock falls back to a typed no-op for a core
// without it); useUiEditActions() reads it (no provider: every action is a no-op).
```

Test hooks the UI must provide: `data-testid` = `view-tab-plan`, `view-tab-3d`, `view-tab-split`, `mode-ute`,
`mode-inne`, `preset-<CameraPreset>`, `plan-storey-ground`, `plan-storey-loft`, `room-schedule`, `area-totals`,
`toggle-labels`, `toggle-new`; phase 2: `toolbar`, `tool-<kind>`, `opening-type-<type>`, `unit-<template>`, `unit-rotate`,
`undo`, `redo`, `hint-line`, `hint-new-proposal`, `new-proposal`, `rename-proposal`, `delete-proposal`, `locked-tag`, `toast`,
`toast-undo`, `toast-new-proposal`, `toast-show-warnings`, `toolbar-warnings`, `mini-bar`, `mini-properties`,
`mini-rotate`, `mini-delete`, `properties-sheet`, `sheet-stop`, `block-rotate`,
`furniture-library`, `first-run`, `first-run-ok`, the editor fields (`room-size-w` / `room-size-d`, `wall-thickness`,
`opening-corner`, …, a NumberField's `<input>` inside its test id), `ghost-restore`, `name-face-input`, `name-face`;
and `window.__hytte = { ready: boolean; project: Project; derived: DerivedVariant; selection: Selection | null }` kept
current (`ready` after the first 3D frame, or right away when only the plan is shown — the default).

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
// The ONLY polygon-clipping callers: input snapped to 1e-7 m, retried on 1e-6 … 1e-4 m, then `ClipError`.
export type MultiPoly = Vec2[][][];
export class ClipError extends Error {}
export function unionMulti(...mps: MultiPoly[]): MultiPoly;                 // holes respected
export function intersectMulti(a: MultiPoly, ...b: MultiPoly[]): MultiPoly;
export function differenceMulti(a: MultiPoly, ...b: MultiPoly[]): MultiPoly;
export function withClipFallback<T>(where: string, fn: () => T, fallback: (error: ClipError) => T): T;
export function collectClipFallbacks<T>(fn: () => T): { result: T; fallbacks: { where: string; message: string }[] };
export function isSelfIntersecting(poly: Vec2[]): boolean;   // block-self-intersecting
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

// geometry/roof.ts  (everything is computed from `variant`; the `blocks` argument is accepted but unused)
export function roofParams(block: Block, level: Level): { eaveZ: number; ridgeZ: number; pitchDeg: number; pitchRad: number; ridgeLine: { a: Vec2; b: Vec2 }; halfWidth: number };
export function ridgeExtension(block: Block, variant: Variant): { start: number; end: number; startFree: boolean; endFree: boolean; startNoMeet: boolean; endNoMeet: boolean };
export function buildRoof(block: Block, variant: Variant, blocks?: DerivedBlock[]): DerivedRoof;
export function buildRoofs(variant: Variant, blocks?: DerivedBlock[]): DerivedRoof[];
export function buildRoofsWithWarnings(variant: Variant): { roofs: DerivedRoof[]; warnings: ModelWarning[] };  // + roofWarnings(variant)
export function roofUndersideAt(roof: DerivedRoof, x: number, y: number): number | null;
export function combinedUndersideAt(roofs: DerivedRoof[], x: number, y: number): number | null;

// geometry/walls.ts  (optional last `opts` replaces terrainZAt / combinedUndersideAt, for tests)
export function deriveBlocks(variant: Variant, site: Site, terrain: TerrainAsset | null, opts?: { terrainZ?: TerrainZFn }): DerivedBlock[];
export function deriveWalls(variant: Variant, blocks: DerivedBlock[], roofs: DerivedRoof[], opts?: { undersideAt?: UndersideFn }): { walls: DerivedWall[]; warnings: ModelWarning[] };
export function deriveBlockWarnings(blocks: DerivedBlock[]): ModelWarning[];   // block-overlap, parts-overlap

// geometry/outdoor.ts
export function deriveOutdoor(variant: Variant, site: Site, terrain: TerrainAsset | null, opts?: { terrainZ?: TerrainZFn; blocks?: readonly DerivedBlock[] }): DerivedVariant['outdoor'];
export function deriveOutdoorWithWarnings(…same…): { outdoor: DerivedVariant['outdoor']; warnings: ModelWarning[] }; // + 'deck-steps-blocked'
export function deriveStructure(variant: Variant, roofs: DerivedRoof[], opts?: { undersideAt?: UndersideFn }): DerivedStructure[];

// geometry/areas.ts  (callbacks instead of roofs / site / terrain, so areas.ts does not depend on roof.ts / terrain.ts)
export function computeAreas(input: { variant: Variant; blocks: DerivedBlock[]; rooms: DerivedRoom[]; decks: DerivedDeck[];
  undersideAt: (x: number, y: number) => number | null;   // combinedUndersideAt(roofs, x, y)
  terrainZ: (x: number, y: number) => number;             // terrainZAt(terrain, site, x, y, groundWorks)
  roofs?: DerivedRoof[] }): AreaSummary;                  // given → exact measurable BRA (derive passes them)
export function computeBya(input: { blocks; decks; terrainZ }): AreaSummary['bya'];          // derive: outdoor stage
export function computeBuildingAreas(input: AreaInput without decks / terrainZ): Omit<AreaSummary, 'bya'>; // building stage
export function measurableRegion(region: MultiPoly, elevation: number, roofs: DerivedRoof[]): MultiPoly; // free height ≥ 1.9 + 0.6 m strip

// geometry/terrain.ts
export function sampleTerrainAsl(terrain: TerrainAsset, x: number, y: number): number | null;   // finest grid covering the point, bilinear
export function terrainZAt(terrain: TerrainAsset | null, site: Site, x: number, y: number, extra?: GroundWork[]): number;
// relative to main floor, after site.groundWorks and `extra` (renderers: derived.groundWorks); fallback -0.5 when no data

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
export function blockGroundWorks(blocks: DerivedBlock[]): GroundWork[];   // gw-<blockId>: outer outline, lowestFloorZ − 0.1
export function furnitureFootprint(item: FurnitureItem): Vec2[];          // size rectangle rotated about the position

// geometry/levels.ts (levelAt is re-exported by model/derived.ts)
export function locateLevel(p: Vec2, storeyLevelIds: ReadonlySet<Id>, blocks: readonly DerivedBlock[]): { levelId: Id; blockId: Id } | null;
export function levelAt(derived: DerivedVariant, storeyId: Id, p: Vec2): Id;
export const GEOMETRY_FALLBACK: string;                                    // 'geometry fallback' (start of fallback warnings)
```

## Testing

- Schema 2 (phase 2): `migrate.test.ts` (v1 → v2 field-wise idempotent; the frozen phase-1 seed migrates to the
  current seed variant minus the lock), `persistence.test.ts` (a phase-1 delta link keeps the railing and the three
  steps, a full v1 project migrates, a revision-3 project shares as a delta < 2 kB, the backup-v1 copy before the first
  write), `outdoor.test.ts` (trimming, free runs, chained railings, steps hosted on edges, blocked steps),
  `derive.schema2.test.ts` (memo split: furniture-only and outdoor-only edits share the building arrays; timing;
  junctions, ghosts, levelAt, the implicit remainder is new, the furniture placeholder).
- `npm test` → Vitest (`src/**/*.test.ts`): geometry, room detection (incl. the seed through the real pipeline,
  `src/model/seed/forslagD.derive.test.ts`: all 27 rooms detected and named, no warnings at all, the locked base
  proposal, BYA 235.50 (178.33 + 57.18, existing 102.18) unchanged by schema 2, the terrace from x 9 with its glass
  railing and three unblocked stairs, block junctions symmetric, exterior pieces' s0/s1, axis total
  170.16, room areas within 0.15 m² of the IFC spaces, no roof slab below the envelope inside any room (0.1 m
  samples), both stair footprints free of floors above their bottom with `stair-level/stairwell` at −1, the terrain
  below every block floor, the derived wall `w-wing-w` (x = 16) with topZ 3.87, the wing ceiling at 2.45 with its
  partitions at 2.4, the double door's two 0.8 m leaves, no patch over a kept opening, loft BRA 12.54; it prints the
  room schedule and the area summary with `--silent=false`), roofs (extension ends y = 2.00 / 4.20 and x = 18.4;
  wall y = 6.2 x 5–9 peaks at 3.28 — the wing ridge underside, the IFC's 3.26 is the ridge beam top), walls on the
  seed (the 2.5 m corridor walls `w-vf-korr` / `w-korr-stue` are on 'main' only, the walls to the roof along the
  loft zone are in the loft), robustness
  (rotated seed, moved / swapped vertices, polygon-clipping mocked to fail), areas (invariants above), migrations,
  seed invariants, the 3D builders on the seed (terrain below every room floor with `derived.groundWorks`; the
  'inne-stua' camera stands in the Stue and frames Passasje and Spiseplass), the 3D scene on the seed from
  'framsiden' (the wing labelled, the glass bump behind it hidden, the main house's tag nudged clear, the bod
  wing's tag over its visible north end), the interior cut 1.3 → 2.3 with 'inne-stua' → 1.3 and no cut-height
  control in the 3D panel, no "save failed" without storage.
- Editing (phase 2a): `geometry/edit.test.ts`, `snap.test.ts` (pure rules), `state/editActions.test.ts` (every action on
  the real seed through the store: the lock, status bookkeeping and ghosts, BYA under block edits, wall / block /
  opening / deck / unit rules, reconcileRooms incl. a wall dragged past the middle of the next room, resizeRoom,
  transactions, robustness of every wall and block edge moved), `store.editor.test.ts`, the plan's gestures and tools
  with a mock drag protocol (`PlanView.edit.test.tsx`, `editModel`, `planSnap`, `editFeedback`), the UI on the real
  seed (`propertiesEditor`, `toolbar`, `numberField`, `roomResize`, `cornerDistance`, `editing.integration`) and 3D
  click selection / group reuse / drops (`selection3d`, `sceneParts`, `drop`). Fix round after 2a: dividers onto
  anchors, whole-wing moves keeping 27 rooms, block-edge bookkeeping sweeps, restore after endpoint drags, trees per
  proposal (`editActions.test.ts`, `edit.test.ts`); derive calls per drag frame (`editActions.drag.test.ts`); short
  drags and Alt (`dragSnap.test.ts`, `snap.test.ts`); small targets and handles (`smallTargets.test.ts`); phone taps on
  room labels and ±4 px wall / door / ghost taps through the rendered DOM (`touchTaps.test.tsx` with the test-only
  `svgHitTest.ts`); the locked drag, the drag loop, the anchor rect and `viewportInsets` (`PlanView.fixes.test.tsx`);
  toast undo binding and warning toasts (`toastUndo.integration.test.tsx`); the phone layout, sheet and mini-bar
  (`phoneLayout.test.tsx`); wording (`wording.test.ts`). Second fix round: the glass bump (east wall +0.5, corner
  drags × both restore orders, a part-less revision-4 copy), "Ta tilbake" bringing neighbours back (a sweep of every
  existing wall ±0.2 / ±0.5 m), clamped openings pulled back, Roter keeping contact (`editActions.test.ts`); the
  opening stage reuse and an opening-only change ≤ 8 ms (`derive.schema2.test.ts`); drag snapping of units, blocks,
  the hot tub and endpoints (`dragSnap.test.ts`, `snap.test.ts`); end handles from one diameter
  (`smallTargets.test.ts`); the unit tap order and render counts per drag frame (`PlanView.fixes2.test.tsx`,
  `stable.test.ts`); labels avoiding ghosts (`storeyData.test.ts`); warning toasts retiring, placeless warning texts,
  phone toast placement and the unit room's mini-bar (`toastUndo.integration`, `wording`, `phoneLayout`).
- `npm run e2e` → Playwright (Chromium; projects 'chromium' at 1400 × 900 and 'iphone' = devices['iPhone 13'] with touch
  through the DevTools protocol). smoke.spec.ts loads the app, waits for `window.__hytte.ready`, checks that no 'generic'
  warning exists, that a fresh start has the bundled `SEED_REVISION` (terrace from x 9, the three steps, the locked
  base proposal, the plan as the default view), that the
  Romskjema's Areal header ends inside the side panel without sideways scrolling, that the plan shows ≥ 15 room labels
  with an m² line, that an autosave of an older seed revision gets the "Hent ny Forslag D" banner and the button adds
  the new seed as the active variant, and that "Send forslaget" / Hjelp / the toolbar are on screen at 375 px, and writes
  screenshots into `e2e/screenshots/`: `plan.png`, `3d-ute-oversikt.png`, `3d-ute-framsiden.png`,
  `3d-ute-langsiden.png`, `3d-ute-inne-stua.png` (Ute + the 'inne-stua' camera: the roof from inside),
  `3d-inne-stua.png`, `plan-hems.png`, `phone.png`. editing.spec.ts (desktop, each test from a fresh "Nytt forslag"):
  the wing's east wall dragged 1 m (the wing follows, rooms grow), a Vedskjul on the terrace (deck pieces lose it, the
  north railing gets a gap; moved 1 m; attached to the wing's north wall = a junction), a partition across Soverom (ny
  fløy) ("Gi navn" for the new piece), Dybde 2,40 typed (w-gang-n moves), ghosts (an existing door moved 0.5 m, the
  existing wall w-104-103 deleted: rooms merge; Angre and "Ta tilbake" restore), Forslag D refusing every edit with
  the toast, each attempt on its own (a drag of the selected wall shows it and does not pan), the hot tub moved;
  fix round: a 0.3 m drag of w-gang-n lands on 3.7, the delete toast's Angre undoes only the delete (and a later
  edit retires it), a tree moved in a proposal leaves the site and Forslag D unchanged, the old west gable moved to
  −1 turns its three windows new with ghosts, the whole wing moved 3 m keeps every room named, a placed Vedskjul
  turns 90° and keeps its back on the deck edge; second fix round: the glass bump's east wall moved 0.5 m (new piece,
  ghosts, BRA / axis existing unchanged, BYA existing 101.9), a glass corner dragged and "Ta tilbake" on every ghost
  (none left, the seed again), w-105-diag moved 0.2 m and restored (the neighbour too), the end handle of w-vf-korr
  dragged 0.36 m at the starting zoom, a Vedskjul against the wing turned twice (still attached, no overlap), a click
  on the middle of w-104-103's ghost selects it, the "Ny advarsel" toast gone once the piece is named, the door's end
  handles at the starting zoom; screenshots `plan-editing.png` (deck handles), `plan-unit-on-deck.png`,
  `plan-ghosts.png`, `plan-glass-bump.png`.
  phone-editing.spec.ts (iPhone): "Nytt forslag", a one-finger pan and a pinch move nothing, a wall tapped and dragged,
  a number typed in the properties bottom sheet, a door tap-placed; at the starting zoom: taps on 8 room label points
  select the room (≥ 7), a selected door dragged 1.5 m keeps its width, a fresh Vedskjul dragged by its body keeps
  its size, the Egenskaper sheet leaves the selected wall in view above it, all six tools fit the screen; second fix
  round: taps ±4 px beside w-gang-n, w-104-103, dv-pass-n and door-mellom-vf select them (`data-hit-band` ≥ 8), the
  Vedskjul dragged 2 m west moves 2 ± 0.25 m and 1 m north about 1 m, a first tap on a placed unit selects it and a
  second its room (whose mini-bar has "Velg bygningsdelen"), the delete toast does not cover the tool row or the hint
  line; `phone-edit.png`, `phone-sheet.png`, `phone-tools.png`, `phone-toast.png`.
- `npm run build` must pass with zero TypeScript errors; `npm run lint` (oxlint) clean.

## Rules for contributors (humans and agents)

- Do not change files you do not own in a parallel task; propose instead. Do not add dependencies without noting it.
- No geometry in renderers; no React in `geometry/`. Keep functions small and tested.
- Never silently change Robin's design: if the spec is contradictory, keep the spec and add a `ModelWarning` or a note.
- Norwegian in UI, comma decimals, `m²`. English in code.
- Keep `STATUS.md` current: done / next / known issues.

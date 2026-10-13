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
               frozen for decoding phase-1 share links; never edited), seed/frozen/forslagD.schema1.rev2.json (the
               revision-2 seed of 11 Oct, only to recognise untouched phase-1 autosaves of that window),
               seed/terrain-merkesvatnet.json (TerrainAsset, built by scripts/build-terrain.mjs)
               unitTemplates.ts ("Nytt bygg" templates: Vedskjul, Bod, Badstue, Anneks, Eget bygg; names from nb.ts)
  geometry/    pure functions, fully unit-tested, no React/three imports:
               polygon.ts planarGraph.ts rooms.ts roof.ts walls.ts outdoor.ts areas.ts derive.ts geo.ts terrain.ts
               levels.ts (which level's floor is at a point: room detection and `levelAt`)
               edit.ts (phase 2: every edit rule as `apply…(draft, ctx, …)`, status bookkeeping, reconcileRooms)
               snap.ts (phase 2: snapping and dimension chips)
               furnitureDerive.ts (phase 2b: the furniture stage: level / room / floor, collisions, door swings)
               plumbing.ts (phase 3: the drainage helper — fixtures, toilet pairs, the suggested stack, runs, distances,
               the 'drain-far' warnings; memoised per derived model)
  state/       store.ts (zustand + zundo + immer), selection.ts, persistence.ts (UI prefs, links, files, the legacy
               autosave), appStore.ts (the app singleton, bootstrap, family session actions),
               familyStore.ts (+ .local.ts, .firestore.ts, .sync.ts, .fake.ts; phase 2b: the family's proposals),
               firebaseConfig.ts, editActions.ts (phase 2: the edit API and the drag protocol on a store;
               `useEditActions()`), editStrings.ts (= nb.editor), fixtures/ (a captured phase-1 autosave);
               phase 3: plumbingActions.ts (drain stacks on the store, the «Avløp og sluk» toggle, the drain warnings)
  plan2d/      SVG plan: PlanView.tsx and parts; editing: usePlanEditing.ts (gestures, tools), editModel.ts (handles,
               hit tests), editTypes.ts (the plan's side of the edit contract), editFeedback.ts, planSnap.ts,
               layers/EditOverlay.tsx, Legend.tsx, GhostLayer.tsx; phase 2b: layers/FurnitureLayer.tsx (+ FurnitureSymbol.tsx,
               furnitureSymbols.ts, furnitureLayerModel.ts), furniturePlacement.ts (tap / drop placement), furnitureDrop.ts
               (DOM events between the library and the plan); phase 3: layers/PlumbingLayer.tsx (stacks, runs,
               distances), layers/IfcLayer.tsx (the IFC model's outlines)
  view3d/      R3F scene: View3D.tsx, Scene.tsx, coords.ts, materials.ts, Walls.tsx, Roofs.tsx, Floors.tsx,
               Openings.tsx, Outdoor.tsx, Terrain.tsx (+ ground.ts), Trees.tsx, Labels.tsx (+ labelDefs.ts), StructureMeshes.tsx,
               cameras.ts, SunLight.tsx; phase 2: selection3d.ts (click selection tags), sceneParts.ts (group reuse),
               drop.ts + dropEvent.ts (furniture drop target); phase 2b: Furniture.tsx + furnitureBuilders.ts (models);
               phase 3: walk.ts (the walk's kinematics, no three.js), walkState.ts (walk session, «Skygger», joystick
               input, the test probe), WalkControls.tsx (the camera inside the canvas), WalkOverlay.tsx («Gå rundt» /
               «Avslutt», the joystick), sunPanel.ts (day presets, sunrise / sunset), capture.ts (the canvas for the
               PNG), IfcOverlay.tsx (the IFC model in 3D)
  ui/          App shell, panels, theme.css, format.ts, components; phase 2: Toolbar, HintLine, Toasts, NumberField,
               PropertiesEditor / PropertiesPanel (+ editors/), BottomSheet, SelectionMiniBar, LibraryPanel,
               FirstRunCard, editorBridge.ts (UiEditActions context, tools, lock helpers), commands.ts, overlay.ts;
               phase 2b: FurnitureLibrary (+ furnitureLibraryModel.ts, libraryDrag.ts, furniturePlacer.ts,
               useFurniturePlacer.ts), properties/FurnitureProps, ProposalsMenu, StatusPill (+ FamilyBanners,
               NameDialog), ShareDialog, TrashPanel, RevisionsPanel, UpdateToast, InstallCard, familyUi.ts, family.css;
               phase 3: ExportMenu.tsx (+ ExportDialog.tsx, a lazy chunk), PlumbingToggle.tsx + plumbingInfo.ts,
               IfcPanel.tsx (+ IfcPanelBody.tsx, a lazy chunk)
  export/      phase 3: paper.ts (paper sizes, sheet layout), sheets.ts (options, sheets per storey), planSheet.tsx (the
               plan layers at true scale), svgPrint.ts (screen SVG → what svg2pdf draws), titleBlock.ts, schedulePage.ts,
               planPdf.ts (lazy: jsPDF, svg2pdf.js, react-dom/server), png.ts + pngExport.ts (lazy), deliver.ts (share
               sheet or download), fileNames.ts, hook.ts (`window.__hytte.lastExport`)
  ifc/         phase 3: types.ts, transform.ts (the calibration IFC → plan), parse.ts + slice.ts (web-ifc → meshes and
               plan sections) and loader.ts (web-ifc and its wasm) — both lazy —, cache.ts (IndexedDB), store.ts (the
               overlay's own store), overlayData.ts, align.ts (+ align.real.test.ts against the real file), testIfc.ts
  i18n/        nb.ts — every user-visible string lives here
  furniture/   catalog.ts (phase 2b: the 50 catalogue entries, presets, stretch ranges, colours, clearances, frame helpers)
e2e/           Playwright: smoke.spec.ts, editing.spec.ts + furniture.spec.ts + proposals.spec.ts (desktop),
               phone-editing.spec.ts + phone-furniture.spec.ts (iPhone project), offline.spec.ts (pwa project), helpers.ts,
               opt-in real-Firestore specs (family-firestore, phone-family-firestore, family-offline; `E2E_FIRESTORE=1`,
               firestoreAdmin.ts), phase 3: phase3.spec.ts + phone-phase3.spec.ts, fixtures/test-cabin.ifc (a synthetic
               IFC, never the architect's), screenshots (e2e/screenshots/*.png, committed)
docs/          this file, phase2-plan.md, firebase-oppsett.md (the family space, for Robin), kalibrering-ifc.md (IFC facts),
               seed-brief-forslag-d.md (what the seed contains)
data/geo/      raw Kartverket elevation grids and the IFC element dump (inputs for scripts)
scripts/       build-terrain.mjs (data/geo → src/model/seed/terrain-merkesvatnet.json),
               freeze-seed-schema1.mjs (one-off: wrote seed/frozen/forslagD.schema1.json; refuses to run on a newer seed)
public/fonts/  self-hosted Barlow + Barlow Semi Condensed (woff2); public/*.png the app icons (180, 192, 512, 512 maskable)
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
  edges leave `Variant.ghosts` (`{ id, a, b }`, passed through as `DerivedVariant.ghosts`, dashed lines in the plan;
  `Variant.mergedRooms` — optional, no schema bump — keeps the Room records merges removed with their peers' anchors
  and, since the last fix round, the outline of the face they went into (`MergedRoom.face`), see Editing),
  and so do the ranges a shortened existing edge lost (partner stubs included; first free id `…/ghost`, `…/ghost/2`).
  Existing openings that a block-edge move carries or clamps turn new and leave their ghost at the old centre, hosted
  on a removed `'exterior-old'` wall with the edge ghost's id (`ensureGhostHost`), so the plan draws the old wall band
  with its windows and "Ta tilbake" on the edge ghost puts the edge and those openings back. When an `'open'` junction
  newly covers a stretch of today's wall on a partner edge that did not move (the glass bump's east wall +0.5 m opens
  blk-main's south wall x 9..9.5), that stretch gets an edge ghost too (`edit.ts addJunctionGhosts`; stretches that
  were open already get none); `healGhosts` keeps it while the junction still covers it, and its "Ta tilbake" moves
  the other block's edge back (`uncoverJunction`).
- **Unit ownership and carried walls** (last fix round after 2b, optional fields, no schema bump): `Room.unitId` is
  the template unit (a block from "Nytt bygg") a Room record was made with (`applyPlaceUnit`, `applyDuplicateBlock`);
  `Wall.carriedBy = { by, a, b }` names the wall whose move carried this one along (a continuation in line, a follower
  at a shared end, a T-junction) and the ends that move gave it (`edit.ts markCarried` in `applyMoveWall` /
  `applyMoveWallEndpoint`; dropped by the wall's own move and when it is back on its ghost). Proposals saved before
  this have neither: their units own what lies in them and in no other block, and "Ta tilbake" there falls back to the
  geometric rules of before (fourth fix round). Since the fourth fix round `carriedBy.from` keeps the wall's ends
  before that wall's moves carried it (kept over repeated moves), and "Ta tilbake" on the carrier returns it there.
- **Drain stacks** (phase 3, optional, no schema bump): `Variant.plumbing = { stacks: { id, p, storeyId }[] }`, each a
  point on a wall's centre line; no stack on a storey = the drainage helper suggests one there (`suggested-<storey>`).
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
9. Furniture (phase 2b, `deriveFurniture` in geometry/furnitureDerive.ts): `footprint` = the item's `size` rectangle
   rotated by `rotationDeg` (CCW; 0 = back to the north, 90 west, 180 south, 270 east) about its position
   (`furnitureFootprint`); `catalog` = the full catalogue entry (`FurnitureCatalogItem`, null for an unknown id:
   'furniture-unknown', a plain box); `roomId` = the room of the item's storey under its centre and `levelId` = that
   room's level (geometry wins over the stored level; a centre in a wall or doorway takes the floor there, one over a
   void keeps the stored level); `floorZ` = that level's elevation, else the deck top, else the terrain; `z` = floorZ +
   the catalogue elevation; `clearances` (front / sides / around); `collisions` = ids of other furniture (same level,
   overlapping z), walls (a door or window the item fits through vertically counts as open), structure (posts,
   chimney, stairs; beams ignored) and hot tubs, by separating axes on convex pieces with a 5 mm tolerance (an L-shaped
   corner sofa collides as its two parts, `outline: 'l'` / `seat`); flat items (rugs, drains: mount 'flat') never
   collide; a seat (`SEATING`: stol, utestol) pushed in under a table (`TABLES`: spisebord-*, utebord, salongbord,
   kjokkenoy) is no collision while its centre is at most `TUCK_DEPTH_M` = 0.25 m inside the table's edge and part of
   the seat is still outside it (`tuckedUnder`, fix round after 2b; the limit is measured at the chair's centre);
   `blocksDoors` = doors whose swing sector the item's z range reaches. Warnings in item order:
   'furniture-unknown', 'furniture-outside' (an indoor item on no floor of its storey and not on a deck),
   'furniture-needs-wet-room' (needsDrain outside bad / wc / teknisk / badstue / kjøkken), 'furniture-in-wall' (the
   first wall, structure element or hot tub it stands in; `wallId` is that id), then 'furniture-overlap' per pair and
   'door-blocked' per door and item (`by` = the item id; nb.ts names the item: «Døra … blokkeres av «Seng 150».»).
   Unchanged derived items keep their identity across wall, deck and hot-tub edits (`shareUnchanged`).

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
- furniture — (building, opened (the opening stage), outdoor, furniture).
With immer's structural sharing an edit of the furniture (or of the outdoor) reuses the building and opening stages:
the derived `walls`, `rooms`, `floors` … are the same array instances (tested); an opening edit reuses rooms, roofs,
areas and the outdoor stage and re-derives only the opening stage (tested deep-equal to a derive from scratch). Seed
timings (this machine, Node, 20 runs each, 2026-10-12): an opening-only change 0.2–0.9 ms (median 0.3; limit 8), a
stored-wall move ≈ 41 ms, a block-edge change ≈ 40 ms (target 60; the test allows × 1.5 locally, where the files run
in parallel, × 3 on CI), a hot-tub move ≈ 4 ms, a furniture-only change ≈ 0.5 ms for the seed's 57 items
(`deriveFurniture` ≈ 0.3 ms; limit 5).
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
  the ridge height, E is a free gable (overhangGable) with warning `roof-no-meet` — unless every block at that end is
  a placed unit (`Block.template`, Nytt bygg: a shed against a gable end is not meant to carry the ridge on; same free
  gable, no warning; final fix round after 2b). `Roof.extend.start/end` = total distance beyond the axis line,
  replacing both the automatic extension and overhangGable.
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
revealPan`). Last fix round: a selected furniture item the previous render did not have (a library item, a Dupliser
copy) is revealed with zero insets where the plan has none (a PC), so a fallback room off screen comes into view; a
selected unit is not revealed while the Møbler tool is active (the library sheet would pull the shed Nytt bygg left
selected into view and move the middle the library places by). Tools (`tool` prop): Velg; Vegg (two taps, the new wall
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

**Phase 2b in the plan.** Furniture (`layers/FurnitureLayer.tsx`) is drawn above the room-label hit areas and below the
walls: each item is its catalogue symbol (`furnitureSymbols.ts`, one per catalogue id, built from the item's own size,
front at local −y; appliances write "VM" / "TT" / "KJ" / "VV" when big enough; dining tables draw the table top alone —
chairs are items of their own, `symbolOverflow` is 0), tappable through its footprint only;
rugs (mount 'flat') are drawn under the other items and, until selected, take taps only on a 12 px band along their
outline (`FLAT_EDGE_HIT_PX`), so a tap inside a rug selects the room. The selected item gets an accent outline, its name,
its clearance zone (every item's with «Plassbehov for møbler», `ui.showClearances`, a persisted pref) and a rotate
handle (a tap turns 90°, a drag in 15° steps, 1° with Alt, applied once on release). Fix round after 2b: the
handle's hit area is its drawn circle only; on touch (`coarse`) its radius is at most `ROTATE_HANDLE_MAX_M` = 0.3 m and
it is not drawn when that is under `ROTATE_HANDLE_MIN_TOUCH_PX` = 10 px (below about 33 px/m; the mini-bar has Roter).
Final fix round: the handle stands on a free side (`handleSide` / `sideHandle`: the first of front, back, left, right
whose circle meets no other item and no live wall and whose stem crosses no live wall — `walls` prop, so an item
backed onto a wall never gets its handle in the next room; else a side over a rug only; on touch else a side
facing up on the screen, where the mini-bar does not cover it; else the front; `data-rotate-side` on the group is the
side's angle from the front, 0 / 180 / −90 / 90; last fix round: a side is never used when its circle or stem meets a
wall or the handle's middle stands on a solid item, the rest rank free, then over a rug, then (on touch) facing up,
then only grazing an item, the least overlap first (`circleDepth`); with no side left the handle is hidden and «Roter
90°» remains — 19 of 57 seed handles at 23.5 px/m; dividers are not checked, since the plan passes only
`data.pieces`), and a press on the drawn circle always turns the item (no
pass-through any more); a drag turns the handle's own side towards the pointer. A press on it is held
(`holdPointer`): the gesture tracker counts it but never pans, taps or claims with it, so a second finger anywhere
makes a pinch, and the handle then drops its press (no preview, no turn). `onLostPointerCapture` ignores a child losing its capture. Colliding items (their own `collisions` / `blocksDoors`
or the furniture warnings) get a red outline. Room names move off furniture where they can (the same text, else a
shorter one: "name / m²", the name alone) and keep their place otherwise; on touch the hit area of a name that had to
stay on furniture lies above the furniture (rooms are tapped by name on a phone), with a mouse the furniture under it
wins. A second tap on the selected item selects the room under the tap, and a tap on the selected room over an item
selects the item (`editModel.ts cycleFurnitureRoom`, next to `tapSelection` and `cycleOpeningGhost`). With the
Møbler tool and no item armed the plan behaves as Velg. A library drag over the plan shows a ghost where the item
will land (red when the spot is not free; `furniturePlacement.ts dropPlacement`), the release calls
`onDropFurniture`; `furnitureDrop.ts` carries the drag, the drop and "the middle of the visible plan" as DOM events,
so the library needs no reference to the plan (and the hidden plan or the 3D view work the same). That middle
(`PlanView.tsx uncoveredCentre`, fix round after 2b) is the middle of the svg box cut to the window and reduced by
`viewportInsets` (the part a bottom sheet leaves visible, the same area the reveal uses); off every room it falls back
to the label point of the last room used, then the middle of the storey's rooms, then the room nearest to it
(`placementCentre`), so repeated tap placements with nothing selected stay in the house and on screen. Final fix
round: while the Møbler tool is active the insets are the ones from before the library sheet opened
(`insetsBeforeLibrary`: the view the user was looking at, not the strip above the sheet; on a PC the visible middle),
and the request names the item (`requestPlanCentre(doc, catalogId)` → `PlanCentreDetail.catalogId`, passed by
`useFurniturePlacer` / `PlacerEnv.planCentre(catalogId)`): when it has no free spot (`tapPlacement`) in the room at the
centre, the 6 rooms nearest the centre (by label point) are tried before an overlap is allowed. Last fix round
(`ui/furniturePlacer.ts`): a selected unit gives its room to a library tap only while the plan's middle lies inside
that room's outline on the same storey (`unitNearMiddle`, fourth fix round; the 100 px rule is gone; `PlacerEnv.planMiddle`,
by default asked through `requestPlanCentre(document)`; without a plan on screen the unit's room is used), else the item
goes to the room in the middle, as with nothing selected; when the item lands in another room than the one picked or in
the middle — or in a unit's room while another room is in the middle — `PlacerEnv.toast` (the app's toast,
`useFurniturePlacer`) says where: `nb.library.placedInToast` «Kommode er satt inn i «Gang».». When neither the room in
the middle nor its 6 nearest have a free spot, every room of the storey is tried, closest first by outline distance
(rooms too small by area or diagonal skipped; `freeRoomElsewhere`), with `nb.library.placedFarToast` «Ingen plass i
rommene i nærheten: Seng 180 er satt inn i «Stue».»; only when no room has space does it stand in the middle room with
its warnings.
Editor polish (phase 2b): the drag loop calls `previewDrag` (state/editActions.ts: the snap and the dragged element's
target outline, no store change, no derive; about 0.1 ms in Node) every animation frame and `updateDrag` at most every
`updateInterval(last)` = clamp(2 × its last duration, 16, 150) ms, and once more with the last position before
`endDrag` (`usePlanEditing.ts`). The overlay draws two outlines: the base (the element at pointer-down, dashed) and the
preview's `target` (the element at the snapped pointer) solid over it, `data-edit-moving` (`normalizePreview` keeps
`target`; `previewFeedback` returns the base first, then the moving rings, also as `PlanFeedback.target`). A drag's
`hint` (`DragFeedback.hint` → `PlanFeedback.hint`, kept by `normalizeFeedback`) replaces the tool's hint line text while
the drag lasts (`usePlanEditing.ts` → `onHint`; a wall drag cut short: «Veggen kan ikke flyttes lenger hit – enden står
fast», final fix round). Fix round after 2b: before, `normalizeFeedback` dropped `target`, so the element moved only when an `updateDrag` landed; a touch press the plan claims (on the selection or a handle) becomes a drag after
5 px (`DRAG_THRESHOLD_TOUCH_SELECTED_PX`, a 0.5 m nudge at the phone's 11.56 px/m; elsewhere 10 px); a tap that the
DOM gives to a wall, opening or ghost band but that lies inside a drawn room name selects the room unless it is within
4.5 px of the element's line (`labelTap`, `data-label-box`); live openings' bodies lie above the ghosts and a second
tap on a selected opening selects the ghost under it; on touch the end handles of an opening are at most
`OPENING_END_HANDLE_MAX_M_TOUCH` = 0.3 m in radius and not drawn below `OPENING_END_HANDLE_MIN_TOUCH_PX` = 10 px (under
about 33 px/m; Bredde in Egenskaper covers the starting zoom), one capped radius outside the jambs; the handle carries
its radius as `PlanHandle.r` (px, only when it differs from the pointer's) and `EditOverlay` draws `h.r ??
sizes.handleR` (final fix round; before, 1.2 m circles at the starting zoom caught every tap near a selected door), and
`resizePlan` stores the width in whole centimetres with the other jamb fixed; loose-wall warnings say where the wall stands ("veggen nord i Stue", "på terrassen", "sør for
«Bod-fløy»") and identical lines merge with a count ("3 vegger nord i Stue henger løs …"; the Advarsler badge counts
every warning).

## 3D view (R3F, `view3d/`)

`<Canvas dpr={[1, 1.5]} frameloop="demand" shadows>` with `invalidate()` on store changes and control changes;
shadow map 2048 (1024 and no soft shadows on `(pointer: coarse)`). Groups (phase 2, `sceneParts.ts`): `building` (walls,
roofs, openings, foundations, floors, ceilings, structure), `outdoor` (decks (their `pieces`: boards on top, skirts
along each piece's outer ring), one railing per deck, every deck steps that is not blocked as its own mesh tinted like
its deck, hot tubs), `furniture` (phase 2b: `Furniture.tsx`, one parametric model per catalogue `model` key from
`furnitureBuilders.ts` in the old model's materials, built in the item's own frame and memoised on the catalogue id,
size, seat and cut height, so a move or turn reuses the geometry; one merged mesh per item plus shower glass without
shadows; recoloured by the item's `colour`; red tint for `collisions`; cut at the structure cut plane in "Inne",
items on hidden levels not built; about 4 ms and 20k vertices for the seed's 57 items) and
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
ceiling), deck piece or the shown ground. `Stage.tsx` places the item with the same placer as the library's tap
(`useFurniturePlacer`, back to the nearest wall within reach) on the level of the floor that was hit
(`furnitureBuilders.ts furnitureDropLevel`, imported lazily: a deck or terrain hit takes the ground storey's level
there). Modes: `ute` (all), `inne` (roofs hidden; storeys above the active storey hidden; each
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

**The family's proposals** (phase 2b, docs/phase2-plan.md §5; `familyStore.ts` holds the interface, the document
format, the rules and the links). The project on screen is the bundled Forslag D (locked, never stored) plus the
family's proposals. `FamilyStore`: `listProposals` (live), `saveProposal(variant, { base, force })` with the conflict
guard (a stored `updatedAt` other than `base` → `conflict`), `createProposal`, `renameProposal`, soft
`deleteProposal` / `restoreProposal`, `listTrash` / `purgeTrash` (30 days), `listRevisions` / `restoreRevision` /
`keepRevision` (≤ 20, at most one per 5 minutes of edits), `whoAmI` / `setMyName`, `status` / `onStatus`, `flush`.
Implementations: `familyStore.local.ts` (localStorage `hytte-planlegger:proposals` / `…:proposal-revisions`,
lz-compressed) and `familyStore.firestore.ts` (`families/{familyId}/proposals/{id}` + `/revisions/{rid}`, the proposal
as the JSON text of a one-variant Project because Firestore has no nested arrays; anonymous auth; the persistent
IndexedDB cache answers and queues writes offline; Firebase itself is loaded with `import()`, a separate chunk).
`familyStore.sync.ts` keeps the app store and a family store in step: debounced autosave (1 s shared, 500 ms local),
remote changes merged without undo steps (the history is rebased, so Angre never brings back someone else's old
version; a merge never counts as an edit to save), the conflict banner ("Hent endringene" / "Lagre over"), edits
saved before a soft delete, an offline save that lands on a newer version kept as a revision with a notice. Fix round
after 2b: soft delete, restore and `keepRevision` write only the changed fields (`ProposalPatch` → an `update` write op
with `arrayUnion` / `arrayRemove`; the fake Firestore applies it with `applyUpdate`), never the content, and add the
version they were made from to `lineage`; a device whose own newer version was deleted unseen gets the notice «… ble
slettet av X på en enhet som ikke hadde sett de siste endringene dine …» with «Hent tilbake»; Angre of a delete
restores rather than rewrites; writing over a proposal in the Papirkurv keeps the old content as a revision. Pending
counts the documents the listener flags with writes the server does not have (`AdapterDoc.pending`, also writes queued
by an earlier page), and `flush` waits for them (`waitForPendingWrites`), so an offline reload never shows «Lagret for
alle». No save is written while a drag transaction is open (`inTransaction()`: re-scheduled after 250 ms). An open
conflict shows the pill «Ikke lagret – velg Hent endringene eller Lagre over» and a `beforeunload` warning (iOS has
none). Anonymous auth uses `initializeAuth` with IndexedDB / local persistence and no popup-redirect resolver, so
phones load no Google scripts and no auth iframe. Final fix round after 2b: «Lagre over» saves with `forceRevision`
(the version written over is always kept, whatever the 5-minute rule) and «Hent endringene» keeps the local version
with `keepRevision` when it differs (also for a proposal deleted elsewhere); the banner says which version goes under
Tidligere versjoner (`nb.family.conflictKeeps` / `conflictKeepsDeleted`). The sync and `startPrefsAutosave` flush at
once on `visibilitychange` → hidden (all iOS fires when the user leaves the app), besides `pagehide` /
`beforeunload`. The last 5 own version stamps per proposal (at most 100 proposals) are kept in
`hytte-planlegger:own-versions:<family | local>`, so the overwritten / deleted-unseen notices work after a reload. A
content save over an existing document is a merge-set without `revisions` / `lastRevisionAt` plus `arrayUnion` of the
new revision id (`arrayRemove` for pruned ones; a new document is written whole), so an offline save from an old view
never drops another device's revision ids; a stamp never goes below the newest version seen (the document's
`updatedAt` can still go back when a queued offline save lands after a newer one: Firestore has no server-side max for
strings). Making a proposal is no undo step: the sync takes the history step that added a variant out of
`store.temporal` (and adds the variant to the other history states), so Angre can never delete a proposal for the
family without the menu's two confirmations; a delete stays undoable. Last fix round: creating a proposal or switching
to one clears the undo history (Angre is greyed out until the next edit; before, Angre right after «+ Nytt forslag»
undid the previous proposal's last edit and saved that for the family); the toast says «… Nå kan du endre det, og
Angre tar tilbake endringene du gjør i det.». Mode
(`resolveFamilyMode`): shared with a Firebase config, except in tests and under browser automation
(`navigator.webdriver`), overridable by `VITE_FAMILY_STORE` or localStorage `hytte-planlegger:family-mode`. Shared
mode whose Firebase cannot be loaded falls back to the local store for the session (`appStore.ts startFallback`,
pill «Kun på denne enheten (familiens plass kan ikke nås nå)»), retries every 15 s and on `online`, and once connected
saves what was kept locally into the family space (also at the next start: `importLeftovers`). Links: `#f=<family>`
(24–64 characters, decoded, trailing characters outside `[A-Za-z0-9_-]` — a sentence's full stop, a bracket — are
dropped; the address bar keeps `#f=…&p=<proposal>`), `#d=` (an old share link: imported as new proposal(s), ids
derived from the link). A `#f=` whose id is not whole never starts a family: the notice
'family-link-invalid' («Lenken til familiens plass er ikke hel …»), the stored family is kept, and a device without one
keeps its proposals in the local store (`noFamily`, pill «Kun på denne enheten (familielenken er ikke hel)», the broken
hash kept) until a whole link moves them in. A 33-character id ending in `_` or `-` (chat italics) is read as the
32-character id (`familyStore.ts`; generated ids are exactly 32). On a device WITHOUT a family a `#f=` link's space is
used but stored only once it shows proposals, a proposal is made there, or the user answers «Denne plassen er tom. Er
lenken hel?» with «Begynn her» (`startEmptyFamily`; until then the old autosave and leftover proposals are not moved
in; 'empty-family-banner'). On a device WITH a family, a link to any other space never switches on its own — at
start-up (an old tab, a bookmark, a session-restored tab, a new link) or pasted into the tab: the device stays, nothing
is stored, and the banner 'other-family-banner' («Denne lenken går til en annen delt plass.») says what both spaces
hold once the link's space has answered (`LinkedFamilyInfo`: «Plassen i lenken har 3 forslag (Pappa, Mamma); plassen
du bruker nå har 1.», read through a second store, `watchLinked`). Until then — and also when only this device's cache
has answered with an empty list (a slow or blocked connection; `updateLinkedInfo` ignores it, fix round 3 after phase
3) — `info` stays null: the banner says «Henter plassen i lenken …» (`nb.family.otherFamily.loading`) and no button is
highlighted (`data-primary="none"`). A non-empty list from the cache sets `LinkedFamilyInfo.fromCache`: its counts are
shown, but «finnes ikke» and the highlighted «Bli her» need a list the server has confirmed. «Bytt dit» (`switchToLinkedFamily`) is the
highlighted button only when the link's space has proposals made on other devices and the current one has none
(`family.created` / `…carried-in` tell this device's own); otherwise «Bli her» (`stayInFamily`, the address bar shows
the current space again). A `&p=` link to another space never switches on its own: it offers «Hent «navn» som en kopi
hit» (`copyLinkedProposal`: the copy's id is derived from the link, so the same link twice adds one copy), «Bytt dit»
(highlighted by the same rule as the space banner; after it the reload shows the linked proposal) and «Bli her»; the
other space is not touched by a copy. A copy from a proposal link counts as brought in while untouched and as made here
once edited on this device, so a later «Bytt dit» offers to bring it along (fourth fix round; copies of the round
before are recognised by their id). An old link `#f=<previous>&p=X` whose X is already in this space opens it here with
no banner and a short toast («… fra lenken finnes alt i listen.»). When the space being left has proposals from other
devices, the carry-over offer highlights neither button and adds «Den plassen har også forslag fra andre. Henter du
det hit, ser ikke familien det der lenger.». A `storage` listener on `hytte-planlegger:family` notices another tab of
the device switching: this tab saves what was pending (`ProposalSync.finish()`), then stops saving and becomes
read-only at once (`ui.readOnly`: no tools, no «+ Nytt forslag», no plan edits; 'family-elsewhere-banner' «Denne
enheten har byttet delt plass i en annen fane.», pill state `elsewhere` «Ikke lagret – last siden på nytt»), and «Last
på nytt» (`reloadInCurrentFamily`) reloads into the stored space. While the link's space is unconfirmed (empty, on a
device without a family) the pill says `notStarted` «Ikke startet – plassen i lenken er tom» (short «Ikke startet»),
also after «Lukk» — but only once the server has answered: a first list built from the device's own (empty) cache
carries `ProposalList.fromCache` (`familyStore.firestore.ts`), and an empty one sets `ui.unanswered` instead of
`emptyFamily`, so the pill says `connecting` «Kobler til …» (offline: `waitingOffline` «Uten nett – plassen i lenken er
ikke hentet ennå») and nothing is stored; `appStore.recheckWaitingList()` (after every sync state update) confirms the
family as soon as a later list has proposals (`confirmFamily()` → `runFirstList`, so the `&p=` proposal opens) and asks
«Denne plassen er tom» only on the first server-confirmed empty list (final morning round). «Hva heter du?» never
opens as a dialog by itself while someone edits: after the first save without a name a card ('name-banner', «Skriv
navnet» / «Hopp over»; `StatusPill.tsx NameCard`, rendered by `FamilyBanners`) floats in the toast area — fixed, bottom
centre on a PC above the first-run card, just under the toolbar on a phone, z-index under menus, dialogs and toasts, so
nothing moves when it comes — once nothing is selected and there has been no edit, selection or pointer / wheel /
touch / gesture / key input for 3 s (`askNameWhenIdle`; a hovering mouse does not count); it steps aside while a toast
shows, and a selection while it is shown takes it away and starts the same 3 s wait again (`hideNameOnSelect`, fix
round 3 after phase 3: before, it came back the instant the selection was let go). On a phone its top is measured
again whenever the toolbar may have moved (`toastLayout.ts watchToolbarMoves`: scroll, resize, and a ResizeObserver on
`.app`, `.topbar`, the headline, `.toolbar-wrap` and the hint line — a banner whose facts arrived late used to push the
toolbar under the card). «+ Nytt forslag» / «Kopier» in the shared space with the name unknown open one dialog
with both fields (`ui/Dialogs.tsx promptNewProposal` → `NewProposalDialog`, rendered by `NameDialog`); a name left
empty is not asked for again until the app is opened next time; «Hopp over» never asks again. «Bytt dit» (only it switches)
pushes the old id onto `hytte-planlegger:family.previous` and records it in `…:family.switched-from`; once the new space
has answered, the proposals this device created in the old one (`…:family.created`, filled by `ProposalSync.onCreated`)
are offered («Hent forslagene fra den forrige plassen»: `acceptCarryOver` copies them in — a copy whose name is taken
is named after this device, «Mammas idé (Pappa)», or «Mammas idé (kopi)» without a name
(`nb.family.carryOver.copyName`), not «(delt)» — and puts the old ones in the old
space's Papirkurv; «Nei takk» forgets the offer). Final fix round: the offer is the snapshot taken at the switch
(`…:family.switch-offer`: what was created in the old space before it), and copies brought in are recorded under
`…:family.carried-in` and never offered again (the last fix round replaced the final round's 'left-family-banner'
«Bytt tilbake» for spaces in `…:family.previous` with the 'other-family-banner' above, for every other space). «Lagre
over» records in the saved document which version it wrote over (`overwrote`) and keeps that version as a revision with
`reason: 'saveOver'`; the device whose version was put aside gets the overwritten banner «… ble lagret over av X …»,
and Tidligere versjoner tags revisions «din» and «lagt bort ved Lagre over», with seconds when two share a minute
(`familyUi.ts revisionLabels`). An untouched phase-1 «Forslag D (kopi)» in an old autosave is dropped like Forslag D
itself; an edited one, or any other name, is kept. The old whole-project autosave becomes proposals once and is kept as
`hytte-planlegger:project.before-2b`: a variant equal to the base it was made from (a phase-1 autosave is compared with
the frozen schema-1 Forslag D, `seed/frozen/forslagD.schema1.json`, and since the final fix round also with the
revision-2 seed the live site served for 11 minutes on 11 Oct, `seed/frozen/forslagD.schema1.rev2.json`) is left out
only when it is Forslag D itself (`forslag-d` with its seed name, or phase 1's auto-named «Forslag D (revisjon n)») — a
copy with its own name is kept even untouched; an edited copy becomes «Forslag D
(eget)» with the id `forslag-d-eget-<hash of the autosave's project id and times>` (unique per device, the same on
re-import);
the autosave's active proposal is shown (in local mode its key is written right after the start-up project is
built, so it is still shown after the next reload) and every migrated proposal keeps the autosave's «sist endret»
(`addVariants(…, { at })`). The PWA: vite-plugin-pwa, `registerType: 'prompt'`, `injectRegister: false`,
`UpdateToast.tsx` registers `./sw.js` (scope `./`) and asks before an update; when the new worker takes over, only the
tab that pressed Oppdater reloads (`onNeedReload`), the others show «Appen er oppdatert i en annen fane … [Last på
nytt]» (also on `controllerchange` in a tab that never saw the waiting worker); everything except the lazy PDF/IFC libraries
is precached (also the Firebase chunk and the fonts; the PDF/IFC libraries are cached on first use and warmed in the
background, see Phase 3), navigations fall back to index.html; the manifest has no `start_url` (a home-screen app
opens the page it was added from, `#f=` included).

`persistence.ts` (phase 1 – 2a; since 2b only the UI prefs, links, files and reading the legacy autosave are in use):
autosave of `project` (debounced 500 ms) to localStorage `hytte-planlegger:project`, written once
at start-up when nothing is stored (so a fresh project keeps its id across a reload); `saveNamedVersion` forces a
save first. Without storage (localStorage blocked) `startAutosave` does nothing and never reports a failed write: the
start-up notice 'storage-unavailable' already says so. UI prefs under `hytte-planlegger:ui` with `v` =
`PREFS_VERSION` (older prefs keep everything but the view; the view is only remembered once the user clicked a view
tab; `cutHeight` / `cutHeightBeforePreset` saved by the removed slider are ignored and dropped on the next save;
`PREFS_VERSION` 3: `highlightNew` is read only from prefs of version 3 on, since older prefs saved the old default
`false` whether or not the user chose it; `PREFS_VERSION` 4 adds `highlightNew3d`, which older prefs lack, so 3D starts
in natural colours; `showClearances` is persisted since 2b, absent = off);
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
Revision 6 (phase 2b) furnishes the seed (`seed/furniture.ts`, 57 items `fu-<room>-<n>`, ported from the old model's
`buildD150()`).
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
  plan pans), `updateDrag(session, p, modifiers)` → `{ indicators, chips, ghost, hint? }` (`hint`: a wall drag cut back
  or refused because an end cannot follow — `wallMoveFraction`, the same clamp as `applyMoveWall`, also applied to the
  preview's `target` — gives `nb.editor.wallStuck`), `previewDrag(session, p, modifiers)`
  → the same plus `target` (the dragged element's outline at the snapped pointer) without changing or deriving
  anything (phase 2b; the plan draws it every frame and applies `updateDrag` at most every few frames), `endDrag` /
  `cancelDrag`. Handles 'a' / 'b' (wall ends), 'start' / 'end' (opening jambs), 'insert' (deck "+"). A furniture drag
  updates the stored level too (`applyFurnitureMove`: the floor under the item, `levelAt`).
- **Furniture** (phase 2b): `addFurniture(catalogId, p, { levelId?, size?, rotationDeg?, sizeVariant? })` (size and
  `sizeVariant` from the catalogue preset, level from `levelAt`), `moveFurniture`, `rotateFurniture`, `duplicateFurniture`
  (the UI selects the copy; `duplicatePlacement`: back-to-wall and corner items take the next free spot from
  `tapPlacement` started at the original; free and flat items, and wall items with no free wall spot, keep the
  original's turn and take the nearest free spot on a 5 cm grid in the item's own frame — outside rooms on the
  original's deck; final fix round: a full room hands over to the rooms whose outline is within 0.6 m of it, nearest
  first, free spots only, the copy taking that room's level; with none, `duplicateFurniture` adds nothing, makes no
  undo step and toasts `nb.editor.duplicateNoSpace` «Ingen ledig plass til en kopi.»; last fix round: only a room a
  door or opening of the original's room leads to (`roomsThroughPassages`; no longer rooms behind a plain wall or a
  divider), the copy within 3 m of the original (`DUP_NEIGHBOUR_REACH_M`), an item that needs a drain only into a wet
  room, and the toast `nb.editor.copyIn` «Kopien står i «Vindfang».»), `deleteFurniture`, `setFurnitureProps` (a new size keeps the back
  edge in place, stretch ranges clamp, presets and colours apply; false when nothing changed). They refuse Forslag D
  and never reconcile rooms. Every action that moves walls (`run()`) lets furniture backed onto a moved wall face (≤ 1
  cm, either face, block edges too, thickness changes too) follow it (`followWallFaces`), never onto another level's
  floor, positions rounded to the micrometre, so "Ta tilbake" puts them back exactly.
- **Fix round after 2b** (the third review): a unit owns the furniture whose derived room lies in it (`furnitureOfBlock`):
  `applyMoveBlock`, `applyRotateBlock` and `applyDeleteBlock` (with the derive `ctx`) carry, turn and delete only those;
  `applyPlaceUnit` pushes items whose centre the new unit covers out past the nearest side, clear of blocks and other
  furniture, and `placeUnit` toasts `nb.editor.furniturePushedOut` («Utebord» er flyttet ut av «Vedskjul»). In
  `pullBackOpenings` a multi-step return is blocked only by an opening the move overlaps more than the current place
  does. `snap.ts` takes `SnapContext.ghostEnds` (point kind 'ghostEnd'; `dragSnapContext` turns it on for wall-end
  drags), so an end dragged back by hand lands on today's point and heals. `healGhosts` trims an edge ghost lying on
  its own live edge to the stretch a neighbouring block still keeps open (`clipEdgeGhost`, its host wall too), and
  «Ta tilbake» keeps a trimmed ghost. `applyMoveWall` keeps every axis-parallel wall parallel: a pinned end may slide
  onto a non-parallel wall meeting it at that corner (w-wing-w along w-sauna-n); otherwise the move is cut back to where
  every end can follow (`followableFraction`) or refused when an end cannot move; a wall continuing in line is carried
  sideways (`carryParallel`: lw-106-top moves with w-106-korr), and `restoreGhost` brings such carried walls back whole
  (lw-split can no longer be moved north at all). Room tombstones: the Room records in the undo history with the
  anchors of the rooms alive alongside them (`editActions.ts roomsFromHistory`) let `edit.ts reviveRoomRecords` give a
  merged-away room its face back when a later restore splits it again. Nytt bygg on touch reaches at most max(0.25 m,
  10 px) (`unitPlacementReach`, about 0.87 m at the phone's starting zoom; the mouse keeps its radius).
- **Final fix round after 2b** (the fourth review): `carriedSideways` counts a wall as carried only when it changed in
  the undo step that made the restored ghost (`ghostStep`: the history states either side of it); with no history
  (after a reload) only when it moved across by exactly as much as the restored wall at that end — a wall in line that
  the user moved in a step of its own (w-vf-korr beside w-103-korr, also the loft's lw-hems2-s) stays. `pushFurnitureOut`
  pushes only items with no derived room whose centre is in no other block (never the house's furniture; a unit over
  the house keeps its block-overlap warning), clear of walls and door swings (the unit's own new door included), up to
  2 m out in 5 cm steps; `applyMoveBlock` / `applyRotateBlock` and block drags push out what the unit did not own before
  the edit (`EditContext.pushed`, one toast per drag in `endDrag`), so a unit never takes terrace furniture over.
  `applyPlaceUnit` turns a unit 180° when its open front (or door edge) would touch another block (`deckFacingEdge`;
  same footprint, the mono roof then slopes towards the wing; placement only). Each merge stores the removed Room with
  the anchors of the rooms on its storey (`Variant.mergedRooms`, `MergedRoom { room, peers }`, at most 40; dropped when
  the room comes back; optional, no schema bump), so the revival survives a reload; it still happens only in
  `restoreGhost`.
- **Last fix round after 2b** (the fifth review): a unit owns only its own things (`edit.ts blockOwnership`, used by
  `applyMoveBlock`, `applyRotateBlock` and `applyDeleteBlock`): new walls with both ends inside it and no point strictly
  inside another block nor along another block's edge; Room records with its `Room.unitId`, or anchored inside it and in
  no other block; its own furniture and structure whose centre is in no other block. Whole-block moves, turns and block
  drags run with `RunOpts.follow: false`, so nothing backed onto the unit's walls follows (a unit over the house took
  existing walls, room names and house furniture along when moved, turned or deleted). A template unit never stands on
  another block (`unitOverlaps`, `unitMoveFraction`, `unitClearShift`: exact separating-axis tests, 1 mm tolerance, a
  unit along a wall is fine): `snapPoint('unit')` shifts the ghost clear within its reach — for a tap outside every
  building within half the unit's size, from the snapped place, else from the tapped one — or sets
  `ToolSnapResult.hint` (`nb.editor.unitOnBlock` «Bygget kan ikke stå oppå et annet bygg», shown on the hint line while
  the Nytt bygg ghost is hovered, `usePlanEditing.ts ghostHint`), and `placeUnit` refuses there with the hint as a
  toast; a body drag shifts clear within reach, else stops at the contact with `DragFeedback.hint`; `moveBlock` stops at
  the contact or refuses, `rotateBlock` shifts up to 0.25 m clear or refuses (toasts); edge and corner moves are cut
  back to the contact (`applyMoveBlockEdge` / `Vertex`; the preview and hint through `blockEdgeMoveClamp` /
  `blockVertexMoveClamp`). `duplicateBlock` puts a unit's copy beside the original (0.5 m gap) or refuses. After an edge
  or corner move of a template unit `applyUnitPolygons` runs the push-out, so an enlarged unit pushes terrace
  furniture out too (the toast for `moveBlockEdge`, `moveBlockVertex`, `setBlockSize` and edge / corner drags). "Ta
  tilbake" and carried walls: `Wall.carriedBy` replaces the undo-history guess (`ghostStep` and the "moved by exactly
  as much" fallback are gone): `carriedSideways` and `neighbourEnds` bring a wall back only when its `carriedBy` names
  the restored wall and still holds; walls moved on their own (`notCarriedBy`) are kept out of every cascade back, and a
  neighbour end such a wall meets stays. A merged-away name revives only into faces this restore changed
  (`reviveRoomRecords` takes a face filter) with the toast `nb.editor.roomsBack` («Rommet «WC» er tilbake.»), and a
  `Variant.mergedRooms` record goes when another edit redraws its face (`MergedRoom.face`). A Vedskjul placed with its
  back against a block gets `slopeTo` high against that wall (also when placed turned so by the user).
- **Fourth fix round** (the sixth review): edge moves never pass between a template unit and a building that is not one
  (`edit.ts carriesThrough` in the shift plan, `unitAwarePlan`): Bredde / Dybde of a unit against a building change its
  free side (`blockSizeMove` picks the side; `BlockEditor` still passes `'max'`) and are refused with
  `nb.editor.unitOnBlock` when the unit would grow into the building; the attached edge dragged into the house is
  refused with the hint, a corner drag slides along the wall (`withoutPushesIntoBuildings`, also in the preview); an
  edge moving away detaches the unit, and the house's partitions are not stretched (a unit's edge takes only its own
  walls). "Ta tilbake" on an edge of a building pushes a unit standing against it away whole (`restoreEdgePushes`), or
  is refused with the toast and changes nothing (`restoreEdgeOnBlock`). A carried wall goes back to
  `Wall.carriedBy.from` (where it stood before the carry), not to its ghost; a corner or T with another moved wall is
  closed again where the two lines cross (`editActions.ts keptJunctions` / `closeJunctions`); a new wall without a
  ghost that the user moved counts as moved (`movedNewWalls`), and `carriedBy` is recorded on such walls too. The
  geometric fallback for variants without any `carriedBy` (`noCarriedBy`) was removed in the final morning round: it
  also switched on in today's proposals whenever nothing happened to be carried and slanted the user's own walls, and
  no published proposal predates `carriedBy` (wall editing went live with it). A `Variant.mergedRooms` record is kept
  while its face is only reshaped; another edit drops it only when it splits the face holding the record's anchor (at
  least two pieces each ≥ 0,5 m² or ≥ 15 % of the old face, or holding another room's anchor: `substantialPiece`, so a
  sliver beside a moved wall is no split) or leaves the anchor in another room's face (`withMergedRooms`;
  `MergedRoom.face` is now for reference only). A drawn block keeps the walls on an edge shared with another block (the wing takes
  `w-wing-w` and `o-stue-gang` when moved or deleted); only a unit leaves such walls to the other block. The push-out
  after a placement also moves terrace items whose footprint reaches into the new unit's walls (the Loungesofa beside
  a Vedskjul set against the house).
- **Final morning round** (the seventh review): «Ta tilbake» on a building edge checks the whole plan before it
  changes anything — `applyRestoreEdgeGhost` computes the edge plan (without the units it would push) first, and
  `restoreGhost` refuses at once when `restoreEdgeOnBlock` holds — so a refused restore changes nothing and leaves no
  undo step (`healGhosts` also assigns a new ghosts array only when a ghost actually healed, else every refused edit
  saved an undo step). A house edge or corner that cannot move outward because a unit stands against it is refused
  with the unit's name (`edit.ts unitInTheWay`; the block-edit plan, `blockEdgeMoveClamp` and `blockVertexMoveClamp`
  return its `unitId`; `editActions.ts onBlockText` → `nb.editor.unitInTheWay`, "«Vedskjul» står inntil veggen – flytt
  det først", in the toast and the drag hint); a unit's own edge pushed into the house keeps `unitOnBlock`. Bredde /
  Dybde that make a unit narrower than its own opening narrow the opening to edge − 2 × post (post = min(0,1 m, edge /
  4)) and centre it (`edit.ts fitUnitOpenings`, toast `nb.editor.unitOpeningsNarrowed` with Angre); dragging the
  unit's edge does not.
- **Fix round 3 after phase 3** (the eighth review): `carriesThrough` carries an edge shift only between two buildings
  that are not template units — never to or from a unit — so a unit snapped against another unit is never squeezed by
  it (before, Bredde 3 m of one Vedskjul shrank the one beside it to 1 m, merged its room away at 3,8 m and left its open
  front outside its wall). `unitEdgeAttached` counts an edge against another unit as attached, so Bredde / Dybde change
  the free side (refused only when both sides are blocked) and an attached edge pushed into the neighbour is refused;
  `withoutPushesIntoBuildings` / `unitAwarePlan` return the neighbour's `unitId`, so the toast and the drag hint say
  «Vedskjul 2» står inntil veggen – flytt det først. `restoreEdgeOnBlock` returns `false | { unitId?: Id }`: the unit
  that cannot be pushed away (`restoreEdgePushes` → `stuck`) or the one in the edge plan's way; `restoreGhost` then
  toasts `nb.editor.restoreUnitInTheWay` («Ta tilbake går ikke: «Vedskjul» står i veien – flytt det først.»), or
  `unitOnBlock` when no unit is known. `fitUnitOpenings(draft, blockId, base)` acts only on edges whose length changed:
  the template's own opening (the open front on the front edge, the door; `templateOpeningWidth`) is centred, and one
  that filled its old edge grows back towards the template's width when the edge gets longer, up to edge − 2 × post
  (`fitWidth`, so there is no jump at the template's own width); anything wider is narrowed (toast); an opening the user
  made narrower keeps its width, and openings the user added only narrow.
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
  a drag (the placement tools) point targets and the ortho guides through the start keep the full radius, and so does
  the "Nytt bygg" ghost (12 / 24 px: a Vedskjul tapped 0.4 m from the wing attaches on a phone). Editor polish (phase
  2b): in unit and block drags, contact targets (a block edge faced from outside, a deck edge the unit stands along
  from inside, really overlapping) reach max(0.25 m, the drag threshold in metres, `DragModifiers.dragThresholdM`); a
  unit edge that would end inside a block is pushed back out against that block's wall; the 0.25 m cap and the
  half-drag rules apply to the snapped point's displacement; extensions and perpendiculars of walls on another level
  are skipped; a free unit off the 0.1 m grid turns about its own centre (`centreTurn`); a clamped wall end is carried
  along by a coincident wall that gets longer (w-103-korr stays parallel).
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
  stack sits 8 px below the tool row and the hint line (`toastLayout.ts phoneToastTop(toolbarBottom())`, updated by
  `watchToolbarMoves`: scroll, resize and size changes of what is above the tool row; the CSS default at the top of the
  screen when the tool row is scrolled away).

## UI (`ui/`)

Layout (phase 2a, top bar since 2b): top bar (title, the "Forslag: <navn> ▾" menu (`ProposalsMenu.tsx`: Forslag D first
with a "Grunnlag" tag, then the family's proposals with "sist endret av …", "+ Nytt forslag", "Lag en kopi", Papirkurv),
"+ Nytt forslag" (asks for a name, copies the proposal on screen; the primary button on Forslag D), Gi nytt navn, Slett
(two steps: "Vil du slette «X»?" → "Er du sikker? …" → into the Papirkurv; not for Forslag D), the status pill
(`StatusPill.tsx`), Eksporter (phase 3, `ExportMenu.tsx`: «Eksporter plan som PDF …», «Lagre 3D-bildet som PNG»), Mer
(Tidligere versjoner, Papirkurv, Lagre som fil, Åpne fil, Eksporter JSON, and "Endre navnet ditt" in shared mode), "Send forslaget" (`ShareDialog.tsx`, a lazy chunk loaded on first open: the family link and the deep link,
`navigator.share` on phones; locally a `#d=` copy), Hjelp; the conflict / overwritten / too-new banners and the app-update toast belong to
the top bar too; "Hva heter du?" once per device in shared mode) · left
column (view tabs Plan/3D/Begge, plan storey tabs, 3D mode + presets and «Gå rundt», toggles (with the plan also «Avløp
og sluk»), the «IFC-modell» panel (closed until opened), «Sol og skygge» (day presets, date, time slider with the
daylight band, «Skygger»); no cut-height control:
'Inne' cuts the walls 1.3 m above each floor, 2.3 m with 'Inne i stua'; Vis has «Plassbehov for møbler»; while the
Møbler tool is active the furniture library (`FurnitureLibrary.tsx`: search ignoring case and æ/ø/å with a few
synonyms, the categories as an accordion with counts — the selected room's category open first —, each item with
its plan symbol, name and size in cm; a tap places it through `useFurniturePlacer` in the selected room (or the
room of a selected item or one-room unit), else at the middle of the visible plan, back to the nearest free wall,
corner items into a corner, tables and rugs near the middle; a mouse drag after 5 px or a 280 ms long press on touch
carries it over the plan or the 3D view, Esc cancels) replaces it) · centre: toolbar (Velg · Vegg · Dør/vindu · Nytt bygg · Møbler · Mål, then Angre / Gjør om; the
type chooser of Dør/vindu and the template chooser + "Roter" of Nytt bygg below it), hint line, then the plan and/or
3D, the first-run card ("Slik kommer du i gang", hidden for good with "Skjønner") and toasts at the bottom centre ·
right column, `clamp(360px, 24vw, 440px)` wide (340 px between 1100 and 1279 px): Egenskaper first (the editors per
selection kind: basic fields, "Mer", action buttons, status tag "Hytta i dag" / "Nytt" / "Fjernet"; number fields
accept "2,4" / "2,40" / "2.40", −/+ 10 cm, Enter / Tab / blur commit, Esc restores; Møbel: `properties/FurnitureProps.tsx`
with Navn, Rom (read-only), Størrelse presets, Bredde / Dybde within the stretch range, Farge from the catalogue
swatches or Standard, Roter 90° / Dupliser / Slett), Romskjema, Arealer with
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
no anchor, and shown only with Velg — final fix round: with Nytt bygg, Vegg, Dør/vindu, Mål or Møbler active it would
lie over the plan where the next tap goes, and a tap meant to place a shed hit its Slett) opens the properties as a bottom sheet (schedule rows too). The sheet opens LOW (40dvh, basic fields only)
and "Vis mer" / the handle opens it to 88dvh with everything; it reports its height (`overlay.ts setSheetHeight`),
opening it scrolls the toolbar to the top of the screen, and `Stage.tsx` hands the plan the covered parts of its box
as `viewportInsets` (`planInsets.ts`) while a sheet is open. The furniture library is a bottom sheet that closes after a
placement (the new item selected with its mini-bar); below 600 px "Send forslaget" and Hjelp are icon buttons in the
title row and the pill shows a short text. After the first-run card the home-screen card (`InstallCard.tsx`) shows once
where it applies (iOS Safari: Del → «Legg til på Hjem-skjerm» with the family link open; browsers with
`beforeinstallprompt`: "Installer"). Read-only (shared link): banner with "Lag min egen kopi";
edit panels/tools hidden, view controls, schedule and areas kept. Wording (fix round after 2a): "Trykk" in every
hint, "Roter" the only rotate verb, `device.ts undoHow()` = "Angre" on touch and "Angre eller Ctrl+Z" with a keyboard;
the ghost tag reads "Fra hytta i dag"; Romskjema, headline and Arealer say "i dag" ("Herav hytta i dag"); read-only
rows use the editors' names ("Høyde over gulv", "Trinn"); a selected door or window is tagged "Dør/vindu"; the help
heading is "Slik bruker du planleggeren". The first-run card and the hint
line on Forslag D say it is the fixed base and that "+ Nytt forslag" makes a copy to change; "Nytt forslag" closes the
first-run card for good (`firstRun.ts`) and, while the card is open, toasts move above it (`toastLayout.ts`). Theme tokens from the old model (self-hosted Barlow / Barlow Semi Condensed,
`--accent #4f6b55`, `--new #c8742a`, light + dark). All strings in `i18n/nb.ts`.

## Phase 3: export, walk, sun, drainage, IFC

All four are optional layers on the same data: nothing here changes the project except the drain stacks
(`Variant.plumbing`). Strings in `nb.export`, `nb.walk`, `nb.sun`, `nb.plumbing`, `nb.ifc`.

- **Start bundle.** jsPDF, svg2pdf.js, react-dom/server, web-ifc and its wasm, the PDF dialog, the PNG code, the IFC
  panel's body and the IFC parser are lazy chunks (`ExportMenu.tsx` loads `ExportDialog` on first open and
  `pngExport` when the menu opens; `IfcPanel.tsx` loads `IfcPanelBody` when the panel is opened; `ifc/store.ts`
  imports `loader.ts` on the first file). They are not precached by the PWA either (`vite.config.ts LAZY_LIBS_*`:
  about 6 MB most installs never use) but cached on first use (runtime cache `hytte-lazy-libs`, cache first), so a PDF
  or an IFC works offline once it has been used online. Final morning round: `export/warmLazy.ts warmLazyChunks()`
  (itself a small chunk, imported by `main.tsx` after the first render) waits 8 s and an idle moment, then — only
  online, only with a service worker registered, not with «Spar data», once per build (`hytte-planlegger:lazy-libs-warm`)
  — imports the PDF code and web-ifc (their chunks are fetched; nothing is started) and puts those files and the wasm
  straight into `hytte-lazy-libs` (also on the very first visit, before the worker controls the page); its
  `LAZY_CACHE` / `LAZY_FILE` must match `vite.config.ts`. Offline before that, `export/offline.ts offlineFirstUse(e)`
  (a failed chunk / wasm download, or `navigator.onLine === false`) makes the PDF dialog and the IFC panel say
  `nb.export.offlineFirstUse` («Første gang trenger dette nett – koble til og prøv igjen; etterpå virker det uten
  nett.») instead of the raw error or «IFC-fila kunne ikke leses» (the loader's reason `'offline'`). The drainage layer
  (`PlumbingLayer.tsx`) is a lazy chunk too, loaded when «Avløp og sluk» is first switched on (precached), and so is
  «Send forslaget» (`ShareDialog.tsx`, fix round 3 after phase 3, precached). The `hytte-lazy-libs` route matches with
  `matchOptions: { ignoreVary: true }`: the page stores those files itself, and with a server that sends `Vary: Origin`
  (`vite preview`) the module script's request never matched them offline (safe: the names carry a content hash;
  `e2e/lazy-offline.spec.ts`). The start bundle (the entry script and its modulepreloads, gzip -9) is 1 081 kB (327 kB
  gzip), against 1 083 kB (327 kB) before fix round 3 after phase 3, measured the same way. `optimizeDeps.include` pre-bundles the libraries
  for the dev server (found only at their first dynamic import, Vite would reload the page then).
- **PDF** (`export/`): `sheets.ts` turns the options (A4 / A3, 1:50 / 1:100, Plan 1 / Hems / Begge, names and areas,
  dimensions, furniture, colours or black and white) into sheets per storey: orientation automatic, a storey too large
  for one sheet tiled with 1 cm overlap («Ark 2 av 7 · rad 1, kolonne 2»); Hems uses Plan 1's rectangle so the storeys
  line up. `planSheet.tsx` renders the plan's own layers with `renderToStaticMarkup` at true scale (1 m = 20 mm at
  1:50), `svgPrint.ts` rewrites that SVG for svg2pdf, `titleBlock.ts` adds the title block (project, proposal,
  storey, scale and paper, date, BYA / BRA, north arrow, scale bar, «sist endret av …», the legend), and
  `schedulePage.ts` the Romskjema per level and the area totals on the last sheet(s), its text 3 mm in from the frame
  (`scheduleBodies` gets the inset area, so the dialog's page count follows). Helvetica (jsPDF needs TTF; only woff2
  Barlow is bundled), WinAnsi: every user text — the plan's labels, the title block (`text()`), the schedule (`t()`,
  its measuring included) and the PDF's metadata title — goes through `svgPrint.ts pdfSafeText` (arrows → «->», ≈ →
  «~», emoji and other letters → «?»). File `hytta-<forslag>-<dato>.pdf`; on a PC a download, on a touch device whose share sheet
  takes files «Del …» / «Last ned» (`deliver.ts`). The dialog's choices are remembered per device
  (`hytte-planlegger:export.pdf`). Defaults A3 1:100 (Forslag D then fits one sheet per storey).
- **PNG** (`export/pngExport.ts`, `png.ts`, `view3d/capture.ts`): re-renders the current scene at the device pixel
  ratio (at most 3× and 16 M pixels), adds a caption strip (proposal, «3D · Ute · Oversikt · dato», «Hytteplanlegger»)
  and saves `hytta-3d-<dato>.png`; synchronous from the tap, so a phone's share sheet opens; with no 3D view shown yet
  it switches to 3D, waits for a frame and downloads. HTML labels are not in the picture. While walking the P key and
  the camera button under «Avslutt» (`view3d/WalkControlsPhoto.tsx`) save it without ending the walk
  (`export/walkView.ts saveWalkPhoto`); the caption's view is then «Gå rundt» (`captionTexts`: while walking, and after
  a walk ended with Esc until the camera moves again, `walkViewKept`).
- **Walk** («Gå rundt»; `view3d/walk.ts`, `WalkControls.tsx`, `WalkOverlay.tsx`, `walkState.ts`): eye 1,65 m over the
  floor, deck, stair tread, step or terrain (eased; ducks under the low loft slab; never under the terrain; not into
  the lake); walls slide, doors and openings with a low sill let the walker through, windows (the glass bump too),
  railings, the hot tub, posts and the chimney block; furniture does not. Below the floors (final morning round,
  `buildWalkWorld → addSkirtsAndPlinths`): each deck piece's outer ring blocks from its skirt bottom (or the terrain) up
  to the deck's underside, and each derived foundation outline (`WalkDerived.foundations`) from its bottom to its top,
  so nobody walks in under the terrace or into a plinth on the slope; the flip side is that an unrailed deck edge more
  than ~0,65 m above the terrain cannot be stepped off. Start: where the user clicked a floor in 3D, else a selected
  room's label point (both facing the camera's way), else inside the Stue 1,6 m from the glass door facing the
  terrace; Playwright can set `window.__hytteWalkFrom = { x, y, heading }` for the next walk (WalkControls.tsx
  `takeTestWalkStart`; nothing in the app sets it). PC: pointer lock (drag to look if refused), W A S D / arrows,
  Shift runs, P saves a PNG and walks on, Esc or losing the lock ends the walk with the camera left where the walker
  stood (`keepWalkerView`: the orbit target 4 m ahead; the orbit controls' 'start' event cancels the rig's easing back;
  until the camera moves again the walk's field of view stays and `walkState.viewKept` shows no camera preset pressed,
  then the orbit's field of view comes back; a new walk drops the watch);
  walk keys are swallowed (no nudge in the plan). Touch: the joystick bottom left, a drag on the right 60 % of the view
  looks, «Avslutt» top right with the camera button stacked under it. «Avslutt», a camera preset or the Plan tab end
  the walk with the camera easing back. Every tap on a preset goes to it, also the one already chosen
  (`walkState.requestPreset()` bumps `presetRequest`, which the camera rig's preset effect lists; fix round 3 after
  phase 3: after Esc the pressed preset did nothing). Playwright reads the camera through `window.__hytteCamera()`
  (position, orbit target, field of view; Scene.tsx, nothing in the app uses it). While walking every storey shows whole and clicks do not select. The session
  and «Skygger» live in `walkState.ts` (the shadows choice per device), not in the app store.
- **Sun** (`view3d/sunPanel.ts`, `ui/Controls.tsx`): presets «Midtsommer» (21 June), «Jevndøgn» (20 March),
  «Midtvinter» (21 December) of the chosen year and «I dag» (today's date and the time now at the cabin); under the
  time slider the day's daylight band with sunrise / sunset ticks at the cabin («Sola er oppe hele døgnet» / «Sola er
  under horisonten»); «Skygger» on / off. The band samples the sun's altitude every 5 min over the local day and
  narrows each crossing to the second (`sunDay`), so the days next to the midnight sun are right (23 May: set 00:45,
  rise 01:07; 21 July: set 00:51, rise 01:22), where suncalc's `getTimes` misses an event.
- **Drainage** («Avløp og sluk»; `geometry/plumbing.ts`, `plan2d/layers/PlumbingLayer.tsx`, `state/plumbingActions.ts`,
  `ui/PlumbingToggle.tsx`, `ui/plumbingInfo.ts`): fixtures that need a drain (`needsDrain` in the catalogue: toilets,
  showers, basins, washers, floor drains, the water heater); toilets back to back or side by side on one wall are a
  fine pair («WC og Hovedbad: toalettene står rygg mot rygg på veggen ved x 18,6 – det er fint.»). The suggested stack
  goes to the largest group of fixtures within 3 m of each other, at the wall point that keeps most of them in reach
  (toilets × 3, walls with wet rooms on both sides preferred, exterior walls penalised for frost). Toilets are measured
  along the stack's wall (across, then along: an L), other fixtures in a straight line; fine: a toilet within 1,0 m
  (`TOILET_REACH_M`), a pair within 2,5 m (`PAIR_REACH_M`), other fixtures within 3,0 m (`FIXTURE_REACH_M`); fixtures in today's wet rooms
  (a room still mostly existing area whose Room record had a wet type in Forslag D; toilets only in bad / wc) use
  today's drains: no run, no warning. A fixture too far gets a red run, a line in the Vis section and, while the
  overlay is on, a `'drain-far'` warning in Advarsler and the toolbar count (`withDrainWarnings`, not from
  `deriveVariant`; not analysed at all while the overlay is off). Stacks drag along walls (snapping out of openings),
  a tap gives a × to delete, «Legg til avløpsstamme» stores one; the suggestion comes back on a storey without a
  stored stack. The stack's hit circle is 12 px (16 on touch) but at most 0,25 m, so the toilets beside it stay
  selectable; on touch an unpicked stack's target is never smaller than the drawn stack (10 px, so it can be picked at
  the starting zoom, where 0,25 m is under 3 px): max(10 px, min(16 px, 0,25 m)). On touch it works like furniture: a finger on a stack that is not picked is the plan's (a
  drag pans, a second finger pinches; a tap picks it and also clears the plan's selection), and only the picked stack
  drags (with the larger target). A picked suggestion explains itself in the plan's hint line (`onHint`,
  `nb.plumbing.suggestedNote`), not in the plan. The toggle is per device (`hytte-planlegger:plumbing`). No 3D, no
  falls or pipe sizes.
- **IFC overlay** («IFC-modell»; `src/ifc`, `IfcLayer.tsx`, `IfcOverlay.tsx`, `IfcPanel.tsx`): the user picks the
  architect's file (no `accept` filter: iOS greys out .ifc); the loader checks the STEP header, imports web-ifc
  (single-threaded) and parses merged meshes per kind (wall, window, door, roof, slab, other) and plan sections (Plan 1
  cut at 0,9 m, Hems at 2,1 m with only the upper IFC storey's elements). The parsed model is cached in IndexedDB
  (keyed by name and size; the file itself is never stored or uploaded) and comes back after a reload. Transform
  IFC → plan (`transform.ts`, docs/kalibrering-ifc.md): translate (+4,71, +1,79), no rotation, no mirror, plus the
  panel's nudge (1 cm steps, ±10 cm). Plan: blue (#1f6fd1) outlines, doors dashed, no pointer events; 3D: semi-
  transparent meshes with blue edges (walls with doors and windows / roof / slabs), clipped at the cut in «Inne»,
  outside the scene root (no picking, no labels). Measured against the real file (`align.real.test.ts`, skipped
  without it): the 10 existing exterior wall pieces within 0,1 cm on both faces. The plan PDF never contains the IFC;
  the 3D PNG does while it is shown.

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
  onHint?: (hint: string | null) => void;    // hint line text of the active tool and step, or a drag's own hint
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
  onDropFurniture?: (catalogId: string, planPoint: Vec2, hit: DropHit) => void;   // wired in ui/Stage.tsx (2b)
}
export type CameraPreset = 'oversikt' | 'terrassen' | 'framsiden' | 'baksiden' | 'langsiden' | 'ovenfra' | 'naert-tilbygget' | 'inne-stua';
export function View3D(props: View3DProps): JSX.Element   // root <div data-testid="view-3d"> containing the <Canvas>

// src/state/selection.ts
export type Selection = { kind: 'wall'|'blockEdge'|'blockVertex'|'opening'|'room'|'block'|'deck'|'railing'|'hotTub'|'structure'|'furniture'|'tree'
                               |'deckVertex'|'deckEdge'|'steps'|'ghost'; id: Id; levelId?: Id };

// src/plan2d/editTypes.ts PlanEditActions (structural): beginDrag?, updateDrag?, previewDrag? (2b), endDrag?, cancelDrag?,
// addWall?, addOpening?, placeUnit?, insertDeckVertex?, snapPoint?; the furniture rotate handle uses rotateFurniture?.
// PlanFeedback = { markers, guides, chips, ghost: Vec2[][], target?: Vec2[][] } — target (fix round after 2b): the drag
// preview's moving outline, also the last rings of ghost; EditOverlay draws it once, solid (data-edit-moving).

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
`furniture-library`, `first-run`, `first-run-ok`; phase 2b: `furniture-library-sheet`, `library-close`, `furniture-search`,
`furniture-category-<id>`, `furniture-item-<catalogId>`, `furniture-drag-chip`, `furniture-rotate`, `furniture-duplicate`,
`furniture-delete`, `furniture-size`, `furniture-width`, `furniture-depth`, `furniture-colour`, `toggle-clearances`,
`proposals-menu`, `proposals-list`, `proposal-item-<id>`, `menu-new-proposal`, `menu-trash`, `delete-step-1`,
`delete-next`, `delete-step-2`, `delete-confirm`, `status-pill` (`data-state`), `more-menu`, `more-revisions`,
`more-trash`, `trash-panel`, `trash-item-<id>`, `trash-restore-<id>`, `revisions-panel`, `share-dialog`,
`share-local-link`, `conflict-banner`; fix round after 2b: `update-toast`, `update-now`, `overwritten-banner`
(`data-kind`), `overwritten-restore`, `family-link-invalid`, `carry-over-banner`, `carry-over-accept`,
`carry-over-decline`; plan attributes `data-furniture-id`, `data-furniture-colliding`,
`data-clearance-of`, `data-furniture-rotate`, `data-rotate-hit`, `data-edit-ghost` (+ `data-edit-moving`),
`data-room-label-hit` (+ `data-label-box`); the editor fields (`room-size-w` / `room-size-d`, `wall-thickness`,
`opening-corner`, …, a NumberField's `<input>` inside its test id), `ghost-restore`, `name-face-input`, `name-face`;
fourth fix round: `new-proposal-dialog`, `new-proposal-name`, `new-proposal-person`, `new-proposal-create`,
`name-banner`; phase 3: `export-menu`, `export-menu-pdf`, `export-menu-png`, `export-dialog`, `export-paper-A4|A3`,
`export-scale-50|100`, `export-storeys-ground|loft|both`, `export-labels`, `export-dims`, `export-furniture`,
`export-colour-new|bw`, `export-summary`, `export-make`, `export-status`, `export-share`, `export-download`,
`export-error`, `preset-walk`, `walk-start-3d`, `walk-exit`, `walk-joystick`, `toggle-shadows`, `toggle-plumbing`,
`plumbing-info`, `plumbing-far`, `plumbing-add-stack`, `ifc-panel`, `ifc-file-input`, `ifc-load`, `ifc-file`,
`ifc-show-plan`, `ifc-show-3d`, `ifc-replace`, `ifc-remove` (and the nudge buttons); plan attributes `data-layer="plumbing"`
(`data-drain-stack`, `data-drain-run`, `data-drain-far`, …) and `data-layer="ifc"` (`path[data-ifc=wall|window|door]`);
the 3D canvas's `data-ifc-meshes` (element groups the IFC overlay draws); and `window.__hytte = { ready: boolean;
project: Project; derived: DerivedVariant; selection: Selection | null; lastExport; walk }` kept current (`ready` after
the first 3D frame, or right away when only the plan is shown — the default; `lastExport` = `{ kind, bytes, pages,
fileName, width?, height? }` after a PDF / PNG export; `walk` = `{ session, x, y, feetZ, eyeZ, heading }` while «Gå
rundt» is on).

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
  junctions, ghosts, levelAt, the implicit remainder is new, the furnished seed's furniture stage).
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
  Romskjema's Areal header ends inside the side panel without sideways scrolling, that the plan shows ≥ 10 room labels
  with an m² line (≥ 15 before the seed was furnished), and that "Send forslaget" / Hjelp / the toolbar are on screen at
  375 px, and writes
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
  a number typed in the properties bottom sheet, a door tap-placed; at the starting zoom: taps on 9 rooms (the drawn
  name, else the floor beside the furniture) select the room (≥ 8, «Bod (ny)» always), a selected door dragged 1.5 m keeps its width, a fresh Vedskjul dragged by its body keeps
  its size, the Egenskaper sheet leaves the selected wall in view above it, all six tools fit the screen; second fix
  round: taps ±4 px beside w-gang-n, w-104-103, dv-pass-n and door-mellom-vf select them (`data-hit-band` ≥ 8), the
  Vedskjul dragged 2 m west moves 2 ± 0.25 m and 1 m north about 1 m, a first tap on a placed unit selects it and a
  second its room (whose mini-bar has "Velg bygningsdelen"), the delete toast does not cover the tool row or the hint
  line; `phone-edit.png`, `phone-sheet.png`, `phone-tools.png`, `phone-toast.png`.
- Phase 2b: the catalogue (`catalog.test.ts`), the furniture stage (`furnitureDerive.test.ts`: frames, levels, floors,
  collisions, door swings, the L sofa, identity reuse), the furnished seed (`seed/furniture.test.ts`: stable ids,
  every item in a room of its level or on the deck, no warnings, backs on inner faces), the furniture actions and
  walls carrying furniture (`editActions.furniture.test.ts`); symbols, the layer, placement, the drop hand-off, the
  library and the Møbel editor (`furnitureSymbols`, `FurnitureLayer`, `furniturePlacement`, `PlanView.furniture`,
  `FurnitureLibrary`, `furnitureLibraryModel`, `libraryDrag`, `furniturePlacer`, `FurnitureProps`); the 3D models
  (`furnitureBuilders.test.ts`, `Furniture.dom.test.tsx`); the family store on the local store and a fake Firestore
  (`familyStore.test.ts`: save, list, conflict guard, delete / restore, revisions, purge; `familyStore.sync.test.ts`: two
  devices, offline, conflicts, a remote change not counted as saving), the Firebase fallback (`appStore.fallback.test.ts`),
  the proposals UI (`proposalsUi.test.tsx`); editor polish (`snap.polish.test.ts`, `editActions.polish.test.ts`,
  `editActions.restore.test.ts` — about 50 s —, `editActions.preview.test.ts`, `editModel.polish.test.ts`,
  `usePlanEditing.test.tsx`, `OpeningLayer.test.tsx`, `LabelLayer.test.tsx`, `warnings.test.ts`); the furnished seed's taps
  (`touchTaps.test.tsx`: names on the phone, furniture under names with a mouse, rugs by their edge). Fix round after
  2b: `editActions.fix3.test.ts` (unit furniture, uneven returns, ghost ends, clipped junction ghosts, parallel walls,
  tombstones, the phone's placement reach), `usePlanEditing.test.tsx` (PlanView with the real bound actions: two
  outlines every frame, the moving one at the pointer), `PlanView.furniture` / `FurnitureLayer` (the handle's hit area,
  always turns, a free side, pinch with a finger on the handle, the uncovered centre), `furnitureDerive` (tucked chairs),
  `editActions.furniture` (Dupliser), `appStore.family.test.ts` (broken links, family switch, carry-over, phase-1
  autosaves), `familyStore` / `familyStore.sync` (field updates, pending after an offline reload, no writes mid-drag),
  `UpdateToast.test.tsx`, `familyBanners.test.tsx`; a captured phase-1 autosave in `state/fixtures/`. Final fix round
  after 2b: `editActions.fix4.test.ts` (carried walls only from their own step, with and without a reload; no house
  furniture pushed; units never take terrace furniture over; push clear of door swings; the clamped wall preview and
  its hint; room names across a JSON reload; the 180° shed), `SelectionMiniBar.test.tsx` (only with Velg),
  `EditOverlay.test.tsx` (`PlanHandle.r`), `editModel.polish` / `smallTargets` (touch end handles ≤ 0.3 m),
  `FurnitureLayer` / `PlanView.furniture` (the handle on a free side, never across a wall; library centre before the
  sheet, neighbouring rooms), `usePlanEditing.test.tsx` (a drag's hint on the hint line), `roof.test.ts` (no
  roof-no-meet for a unit), `familyStore` / `familyStore.sync` / `appStore.family` (merge saves, conflict revisions,
  hidden flush, persisted own versions, creation not undoable, the left-family banner, carried-in copies, trailing
  punctuation, the rev-2 frozen seed, named copies kept). Last fix round after 2b: `editActions.fix5.test.ts` (a unit
  over the house takes none of its walls, names or furniture when deleted, dragged, moved or turned; taps outside the
  sauna wall attach or are refused, never overlap; refusals and the ghost hint; drags, `moveBlock` and edge moves stop
  at the contact; Dupliser of a unit; an enlarged Bod pushes the Utebord out; `carriedBy` restores with and without a
  reload; revival only into changed faces; the lean-to roof), `furniturePlacer.test.ts` (the shed near the middle or
  not, the toast), `PlanView.reveal.test.tsx` (a new item revealed without insets; no unit reveal with the library),
  `PlanView.edit.test.tsx` (the Nytt bygg ghost's hint), `FurnitureLayer.test.tsx` (handle ranking, a sweep of every
  seed item: no handle on a wall or an item), `editActions.furniture.test.ts` (Dupliser through doors only),
  `appStore.family.test.ts` / `familyBanners.test.tsx` (any other space asks, `&p=` copies, the other tab stops, empty
  spaces, trailing `_` / `-`), `familyStore.sync.test.ts` («Lagre over» tells the other, the undo history cleared),
  `persistence.test.ts` (an untouched «Forslag D (kopi)» dropped).
- `npm run e2e` since 2b also runs `furniture.spec.ts` (desktop: a toilet placed in Hovedbad from the library with its
  clearance, dragged into the door swing → door-blocked naming it, turned, duplicated, deleted; the bed in Soverom (ny
  fløy) dragged off the wall and back → snapped back; main south +0.3 then glass east +0.5 then "Ta tilbake" on every
  ghost → the seed, furniture included; a click on win-106-s selects it, a second its ghost; screenshots
  `plan-furnished.png`, `3d-inne-furnished.png`), `phone-furniture.spec.ts` (iPhone: a chair from the library sheet,
  dragged 1 m; the proposals menu: create and rename; a Vedskjul tapped 0.4 m from the wing attaches and a 0.5 m nudge
  at the starting zoom moves it; «Bod (ny)» by its name; `phone-library.png`), `proposals.spec.ts` (local mode: create,
  reload, rename, delete with two confirmations, Papirkurv, restore, the pill, Send forslaget, an old `#d=` link, an old
  autosave; `proposals-menu.png`, `share-dialog.png`) and `offline.spec.ts` (project 'pwa': `npm run build` served by
  `vite preview --base /hytte-planlegger/`, assets and the service worker under that path, an offline reload with fonts
  from the cache). Every project runs the app in local mode; the e2e helpers skip the first-run and home-screen
  cards. The "Hent ny Forslag D" scenario is gone (Forslag D is always the bundled one). Fix round after 2b:
  `furniture.spec.ts` (E)–(H) (a wall drag's moving outline at the pointer every frame, also ahead of the model;
  Ctrl+D on an armchair; each «Ta tilbake» alone leaves no ghost over a live wall; a tucked dining chair; screenshot
  `plan-drag-preview.png`), `phone-furniture.spec.ts` "fix round after 2b" (taps with the bed selected never turn it,
  a pinch with a finger on the handle zooms and moves nothing, library tap → Slett → tap three times lands in rooms on
  screen, a shed mid-deck stays within 0.3 m, door end handles at the starting zoom; `phone-rotate-handle.png`),
  `proposals.spec.ts` "family links" (shared mode switched on, never the real Firestore: a broken `#f=` link; a hash
  switch offering the old space's proposals, on an in-browser fake Firestore the test routes into the dev server's
  familyStore.firestore.ts; `family-carry-over.png`) and `offline.spec.ts` (two tabs: Oppdater reloads only its own).
  Final fix round: `editing.spec.ts` (u)–(x) (w-vf-korr kept after «Ta tilbake» on w-103-korr; a shed by the sauna
  moves no house furniture; a shed dragged onto the terrace table pushes it out and its delete leaves it; lw-split's
  clamped drag on the hint line), `proposals.spec.ts` "conflicts and undo" (Angre after «+ Nytt forslag»; two tabs on
  the fake family space — it now relays writes between tabs through the `storage` event — B holds a drag while A
  saves, «Lagre over» keeps A's version under Tidligere versjoner) and the old-tab banner in "family links",
  `phone-editing.spec.ts` (the whole first-time flow from the first-run card to Send, the link opened on a second
  device; door handles; `phone-first-flow.png`), `phone-furniture.spec.ts` (the dining chair's handle on its back turns
  it; Kommode in the zoomed-in bedroom). Last fix round: `editing.spec.ts` (y)–(aa) (the Nytt bygg ghost over the house
  says so and a click there is refused; an Anneks dragged into the wing stops against its wall with the hint; a Bod's
  north edge dragged over the Utebord pushes it out, and the Bod moved and deleted leaves it; w-106-korr north carries
  lw-106-top, which the user moves on, and «Ta tilbake» on lw-106-top leaves w-106-korr), `furniture.spec.ts` (I)
  (Dupliser into the Vindfang with the toast, the sauna bench refused), `phone-editing.spec.ts` (Vedskjul taps 0.2 m
  outside the sauna wall attach against it, a tap on the sauna is refused; the first-time flow with the shed still
  selected, no Escape), `proposals.spec.ts` "family links" (a pasted link asks first; a never-used space with another
  device's proposal highlights «Bytt dit», and the tab left open stops saving and reloads in the new space; a `&p=`
  link copies once and never switches; `family-other-space.png`); `family-firestore.spec.ts` H and J on the real
  Firestore.
  Opt-in against the REAL Firestore (`E2E_FIRESTORE=1`, throwaway `e2e-` families deleted afterwards over the REST API,
  `e2e/firestoreAdmin.ts`): `family-firestore.spec.ts` (an offline delete never wipes another device's newer edit; a
  phase-1 autosave; an old tab at a space the device left; «Lagre over» within 5 minutes keeps the other version as a
  revision; an edit followed by `visibilitychange` → hidden is written within 0.7 s and survives the context closing), `phone-family-firestore.spec.ts` (no Google scripts or auth iframe on the iPhone) and
  `family-offline.spec.ts` ('pwa': an offline reload keeps «Lagret her – sendes når du er på nett»). Without the
  variable they are skipped.
- Fourth fix round and phase 3: `editActions.fix6.test.ts` (units against the house: Dybde / Bredde, edge and corner
  drags, «Ta tilbake» on a house edge with a unit against it; corner restores D1 / D3 / D5, E2 / E3 with and without a
  reload; merged-room records after a reload; legacy proposals without `carriedBy`; the wing's w-wing-w; the Loungesofa
  push-out), `appStore.family.test.ts` / `familyStore.sync.test.ts` / `familyBanners.test.tsx` (the proposal-link
  banner's «Bytt dit», the carry-over text, the stopped tab read-only, the old proposal link, the pill «Ikke startet»,
  the name banner and the two-field dialog), `furniturePlacer.test.ts` (middle inside the unit, the storey-wide
  fallback), `FurnitureLayer.test.tsx` (no up-facing handle on touch), `SelectionMiniBar.test.tsx` (two fingers pass
  through), `export/*.test.ts(x)` (paper, sheets, svgPrint, the real jsPDF + svg2pdf page sizes and the west wall at
  1:50 / 1:100, title block, PNG caption, the dialog), `walk.test.ts` / `Walk.dom.test.tsx` / `WalkOverlay.dom.test.tsx`
  / `sunPanel.test.ts` / `controlsWalkSun.test.tsx`, `plumbing.test.ts` / `PlumbingLayer.test.tsx`, `src/ifc/*.test.ts`
  (parse with the real web-ifc on a synthetic file, transform, cache, store, views). E2E: `phase3.spec.ts` (PDF A3 1:50
  both storeys: pages and A3 MediaBox read from the file; PNG download; walk W 500 ms at eye height, Esc; «Avløp og
  sluk» with the «fint» line, the WC toilet in Soverom 1 flagged in Advarsler; the synthetic IFC through the file
  chooser in plan and 3D, the screenshot always from the synthetic file), `phone-phase3.spec.ts` (the joystick walks,
  a drag looks, «Avslutt»; «Eksporter» reachable), `editing.spec.ts` (ab) (Vedskjul at (12,8, −0,9), Dybde 2,0: the
  house unchanged) and (ac) (corner restore D1), `proposals.spec.ts` (the proposal link's «Bytt dit», the two-field
  dialog), `phone-editing.spec.ts` (the shed against the wing, the bedroom pinched to the middle),
  `phone-furniture.spec.ts` (two fingers through the mini-bar; the up-facing handle hidden). Screenshots:
  export-dialog.png, 3d-walk.png, plan-avlop.png, ifc-overlay.png, phone-walk.png.
- Final morning round: `editActions.fix7.test.ts` (no geometric fallback without `carriedBy`, with and without a
  reload; the refused house-edge restore byte-identical with 0 undo steps; merged-room records past a sliver face;
  the unit named when it blocks a house edge or corner; Bredde / Dybde narrowing a unit's own opening),
  `editActions.fix6.test.ts` (the corner sweep now also fails on any wall the restore turns), `appStore.family.test.ts`
  (a new device on an unreachable connection: «Kobler til …», nothing stored, then the family and the `&p=` proposal;
  `waitingOffline`; the carried copy «(Pappa)» / «(kopi)»), `familyBanners.test.tsx` (the name card fixed in the toast
  area with `theme.css` loaded, no banner row; it steps aside for a toast or a selection; a finger move re-arms the
  wait, a hovering mouse does not; banner buttons wrap), `walk.test.ts` (from (20, −9) north, y stays below −4,6; from
  the east x above 23; a 0,25 m flood fill from the Stue start reaches all 27 rooms and never stands under a deck or
  inside a plinth; a plinth on a slope), `sunPanel.test.ts` (23 May and 21 July), `planPdf.test.ts` (emoji, arrows, ≈
  and Ł in the title block, schedule and metadata; the 3 mm inset), `exportDialog.test.tsx`, `loader.offline.test.ts`,
  `warmLazy.test.ts`, `pngCaption.test.ts`, `Walk.dom.test.tsx`, `WalkControlsPhoto.dom.test.tsx`,
  `PlumbingLayer.test.tsx` (touch: drag pans, tap picks, the picked one drags). E2E: `editing.spec.ts` (ad)
  (dv-leseskrok south, w-106-stue west, «Ta tilbake»: w-106-stue straight, its end on the divider) and (ae) (the
  house's south edge north, a shed against it and one in the way: the refused restore changes nothing, Angre takes the
  last shed); `phase3.spec.ts` (from (20, −9) north the skirt stops the walker on the terrain; P saves a PNG and the
  walk goes on; a PDF of «Pappas idé 👍 ≈ ny» prints «Pappas idé ? ~ ny», read from the file's inflated text);
  `phone-phase3.spec.ts` (the camera button under «Avslutt»; a drag on the unpicked drain stack pans and saves
  nothing, a tap picks it and the hint line explains it, a drag of the picked one saves it; the joystick checked once
  the scroll has settled); `proposals.spec.ts` (the name card leaves the toolbar where it was; the proposal-link banner
  and its buttons inside an iPhone 13's 390 px; «Mammas idé (Pappa)»); `family-firestore.spec.ts` (opt-in: a new device
  with firestore.googleapis.com aborted for 15 s is never told the space is empty, then shows the link's proposal with
  «Lagret for alle»).
- Fix round 3 after phase 3: `editActions.fix8.test.ts` (two Vedskjul snapped side by side: Bredde 3 / 3,8 / 5 leave
  the neighbour byte-identical with no merge and no `opening-outside-host`; an edge pushed into it is refused naming
  it, also in the drag hint; a third unit makes Bredde refuse on both sides, also after a reload; Bredde 1,5 then 2
  gives the open front back [1, 1,8] centred; 1,75 / 1,8 / 1,81 give smooth widths; a user width stays; the refused
  restore names the unit in both cases), `controlsPresets.test.tsx` and `Walk.dom.test.tsx` (no preset pressed after
  Esc; a tap on the current preset runs it again; the walk's field of view kept until the view is left),
  `PlumbingLayer.test.tsx` (10 px at the starting zoom, the 0,25 m cap at 60 px/m), `appStore.family.test.ts` (the
  linked space unreachable: no info; an old non-empty cache: `fromCache`; a server-confirmed empty space; the name card
  hidden by a selection and back only after 3 s), `familyBanners.test.tsx` («Henter plassen i lenken …» with nothing
  highlighted; the card follows a toolbar that moves), `app.test.tsx` / `proposalsUi.test.tsx` (the share dialog
  appears once its lazy chunk is in). E2E: `walk-preset.spec.ts` (walk, W, Esc: nothing pressed; «Oversikt» brings back
  the overview's position, target and field of view), `lazy-offline.spec.ts` (pwa project: online load, the warm-up
  key and the cached files, offline reload, a PDF and the synthetic IFC), `proposals.spec.ts` (iPhone 13: the name card
  shown, then a proposal-link hash whose space answers 1 s late, `window.__e2eWatchDelayMs`: the card stays clear of the
  toolbar and the hint line and a tap reaches Vegg), `editing.spec.ts` (ae) now expects «Vedskjul 2» in the refusal,
  `phone-phase3.spec.ts` reads both button boxes in one frame after the scroll has stopped, `family-firestore.spec.ts`
  (opt-in: a device with a space opens a link to another space with Firestore blocked for 15 s: never «ingen
  forslag», then the real counts).
- `npm run build` must pass with zero TypeScript errors; `npm run lint` (oxlint) clean.

## Rules for contributors (humans and agents)

- Do not change files you do not own in a parallel task; propose instead. Do not add dependencies without noting it.
- No geometry in renderers; no React in `geometry/`. Keep functions small and tested.
- Never silently change Robin's design: if the spec is contradictory, keep the spec and add a `ModelWarning` or a note.
- Norwegian in UI, comma decimals, `m²`. English in code.
- Keep `STATUS.md` current: done / next / known issues.

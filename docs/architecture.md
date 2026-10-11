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
               Openings.tsx, Outdoor.tsx, Terrain.tsx (+ ground.ts), Trees.tsx, Labels.tsx (+ labelDefs.ts), StructureMeshes.tsx,
               cameras.ts, SunLight.tsx
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
  [5,9]×[6.2,12.1] with parts [6.2,10.1] existing and [10.1,12.1] new. Parts and floor zones are clipped to the
  block polygon at derive time; the uncovered remainder is an implicit part/zone (no tiling invariant, so dragging a
  block edge just works). Overlapping parts → `parts-overlap`.
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
  `status` 'removed' keeps demolished openings for the plan ("rives", dashed) and generates infill `patches`
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
3. `deriveWalls(variant, blocks, roofs)` (`walls.ts`) → exterior pieces (split at part + zone boundaries, junction
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
   `deriveOutdoor` (`outdoor.ts`): decks (skirt bottoms from terrain), railings (panels between gaps, posts at
   corners/gap ends/≤ 1.5 m), steps in gaps with `steps: true` (risers = ceil(drop / 0.18), going 0.3, drop from the
   deck top to the terrain 0.5 m outside the gap), hot tubs (z from the deck under the centre, else terrain).
7. `deriveStructure`: posts/beams/chimney with absolute z (`roofExitZ` from the roof envelope + thickness), stairs
   as treads (n = ceil(dz / 0.18), going = length / n, arrow from bottom to top).
8. `computeAreas` (`areas.ts`), foundations (outer outline, topZ = lowestFloorZ, bottomZ = groundZ − 0.3), site
   trees with terrain baseZ, dimensions (one axis chain per cardinal side: the outermost block edges seen from that
   side, broken at block and part vertices, pieces set back more than 6.5 m left out, chain 1.0 m and a total
   1.8 m outside the outermost edge, running counter-clockwise so the offsets are negative), bounds (outer outlines
   + decks), wall unions per storey and status, warnings (blocks, roofs, walls/openings, rooms, `area-limit`).

`deriveVariant` is memoised on (variant, site, terrain) object identities (nested WeakMaps).

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
`${blockId}/${zoneId ?? 'base'}/slab`; steps: `${railingId}/steps/${gapIndex}`.

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
  `decks` = deck area (minus buildings) where deck top − terrain > 0.5 m (grid-sampled at 0.25 m);
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
- **Aksemål**: the spec's convention (170.2 m²), for comparison only.
- **Rom (netto)**: inner-face polygon area per room, split existing/new.
- No area limiter in phase 1 (Robin's decision); `areaLimit` stays null and the `area-limit` warning is dormant.

## 2D plan (SVG, `plan2d/`)

Metres → pixels through the flipped root group and one `viewBox`; pan/zoom with pointer events (drag, wheel,
pinch; `touch-action: none`). Layers (bottom→top): grid (1 m, 5 m darker), terrain shade (optional), decks,
floors (tinted by material only; new floors get the orange mix only with "Marker det som er nytt"; flat-ceiling
floors are not drawn), wall union outlines (existing: fill #2b2b2b; new: fill #c8742a tint, outline #8a4d1c;
removed: dashed grey), dividers (dashed hairline), openings (windows: triple line; doors: leaf + swing arc from
`DerivedOpening.swing`, both leaves when `swing2` is present; frameless openings: gap), structure (posts, chimney
hatched, stairs with arrow and tread lines; a stair is also drawn on the storey it arrives at, with the treads above
the lower storey's 1.2 m cut solid, the rest dashed, a slanted cut line and the arrow; the "opp" text sits on the
walking line inside the symbol and is left out when the stair is too small on screen), railings/steps, room labels
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
faint outlines.

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
(emissive) using separate material sets. Floors of kind `ceiling` render as a thin pine slab (at least 2 cm, so
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
(8.03, 1.31), so the camera stands west of it). Choosing 'inne-stua' raises a cut height below 2.3 to 2.3
(`presetUi`, `EYE_LEVEL_CUT`), so the walls rise above the eye, and remembers the previous one in
`ui.cutHeightBeforePreset`; choosing another preset restores it unless the user moved the slider in between (any
`setUi` with `cutHeight` clears the memory). OrbitControls damped, maxPolarAngle 0.495·π,
minDistance 3, animated transitions (~900 ms, skipped with reduced motion).
Sun: directional light from `sunInPlan` for the chosen date/time (default 21 June 15:00 local).

## State (`state/store.ts`)

```ts
interface AppState {
  project: Project;                       // tracked by zundo (partialize: project only, limit 200), autosaved
  ui: { activeView: 'plan'|'3d'|'split'; planStorey: 'ground'|'loft'; activeStoreyId: Id; mode3d: 'ute'|'inne';
        cutHeight: number; cutHeightBeforePreset: number | null; showLabels: boolean; showDims: boolean;
        showGrid: boolean; showRoofPlan: boolean;
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
selection after undo. While `ui.readOnly` every project action is a no-op and autosave is off. Defaults:
`activeView` 'split' (Begge) from 1600 px window width (`SPLIT_MIN_WIDTH`), else 'plan'; `cutHeight` 1.3 (below
the 'inne-stua' eye height); `preset` 'oversikt'. `commitTransaction` / `cancelTransaction` reset the
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
`PREFS_VERSION` (older prefs keep everything but the view and the cut height; the view is only remembered once the
user clicked a view tab; `cutHeightBeforePreset` is kept only together with the preset 'inne-stua', otherwise it is
loaded as the cut height, so the raised value never outlives the preset); named versions
`hytte-planlegger:versions` = `{ id, name, savedAt, projectId, schemaVersion, project }[]`, listed for the current
projectId newest first, capped at 30 with size shown; export / import JSON file (a share-link delta is also accepted
as a file). Share link `#d=` + lz-string `compressToEncodedURIComponent(JSON of payload)`: a DELTA against the
bundled Forslag D (per variant the changed top-level fields and, per collection, added / changed entities in full,
removed ids and the order) when the project is at the bundled `SEED_REVISION` and the delta is smaller, else the full
`{ v, project }`; timestamps are never sent. Only the active variant by default ("del alle varianter" toggle), size
shown, warning above 8 kB with "send som JSON-fil" fallback; never includes terrain. Unchanged Forslag D is about
210 characters, one renamed room under 1.5 kB. A delta made against an older seed revision is applied to the current
seed (banner `link-rebased`); one from a newer revision is treated as too new; old full-format links still open.
**Any change to Forslag D's content must bump `SEED_REVISION`**, otherwise old links decode against the changed seed.
All storage access in try/catch. Other tabs: a saved document is identified by `id@updatedAt`; autosave remembers
what this tab last wrote and treats only a different stored document as another tab's. This tab then stops saving
until the user picks "Hent endringene" or "Behold mine endringer" (closing the tab without choosing loses its
unsaved edits). Seed updates: `Project.seedRevision` vs the bundled
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
presets, toggles, sun date/time) · centre (plan and/or 3D) · right column, `clamp(360px, 24vw, 440px)` wide
(340 px between 1100 and 1279 px): Romskjema, Egenskaper for the selection (opened and scrolled into view when a
schedule row is clicked), Arealer with explanations, Advarsler. Romskjema columns: Rom · Bygningsdel · Status ·
Mål (m) · Areal, fixed table layout, rows grouped per level with level sums; a room that is part existing, part new
shows both tags and both shares. Headline always visible: "BYA 245,5 m² · bygg 178,3 (eks. 102,2 · nytt 76,1) ·
terrasse 67,1 — BRA 170,1 m² (per level)", with BYA / BRA / eks. expanded in tooltips; the Arealer panel shows
Bygninger with its own eks./nytt split and the deck on its own line (the building-only split is worked out in
`ui/areaFigures.ts` from whether the decks are new; none is shown for mixed decks). Buttons, toggles, tabs and presets have tooltips.
Phone (< 800 px): stacked, 3D first, panels collapsible, heights in `100dvh`, canvas and SVG with
`touch-action: none`; below 600 px Del lenke and Hjelp are icon buttons in the title row and Lagre versjon /
Versjoner / Eksporter / Importer sit in a "Mer" menu. Read-only (shared link): banner with "Lag min egen kopi";
edit panels/tools hidden, view controls, schedule and areas kept. Theme tokens from the old model (self-hosted Barlow / Barlow Semi Condensed,
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
export type CameraPreset = 'oversikt' | 'terrassen' | 'framsiden' | 'baksiden' | 'langsiden' | 'ovenfra' | 'naert-tilbygget' | 'inne-stua';
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
export function deriveOutdoor(variant: Variant, site: Site, terrain: TerrainAsset | null, opts?: { terrainZ?: TerrainZFn }): DerivedVariant['outdoor'];
export function deriveStructure(variant: Variant, roofs: DerivedRoof[], opts?: { undersideAt?: UndersideFn }): DerivedStructure[];

// geometry/areas.ts  (callbacks instead of roofs / site / terrain, so areas.ts does not depend on roof.ts / terrain.ts)
export function computeAreas(input: { variant: Variant; blocks: DerivedBlock[]; rooms: DerivedRoom[]; decks: DerivedDeck[];
  undersideAt: (x: number, y: number) => number | null;   // combinedUndersideAt(roofs, x, y)
  terrainZ: (x: number, y: number) => number;             // terrainZAt(terrain, site, x, y, groundWorks)
  roofs?: DerivedRoof[] }): AreaSummary;                  // given → exact measurable BRA (derive passes them)
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
export const GEOMETRY_FALLBACK: string;                                    // 'geometry fallback' (start of fallback warnings)
```

## Testing

- `npm test` → Vitest (`src/**/*.test.ts`): geometry, room detection (incl. the seed through the real pipeline,
  `src/model/seed/forslagD.derive.test.ts`: all 27 rooms detected and named, no warnings at all, axis total
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
  wing's tag over its visible north end), the cut height restored after 'inne-stua', no "save failed" without
  storage.
- `npm run e2e` → Playwright (Chromium) loads the app, waits for `window.__hytte.ready`, checks that no 'generic'
  warning exists, that the Romskjema's Areal header ends inside the side panel without sideways scrolling, that the
  plan shows ≥ 15 room labels with an m² line, and that Del lenke / Hjelp are on screen at 375 px, and writes
  screenshots into `e2e/screenshots/`: `plan.png`, `3d-ute-oversikt.png`, `3d-ute-framsiden.png`,
  `3d-ute-langsiden.png`, `3d-ute-inne-stua.png` (Ute + the 'inne-stua' camera: the roof from inside),
  `3d-inne-stua.png`, `plan-hems.png`, `phone.png`.
- `npm run build` must pass with zero TypeScript errors; `npm run lint` (oxlint) clean.

## Rules for contributors (humans and agents)

- Do not change files you do not own in a parallel task; propose instead. Do not add dependencies without noting it.
- No geometry in renderers; no React in `geometry/`. Keep functions small and tested.
- Never silently change Robin's design: if the spec is contradictory, keep the spec and add a `ModelWarning` or a note.
- Norwegian in UI, comma decimals, `m²`. English in code.
- Keep `STATUS.md` current: done / next / known issues.

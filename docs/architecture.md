# Architecture

Web-based 2D/3D planner for extending the cabin at Merkesvatnet (Hadsel, Vesterålen). Robin and his family
use it to develop "Forslag D". UI language is Norwegian bokmål; code, comments and docs are English.

Stack: Vite 8, React 19, TypeScript 6 (strict), three.js via @react-three/fiber 9 + drei 10, zustand 5 + zundo
(undo/redo) + immer, polygon-clipping (boolean ops), lz-string (share links), suncalc, Vitest, Playwright.

## Core principle: everything is data

One plain JSON document (`Project`, see `src/model/types.ts`) holds the whole design: site, variants, blocks,
walls, openings, rooms, furniture, outdoor, structure. Everything on screen is generated from it by
`deriveVariant()` (`src/geometry/derive.ts`) into a `DerivedVariant` (`src/model/derived.ts`). Renderers
(2D plan, 3D view, schedule) only read the derived model. Edits only change the JSON (through store actions),
undo/redo is a history of the JSON, saving/sharing is storing the JSON.

## Folder layout and ownership

```
src/
  model/       types.ts (schema), derived.ts (render contract), migrate.ts (schema versions),
               seed/forslagD.ts (Forslag D built from calibrated numbers), seed/terrain.json (heightmap)
  geometry/    pure functions, fully unit-tested, no React/three imports:
               polygon.ts planarGraph.ts rooms.ts roof.ts walls.ts areas.ts derive.ts geo.ts
  state/       store.ts (zustand + zundo + immer), persistence.ts (autosave, named versions, share link)
  plan2d/      SVG plan: PlanView.tsx and parts
  view3d/      R3F scene: Scene.tsx, materials.ts, Walls.tsx, Roofs.tsx, Floors.tsx, Openings.tsx,
               Outdoor.tsx, Terrain.tsx, Trees.tsx, Labels.tsx, cameras.ts, StructureMeshes.tsx
  ui/          App shell, panels, theme.css, components
  i18n/        nb.ts — every user-visible string lives here
  furniture/   catalogue + components (phase 3)
e2e/           Playwright smoke test and screenshots (e2e/screenshots/*.png, committed)
docs/          this file, kalibrering-ifc.md (what the IFC says about the existing cabin)
data/geo/      raw Kartverket elevation grids and the IFC element dump (inputs for scripts)
scripts/       build-terrain.mjs (data/geo → src/model/seed/terrain.json)
```

## Coordinate systems

- **Plan frame** (all stored geometry): x, y in metres. Origin = SW corner of the existing main building on the
  axis line. Plan +x runs along the main house towards the living room / new wing (compass bearing 196°),
  plan +y runs towards the bod wing (bearing 106°). The glass bump (low y) faces the lake (WNW).
  `Site.planNorthBearing = 106` is the bearing of plan +y. True north in the plan frame is the direction
  rotated `planNorthBearing` degrees clockwise from +y, i.e. the unit vector `(sin(-106°), cos(-106°)) = (-0.961, -0.276)`.
- **Heights** z: metres relative to the main floor (level `main`, 0). Level `lower` = -1.0 (existing bedrooms),
  `loft` = +1.47. The site's `floorElevation` (161.0 m a.s.l.) converts to sea level.
- **three.js world**: `X = x, Y = z, Z = -y` (same as the old model). Helper `toWorld(x, y, z)` in `view3d/coords.ts`.
- **Geographic**: `geometry/geo.ts` converts plan ↔ lat/lon and gives the sun direction in the plan frame.

## Data model conventions (see types.ts for the fields)

- Polygons are CCW. Block polygons sit on the **axis line** (outside of the timber frame = the architect's grid).
  Exterior walls are **derived** from block edges: `outerOffset` (0.11 m cladding+battens) lies outside the axis
  line, `thickness - outerOffset` (0.16 m) inside. Existing cabin: thickness 0.27. New blocks: the same build-up
  by default (`VariantSettings.defaultExteriorWall`) so the room sizes match the spec; Robin can change it.
- Where two block polygons share an edge segment, a **junction policy** decides: `'open'` removes the wall there
  (glass bump ↔ living room, new wing ↔ living room extension), `'wall'` (default) keeps the first block's exterior wall
  (main house north wall ↔ bod wing, with the door into the vindfang). Stored interior walls may lie on a shared
  edge (the new wing's west wall at x=16 with its 1.2 m opening is a stored interior wall).
- **Parts** split one block into existing/new areas without splitting its roof: the main house is one block
  [0,16]×[0,6.2] with parts "eksisterende" [0,12] and "stueforlengelse" [12,16]; the bod wing is one block
  [5,9]×[6.2,12.1] with parts [6.2,10.1] existing and [10.1,12.1] new. Exterior wall pieces take `isNew` from the
  part they run along; the old gable wall at y=10.1 is a stored wall of kind `exterior-old`.
- **Floor zones**: the main block's west part (x < ~4.3–5.1, the bedroom part) is a floor zone on level `lower`.
  Rooms get their level from the zone/level under their anchor. Walls carry an explicit `levelId`.
- **Levels**: `lower` (-1.0, ceilingHeight 2.3 = underside of the loft floor), `main` (0, open to the roof),
  `loft` (1.47, open to the roof). Walls on `lower` run from -1.0 to 1.3; walls on `main`/`loft` are cut by the roof.
- **Openings** are hosted on a block edge or a stored wall, positioned by `offset` (m from the host start to the
  opening centre). Sill is measured from the floor of `levelId` (default: the host's level). Doors have a swing.
- **Rooms** are records with an anchor point; geometry comes from room detection (faces of the wall graph).

## Derivation pipeline (`geometry/derive.ts`)

1. `deriveBlocks(variant)` → for each block: axis polygon, outer (offset +outerOffset), inner (offset −(thickness−outerOffset)), parts, eaveZ/ridgeZ.
2. `buildRoofs(variant, blocks)` (`roof.ts`) → `DerivedRoof[]` with automatic ridge extension (below).
3. `deriveWalls(variant, blocks, roofs)` (`walls.ts`) → exterior wall pieces from block edges (minus 'open' junctions,
   split at part boundaries) + stored walls; each with footprint, `topProfile` (roof-clipped or ceiling), and its openings
   (with swing geometry) attached. Also validates openings (fit inside host, no overlap).
4. `detectRooms(walls, level)` (`planarGraph.ts` + `rooms.ts`) → faces of the planar graph of wall reference lines per
   level; inner polygons by offsetting each face edge by the wall's inner half-thickness; attach `Room` records by anchor.
5. `computeAreas(...)` (`areas.ts`) → BYA / BRA / axis-line footprint / per-room areas, existing vs new.
6. Floors per room (material from room type: bad/wc → tile, badstue → sauna, bod/teknisk → concrete, else wood).

`deriveVariant` is pure and memoised per `Variant` object identity (use a WeakMap); the store calls it via a selector.

### Roof rules

- Gable roof: ridge centred across the block's bbox perpendicular to `ridgeAxis`. Underside at the outer wall face
  = `eaveHeight` above the block's level floor; underside at the ridge = `ridgeHeight` (or from `pitchDeg` when
  `drive === 'pitch'`; keep both fields consistent when either changes). Top surface = underside + `thickness` (vertical).
  Eave overhang 0.51 m, gable overhang 0.35 m beyond the axis line.
- **Automatic ridge extension**: if a block's ridge-axis end sits against another block (its end edge coincides with /
  lies on the other block's polygon and the junction is not a free gable), extend the roof along the ridge axis until
  the ridge underside meets the other roof's underside surface. Examples (all heights above main floor, 28° pitch):
  glass bump (ridge z 3.28) runs north into the main roof (ridge 3.87) → meets at y = 3.1 − (3.87−3.28)/tan28° = 1.99;
  bod wing likewise to y = 4.21; the main house roof (ridge 3.87) runs east until it meets the new wing's ridge at x = 18.4
  (equal ridge heights → extends to the other ridge line). `Roof.extend` overrides per end.
- Valleys are not computed: overlapping slabs render correctly from the outside; barge boards are only drawn on free gable
  ends, fascias only on eave segments outside other blocks.
- Mono-pitch: high side opposite `slopeTo`, `ridgeHeight` = underside at the high wall. Flat: thickness only.
- `roofUndersideAt(roof, x, y): number | null` returns the underside height at a plan point (null outside the roof outline).

### Wall top profiles

For each wall piece sample the underside of all roofs covering its reference line (both ends + any ridge crossing
+ a few samples), take the minimum roof underside, or the level ceiling if the level has one, or `height` when fixed.
Interior mode (3D) clips the top at the user's cut height; that is done in the renderer, not in the derived model.

### Room detection

Build a planar graph from the wall reference lines of a level (exterior pieces + stored walls + 'open' junction
lines are NOT walls, so faces merge across them). Split segments at intersections, merge nodes within 1 cm, drop
dangling edges, extract faces by walking half-edges (smallest left turn), discard the outer face and faces with
area < 0.3 m². Faces whose polygon contains a Room anchor get that Room; others become "unnamed" with a warning.
Inner polygon: offset each face edge inward by the inner half-thickness of the wall lying on it (exterior: thickness −
outerOffset; interior: thickness/2), intersect consecutive offset lines.

### Areas (shown with an on-screen explanation)

- **BYA** (bebygd areal, NS 3940): area of the union of block outer outlines (outside of cladding). Split existing/new by parts.
  Decks are not counted (they are < 0.5 m above terrain in most places; a later phase can add the rule).
- **BRA** (bruksareal): per level, area inside the exterior inner faces (interior walls included). Loft counts (Hems01/02).
- **Aksemål** (axis footprint): the spec's convention (170.2 m²), for comparison only.
- **Rom (netto)**: inner-face polygon area per room.

## 2D plan (SVG, `plan2d/`)

Metres → pixels through a single `viewBox`; pan with drag / wheel-zoom / pinch. Layers (bottom→top): grid (1 m, 5 m
darker), terrain shade (optional), decks, floors (material tint), walls (existing: fill #2b2b2b outline; new: fill
#c8742a-tinted, outline #8a4d1c), openings (windows: triple line; doors: leaf + swing arc; frameless openings: gap),
structure (posts, chimney hatched, stairs with arrow), room labels (name, `b × d` with comma decimals, `m²`),
dimension lines (outer axis dimensions per block, room inner dims on hover/selection), north arrow, scale bar.
Numbers use Norwegian formatting: `2,2 × 4,2 m`, `13,4 m²` (helper `formatM`, `formatM2` in `ui/format.ts`).

## 3D view (R3F, `view3d/`)

Groups: `exterior` (walls + roofs + openings), `interior` (floors, interior walls, furniture, structure), `base`
(terrain, decks, railings, hot tub, trees, water). Modes: `ute` (all), `inne` (roofs hidden, walls clipped at cut
height 1.2–2.6 m, default 2.2). Materials ported from the old model (`materials.ts`: canvas textures for dark
vertical boards, turf, deck boards, pine floor, tiles, logs; sage-green trim #6f8170; white/green frames; glass
#27313a opaque outside, pane 0x9cc3dd 45 % inside). "Marker det som er nytt" tints new parts orange (emissive).
Labels via drei `<Html>` (name + dims + area), toggleable. Camera presets: oversikt, fra terrassen, framsiden,
baksiden, ovenfra, nært tilbygget, inne i stua (OrbitControls, damped). Sun: directional light from `geo.ts` for the
chosen date/time (default 21 June 15:00 local); shadows on.

## State (`state/store.ts`)

```ts
interface AppState {
  project: Project;                       // tracked by zundo (undo/redo), autosaved
  ui: { activeView: 'plan'|'3d'|'split'; mode3d: 'ute'|'inne'; cutHeight: number; showLabels: boolean;
        highlightNew: boolean; showTrees: boolean; showTerrain: boolean; selection: Selection | null;
        tool: 'select'|'measure'|... ; sun: { date: string; minutes: number } };
  // actions (all project edits go through actions; each action is one undo step)
  setProject, updateVariant(id, recipe), duplicateVariant(id, newName), setActiveVariant(id), renameRoom(...),
  // ui
  setUi(partial)
}
```
`persistence.ts`: debounced autosave of `project` to localStorage (`hytte-planlegger:project`), named versions
(`hytte-planlegger:versions` = [{id, name, savedAt, project}]) sorted newest first, export/import JSON, share link
`#d=<lz-string compressToEncodedURIComponent(JSON of {v: schemaVersion, project})>` read on load (read-only banner with
"Lag min egen kopi"). `migrate.ts`: `migrateProject(json): Project` applies `migrations[v]` in order; every persisted
document carries `schemaVersion`; add a migration whenever types change so old saves and links keep working.

## UI (`ui/`)

Layout: top bar (title, variant selector + duplicate, undo/redo, Lagre/Del/Eksporter, Hjelp) · left column (view
tabs Plan/3D/Begge, 3D mode + presets, toggles, sun) · centre (plan and/or 3D) · right column (Romskjema table,
Arealer with explanations, Egenskaper for selection). Phone: stacked, 3D first, panels collapsible. Theme tokens
from the old model (Barlow / Barlow Semi Condensed, --accent #4f6b55, --new #c8742a, light/dark). All strings in
`i18n/nb.ts`.

## Testing

- `npm test` → Vitest (`src/**/*.test.ts`), geometry/areas/room detection/roof/migrations/seed invariants.
- `npm run e2e` → Playwright (Chromium) loads the app, waits for the model, screenshots plan, 3D exterior (oversikt),
  3D interior (inne i stua) into `e2e/screenshots/`. Run `npx playwright install chromium` once.
- `npm run build` must pass with zero TypeScript errors; `npm run lint` (oxlint) clean.

## Rules for contributors (humans and agents)

- Do not change files you do not own in a parallel task; propose instead. Do not add dependencies without noting it.
- No geometry in renderers; no React in `geometry/`. Keep functions small and tested.
- Never silently change Robin's design: if the spec is contradictory, keep the spec and add a `ModelWarning` or a note.
- Norwegian in UI, comma decimals, `m²`. English in code.
- Keep `STATUS.md` current: done / next / known issues.

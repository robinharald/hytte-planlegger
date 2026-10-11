# Phase 2 plan: editing, units on the terrace, furniture, saving and offline

Robin's brief for phase 2 (2026-10-11, after reviewing phase 1):

> "now move on to phase two where I can start customizing rooms, furniture placements, room types, sizes of rooms,
> where doors, windows, etc. are. But I can never remove the original house. That should be locked. But adding,
> removing or similar. Just creating for instance the wood shed as a separate unit on the terrace (needs to snap,
> and instantly the layout of the terrace should fit to this new unit, and can also be changed). And again a saving
> feature for if my mother wants to work on our own suggestion then pick it up later. It also needs to work if this
> PC is offline. Keep the design user friendly and easy to understand and use."

Everything below extends docs/architecture.md (which stays authoritative for coordinates, derivation and the
existing contracts). Phase 2 = the original brief's phase 2 (plan editor) + phase 3 (furniture) + offline/PWA.

## 1. Guiding rules

1. **The original house is locked.** Anything with status `existing` (or a block/part with `isNew: false`) cannot be
   moved, resized or deleted. What IS allowed on existing elements: renaming/typing rooms, hosting NEW openings in
   existing walls (a new door in the old north wall), and marking an existing interior wall or opening as
   "rives" (status → `removed`, reversible, with a confirmation). Block polygons of existing blocks never change;
   on mixed blocks (main house, bod wing) only the vertices that belong solely to new parts move (see §3.4).
2. **Edits are data.** Every interaction ends in one store action (one undo step; drags are transactions). The
   derived model is recomputed live while dragging (deriveVariant is ~30–70 ms on the seed; throttle to one derive
   per animation frame and skip frames when behind).
3. **Simple first.** One toolbar with a handful of tools, a properties panel with plain numbers, snapping that
   just works, no modes the family has to learn. Advanced settings live behind "Mer". Mobile: viewing, selecting
   and editing numbers in the properties panel work; dragging is a desktop/tablet-with-mouse thing (touch drag of
   furniture is nice-to-have).
4. **Nothing is lost.** Autosave + named versions + share links (delta) + JSON files + works offline (PWA).
   A family member opens the link, edits, saves versions in her browser, and sends a link back.

## 2. Data model changes (schemaVersion 2, with a v1 → v2 migration)

```ts
// Deck: railings and steps become properties of the deck; the deck outline may overlap buildings (derive trims it)
interface Deck {
  id: Id; polygon: Vec2[]; topHeight: number; isNew: boolean;
  /** Railing along every free edge (edges not touching a building), unless listed in noRailingEdges. */
  railing?: { style: 'glass' | 'boards'; height: number };
  /** Edge indices (into `polygon`, after trimming they are matched by geometry) where the user removed the railing. */
  noRailingEdges: number[];
  steps: DeckSteps[];
}
interface DeckSteps { id: Id; /** a point near the deck edge the steps hang on */ at: Vec2; width: number }
// Outdoor.railings is removed (migration converts each Railing into deck.railing + steps from its gaps).

// Blocks created from the unit catalogue remember their template; new blocks may carry a floor material
interface Block { ...; template?: string }

// Furniture (unchanged shape; catalogue ids below). FurnitureItem.levelId stays explicit.

// Variant gets free-text notes for the family
interface Variant { ...; notes?: string }
```

Migration v1 → v2: `Outdoor.railings[]` → for each railing, set `deck.railing = { style, height }` on `deckId` and
convert each gap with `steps: true` into `DeckSteps { at: midpoint of the gap on the path, width: gap length }`;
`noRailingEdges = []`; blocks `template` undefined; `schemaVersion = 2`. Share links and versions run through it.

### Derived additions

```ts
DerivedDeck { ...; /** polygon after subtracting all block outer outlines (MultiPolygon, usually one) */ pieces: Vec2[][][];
              freeEdges: { a: Vec2; b: Vec2; index: number }[] /* edges of the trimmed outline not touching a building */ }
DerivedRailing  // now generated per deck from freeEdges minus noRailingEdges minus steps gaps (same shape as before)
DerivedSteps    // from DeckSteps projected onto the nearest free edge (gap = width centred at the projection)
DerivedBlock { ...; vertexLocked: boolean[]; edgeLocked: boolean[] }   // §3.4
DerivedWall { ...; locked: boolean }        // status existing → true
DerivedOpening { ...; locked: boolean }
DerivedFurniture { ...; footprint: Vec2[]; clearances: { polygon: Vec2[]; kind: 'front' | 'side' | 'around' }[];
                   bbox; catalog: FurnitureCatalogItem; needsDrain: boolean; collisions: Id[]; blocksDoor?: Id }
ModelWarning += { kind: 'furniture-overlap'; ids: Id[] } | { kind: 'furniture-in-wall'; id: Id }
             | { kind: 'door-blocked'; openingId: Id; by: Id } (exists) | { kind: 'deck-no-free-edge-for-steps'; stepsId: Id }
```

Decks are trimmed by ALL block outer outlines at derive time, so a unit dropped on the terrace cuts itself out of
the deck, the railing disappears along its walls and reappears if it is moved away. Robin's "the layout of the
terrace should instantly fit the new unit" follows from that rule.

## 3. Editor (2D plan) — `src/editor/` (new) + `src/plan2d/` handles

### 3.1 Tools (toolbar above the plan, icons + Norwegian labels, keyboard letter in the tooltip)

| Tool | Key | What it does |
|---|---|---|
| Velg og flytt | V | select; drag walls, openings, block vertices/edges, deck vertices, steps, hot tub, furniture; handles on selection |
| Vegg | W | click–click to draw a new interior wall (snaps; Esc cancels; Enter/double-click ends a chain) |
| Dør / vindu | D | pick a type in the small chooser, then click on a wall or block edge to place it (default sizes per type) |
| Enhet | E | pick a unit template (Bod, Vedskjul, Badstue, Anneks, Egendefinert), then click to place it; it snaps to deck edges, other blocks and the grid |
| Terrasse | T | edit the deck outline: drag vertices/edges, click an edge to add a vertex, Delete removes a vertex; "Legg til trapp" places steps on the nearest edge |
| Møbler | M | opens the furniture library panel; drag an item onto the plan (or 3D) |
| Mål | L | click two points → distance; Esc clears |

Delete removes the selected NEW element (or asks to mark an existing one as "rives"). R rotates furniture 15°
(Shift+R free rotation while dragging the handle), Ctrl+D duplicates, arrows nudge 1 cm (Shift: 10 cm), Esc deselects /
cancels the tool, Ctrl+Z / Ctrl+Y undo/redo.

### 3.2 Snapping (`geometry/snap.ts`, pure, tested)

Grid 0.10 m (0.01 m while Alt is held); wall endpoints and midpoints; perpendicular/collinear extensions of nearby
walls; block edges and vertices; deck edges and vertices; furniture to wall faces (back against the wall, 0 gap) and to
other furniture edges. Snap radius 12 screen px. The engine returns the snapped point + a list of snap indicators
(points, guide lines) that the plan draws, and the distances to the nearest walls on each side, shown live as small
dimension chips while dragging.

### 3.3 Dragging rules (store actions in `state/editActions.ts`, geometry in `geometry/edit.ts`)

- **Wall move** (perpendicular to itself): both endpoints move by the perpendicular component; any wall whose endpoint
  coincides (≤ 1 cm) with a moved endpoint stretches; a wall ending ON the moved wall (T-junction) is extended/trimmed to
  the new line; openings on the moved wall keep their offset; openings on stretched walls keep their absolute position
  (re-offset, clamped, warning if they no longer fit). Dividers move like walls.
- **Wall endpoint drag**: moves one endpoint (the handle), snapping; T-junction walls follow.
- **Block vertex / edge drag** (unlocked vertices only; edges move both their vertices): interior walls ending on the moved
  edge extend/trim; openings on the edge keep absolute positions; floor zones and parts are clipped at derive time (no
  change needed); the roof follows (`drive`). Axis-aligned blocks stay axis-aligned when an edge is dragged.
- **Opening drag**: along its host (clamped to fit, end-touch allowed); dragging onto another wall re-hosts it.
- **Deck vertex/edge drag**, add vertex on edge click, delete vertex (min 3). Steps drag along the edge.
- **Everything new is movable** (Robin: "things like the badestamp need to be movable if someone wants to move stuff
  around"): the hot tub (drag anywhere; snaps to deck edges and to the deck surface, warning if it ends up off the deck
  and on terrain), steps, outdoor furniture, units, and also the birch trees (drag/delete/add). The only immovable things
  are the parts of today's cabin.
- **Furniture drag/rotate**: snapping per §3.2; collision + clearance warnings live.
- **Unit placement**: template → new Block (isNew, `template`), with its default roof, wall build-up, a Room record,
  default openings (e.g. a door on the deck-facing side, open front for the woodshed), placed with its reference corner at
  the snapped point; afterwards it is edited like any new block (drag edges/vertices, roof settings in Egenskaper).
- Every drag = `beginTransaction` on pointer-down, actions on move (throttled), `commitTransaction` on pointer-up.

### 3.4 Lock rules

- `DerivedWall.locked = status === 'existing'`; `DerivedOpening.locked` likewise; both still selectable (properties
  read-only, "Marker for riving" button for interior walls and openings; exterior existing walls: no riving).
- Block vertices: locked when the vertex lies on the boundary of an existing part (or the block is existing). Edge locked
  when either vertex is locked. For blk-main that frees the east vertices (x 16) → the extension can grow/shrink; for
  blk-bod the north vertices; blk-glass fully locked; blk-wing free.
- Existing structure, floor zones, levels: not editable in phase 2.
- UI: a small lock icon in the properties header; dragging a locked thing shows a toast "Dette er en del av hytta i dag
  og kan ikke flyttes. Du kan legge til nytt, eller markere for riving."

### 3.5 Properties panel (Egenskaper), by selection kind

- **Rom**: name, type (drives floor material), note; "Bredde / dybde" numeric fields for rectangular rooms: changing one
  moves the opposite unlocked wall (prefer new walls; if both bounding walls are locked, the field is read-only with a hint).
- **Vegg**: length (read-only for existing), thickness, height mode/height, kind (divider toggle), status; buttons:
  Del (split at midpoint), Slett / Marker for riving.
- **Åpning**: type, width, height, sill, offset from the nearer wall end (shown as "avstand fra hjørne"), swing side/hinge
  (flip buttons), leaves, frame/leaf colour, mullions; status.
- **Bygningsdel (blokk)**: name, outer dims (axis, editable for unlocked edges), roof type/pitch/ridge height/drive,
  eave height, overhangs, wall build-up, ceiling height, material; for units from a template also "Åpen front" toggle.
- **Terrasse**: height, railing style/height, per-edge railing on/off (click the edge), steps list.
- **Badestamp**: diameter.
- **Møbel**: catalogue name, size variant, colour, rotation, level; "Vis klaringssoner" global toggle.

### 3.6 Live feedback

Room labels update during drags; dimension chips to the nearest walls on both sides of a dragged wall/opening/furniture;
"Romskjema" and areas update live; warnings panel shows overlaps/blocked doors; the 3D view updates after the drag ends
(and every ~150 ms during long drags).

## 4. Furniture — `src/furniture/`

`catalog.ts`: `FurnitureCatalogItem { id, name (nb), category, sizes: { key, label, w, d, h }[], defaultSize, colours?,
clearance?: { front?: number; sides?: number; around?: number }, snap: 'back-to-wall' | 'corner' | 'free',
needsDrain?: boolean, symbol: 2D symbol key, model: 3D builder key }`. Categories and items (names in bokmål):

- Soverom: Seng 90 / 120 / 150 / 180 (200 long), Køyeseng, Nattbord, Garderobeskap (60 deep, 100/150/200 wide), Kommode.
- Stue: Sofa 2-seter / 3-seter, Hjørnesofa, Lenestol, Salongbord, Teppe (sizes), TV-benk, Bokhylle, Vedovn (clearance around).
- Kjøkken: Benkeskap 60 (and 120/180/240 runs), Overskap, Høyskap, Kjøleskap, Kjøkkenøy, Spisebord for 4 / 6 / 8 med stoler.
- Bad / WC: Toalett (clearance front 0.6), Servant med skap, Dusj med glassvegger (80/90/100), Badekar, Vaskemaskin,
  Tørketrommel, Vaskesøyle, Håndkletørker, Sluk (floor drain, flat).
- Badstue: Badstubenk (to nivåer, length variants), Badstuovn.
- Annet: Hylle (pantry), Skohylle, Benk, Skistativ.
- Ute: Loungesofa, Utebord, Utestol, Grill (the hot tub is its own entity).

2D: recognisable plan symbols (bed with pillow, toilet, sink, shower, table with chairs...). 3D: simple parametric builders
(boxes/cylinders with materials from the old model: wood, mattress, duvet colours, porcelain, black stove, metal) — the
look of the old model's furniture. Clearance zones drawn as faint hatched areas when the toggle is on. Collisions: furniture
footprint vs wall footprints and vs other furniture (warning, red outline); door swing arcs vs furniture (door-blocked).

Seed furnishing of Forslag D: port the old model's `buildD150()` furniture positions (beds, kitchen counter + tall units +
island, dining table 7–8, sofa group, wood stove, toilets back-to-back at x 18.6, sinks, washer tower, shower, sauna
benches + stove, wardrobe, pantry shelves, outdoor lounge, chairs) as `FurnitureItem`s with status new/existing by room.

## 5. Saving, sharing, offline

- PWA with `vite-plugin-pwa` (installed): app shell + terrain asset precached, `registerType: 'autoUpdate'`, manifest
  (name "Hytteplanlegger", icons from the favicon), works offline after the first visit; an "Oppdatering tilgjengelig"
  toast when a new build is deployed. Vite `base` becomes `/hytte-planlegger/` for production builds and `/` in dev.
- Versions UI: "Lagre" (prompt for a name, default "Mammas forslag 11. okt"), list with date/time, "Åpne", "Slett",
  "Send som lenke" per version; autosave indicator "Lagret" in the top bar.
- Share dialog: copy link, "send JSON-fil", QR code (optional, small lib not needed: skip if it adds a dependency).
- Export/import unchanged. All of it works offline (no network calls except the deploy's own assets).

## 6. UI changes

- Toolbar (§3.1) above the plan; the plan is the default view on all desktop widths; 3D keeps presets; "Snitthøyde"
  slider removed (fixed 1.3 m; 2.3 m in "Inne i stua").
- Furniture library as a left-side panel with categories (accordion), search box, drag handles.
- Properties panel moves to the top of the right column; Romskjema and Arealer below.
- First-run card "Slik kommer du i gang" (3 bullets, dismissable) + the Hjelp panel updated with tools and shortcuts.
- Read-only (shared link) mode hides the toolbar and library.

## 7. Done when

- Robin can: drag the new wing's east wall and see rooms, roof, areas and dimensions follow; draw a new partition in the
  bedroom and name the rooms; move/resize/add a window on the south wall; place a 2 × 3 m woodshed unit on the terrace and
  watch the deck and railing adapt, then move it; set the bedroom width to 2.40 m by typing it; furnish the bathroom
  (toilet, sink, shower) with clearance zones visible and a warning when the door is blocked; save a version, reload,
  reopen it; open the site on his phone offline after a first visit; and the original house never moves or disappears.
- Tests: snapping, drag rules (connected walls, re-offset openings), lock rules, deck trimming/railing regeneration,
  migration v1 → v2, furniture collisions/clearances, catalogue invariants; Playwright: a drag of the wing's east edge,
  placing a unit on the terrace, dropping a toilet in the bathroom, saving/reopening a version, offline reload.

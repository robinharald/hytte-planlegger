# Phase 2 plan: editing, units on the terrace, furniture, saving and offline

Revision 2 (2026-10-11 evening), after a three-reviewer critique of revision 1. This document is the contract for the
phase-2 engineers; docs/architecture.md stays authoritative for coordinates, derivation and the phase-1 contracts.

Robin's brief for phase 2:

> "now move on to phase two where I can start customizing rooms, furniture placements, room types, sizes of rooms,
> where doors, windows, etc. are. But I can never remove the original house. That should be locked. But adding,
> removing or similar. Just creating for instance the wood shed as a separate unit on the terrace (needs to snap,
> and instantly the layout of the terrace should fit to this new unit, and can also be changed). And again a saving
> feature for if my mother wants to work on our own suggestion then pick it up later. It also needs to work if this
> PC is offline. Keep the design user friendly and easy to understand and use. [...] things like the badestamp need
> to be movable if someone wants to move stuff around."

## 1. Guiding rules

1. **The original house is locked; everything new is movable.** One pure function `isLocked(target, variant)` in
   `geometry/edit.ts` decides, and every edit action calls it (no UI path can bypass it). LOCKED: stored walls and
   openings with status `existing` (position, size, type); block vertices/edges by the part rule in §3.4; blk-glass;
   structure; floor zones; levels. NEVER LOCKED: furniture (whatever its `isNew`), decks, steps, the hot tub, trees,
   everything with status `new`, and room names/types/notes. Allowed on existing elements: naming/typing rooms,
   hosting NEW openings in existing walls, and "Marker for riving" (existing → `removed`, reversible with "Ta tilbake")
   for interior walls and openings only. Status is shown as read-only text ("Hytta i dag" / "Nytt" / "Rives"), never
   as an editable field.
2. **Edits are data.** Every interaction ends in one store action = one undo step; drags are transactions applied from
   the pointer-down base (`apply(base, totalDelta, snap)`), never incrementally.
3. **Simple first.** Six tools, a hint line that says what to do next, a properties panel with basic fields and a
   "Mer" section, snapping that just works, and the same gestures with mouse and touch (iPad is a first-class device).
4. **Nothing is lost.** Autosave is the save; named "Tidligere lagringer"; share links (delta); JSON files; works offline
   (PWA); a shared link reopens as the recipient's own editable proposal the second time.

## 2. Schema v2 (exact types; migration v1 → v2 is field-wise idempotent)

```ts
export const CURRENT_SCHEMA_VERSION = 2;

interface Deck {
  id: Id;
  /** Outline on the deck's own line, with stable vertex ids (edge id = start vertex id). May overlap buildings: derive trims it. */
  polygon: DeckVertex[];
  topHeight: number; isNew: boolean;
  /** Railing along every free run (parts of edges not touching a building), unless the edge id is in noRailingEdges. */
  railing?: { style: 'glass' | 'boards'; height: number };
  noRailingEdges: Id[];
  steps: DeckSteps[];
}
interface DeckVertex { id: Id; p: Vec2 }
/** Steps down from the deck, hosted like an opening: on an edge, offset from the edge start to the centre, width. */
interface DeckSteps { id: Id; edgeId: Id; offset: number; width: number }
interface Outdoor { decks: Deck[]; hotTubs: HotTub[] }          // railings removed

interface Block { /* as before */ template?: string; templateFrontEdgeId?: Id; floorMaterial?: FloorMaterial }
interface Variant { /* as before */ notes?: string; copiedFrom?: string /* fnv1a of the decoded link payload */ }

interface FurnitureItem {
  id: Id; catalogId: string; position: Vec2; rotationDeg: number; levelId: Id;
  /** Dimensions written at placement from the chosen preset (w along local x, d along local y, h up). Catalogue changes never resize saved items. */
  size: { w: number; d: number; h: number };
  sizeVariant?: string; colour?: string; isNew: boolean;
}
```

Migration `toV2`: convert `outdoor.railings` only when it is a non-empty array (set `deck.railing` from the first
railing on that deck, each gap with `steps: true` → `DeckSteps { id: \`${railingId}/steps/${gapIndex}\`, edgeId, offset,
width }` on the stored deck edge under the gap centre; a gap without steps covering a whole edge → `noRailingEdges`),
then delete `railings`; never overwrite `railing`, `steps`, `noRailingEdges`, `polygon` ids or `size` when present,
only default missing ones (deck vertices get ids `${deckId}-v${i}`; furniture `size` from the catalogue preset).
Before raising the version, freeze today's seed variant as `src/model/seed/frozen/forslagD.schema1.json`;
`decodeDeltaPayload` uses the frozen base when `raw.v < CURRENT_SCHEMA_VERSION` so migrations always see a real old
document. Before the first autosave write of a project whose stored schemaVersion is older, copy the raw string to
`hytte-planlegger:project.backup-v1`. `OUTDOOR_COLLECTIONS` becomes `['decks', 'hotTubs']`. `sharePayloadJson` drops the
`seedRevision !== SEED_REVISION → full` early return (the decoder already rebases by `meta.seedRevision`). The seed
engineer bumps `SEED_REVISION` exactly once (3 → 4) when the seed content changes (deck v2 fields, furniture).
Tests: a phase-1 delta link (v 1, seedRevision 2, one renamed room) decodes with the glass railing and three steps; a
full v1 project migrates to the same railing panels within 0.11 m; a seedRevision-3 project still encodes to a delta
< 2 kB.

### Derived additions (`src/model/derived.ts`)

```ts
DerivedDeck { id; polygon: Vec2[] /* stored outline, for handles */; vertexIds: Id[]; pieces: Vec2[][][] /* trimmed by all block outer outlines */;
              topZ; thickness; skirtBottomZ: number[][] /* per piece ring vertex */; boardDirection; isNew;
              freeRuns: { edgeId: Id; a: Vec2; b: Vec2 }[] /* intervals of trimmed edges not overlapping (≤ 1 mm) any block outer edge */ }
DerivedRailing { id: `${deckId}/railing`; deckId; baseZ; height; style; panels; posts; isNew }   // freeRuns − noRailingEdges − step gaps
DerivedSteps   { id = DeckSteps.id; deckId; edgeId; at; outward; width; topZ; bottomZ; risers; riserHeight; going; treads }
DerivedVariant.outdoor = { decks; railings; steps; hotTubs }
DerivedBlock { ...; vertexLocked: boolean[]; edgeLocked: boolean[];
               junctions: { edgeIndex; s0; s1; otherBlockId; otherEdgeIndex; role: 'owner' | 'removed' | 'open' }[] }
WallSource (blockEdge) += { s0: number; s1: number }   // the piece's range along the edge
DerivedWall { ...; locked: boolean }
DerivedOpening { ...; locked: boolean; levelId: Id }
DerivedFurniture { id; item; catalog: FurnitureCatalogItem | null; footprint: Vec2[]; bbox; levelId; roomId?; floorZ; z;
                   clearances: { polygon: Vec2[]; kind: 'front' | 'side' | 'around' }[]; collisions: Id[]; blocksDoors: Id[];
                   needsDrain: boolean; isNew: boolean }
ModelWarning += 'furniture-overlap' {ids} | 'furniture-in-wall' {id} | 'furniture-outside' {id} | 'furniture-unknown' {id}
             | 'furniture-needs-wet-room' {id} | 'deck-steps-blocked' {stepsId}
export function levelAt(derived: DerivedVariant, storeyId: Id, p: Vec2): Id   // level of the floor under p on that storey
```

Derive is split so edits are cheap: building stages memoised on the identities of (levels, blocks, walls, openings,
rooms, structure, settings); outdoor on (outdoor, building); furniture on (furniture, building) (~1–3 ms). Test: two
variants differing only in furniture share the same `walls`/`rooms` array instances. Perf test on the seed: block-edge
change ≤ 60 ms, furniture-only change ≤ 5 ms.

## 3. Editor

### 3.1 Gestures (mouse and touch alike)

"Trykk for å velge, dra det valgte for å flytte." A tap selects. A pointer-down on the SELECTED element or one of its
handles starts a move (`beginTransaction`), after 5 px (mouse) / 10 px (touch). Any other one-pointer drag pans; two
fingers or the wheel pan/zoom. Placement tools use click/tap, never drag. Handles: white circles with an accent border,
radius 7 px (14 px on `(pointer: coarse)`); wall and opening hit corridors ≥ 12 px (24 px coarse) in screen space at any
zoom. Esc / pointercancel / lostpointercapture cancel the transaction. No HTML5 drag-and-drop anywhere.

### 3.2 Toolbar (above the plan) and hint line

Velg · Vegg · Dør/vindu · Nytt bygg · Møbler · Mål, plus labelled Angre / Gjør om at the right end. Keyboard letters
(V W D N M L) only in tooltips. Placement tools return to Velg after one placement with the new element selected;
Vegg draws one wall per two clicks and stays active until Esc/Velg. A hint line under the toolbar tells the next step:
Vegg "Klikk der veggen skal begynne" → "Klikk der den skal slutte (Esc avbryter)"; Dør/vindu "Velg type, og klikk på en
vegg"; Nytt bygg "Klikk der bygget skal stå – det fester seg til terrassekanten og veggene"; Mål "Klikk på to punkter".
Nytt bygg chooser: Vedskjul, Bod, Badstue, Anneks, Eget bygg; a ghost outline follows the pointer and snaps. There is no
Terrasse tool: selecting the deck shows vertex handles and "+" handles at edge midpoints (drag to add a corner); its
Egenskaper has "Legg til trapp" and "Fjern hjørne". Møbler opens the library, which REPLACES the left column's content
(heading "Møbler", button "Lukk"); on phones it is a bottom sheet. Library items can be tapped to place (centre of the
selected room, else the visible plan centre, pushed to the nearest free wall by the snap rule) or dragged into the plan.
In 3D, dropping a library item places it on the floor at the hit point.

### 3.3 Snapping (`geometry/snap.ts`, pure, tested)

Grid 0.10 m (0.01 m with Alt); wall endpoints/midpoints; perpendicular/collinear extensions of nearby walls; block
axis edges and vertices (blocks snap axis line to axis line, never to cladding faces); deck edges/vertices; furniture
back-to-wall (0 gap, back face on the wall's inner face) and edge-to-edge with other furniture. Radius 12 px (24 coarse).
Returns the snapped point, snap indicators (points, guide lines) and the distances to the nearest walls on both sides
(dimension chips while dragging).

### 3.4 Lock rules for blocks

A block is fully locked iff `isNew === false` and it has no explicit part with `isNew: true`. Otherwise
`vertexLocked[i]` = the vertex lies within 1 mm of the boundary of an explicit `isNew: false` part's clipped polygon;
`edgeLocked` = either vertex locked, or the junction partner's edge is locked. The implicit remainder of a block that
has explicit parts is `isNew: true` (derive safety net, so growing the extension never creates "existing" area).
Edge/vertex drags also move every explicit NEW part vertex coincident (≤ 1 mm) with a moved block vertex. Clamps: every
explicit existing part polygon stays inside its block; no new block's axis polygon may overlap an existing part by more
than 0.01 m²; a vertex whose adjacent edge has a locked vertex may only slide along that edge's line; gable/mono blocks
keep their rectangle (corner handles move both adjacent edges; free vertex drags only for flat-roof "Eget bygg").
An edge with an 'open'/'wall' junction moves together with the partner block's coincident vertices (so the wing follows
the extension's east edge); stored walls collinear with and lying on a moved edge translate with it (w-wing-w with its
opening). Tests: blk-main east edge 16 → 18 → 16 keeps BYA existing at 102.18 and the vertices unlocked; a drag to x 11
stops at x 12; blk-bod's north edge drag keeps the old east wall straight.

Visibility: "Vis hva som er nytt" (the renamed highlight toggle) is ON by default; a two-item legend in the plan corner
opposite the scale bar: "Hytta i dag (låst)" / "Nytt"; handles only on unlocked vertices/edges, a small lock glyph and a
not-allowed cursor on locked ones; the Egenskaper header reads "Låst – dette er en del av hytta i dag." Messages:
interior wall "Denne veggen står i hytta i dag og kan ikke flyttes. Du kan markere den for riving."; exterior wall
"Ytterveggene på hytta i dag er låst. Du kan sette inn nye dører og vinduer i dem."; dragging an existing opening opens
the dialog "Vinduet står i hytta i dag. Vil du flytte det? Det gamle markeres som revet, og et nytt settes inn der du
slipper. [Flytt] [Avbryt]" (Flytt = mark removed + new opening of the same type/size). Blocks with parts list each part
in Egenskaper: "Eksisterende del: 12,00 × 6,20 m (låst)", "Stueforlengelse: lengde 4,00 m" (editable).

### 3.5 Drag rules (`geometry/edit.ts` pure functions; `state/editActions.ts` wraps them; all computed from the base)

- **Wall move / endpoint drag**: at pointer-down classify each endpoint P: its supports are block edges and vertices,
  locked walls, floor-zone edges and any wall whose interior contains P. P with a non-parallel support is anchored and
  slides along that support's line (clamped to its extent); coincident walls are NOT stretched. A free node (no support,
  only unlocked coincident walls) moves as a node: every coincident wall follows keeping its direction (new end = its
  line ∩ the moved line). A free node whose only coincident wall is locked → refuse with the lock toast. T-junction walls
  ending on the moved wall's interior are trimmed/extended along their own direction. Openings on the moved wall keep
  their offset; openings on stretched walls keep their plan position (re-offset, clamped, `opening-outside-host` if it
  no longer fits). Test: moving w-sauna-n +0.3 leaves w-wing-w at (16,0)–(16,6.2) and all 27 rooms named; dragging
  dv-stue-n leaves dv-kjk-w unchanged.
- **Block vertex / edge / whole-block move**: §3.4 rules; `moveBlock(blockId, delta)` translates polygon, parts, floor
  zones, stored walls with both endpoints on/inside the axis polygon, Room anchors and furniture inside it; refuses
  locked blocks; clamps against existing parts. After any vertex/edge move, re-offset every opening on BOTH adjacent
  edges so its plan centre stays put (locked ones too: bookkeeping, not a move).
- **Opening drag**: clamped to its piece range `[s0, s1]` (end-touch allowed; crossing a part/zone/junction split is
  not); dragging onto another wall re-hosts it keeping the swing in world terms (side = side of the new host containing
  the old open-leaf point; hinge = jamb nearer the old hinge point); `levelId` is recomputed from the floor 0.2 m inside
  the new centre unless the stored level differed from the old default (keeps loft windows).
- **Deck**: vertex/edge drags, insert vertex (re-hosts steps on the second half), delete vertex (min 3; merges edges and
  re-hosts steps), steps drag along their edge; steps whose centre is not on a free run stay and raise `deck-steps-blocked`.
- **Furniture**: §4. **Hot tub, trees**: free drags; hot tub snaps to deck edges, warning when off the deck on terrain.
- **Unit placement** `placeUnit(templateId, at, rotation90)`: new Block (isNew, `template`, levelId 'main', parts [],
  floorZones [], junctions [], nanoid vertex ids, edge id = start vertex id), one Room (anchor = centroid, type from the
  template, `floorMaterial: 'deck'` for Vedskjul), default openings as ordinary Openings (door on the deck-facing side;
  Vedskjul: a fullHeight 'opening' on `templateFrontEdgeId`), snapped axis-to-axis; a unit touching another block forms a
  'wall' junction owned by the first-listed block. Foundation and terrain cut come from derive.
- **Rooms under edits** (`reconcileRooms(baseDerived, nextVariant)` in every action and at commit): each Room stays with
  the new face overlapping most with its previous inner polygon and its anchor moves to that face's labelPoint; two Rooms
  in one face → keep the larger, delete the other, toast "«A» og «B» er nå ett rom («A»). [Angre]"; a split face → the
  larger piece keeps the Room, the other shows "Gi navn" (`nameFace(faceId, levelId, name, type)`); `deleteRoom`.
  Warning text: "Rommet «X» er borte fra planen. Angre siste endring, eller gi rommet et nytt navn."
- **Transactions**: `transactionBase()` exposed by the store; nudges (arrows, 1 cm / Shift 10 cm) use
  `{ transaction: 'nudge:<id>' }`; numeric fields commit on Enter/Tab/blur, Esc restores; every delete toasts "Slettet. [Angre]".

### 3.6 Edit API (`state/editActions.ts`; each refuses locked targets with a toast; cascades listed)

Walls: `addWall(a, b, levelId?)`, `moveWall(id, delta)`, `moveWallEndpoint(id, 'a'|'b', p)`, `splitWall(id, t)` (new id for
the second half; openings re-hosted by centre, split point snaps to the nearest gap between openings), `deleteWall(id)`
(deletes its openings), `setWallProps(id, {thickness, heightMode, height, kind})` (turning a wall into a divider asks, then
deletes its openings), `setStatus(id, 'removed'|'existing')` for walls and openings.
Blocks: `moveBlockEdge`, `moveBlockVertex`, `moveBlock`, `placeUnit`, `deleteBlock` (deletes openings on its edges, stored
walls and furniture inside, rooms with anchors inside, junction entries elsewhere), `setBlockProps` (roof: editing
Takvinkel sets `drive: 'pitch'`, Mønehøyde sets `'height'`), `duplicateBlock` (remaps vertex ids and opening hosts).
Openings: `addOpening(host, offset, type)`, `moveOpening(id, offset, host?)`, `setOpeningProps`, `deleteOpening`.
Rooms: `nameFace`, `setRoomProps`, `deleteRoom`, `resizeRoom(id, 'w'|'d', value, side?)`.
Deck: `moveDeckVertex`, `moveDeckEdge`, `insertDeckVertex`, `deleteDeckVertex` (re-hosts steps), `setDeckProps`,
`toggleRailingEdge(edgeId)`, `addSteps(edgeId, offset)`, `moveSteps`, `deleteSteps`.
Other: `moveHotTub`, `setHotTubDiameter`, `addFurniture`, `moveFurniture`, `rotateFurniture`, `setFurnitureProps`,
`duplicateFurniture`, `deleteFurniture`, `addTree`/`moveTree`/`deleteTree`, `setVariantNotes`.
Selection kinds += `'deckVertex' | 'deckEdge' | 'steps' | 'blockEdge' | 'blockVertex'` (exist) ; `'railing'` resolves by
`${deckId}/railing`. `UiState.tool: 'select' | 'wall' | 'opening' | 'unit' | 'furniture' | 'measure'` + `toolOptions`
(opening type / unit template / furniture item) + `showClearances`. `PlanViewProps` += `editable`, `tool`,
`onEditPointerDown/Move/Up`, `overlay` (handles, snap guides, dimension chips, ghost).

### 3.7 Properties panel (Egenskaper), basic | Mer, with action buttons

- Rom: Navn, Romtype, Bredde ↔, Dybde ↕ | Gulv, Merknad. Size fields = DerivedRoom.dims (as on the label); a change moves
  the bounding stored interior wall/divider on that side (prefer stored walls over block edges; both sides movable → the
  north/east one; a small switch "Flytt: venstre / høyre vegg" ("øvre / nedre")); while the field has focus the wall is
  highlighted with an arrow; only block edges on that side → read-only "Endres under bygningsdelen". Robin's example:
  Soverom (ny fløy) dybde 2,40 → w-gang-n moves 0.18 m north.
- Vegg (ny): Lengde, Tykkelse, [Del i to] [Slett] | Høyde (Automatisk / Til taket / Fast høyde), "Usynlig romdeler".
  Vegg (eksisterende): read-only + [Marker for riving] / [Ta tilbake].
- Åpning: Type, Bredde, Høyde, "Høyde over gulv" (windows; tooltip "brystning"), Avstand fra hjørne (distance from the
  inner face of the nearer crossing wall to the near edge of the opening, drawn as a temporary dimension while focused),
  [Bytt hengselside] [Slå andre veien] [Slett] | Antall fløyer, Karmfarge, Dørblad, Sprosser.
- Bygningsdel: Navn, Bredde ↔, Dybde ↕ (per part for mixed blocks), Taktype, Takvinkel, Åpen front (template units),
  [Slett] | Mønehøyde, Rafthøyde, Utstikk, Veggtykkelse, Himlingshøyde, Taktekking. Never show `drive`.
- Terrasse: Høyde, Rekkverk (stil, høyde), per-edge railing on/off (tap the edge), [Legg til trapp] [Fjern hjørne];
  Trapp: Bredde, [Slett]. Badestamp: Diameter, [Slett].
- Møbel: Navn, Størrelse (preset or Bredde/Dybde when stretchable), Farge, [Roter 90°] [Dupliser] [Slett]; "Rom: <navn>"
  read-only (no level field). "Vis klaringssoner" lives in the Vis panel and is on while the library is open.
- Number fields: accept "2,4" / "2,40" / "2.40", unit "m" shown, two decimals with comma, `inputmode="decimal"`, −/+ 10 cm
  buttons, values > 30 rejected with "Skriv i meter, for eksempel 2,40".

## 4. Furniture (`src/furniture/`)

Catalogue (`catalog.ts`, ids and size keys append-only, `hidden: true` to retire):
`FurnitureCatalogItem { id, name, category, sizes: { key, label, w, d, h }[], defaultSize, stretch?: { w?: [min,max]; d?: [min,max] },
colours?, clearance?: { front?, sides?, around? }, snap: 'back-to-wall' | 'corner' | 'free', mount: 'floor' | 'wall' | 'flat',
elevation: number /* bottom above floor */, needsDrain?: boolean, symbol: string, model: string }`. Local frame: w along
local x, back edge at local +y, rotationDeg CCW about the centre.
- Soverom: Seng 90/120/150/180 (200 long), Køyeseng, Nattbord, Garderobeskap (stretch w 0.6–3.0), Kommode.
- Stue: Sofa 2-/3-seter, Hjørnesofa, Lenestol, Salongbord, Teppe (flat, stretch), TV-benk, Bokhylle (stretch), Vedovn (around 0.5).
- Kjøkken: Benkeskap (stretch w 0.4–4.0), Overskap (wall, elevation 1.4, stretch), Høyskap (stretch), Kjøleskap, Kjøkkenøy
  (stretch), Spisebord for 4/6/8 med stoler (around 0.8), Stol.
- Bad / WC: Toalett (front 0.6), Servant med skap (front 0.6), Dusj med glassvegger 80/90/100, Dusjvegg (stretch), Badekar,
  Vaskemaskin, Tørketrommel, Vaskesøyle, Håndkletørker (wall, 0.9), Sluk (flat), Varmtvannsbereder.
- Badstue: Badstubenk (two levels, stretch), Badstuovn (around 0.3).
- Annet: Hylle (stretch), Skohylle, Benk, Skistativ, Vedstabel.
- Ute: Loungesofa, Utebord, Utestol, Grill.
Derive: `deriveFurniture(items, building)`; `levelId` is set by the editor on drop/move = `levelAt(derived, planStorey, centre)`
(outside blocks: 'main'); `floorZ` = the room floor under the centre, else the deck top, else terrain; `roomId` from the room
under the centre; `furniture-outside` for indoor categories outside every room. Collisions: same level, overlapping z ranges
`[floorZ + elevation, + h]`, neither 'flat'; walls only when `wall.levelIds` includes the item's level; door arcs only when
the door's level matches; include stairs, chimney, posts, hot tub; separating-axis tests on convex quads (arc as 8 segments,
5 mm tolerance), never polygon-clipping. Items whose back face lies on a moved wall face (≤ 1 cm) move with the wall.
Unknown catalogId → plain box of `size` + `furniture-unknown`. 2D symbols recognisable (bed with pillow, toilet, sink, shower,
table with chairs); 3D simple parametric builders in the old model's materials. Clearances as faint hatched areas.
Seed furnishing `src/model/seed/furniture.ts` as a table `{ id: 'fu-<roomId>-<n>', catalogId, size, centre, rotationDeg,
levelId }` ported from the old model's `buildD150()`, each item's back snapped to the nearest inner face within 0.15 m, the
lower-bathroom toilet turned to face the room, lower-level items on 'lower'; tests: `createForslagD()` twice gives identical
JSON, every seed item lies in a room of its level (outdoor on the deck), no furniture warnings.

## 5. Saving, sharing, offline

- Wording: Variant = "Forslag" ("Forslag: Forslag D ▾", "+ Nytt forslag (kopi av dette)"); autosave indicator "Lagret på
  denne maskinen" / "Ikke lagret – du ser på en delt lenke" / "Kan ikke lagre i denne nettleseren"; versions under Mer as
  "Tidligere lagringer" (default name `${forslag} – 11. okt kl. 14.30`, last typed name remembered; "Åpne" first stores
  "Før «X» ble åpnet"; line "Lagret bare i denne nettleseren på denne enheten"; per entry "Send som lenke" and "Last ned som fil").
- Primary share button "Send forslaget": `navigator.share({ url })` where available, else copy; the dialog shows two labelled
  links: "Lenke til planleggeren (viser Forslag D)" and "Lenke til dette forslaget (med endringene dine)".
- Link round trip: `Variant.copiedFrom` = fnv1a of the decoded payload. Opening a link whose hash matches one of the own
  variants opens that variant editable with "Du fortsetter på ditt eget forslag. [Vis forslaget slik det ble sendt]". Read-only
  mode keeps the toolbar greyed with one primary button "Endre dette forslaget"; on copy ask once "Hva skal forslaget ditt
  hete?" (default "Mitt forslag"); afterwards a one-time note "Neste gang kan du åpne robinharald.github.io/hytte-planlegger
  direkte – forslaget ditt ligger der." Test: open link → Endre → edit → reload the same link → own copy, editable, no duplicate.
- Storage: `navigator.storage.persist()` after the first edit; on iOS/iPadOS Safari outside standalone mode a one-time card
  "Legg appen til på Hjem-skjermen, så blir forslagene liggende og den virker uten nett" with the two steps.
- PWA (vite-plugin-pwa 2): `registerType: 'prompt'`, `injectRegister: false`, one `ui/UpdateToast.tsx` using
  `useRegisterSW` from `virtual:pwa-register/react`: "Ny versjon av appen er klar. [Oppdater]" → cancel open transaction,
  `autosave.saveNow()`, `updateServiceWorker(true)`; never reload automatically; link/schema/import "too new" notices call
  `registration.update()` then update (offline: "Lenken er laget i en nyere versjon av appen. Koble til internett og åpne
  lenken på nytt."); `registration.update()` hourly and on `visibilitychange`; on `controllerchange` in other tabs "Appen ble
  oppdatert i en annen fane – last inn på nytt". Workbox: `globPatterns ['**/*.{js,css,html,svg,woff2,png,webmanifest}']`,
  `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`. PNG icons 180/192/512 generated once from the favicon and
  committed, `apple-touch-icon`. Vite `base` = `/hytte-planlegger/` in production, `/` in dev. A second Playwright project runs
  against `npm run build && vite preview --port 4173` with baseURL `/hytte-planlegger/`: wait for a controlling service worker,
  go offline, reload, assert `__hytte.ready` and `document.fonts.check('16px Barlow')`.
- First-run card (three bullets): "Trykk på et rom, en vegg eller et møbel for å se målene. Dra det du har valgt for å flytte
  det." / "Hytta slik den står i dag er låst. Du kan bygge til og flytte nye vegger, dører, vinduer og møbler – og angre alt
  med Angre." / "Alt lagres automatisk på denne maskinen. Trykk «Send forslaget» for å vise det til de andre."

## 6. UI changes

Toolbar + hint line (§3.2); plan is the default view on desktop; Egenskaper at the top of the right column, Romskjema and
Arealer below; "Vis hva som er nytt" on by default with the legend; library replaces the left column while active; Hjelp
updated with tools, gestures and shortcuts; read-only mode per §5.

## 7. Done when

- Robin can: drag the new wing's east wall (the wing follows) and see rooms, roof, areas and dimensions follow; draw a new
  partition in the wing bedroom and name both rooms; move an existing window via the Flytt dialog and add a new one on the
  south wall; place a 2 × 3 m Vedskjul on the terrace, watch the deck and railing adapt, then move it and resize it; set
  Soverom (ny fløy)'s dybde to 2,40 by typing it; move the hot tub; furnish the bathroom (toilet, sink, shower) with clearance
  zones visible and a warning when the door is blocked; pan across a furnished room without moving anything; save, reload,
  reopen; open the site on his phone offline after a first visit; and the original house never moves or disappears.
- Tests: snapping; drag rules (supports, coincident walls, T-junctions, re-offset openings); lock rules (incl. the §3.4
  tests); block move/placement clamps; deck trimming, free runs, railing regeneration, steps re-hosting; migration v1 → v2
  (incl. phase-1 delta links); furniture collisions/clearances/levels; catalogue invariants; reconcileRooms (shrink past an
  anchor, merge by riving, split). Playwright: desktop drag of the wing's east edge; a Vedskjul placed and moved; a toilet
  tap-placed and deleted; a touch project (`hasTouch`, 1024 × 768) that pans across a furnished room without moving
  anything and moves a bed after selecting it; the link round trip; the offline reload.

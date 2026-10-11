# Phase 2 plan: editing, units on the terrace, furniture, shared proposals and offline

Revision 3 (2026-10-11 late evening). Revision 2 folded in a three-reviewer critique; revision 3 applies Robin's answers of the same
evening, which change two things: **the original cabin is editable** (only the Forslag D base proposal is immutable), and **proposals
are shared across the family's devices** (a shared store, not only links). This document is the contract for the phase-2 engineers;
docs/architecture.md stays authoritative for coordinates, derivation and the phase-1 contracts.

Robin's words:

> "customizing rooms, furniture placements, room types, sizes of rooms, where doors, windows, etc. are ... creating for instance the
> wood shed as a separate unit on the terrace (needs to snap, and instantly the layout of the terrace should fit to this new unit, and
> can also be changed) ... a saving feature for if my mother wants to work on our own suggestion then pick it up later ... needs to work
> if this PC is offline ... keep the design user friendly ... things like the badestamp need to be movable."
>
> Answers (11 Oct evening): units "can be added as separate buildings or attached to existing, removed, then changed in size as wanted
> (keep Forslag D as the standard base)". "I changed my mind about not editing the original cabin, as we may need to move some doors,
> windows, new hallways, etc." — change window sizes, add/remove windows and doors, hallways, new rooms, remove rooms, change sizes,
> "add a door or change layout for everything". Devices: PC, and "my dad wants to use his iPhone to play around with ideas". Saving:
> "the standard one (original Forslag D) cannot be changed; everyone who gets my link saves their tab, that everyone can click on and
> change, or delete (double confirmation on delete)". No hard deadline; "a day or two".

## 1. Guiding rules

1. **Forslag D is the immutable base; every proposal is fully editable.** The bundled Forslag D variant has `locked: true`: all edit
   actions refuse it with "Forslag D er grunnlaget og kan ikke endres. Lag et nytt forslag for å endre." and a button "Nytt forslag".
   In any other proposal everything can be moved, resized, added and deleted, including the walls, doors and windows of today's cabin.
   Nothing else is locked (no per-element locks; the §3.4 rules of revision 2 are withdrawn).
2. **Today's cabin stays visible as the reference.** Status bookkeeping is automatic: an existing wall, opening or block edge that is
   moved or resized becomes status `new` at its new place and leaves a `removed` ghost (status `removed`, original geometry) at the old
   place; deleting an existing element only marks it `removed`. Ghosts draw dashed in the plan when "Vis hva som er nytt" is on (default
   on) and never in 3D; "Ta tilbake" on a ghost restores it. The area split (existing/new BYA, room `areaExisting/areaNew`) keeps working
   through the block parts (an explicit existing part polygon never grows; the implicit remainder is `new`; shrinking clips it).
   UI words: "Nytt" / "Hytta i dag" / "Fjernet" (never "rives").
3. **Edits are data.** Every interaction is one store action = one undo step; drags are transactions applied from the pointer-down base.
4. **Simple first, on PC and on a phone.** Six tools, a hint line, basic/Mer properties, snapping that just works, the same gestures with
   mouse and touch. iPhone is a tested target (Playwright iPhone 13 project): tap to select, drag the selected thing, properties and the
   furniture library as bottom sheets, numbers editable with the keyboard.
5. **Nothing is lost.** Proposals live in the family's shared space (Firestore) and in the browser; autosave is the save; offline works
   (Firestore persistence + PWA); delete needs two confirmations; every proposal keeps automatic revisions.

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
interface Variant {
  /* as before */
  notes?: string;
  /** The bundled base proposal: read-only in the UI and in every edit action. */
  locked?: boolean;
  /** Shared-store metadata (undefined for the bundled base). */
  meta?: { author?: string; createdBy?: string; updatedBy?: string; updatedAt?: string };
}
interface FurnitureItem {
  id: Id; catalogId: string; position: Vec2; rotationDeg: number; levelId: Id;
  /** Dimensions written at placement from the chosen preset. Catalogue changes never resize saved items. */
  size: { w: number; d: number; h: number };
  sizeVariant?: string; colour?: string; isNew: boolean;
}
```

Migration `toV2`: convert `outdoor.railings` only when it is a non-empty array (set `deck.railing` from the first railing on that
deck, each gap with `steps: true` → `DeckSteps { id: \`${railingId}/steps/${gapIndex}\`, edgeId, offset, width }` on the stored deck
edge under the gap centre; a gap without steps covering a whole edge → `noRailingEdges`), then delete `railings`; never overwrite
`railing`, `steps`, `noRailingEdges`, vertex ids or `size` when present (deck vertices default to `${deckId}-v${i}`, `size` from the
catalogue preset). Freeze today's seed variant first as `src/model/seed/frozen/forslagD.schema1.json`; `decodeDeltaPayload` uses it
as the base when `raw.v < CURRENT_SCHEMA_VERSION`. Back up an older autosave to `hytte-planlegger:project.backup-v1` before the first
write. `OUTDOOR_COLLECTIONS = ['decks', 'hotTubs']`. `sharePayloadJson` drops the `seedRevision !== SEED_REVISION → full` early return.
The seed engineer bumps `SEED_REVISION` once per seed content change (deck v2 → 4; furniture → 5). The bundled Forslag D variant gets
`locked: true`. Tests as in revision 2 (phase-1 delta link keeps railing + 3 steps; full v1 migrates; rev-3 project delta < 2 kB).

### Derived additions (`src/model/derived.ts`)

```ts
DerivedDeck { id; polygon /* stored outline */; vertexIds; pieces: Vec2[][][] /* trimmed by all block outer outlines */; topZ; thickness;
              skirtBottomZ: number[][]; boardDirection; isNew; freeRuns: { edgeId; a; b }[] }
DerivedRailing { id: `${deckId}/railing`; deckId; baseZ; height; style; panels; posts; isNew }
DerivedSteps   { id = DeckSteps.id; deckId; edgeId; at; outward; width; topZ; bottomZ; risers; riserHeight; going; treads }
DerivedVariant.outdoor = { decks; railings; steps; hotTubs }
DerivedBlock { ...; junctions: { edgeIndex; s0; s1; otherBlockId; otherEdgeIndex; role: 'owner' | 'removed' | 'open' }[] }
WallSource (blockEdge) += { s0: number; s1: number }
DerivedWall { ...; isGhost: boolean /* status removed */ }
DerivedOpening { ...; levelId: Id; isGhost: boolean }
DerivedFurniture { id; item; catalog | null; footprint; bbox; levelId; roomId?; floorZ; z; clearances; collisions; blocksDoors; needsDrain; isNew }
DerivedVariant.locked: boolean
ModelWarning += 'furniture-overlap' | 'furniture-in-wall' | 'furniture-outside' | 'furniture-unknown' | 'furniture-needs-wet-room' | 'deck-steps-blocked'
export function levelAt(derived, storeyId, p): Id
```

Derive is split (building / outdoor / furniture stages memoised on sub-collection identities); perf targets: block-edge change ≤ 60 ms,
furniture-only ≤ 5 ms. Ghost walls/openings are excluded from room detection, areas and 3D.

## 3. Editor

### 3.1 Gestures (mouse and touch alike)

"Trykk for å velge, dra det valgte for å flytte." A tap selects. A pointer-down on the SELECTED element or a handle starts a move after
5 px (mouse) / 10 px (touch); any other one-pointer drag pans; two fingers / wheel pan and zoom. Placement tools click/tap, never drag.
Handles: white circles with an accent border, radius 7 px (14 px on `(pointer: coarse)`); wall/opening hit corridors ≥ 12 px (24 px
coarse) at any zoom. Esc / pointercancel / lostpointercapture cancel. No HTML5 drag-and-drop. On phones the selected element gets a
floating mini-bar (Egenskaper · Roter · Slett) above it and the properties panel opens as a bottom sheet.

### 3.2 Toolbar and hint line

Velg · Vegg · Dør/vindu · Nytt bygg · Møbler · Mål, plus Angre / Gjør om at the right end; on phones the toolbar scrolls with Velg pinned.
Placement tools return to Velg after one placement with the new element selected; Vegg stays active until Esc/Velg. Hint line texts:
Vegg "Klikk der veggen skal begynne" → "Klikk der den skal slutte (Esc avbryter)"; Dør/vindu "Velg type, og klikk på en vegg"; Nytt
bygg "Klikk der bygget skal stå – det fester seg til terrassekanten og veggene"; Mål "Klikk på to punkter". Nytt bygg chooser:
Vedskjul (2 × 1,5, åpen front), Bod (2 × 3), Badstue (2,4 × 2,2), Anneks (4 × 3), Eget bygg; a ghost outline follows the pointer and
snaps; units may stand free or against another building (axis-to-axis snap → a 'wall' junction owned by the first-listed block) and are
resized/moved/deleted like any block. No Terrasse tool: selecting the deck shows vertex handles and "+" midpoint handles; its Egenskaper
has "Legg til trapp" and "Fjern hjørne". Møbler replaces the left column (heading "Møbler", "Lukk"); bottom sheet on phones; items are
tapped to place (centre of the selected room, else the visible plan centre, pushed to the nearest free wall) or dragged in; in 3D a
library item dropped on the view lands on the floor at the hit point.

### 3.3 Snapping (`geometry/snap.ts`, pure, tested)

Grid 0.10 m (0.01 m with Alt); wall endpoints/midpoints; perpendicular/collinear extensions; block axis edges/vertices (axis to axis,
never cladding faces); deck edges/vertices; furniture back-to-wall (0 gap) and edge-to-edge. Radius 12 px (24 coarse). Returns the
snapped point, indicators and the distances to the nearest walls on both sides (dimension chips).

### 3.4 Lock, status and parts

- `isLocked(variant)` is variant-level: `variant.locked === true`. Every action in `editActions.ts` checks it first (toast + "Nytt
  forslag" button). Unit test: no action changes a locked variant.
- Status bookkeeping (rule 1.2), implemented once in `geometry/edit.ts` and used by every geometry action: `touchExisting(variant, id)`
  turns an existing stored wall/opening into `new` and appends a `removed` copy with the old geometry (id `${id}/ghost`), idempotent
  within a transaction; moving an existing block edge/vertex marks the derived exterior pieces through the parts (the explicit existing
  part polygon stays, so the moved strip is new) and records a ghost outline of the old edge in `variant.ghosts?: { id; a; b }[]` (new
  optional field, drawn dashed). Deleting existing elements = mark `removed`. "Ta tilbake" restores (removes the ghost, restores status).
- Parts: the implicit remainder of a block that has explicit parts is `isNew: true`; explicit existing parts are clipped to the block;
  nothing clamps block edits any more. Gable/mono blocks keep their rectangle (corner handles move both adjacent edges; free vertex drags
  only for flat-roof "Eget bygg"). An edge with a junction moves together with the partner block's coincident vertices; stored walls
  collinear on a moved edge translate with it (w-wing-w with its opening).
- Visibility: "Vis hva som er nytt" ON by default; legend "Hytta i dag" / "Nytt" / "Fjernet"; the Egenskaper header shows the status
  text; blocks with parts list "Eksisterende del: 12,00 × 6,20 m" and "Stueforlengelse: lengde 4,00 m".
- Tests: moving blk-main's east edge 16 → 18 → 16 keeps BYA existing 102.18; moving the old west gable from x 0 to −1 adds 6.2 m² to
  BYA new and leaves existing at 102.18 (part clipped: unchanged); deleting w-104-103 marks it removed, merges the rooms per §3.5 and
  "Ta tilbake" restores both rooms.

### 3.5 Drag rules (`geometry/edit.ts` pure; `state/editActions.ts` wraps; computed from the base)

- **Wall move / endpoint drag**: at pointer-down classify each endpoint P: supports are block edges and vertices, floor-zone edges and
  any wall whose interior contains P. P with a non-parallel support is anchored and slides along that support's line (clamped to its
  extent); coincident walls are NOT stretched. A free node (no support, only coincident walls) moves as a node: every coincident wall
  follows keeping its direction (new end = its line ∩ the moved line). T-junction walls ending on the moved wall's interior are
  trimmed/extended along their own direction. Openings on the moved wall keep their offset; openings on stretched walls keep their plan
  position (re-offset, clamped, `opening-outside-host` if it no longer fits). Existing walls touched → status bookkeeping. Tests: moving
  w-sauna-n +0.3 leaves w-wing-w at (16,0)–(16,6.2) and all 27 rooms named; dragging dv-stue-n leaves dv-kjk-w unchanged.
- **Block vertex / edge / whole-block move**: §3.4 rules; `moveBlock(blockId, delta)` translates polygon, parts, floor zones, stored
  walls with both endpoints on/inside the axis polygon, Room anchors and furniture inside it. After any vertex/edge move, re-offset every
  opening on BOTH adjacent edges so its plan centre stays put.
- **Opening drag**: clamped to its piece range `[s0, s1]` (end-touch allowed; crossing a part/zone/junction split is not); dragging
  onto another wall re-hosts it keeping the swing in world terms; `levelId` recomputed from the floor 0.2 m inside the new centre unless
  the stored level differed from the old default. Resizing: width/height/sill in Egenskaper or the end handles.
- **Deck**: vertex/edge drags, insert vertex (re-hosts steps on the second half), delete vertex (min 3; merges edges, re-hosts steps),
  steps drag along their edge; steps not on a free run stay and raise `deck-steps-blocked`.
- **Furniture**: §4. **Hot tub, trees**: free drags; hot tub snaps to deck edges, warning when off the deck on terrain.
- **Unit placement** `placeUnit(templateId, at, rotation90)`: new Block (isNew, `template`, levelId 'main', parts [], floorZones [],
  junctions [], nanoid vertex ids), one Room (anchor = centroid, type from the template, `floorMaterial: 'deck'` for Vedskjul), default
  openings (door on the deck-facing side; Vedskjul: a fullHeight 'opening' on `templateFrontEdgeId`). Foundation and terrain cut from derive.
- **Rooms under edits** (`reconcileRooms(baseDerived, nextVariant)` in every action and at commit): each Room stays with the new face
  overlapping most with its previous inner polygon, anchor → labelPoint; two Rooms in one face → keep the larger, delete the other, toast
  "«A» og «B» er nå ett rom («A»). [Angre]"; a split face → the larger piece keeps the Room, the other shows "Gi navn" (`nameFace`);
  `deleteRoom`. Warning text: "Rommet «X» er borte fra planen. Angre siste endring, eller gi rommet et nytt navn."
- **Transactions**: `transactionBase()` exposed; nudges (arrows 1 cm / Shift 10 cm) use `{ transaction: 'nudge:<id>' }`; numeric fields
  commit on Enter/Tab/blur, Esc restores; every delete toasts "Slettet. [Angre]".

### 3.6 Edit API (`state/editActions.ts`; each refuses a locked variant; cascades listed)

Walls: `addWall(a, b, levelId?)`, `moveWall(id, delta)`, `moveWallEndpoint(id, 'a'|'b', p)`, `splitWall(id, t)` (new id for the second half;
openings re-hosted by centre), `deleteWall(id)` (existing → removed ghost incl. its openings; new → deleted with its openings),
`setWallProps(id, {thickness, heightMode, height, kind})` (to divider: asks, then deletes its openings), `restoreGhost(id)`.
Blocks: `moveBlockEdge`, `moveBlockVertex`, `moveBlock`, `placeUnit`, `deleteBlock` (new blocks: deletes openings on its edges, stored walls
and furniture inside, rooms with anchors inside, junction entries elsewhere; existing blocks: refuse with "Hytta i dag kan ikke slettes som
helhet – flytt eller fjern vegger i stedet"), `setBlockProps` (Takvinkel → `drive: 'pitch'`, Mønehøyde → `'height'`), `duplicateBlock`.
Openings: `addOpening(host, offset, type)`, `moveOpening(id, offset, host?)`, `setOpeningProps`, `deleteOpening` (existing → ghost).
Rooms: `nameFace`, `setRoomProps`, `deleteRoom`, `resizeRoom(id, 'w'|'d', value, side?)`.
Deck: `moveDeckVertex`, `moveDeckEdge`, `insertDeckVertex`, `deleteDeckVertex`, `setDeckProps`, `toggleRailingEdge(edgeId)`, `addSteps`,
`moveSteps`, `deleteSteps`. Other: `moveHotTub`, `setHotTubDiameter`, `addTree`/`moveTree`/`deleteTree`, `setVariantNotes`, `nudge`.
Furniture: `addFurniture`, `moveFurniture`, `rotateFurniture`, `setFurnitureProps`, `duplicateFurniture`, `deleteFurniture`.
Drag protocol: `beginDrag(selection, p) → DragSession`, `updateDrag(session, p, modifiers) → { indicators, chips, ghost }`, `endDrag`, `cancelDrag`.
Selection kinds += `'deckVertex' | 'deckEdge' | 'steps' | 'ghost'`; `'railing'` resolves by `${deckId}/railing`.
`UiState.tool: 'select' | 'wall' | 'opening' | 'unit' | 'furniture' | 'measure'` + `toolOptions` + `showClearances` + `hint`; toasts with optional Angre.
`PlanViewProps` += `editable`, `tool`, `toolOptions`, `editActions`, `overlay`.

### 3.7 Properties panel (Egenskaper), basic | Mer, with action buttons

- Rom: Navn, Romtype, Bredde ↔, Dybde ↕ | Gulv, Merknad. Size fields = DerivedRoom.dims; a change moves the bounding stored interior wall
  on that side (prefer stored walls over block edges; both movable → north/east; switch "Flytt: venstre / høyre vegg"); the wall is
  highlighted with an arrow while the field has focus; only block edges on that side → "Endres under bygningsdelen".
- Vegg: Lengde, Tykkelse, [Del i to] [Slett] | Høyde (Automatisk / Til taket / Fast høyde), "Usynlig romdeler". Status text in the header.
- Åpning: Type, Bredde, Høyde, "Høyde over gulv" (windows), Avstand fra hjørne (from the inner face of the nearer crossing wall to the
  near edge, drawn as a temporary dimension while focused), [Bytt hengselside] [Slå andre veien] [Slett] | Antall fløyer, Karmfarge,
  Dørblad, Sprosser.
- Bygningsdel: Navn, Bredde ↔, Dybde ↕ (per part for mixed blocks), Taktype, Takvinkel, Åpen front (template units), [Slett] |
  Mønehøyde, Rafthøyde, Utstikk, Veggtykkelse, Himlingshøyde, Taktekking. Never show `drive`.
- Terrasse: Høyde, Rekkverk (stil, høyde), per-edge railing on/off (tap the edge), [Legg til trapp] [Fjern hjørne]; Trapp: Bredde,
  [Slett]. Badestamp: Diameter, [Slett]. Fjernet (ghost): [Ta tilbake].
- Møbel: Navn, Størrelse (preset or Bredde/Dybde when stretchable), Farge, [Roter 90°] [Dupliser] [Slett]; "Rom: <navn>" read-only.
- Number fields: accept "2,4" / "2,40" / "2.40", unit "m", two decimals, `inputmode="decimal"`, −/+ 10 cm buttons, > 30 rejected.

## 4. Furniture (`src/furniture/`)

Unchanged from revision 2: catalogue schema (sizes, stretch, clearance, snap, mount, elevation, needsDrain, symbol, model; ids
append-only, `hidden` to retire), the item list (Soverom, Stue, Kjøkken, Bad/WC, Badstue, Annet, Ute), derive stage with level/floorZ/room
resolution, SAT collisions aware of levels and z ranges, door-blocked, warnings, unknown-id fallback, 2D symbols, 3D parametric models in
the old model's materials, clearances as faint hatching, items following a moved wall face, seed furnishing ported from `buildD150()`
with stable ids and tests (createForslagD twice identical; every item in a room of its level or on the deck; no furniture warnings).

## 5. Shared proposals, saving, offline (replaces revision 2 §5)

Model: one **family space** identified by an unguessable id in the link (`#f=<24+ random chars>`), holding **proposals** ("Forslag").
The bundled **Forslag D** is the base: visible to everyone, never changed (`locked`). Everyone with the link sees the same list, can open
any proposal, change it, create a new one ("Nytt forslag", a copy of Forslag D or of another proposal), rename it, and delete it after
two confirmations ("Vil du slette «X»?" → "Er du sikker? Forslaget forsvinner for alle. [Slett for alle]"). Deleted proposals are kept
in a "Papirkurv" for 30 days (restorable). Each proposal keeps up to 20 automatic revisions (one per save burst, max one per 5 minutes)
with "Gjenopprett tidligere versjon" under Mer. Each device asks once "Hva heter du?" and tags saves with that name ("Sist endret av
Mamma, i dag 14.30").

Store: **Firebase Firestore** with anonymous auth (free tier; Robin creates the project and pastes the config; no personal data, no
passwords). Rules: `/families/{familyId}/proposals/{id}` and `/families/{familyId}/proposals/{id}/revisions/{rev}` readable and writable
by any authenticated (anonymous) client when `familyId.size() >= 24`; nothing else readable. Documents: `{ name, project: Project
(full JSON, < 100 kB), updatedAt, updatedBy, createdBy, deletedAt? }`. Concurrency: last write wins per proposal, with a soft guard — when
the remote `updatedAt` is newer than the local base, show "«X» ble endret av Pappa for 2 min siden. [Hent endringene] [Lagre over]".
Offline: Firestore persistence (IndexedDB) caches everything opened; edits queue and sync when back online; the PWA caches the app; the
status pill shows "Lagret for alle" / "Lagret her – sendes når du er på nett" / "Kun på denne enheten (ingen delt plass satt opp)".
`src/state/familyStore.ts` wraps all of it behind an interface with a local-only implementation (no config) used in tests and as the
fallback; the Firestore implementation is behind `import()` so the bundle without a configured family space never loads Firebase.
Local mode keeps today's autosave/versions/share-link behaviour.

Links: the family link (`#f=`) is THE link to send; `#p=<proposalId>` deep-links a proposal; the old `#d=` delta links still work
(import as a new proposal). "Send forslaget" uses `navigator.share` with the deep link, else copies it. PWA: `registerType: 'prompt'`,
`injectRegister: false`, `useRegisterSW` toast "Ny versjon av appen er klar. [Oppdater]" (save first, never auto-reload); too-new notices
call `registration.update()`; hourly and `visibilitychange` checks; `controllerchange` notice; workbox `globPatterns
['**/*.{js,css,html,svg,woff2,png,webmanifest}']`, `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`; PNG icons
180/192/512 committed; `apple-touch-icon`; Vite `base` `/hytte-planlegger/` in production, `/` in dev; `navigator.storage.persist()`;
iOS home-screen card. First-run card: "Trykk på et rom, en vegg eller et møbel for å se målene. Dra det du har valgt for å flytte det." /
"Forslag D er grunnlaget og kan ikke endres. Lag et nytt forslag, så kan du flytte vegger, dører, vinduer og møbler – og angre alt med
Angre." / "Alt lagres automatisk og deles med familien. Trykk «Send forslaget» for å sende lenken."
Setup guide for Robin: `docs/firebase-oppsett.md` (create project → Firestore in production mode → Authentication → Anonymous →
web app config → paste into `src/state/firebaseConfig.ts` → deploy rules from `firestore.rules` with the console or `firebase deploy`).

## 6. UI changes

Top bar: "Forslag: <navn> ▾" list (Forslag D first, then the family's proposals with "sist endret av … "), "+ Nytt forslag", status pill,
"Send forslaget", Hjelp, Mer (Tidligere versjoner, Papirkurv, Lagre som fil, Åpne fil, Eksporter JSON). Toolbar + hint line; plan is the
default view on desktop; Egenskaper on top of the right column; phone: toolbar pinned, properties/library as bottom sheets, floating
mini-bar on the selection. Read-only applies only to Forslag D (toolbar greyed, "Nytt forslag" primary).

## 7. Done when

- On a PC and on an iPhone, a family member can open the family link, see Forslag D and everyone's proposals, create "Mitt forslag",
  move an existing door and window of the old cabin (ghosts appear in "Vis hva som er nytt"), draw a hallway wall and name the rooms,
  remove a wall between two bedrooms (rooms merge, areas update), set a room's dybde to 2,40 by typing, place a Vedskjul on the terrace
  (deck and railing adapt) and later attach it to the wing, move the hot tub, furnish the bathroom with clearance zones, save
  automatically, see the change appear on another device, delete a proposal with two confirmations and restore it from Papirkurv, work
  offline and sync later; Forslag D itself never changes.
- Tests: snapping; drag rules; status bookkeeping and ghosts (incl. "Ta tilbake"); parts/BYA under block edits; reconcileRooms; deck
  trimming/free runs/railing/steps; migration v1 → v2; furniture; familyStore (local implementation + a fake Firestore adapter: save,
  list, delete/restore, revisions, conflict guard); Playwright desktop + iPhone (touch) projects + pwa project (offline reload).

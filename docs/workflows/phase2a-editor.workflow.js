export const meta = {
  name: 'phase2a-editor',
  description: 'Phase 2a of the cabin planner: schema v2 + deck/railing model, then the editor (status ghosts, snapping, drags, units, properties, toolbar, phone), integrate and verify',
  phases: [
    { title: 'Schema', detail: 'schema v2, migration, deck free runs, derived additions, memo split (sequential, keeps the tree green)' },
    { title: 'Build', detail: 'editor core, plan editing UI, properties/toolbar UI, 3D selection (parallel)' },
    { title: 'Integrate', detail: 'wire, tests, e2e (desktop + iPhone touch), screenshots, STATUS, commits' },
    { title: 'Verify', detail: 'editor-behaviour reviewer, family-UX reviewer' },
  ],
}

const REPO = 'C:\\Users\\robin\\Projects\\hytte-planlegger'
const ONEDRIVE = 'C:\\Users\\robin\\OneDrive\\Byggeprosjekt hytte'

const COMMON = `You are an engineer on phase 2 of a cabin-planner web app. Repository: ${REPO} (Vite 8 + React 19 + TypeScript 6 strict,
\`verbatimModuleSyntax\` → \`import type\`, no enums; zustand + zundo + immer; polygon-clipping; vitest; Playwright). Work on the current branch.
READ FIRST, completely: docs/phase2-plan.md (revision 3 — THE contract for this phase; follow its section numbers; note that the ORIGINAL CABIN IS
EDITABLE, only the Forslag D base proposal is locked, and existing elements that are moved/deleted leave "removed" ghosts), docs/architecture.md
(phase-1 conventions), src/model/types.ts, src/model/derived.ts, STATUS.md. Reference material under ${ONEDRIVE} is read-only; never modify it.
Rules: only create/modify files in your OWNERSHIP list (read anything); no package.json/vite.config/tsconfig edits unless your task says so;
no git commands; no dev server (the integrator runs Playwright); vitest is fine. English code/comments; every user-visible string in
src/i18n/nb.ts (owned by the UI engineer — if you need a string, add it to a local strings file in your folder and name it in your report).
Keep YOUR files typecheck-clean (\`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "src/(<your dirs>)"\` prints nothing) and tested.
Where the plan is silent, choose the simplest correct behaviour and document it in a header comment.
FINAL REPORT (plain text, <= 60 lines): files, public API actually implemented (deviations from the plan and why), strings needed in nb.ts,
known gaps, what the integrator must do.`

// ---------------------------------------------------------------------------
phase('Schema')
const schema = await agent(`${COMMON}

TASK (sequential; everyone else waits for you — keep the WHOLE tree green at the end: \`npm run typecheck\`, \`npm run lint\`, \`npm test\`,
\`npm run build\`). OWNERSHIP for this task: src/model/types.ts, src/model/derived.ts, src/model/migrate.ts (+tests), src/model/seed/**,
src/geometry/** (derive.ts, outdoor.ts, walls.ts, areas.ts, terrain.ts, new files), src/state/persistence.ts (+tests), and the minimal
consumer edits needed to compile (plan2d/view3d/ui fixtures and renderers that read railings/steps/deck polygons — change only what the
schema change forces, keep behaviour).
Implement docs/phase2-plan.md §2 exactly:
1. Schema v2 types (Deck with DeckVertex ids, railing, noRailingEdges, DeckSteps hosted by edgeId/offset; Outdoor without railings;
   Block.template/templateFrontEdgeId/floorMaterial; Variant.notes/locked/meta and the optional \`ghosts\` list from §3.4; FurnitureItem.size
   required; CURRENT_SCHEMA_VERSION = 2).
2. Frozen schema-1 seed: write src/model/seed/frozen/forslagD.schema1.json from the CURRENT createForslagD() BEFORE changing the seed
   (a script under scripts/ may generate it; commit the JSON). decodeDeltaPayload uses it as the base when raw.v < CURRENT.
3. toV2 migration, field-wise idempotent as specified; autosave backup key 'hytte-planlegger:project.backup-v1' before the first write of an
   older project; OUTDOOR_COLLECTIONS = ['decks','hotTubs']; remove the seedRevision early return in sharePayloadJson; tests listed in §2.
4. Seed: convert the Forslag D deck to v2 (vertex ids, railing glass 1.05, steps hosted on edges with the same gap centres/widths as today,
   noRailingEdges []), set \`locked: true\` on the bundled Forslag D variant (and make duplicateVariant produce an unlocked copy), SEED_REVISION
   3 → 4; keep all existing seed tests green (adjust expectations only where the model changed).
5. Derived additions (§2 "Derived additions"): DerivedDeck pieces/vertexIds/freeRuns (free runs = intervals of trimmed ring edges not
   overlapping any block outer edge within 1 mm, inheriting the stored edge id), DerivedRailing per deck (id \`\${deckId}/railing\`, panels =
   free runs − noRailingEdges − step gaps, chained, posts at corners/run ends/≤ 1.5 m), outdoor.steps (DeckSteps projected on their own edge;
   'deck-steps-blocked' when the centre is not on a free run), DerivedBlock.junctions, WallSource s0/s1 for block-edge pieces, DerivedWall.isGhost
   and DerivedOpening.isGhost + levelId (ghosts = status removed: excluded from room detection, areas, 3D; kept for the plan), DerivedVariant.locked,
   exported levelAt(derived, storeyId, p), new ModelWarning kinds (furniture ones may be declared now, produced later). Implicit remainder of a
   block with explicit parts is isNew: true.
6. Derive memo split (§2 last paragraph): building / outdoor / furniture stages memoised on sub-collection identities; the furniture stage
   may be a placeholder that passes items through with footprint = rotated size rectangle; tests: two variants differing only in furniture
   share walls/rooms array instances; perf test (block-edge change ≤ 60 ms, furniture-only ≤ 5 ms on this machine, generous CI margin).
7. Renderers: plan OutdoorLayer and view3d Outdoor read deck \`pieces\`, railings and outdoor.steps from the new places; BYA decks use pieces;
   the plan draws ghosts dashed when highlightNew is on (simple version; the plan engineer refines).
8. Update docs/architecture.md where the contracts changed (Deck/railing/steps, locked variant, ghosts, memo split, new derived fields).
Confirm with the seed: the terrace still has its glass railing and three stairs, the deck still starts at x 9, BYA unchanged (235.5), 27 rooms,
no warnings. Report the final test count.`, { label: 'schema-v2', phase: 'Schema', model: 'opus' })

// ---------------------------------------------------------------------------
phase('Build')
const EDIT_API = `The editing API everyone codes against (names from docs/phase2-plan.md §3.6; the editor-core engineer implements them in
src/state/editActions.ts as functions taking the store, e.g. \`moveWall(store, id, delta)\`, and exports a hook \`useEditActions()\` returning bound
versions; pure geometry in src/geometry/edit.ts and src/geometry/snap.ts):
  isLocked(variant: Variant): boolean                   // variant.locked === true (Forslag D base) — the ONLY lock
  touchExisting(draft: Variant, id: Id): void          // status bookkeeping: existing → new + removed ghost (idempotent per transaction)
  snap(ctx: SnapContext, p: Vec2, opts): SnapResult    // SnapContext built once per drag from derived; SnapResult { point, indicators, chips }
  transactionBase(): Project | null                    // store addition
  Walls: addWall, moveWall, moveWallEndpoint, splitWall, deleteWall, setWallProps, restoreGhost
  Blocks: moveBlockEdge, moveBlockVertex, moveBlock, placeUnit, deleteBlock, setBlockProps, duplicateBlock
  Openings: addOpening, moveOpening, setOpeningProps, deleteOpening
  Rooms: nameFace, setRoomProps, deleteRoom, resizeRoom
  Deck: moveDeckVertex, moveDeckEdge, insertDeckVertex, deleteDeckVertex, setDeckProps, toggleRailingEdge, addSteps, moveSteps, deleteSteps
  Other: moveHotTub, setHotTubDiameter, addTree, moveTree, deleteTree, setVariantNotes, nudge(selection, dx, dy)
  Furniture (phase 2b implements the bodies; declare signatures now): addFurniture, moveFurniture, rotateFurniture, setFurnitureProps, duplicateFurniture, deleteFurniture
  Drag protocol (plan2d → actions): beginDrag(selection, pointerPlan) → DragSession { kind, base, snapCtx }; updateDrag(session, pointerPlan, modifiers) → applies from base and returns { indicators, chips, ghost }; endDrag(session) commits; cancelDrag(session).
UI state additions (store): ui.tool: 'select'|'wall'|'opening'|'unit'|'furniture'|'measure'; ui.toolOptions: { openingType?, unitTemplate?, furnitureItem? };
ui.showClearances: boolean; ui.hint: string | null; toasts: { id, text, undo?: boolean }[] with showToast/dismissToast.
Selection kinds: existing ones + 'deckVertex' | 'deckEdge' | 'steps' | 'ghost'; 'railing' resolves by \`\${deckId}/railing\`.`

const SCHEMA_REPORT = `SCHEMA ENGINEER'S REPORT (the tree is green at this point):\n${schema}`

const [core, planUi, propsUi, view3d] = await Promise.all([
  agent(`${COMMON}

${SCHEMA_REPORT}

${EDIT_API}

TASK: editor core. OWNERSHIP: src/geometry/edit.ts, src/geometry/snap.ts, src/geometry/*.test.ts for them, src/model/unitTemplates.ts,
src/state/editActions.ts (+tests), src/state/store.ts additions (transactionBase, ui.tool/toolOptions/showClearances/hint, toasts, Selection kinds),
src/state/selection.ts. Implement docs/phase2-plan.md §1 (variant lock), §3.3 (snapping), §3.4 (status bookkeeping/ghosts, parts stay fixed and the
remainder is new, rectangle-preserving corner handles, junction partner follows, collinear walls translate), §3.5 (all drag rules incl. supports
classification, opening clamps/re-host/re-offset on both adjacent edges, deck ops, unit placement with templates Vedskjul 2×1.5 open front / Bod 2×3 /
Badstue 2.4×2.2 / Anneks 4×3 / Eget bygg 3×3, reconcileRooms, transactions from base, nudges), §3.6 (every action with its cascades and the locked-variant
refusal via toast), §3.7 resizeRoom semantics.
Tests are mandatory for: no action changes a locked variant; the §3.4 tests (16→18→16 keeps BYA existing 102.18; old west gable 0 → −1 adds 6.2 m² new and
keeps existing; deleting w-104-103 makes a ghost, merges rooms, restoreGhost brings both back); moving an existing door → status new + ghost at the old
place; the §3.5 wall tests (w-sauna-n +0.3 leaves w-wing-w intact and 27 rooms named; dv-stue-n drag leaves dv-kjk-w); opening re-offset after a vertex
move (door-mellom-vf keeps its plan position); re-host swing preservation; reconcileRooms (shrink past an anchor, merge by deleting a wall, split →
nameFace); placeUnit on the deck (deck pieces lose the footprint, railing regenerates, a junction forms when touching the wing); moveBlock carrying
walls/rooms/furniture; deleteBlock cascades and the refusal for existing blocks; splitWall re-hosting; deck vertex insert/delete re-hosting steps;
nudge = one undo step. Use the real seed (createForslagD, then duplicateVariant to get an unlocked copy) in tests.`, { label: 'editor-core', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${SCHEMA_REPORT}

${EDIT_API}

TASK: plan editing UI. OWNERSHIP: src/plan2d/** (PlanView edit props and overlay, handles, gestures, ghost outlines, snap indicators, dimension
chips, legend, removed-ghost rendering, deck handles with "+" midpoints, tool interactions, measure tool, phone mini-bar hooks, tests). Implement §3.1
gestures exactly (tap selects; drag the SELECTED element/handles moves; else pan; thresholds; handle sizes; hit corridors; no HTML5 DnD;
Esc/pointercancel cancel), §3.2 tool behaviours on the plan side (Vegg two clicks; Dør/vindu click on wall/edge with the chosen type; Nytt bygg ghost +
click; Mål two points; tools return to Velg after placement), §3.4 visibility (legend "Hytta i dag" / "Nytt" / "Fjernet", dashed ghosts selectable
with kind 'ghost'), the furniture layer hooks for phase 2b (FurnitureLayer renders DerivedFurniture footprints as simple rectangles with the catalogue
name for now; drop target via prop onDropFurniture(catalogId, planPoint)), and the "Avstand fra hjørne" temporary dimension when asked via a prop.
PlanViewProps += editable, tool, toolOptions, editActions (the bound API), showClearances, overlay state, onSelectionBar (phone mini-bar anchor in
screen px); keep the phase-1 props working for the locked base proposal. Tests: jsdom pointer-event tests for pan-vs-drag (pan across a wall moves
nothing; select then drag moves), handle hit sizes under coarse pointer, Vegg two-click flow, Esc cancel. If editActions are not finished when you
test, use a minimal mock implementing the DragSession protocol.`, { label: 'plan-edit-ui', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${SCHEMA_REPORT}

${EDIT_API}

TASK: toolbar, hint line, properties panel, dialogs, wording, phone sheets. OWNERSHIP: src/ui/** (Toolbar.tsx, HintLine.tsx, PropertiesPanel and
its per-kind editors, NumberField.tsx, dialogs/toasts components, FirstRunCard.tsx, BottomSheet.tsx, SelectionMiniBar.tsx, Help updates, layout
changes), src/i18n/nb.ts, src/App.tsx, theme.css. Implement §3.2 (toolbar with Angre/Gjør om, hint texts, library placeholder slot replacing the
left column when tool === 'furniture'), §3.7 (every kind, basic | Mer, action buttons, number-field rules, room size fields with the wall highlight
callback and the switch, "Avstand fra hjørne", ghost → "Ta tilbake"), §1 rule 1 behaviour for the locked base proposal (toolbar greyed, toast with
"Nytt forslag" button that duplicates the variant and switches to it), "Vis hva som er nytt" renamed and ON by default, Egenskaper on top of the right
column, delete toasts with [Angre], the first-run card (§5 bullets), the pure-UI wording changes (Variant → "Forslag" in the top bar, "+ Nytt forslag",
"Send forslaget" label keeping today's link behaviour — the shared store comes in phase 2b), Hjelp with tools/gestures/shortcuts, phone layout
(toolbar scrolls with Velg pinned; properties and library as bottom sheets; floating mini-bar Egenskaper · Roter · Slett above the selection).
Add all strings to nb.ts. Tests: panel rendering per selection kind with the real seed derived model, NumberField parsing/commit rules, room size
field choosing the right wall (mock actions), toolbar tool switching, locked-base toast.`, { label: 'props-toolbar-ui', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${SCHEMA_REPORT}

TASK: 3D view editing hooks. OWNERSHIP: src/view3d/**. (1) Click selection in 3D for walls (→ 'wall' or 'blockEdge' via DerivedWall.source),
openings, rooms (floors), decks, deck steps, hot tub, blocks (roof click → block), with a selection highlight (outline/emissive) and a drag
threshold so orbiting never selects. (2) Render the new outdoor model (railings per deck, outdoor.steps, deck pieces) and ceilings; ghosts are never
rendered; nothing regresses vs phase 1. (3) Performance: split the scene into building / outdoor / furniture groups keyed on the derived sub-objects
so a furniture or deck change does not rebuild walls. (4) Drop target for phase 2b: View3D prop onDropFurniture(catalogId, planPoint) resolved by
raycasting the pointer onto floors/decks/terrain. (5) No dragging in 3D in this phase. Tests: selection mapping helpers, group memo keys, drop raycast
math with the fixture.`, { label: 'view3d-select', phase: 'Build', model: 'opus' }),
])

// ---------------------------------------------------------------------------
phase('Integrate')
const integration = await agent(`You are the INTEGRATOR of phase 2a on ${REPO}. You may edit any file. Read docs/phase2-plan.md (revision 3),
docs/architecture.md, STATUS.md, then these reports:

SCHEMA:\n${schema}\n\nEDITOR CORE:\n${core}\n\nPLAN EDIT UI:\n${planUi}\n\nPROPS/TOOLBAR UI:\n${propsUi}\n\nVIEW3D:\n${view3d}

Do, in order:
1. Wire everything: PlanView edit props from the store (tool, toolOptions, editActions, overlay), toolbar/hint/properties to actions, 3D selection,
   toasts, bottom sheets; add missing nb.ts strings; \`npm run typecheck\`, \`npm run lint\`, \`npm test\` green.
2. Playwright (desktop project, starting from a fresh "Nytt forslag" copy of Forslag D): (a) select the wing's east exterior wall, drag it 1 m east →
   the wing follows, room areas change, no 'generic' warnings; (b) Nytt bygg → Vedskjul placed on the terrace at about (14, 9) → deck pieces exclude
   it and a railing gap appears; move it 1 m; attach it to the wing's north wall; (c) Vegg: draw a partition across Soverom (ny fløy) → one room keeps
   its name, the other shows "Gi navn"; name it; (d) set Soverom (ny fløy) dybde to 2,40 via the properties field → w-gang-n moves; (e) move the
   EXISTING door-mellom-vf 0.5 m → it turns new and a dashed ghost remains; "Ta tilbake" restores it; (f) delete the existing wall w-104-103 → the
   two rooms merge, ghost shown, undo restores; (g) on Forslag D itself every edit is refused with the toast; (h) move the hot tub.
   Add an iPhone project (devices['iPhone 13'], hasTouch): open the app, create "Nytt forslag", pan across the plan (nothing moves), tap a new wall
   and drag it, open the properties bottom sheet and change a number, tap-place a door. Screenshots: plan-editing.png (handles visible),
   plan-unit-on-deck.png, plan-ghosts.png, phone-edit.png, phone-sheet.png.
3. \`npm run build\`, \`npm run e2e\`; READ every screenshot; fix what is wrong (max 6 iterations).
4. STATUS.md (Gjort / Neste / Kjente problemer for phase 2a), architecture.md where behaviour changed, README (new tools in short).
5. Commit in logical commits (English, imperative), each ending with
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Do NOT push.
FINAL REPORT: test counts, what works end to end, open issues.`, { label: 'integrate-2a', phase: 'Integrate', model: 'opus' })

// ---------------------------------------------------------------------------
phase('Verify')
const VERIFY_SCHEMA = { type: 'object', properties: {
  summary: { type: 'string' }, resolved: { type: 'array', items: { type: 'string' } },
  findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, area: { type: 'string' }, file: { type: 'string' },
    problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['severity', 'area', 'file', 'problem', 'evidence', 'fix'] } } },
  required: ['summary', 'resolved', 'findings'] }
const VCOMMON = `You are reviewing phase 2a of ${REPO} after integration. Read docs/phase2-plan.md (revision 3) and STATUS.md. Integrator's report:\n${integration}\n
You may run tests/scripts/Playwright and read anything; do NOT modify repository files (temporary scripts under tmp-review/, deleted afterwards);
do not commit. Report verified findings with evidence; list which plan requirements (§7 "Done when") you confirmed.`
const verifiers = await parallel([
  () => agent(`${VCOMMON}\nLENS: editor behaviour. Drive the app with Playwright and scripts: every §3.4/§3.5 rule, status bookkeeping and ghosts
(move/resize/delete existing walls, openings and block edges; Ta tilbake; undo), the base proposal lock (try every edit path on Forslag D), re-offset of
openings, reconcileRooms, deck adaptation to units (free and attached), undo granularity (one step per drag/nudge run), performance during drags
(measure derive time per frame), BYA existing/new after edits of the old cabin.`, { label: 'verify:editor', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }),
  () => agent(`${VCOMMON}\nLENS: family usability on PC and iPhone. Use the app as a first-time family member on a laptop and (Playwright iPhone 13,
hasTouch) on a phone: create a proposal, move a door of the old cabin, place a woodshed, move a wall, add a door, name a room, resize a room by typing,
delete a wall, undo a mistake, read the hint line, understand what "Fjernet" ghosts are. Check every Norwegian string in nb.ts added this phase for
clarity and consistency; check the properties panel basic/Mer split, number fields, bottom sheets, the mini-bar.`, { label: 'verify:ux', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }),
])
return { integration, verifiers: verifiers.filter(Boolean) }

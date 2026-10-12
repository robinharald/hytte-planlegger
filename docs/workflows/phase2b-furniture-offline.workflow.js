export const meta = {
  name: 'phase2b-furniture-shared',
  description: 'Phase 2b of the cabin planner: furniture catalogue, 2D/3D furniture, placement and collisions, seed furnishing; shared family proposals (Firestore) with offline PWA; editor polish from the round-2 review; integrate and verify',
  phases: [
    { title: 'Build', detail: 'catalogue+derive, 2D library+symbols, 3D models+drop, shared store + proposals UI + PWA, editor polish core, editor polish plan (parallel)' },
    { title: 'Integrate', detail: 'wire, tests, e2e incl. iPhone and pwa projects, screenshots, STATUS, commits' },
    { title: 'Verify', detail: 'furniture reviewer, shared-store/offline reviewer, editor reviewer' },
  ],
}

const REPO = 'C:\\Users\\robin\\Projects\\hytte-planlegger'
const ONEDRIVE = 'C:\\Users\\robin\\OneDrive\\Byggeprosjekt hytte'
const SCRATCH = 'C:\\Users\\robin\\AppData\\Local\\Temp\\claude\\C--Users-robin-OneDrive-Byggeprosjekt-hytte\\d513db0c-a94e-497a-9149-c624ff62ac76\\scratchpad'
const FIX2_FINDINGS = SCRATCH + '\\fix2-findings.txt'

const COMMON = `You are an engineer on phase 2b of a cabin-planner web app. Repository: ${REPO} (Vite 8 + React 19 + TypeScript 6 strict,
\`verbatimModuleSyntax\` → \`import type\`, no enums; zustand + zundo + immer; vitest; Playwright; vite-plugin-pwa 2 and firebase 13 installed).
Phase 2a (editor) and two fix rounds are integrated and green (1245 tests, 31 e2e) — read STATUS.md «Fase 2a», «Fikserunde 2a» and «Fikserunde 2a,
runde 2» first: trees are per proposal (\`Variant.trees\`, copy-on-write, helper \`treesOf\`), PlanView has \`viewportInsets\` for bottom sheets, undo
toasts bind to their history entry, the plan highlights new parts while 3D has its own switch (highlightNew3d, default off), SEED_REVISION is 5,
openings are their own derive stage, the touch hit band is 0.25 m clamped to 10–24 px, snapping reaches at most 0.25 m and never takes back more
than half a drag. READ FIRST, completely: docs/phase2-plan.md revision 3 (§4 furniture, §5 shared proposals/offline, §3.6 Edit API),
docs/architecture.md, src/model/types.ts, src/model/derived.ts, src/state/editActions.ts, STATUS.md. Reference material under ${ONEDRIVE} is
read-only. Rules: SIX engineers edit this same checkout at the same time — only create/modify files in your OWNERSHIP list (read anything), use
targeted edits (never rewrite or reformat a shared file, never convert line endings — the repo is LF), no git commands, no dev server; vitest is fine
(run your own test files plus \`npx tsc --noEmit -p tsconfig.app.json\` filtered to your dirs). English code, Norwegian UI strings in src/i18n/nb.ts
(owned by the shared-store engineer in this round — name needed strings in your report and keep a local strings file meanwhile). Keep YOUR files
typecheck-clean and tested; every behaviour change gets a test.
FINAL REPORT (plain text, <= 60 lines): files, API implemented, deviations, strings needed, known gaps, what the integrator must do.`

const CATALOG_IDS = `Catalogue ids (append-only; use exactly these): seng-90, seng-120, seng-150, seng-180, koyeseng, nattbord, garderobeskap, kommode,
sofa-2, sofa-3, hjornesofa, lenestol, salongbord, teppe, tv-benk, bokhylle, vedovn, benkeskap, overskap, hoyskap, kjoleskap, kjokkenoy, spisebord-4,
spisebord-6, spisebord-8, stol, toalett, servant, dusj-80, dusj-90, dusj-100, dusjvegg, badekar, vaskemaskin, torketrommel, vaskesoyle, handkletorker,
sluk, varmtvannsbereder, badstubenk, badstuovn, hylle, skohylle, benk, skistativ, vedstabel, loungesofa, utebord, utestol, grill.`

const PREVIEW_API = `Drag preview contract (agreed between the editor-polish engineers): src/state/editActions.ts exports
\`previewDrag(session, pointerPlan, modifiers): { indicators, chips, ghost }\` — the cheap part of updateDrag (snap + the dragged element's target
geometry for the overlay), no store change, no derive, ≤ 2 ms. The plan calls previewDrag on every frame and updateDrag at most every T ms, where
T = clamp(2 × the last updateDrag duration, 16, 150) measured with performance.now(), and always runs a final updateDrag before endDrag.`

phase('Build')
const [catalog, library2d, models3d, shared, polishCore, polishPlan] = await Promise.all([
  agent(`${COMMON}

${CATALOG_IDS}

TASK: furniture catalogue, derive stage, collisions, seed furnishing, furniture actions. OWNERSHIP: src/furniture/catalog.ts (+test), src/geometry/
furnitureDerive.ts (+test) wired into the existing furniture stage of src/geometry/derive.ts (edit only that stage), src/state/editActions.ts
furniture action BODIES ONLY (addFurniture with size from the preset and levelId via levelAt, moveFurniture/rotateFurniture/duplicate/delete/setProps,
items following a moved wall face; all refuse a locked variant — another engineer edits restoreGhost/placeUnit/rotateBlock/the drag protocol in the
same file at the same time: targeted edits only), src/model/seed/furniture.ts (+test) and a SEED_REVISION bump 5 → 6 in forslagD.ts.
Implement §4 exactly (unchanged from revision 2): FurnitureCatalogItem fields (sizes, stretch, clearance, snap, mount, elevation, needsDrain, symbol,
model), the item list with realistic Norwegian names and sizes, DerivedFurniture (footprint, bbox, levelId, roomId, floorZ, z, clearances, collisions,
blocksDoors, needsDrain), collision rules (same level, z-range overlap, not 'flat', walls by levelIds, doors by level, stairs/chimney/posts/hot tub,
separating-axis tests, 5 mm tolerance), warnings, unknown-id fallback. Seed furnishing ported from the old model's buildD150() in
${ONEDRIVE}\\3d-planlegger\\reference\\forrige-modell-v16.html (beds, kitchen counter + tall units + island, dining table + chairs, sofa group + stove,
leseskrok chairs + table + shelf, toilets back-to-back at x 18.6, sinks, washer tower, shower, sauna benches + stove, wardrobe, pantry shelves, bod
shelves, water heater, log stack, outdoor lounge + table + chairs) with stable ids, backs snapped to inner faces within 0.15 m, lower-level items on
'lower', the lower-bathroom toilet facing the room. Tests: catalogue invariants, collisions (overlap, in-wall, door-blocked, wall-mounted vs base
cabinet no collision, rug under sofa no collision), seed: createForslagD() twice identical, every item in a room of its level or on the deck, no
furniture warnings, 27 rooms unchanged, derive furniture-only change ≤ 5 ms.`, { label: 'furniture-core', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${CATALOG_IDS}

TASK: furniture in the plan and the library panel. OWNERSHIP: src/plan2d/layers/FurnitureLayer.tsx (+symbols module), src/ui/FurnitureLibrary.tsx
(+styles), src/ui/properties/FurnitureProps.tsx, their tests; PlanView.tsx only for the drop/tap-place hand-off (targeted edit — another engineer
edits src/plan2d/editModel.ts, usePlanEditing.ts, OpeningLayer.tsx and LabelLayer.tsx at the same time). Implement §3.2 library behaviour (replaces the
left column when the Møbler tool is active; categories as an accordion with Norwegian names; search box; items show a small symbol + name + default
size; TAP places in the selected room else the plan centre, pushed to the nearest free wall per the snap rule; drag into the plan with pointer events,
no HTML5 DnD; on phones the library is a bottom sheet using the same BottomSheet component and the same \`viewportInsets\` hand-off to PlanView as
Egenskaper does), §4 2D symbols (recognisable: bed with pillow and duvet line, bunk bed, wardrobe with door lines, sofa with cushions, armchair,
tables with chairs, kitchen cabinets with counter line, fridge, toilet, sink, shower with glass lines, bathtub, washer/dryer circles, stove, sauna
benches, shelves, outdoor lounge, grill), clearance zones as faint hatched areas when ui.showClearances, selection/rotation handle (rotate handle on
the front edge), collision outline in red, drop handling through PlanView's onDropFurniture prop → addFurniture, and the Møbel properties editor
(Navn, Størrelse / Bredde/Dybde when stretchable, Farge, Roter 90°, Dupliser, Slett, Rom read-only). Furniture hit areas sit above room labels and
below walls/openings. Tests: symbol registry covers every catalogue id, tap-to-place math, library filtering.`, { label: 'furniture-2d', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${CATALOG_IDS}

TASK: furniture in 3D. OWNERSHIP: src/view3d/Furniture.tsx, src/view3d/furnitureBuilders.ts (+test), src/view3d/materials.ts additions.
Build simple, recognisable parametric models for every catalogue id in the old model's look (${ONEDRIVE}\\3d-planlegger\\reference\\forrige-modell-v16.html:
bed() with frame/mattress/duvet colours, toilet(), chair(), counters with tops, sofa blocks, stove with pipe, sauna benches, water surface for the
bathtub, logs texture for vedstabel, white porcelain, metal), scaled by DerivedFurniture size, placed at z = floorZ + elevation, rotated by rotationDeg
(plan frame → three.js via toWorld), selectable by click (Selection kind 'furniture'), highlight when selected, red tint when colliding, visible per
storey in interior mode, and the 3D drop (View3D.onDropFurniture already resolves the point) — nothing else in view3d changes. Instanced or merged where
cheap (chairs). Tests: every catalogue id has a builder; builders return finite bounds matching size within 5 %; rotation mapping.`, { label: 'furniture-3d', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

TASK: shared family proposals, saving, offline PWA. OWNERSHIP: src/state/familyStore.ts (+ familyStore.local.ts, familyStore.firestore.ts, tests with a
fake adapter), src/state/persistence.ts (+tests) and appStore/link flow, src/ui/ProposalsMenu.tsx, src/ui/ShareDialog.tsx,
src/ui/StatusPill.tsx, src/ui/TrashPanel.tsx, src/ui/RevisionsPanel.tsx, src/ui/UpdateToast.tsx, src/ui/InstallCard.tsx, src/ui/TopBar.tsx edits,
src/ui/FirstRunCard.tsx, src/i18n/nb.ts, vite.config.ts (PWA plugin + base), index.html (manifest/apple-touch-icon), public/ icons (generate 180/192/512
PNGs from public/favicon.svg with a one-off node script using sharp if present in node_modules, else write them with a tiny PNG encoder; commit the
PNGs), playwright.config.ts (keep the existing projects 'chromium' and 'iphone' with their test filters against the dev server on 5173; ADD a 'pwa'
project that runs \`npm run build && npx vite preview --port 4173 --strictPort\` with the matching baseURL), e2e/offline.spec.ts, e2e/proposals.spec.ts.
FIREBASE IS ALREADY SET UP: src/state/firebaseConfig.ts holds Robin's real project config (do not edit it; the \`null\` → local-only path must keep
working for tests and forks), and firestore.rules is ALREADY PUBLISHED in his Firebase project exactly as the file reads (anonymous signed-in users
may read/write /families/{familyId}/** when the id is 24–64 chars; everything else denied). Fit your document layout under /families/{familyId}/...
to those rules. Do not change firestore.rules unless unavoidable; if you do, say so IN CAPITALS in your report because Robin must publish the new
rules by hand. You may probe the real Firestore from Node or Playwright with a throwaway family id (≥ 24 random chars, prefix 'e2e-') and must
delete everything you created; never touch other families. The vite base is currently './' (relative) and .github/workflows/deploy.yml only
uploads dist to GitHub Pages at https://robinharald.github.io/hytte-planlegger/: either keep the relative base if the manifest scope/start_url
and the service-worker registration work with it, or switch to '/hytte-planlegger/' in production and '/' in dev as the plan says — the Pages
site, \`npm run dev\` and the existing e2e projects must all keep working.
Implement §5 exactly: the FamilyStore interface (listProposals (live subscription), getProposal, saveProposal (debounced autosave with the conflict
guard "«X» ble endret av Pappa … [Hent endringene] [Lagre over]"), createProposal (copy of Forslag D or another), renameProposal, deleteProposal
(soft, Papirkurv 30 days), restoreProposal, listRevisions/restoreRevision (max 20, ≤ 1 per 5 min), whoAmI name prompt stored locally); the local
implementation (localStorage, used when no config and in tests) and the Firestore implementation (anonymous auth, enablePersistence/IndexedDB cache,
dynamic import so the bundle without config never loads Firebase, family id from \`#f=\` or generated once and shown in the share dialog);
the proposals menu in the top bar (Forslag D first and locked; others with "sist endret av … "), "+ Nytt forslag", status pill texts, "Send forslaget"
(navigator.share with the family deep link, fallback copy, both links labelled), Papirkurv, Tidligere versjoner under Mer, the old \`#d=\` links imported
as a new proposal, first-run card texts that are TRUE for the running mode (shared: "Alt lagres automatisk i familiens delte plass …"; local-only:
"Alt lagres automatisk på denne enheten. Trykk «Send forslaget» for å dele …"), navigator.storage.persist(), iOS home-screen card, PWA per §5
(registerType 'prompt', injectRegister false, useRegisterSW toast "Ny versjon av appen er klar. [Oppdater]" saving first, too-new notices wired to
update, hourly/visibilitychange checks, controllerchange notice, workbox globPatterns/navigateFallback/cleanupOutdatedCaches, base as decided
above). docs/firebase-oppsett.md: keep it in sync with what the code expects (it already describes the finished setup; add the family-link format
and what the status pill texts mean). The proposal document must carry the whole Variant incl. \`trees\` and \`ghosts\`. Privacy: write nothing but the
proposal data, the chosen display name and timestamps — no e-mail, device name, user agent or location. Tests: familyStore local + fake Firestore
adapter (save/list/delete/restore/revisions/conflict), persistence, Playwright proposals flow (create, edit, rename, delete with two confirmations,
restore from Papirkurv — local mode) and offline (service worker controlling → offline → reload → ready, fonts loaded).`, { label: 'shared-store-offline', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${PREVIEW_API}

TASK: editor polish, core side — the leftovers of the second review, read ${FIX2_FINDINGS} in full (your items are the ones below).
OWNERSHIP: src/geometry/edit.ts, src/geometry/snap.ts, src/geometry/walls.ts, src/state/editActions.ts ONLY these functions: restoreGhost,
placeUnit, rotateBlock, the drag protocol (beginDrag/updateDrag/endDrag and the new previewDrag) and the SnapContext builder (the furniture
engineer edits the furniture action bodies in the same file at the same time — targeted edits only), their *.test.ts files.
1. [MAJOR] Junction/stub ghosts on an already-moved edge: addJunctionGhosts and addStubGhosts call notToday without the edge id, so a stretch
   that is not today's cabin gets a ghost; "Ta tilbake" on it then moves today's wall. Pass the edge id in both. Tests: main south +0.3 then glass
   east +0.5, Ta tilbake on every ghost in either order → seed with ghosts undefined; glass NE/NW corner dragged (x∓0.5, +0.3) likewise; glass
   south +0.3 then west +0.3 inward, first-ghost-first restores → seed; extend the corner test to all four glass corners.
2. [MAJOR] Attaching a placed unit on the phone: the 0.25 m cap also limits placement and contact reach. The placement ghost (Nytt bygg tap) gets
   the pointer radius back (12 px mouse / 24 px touch); for unit and block DRAGS, contact targets (block edges, deck edges) reach max(0.25 m, the
   touch drag threshold in metres at the current zoom), still never taking back more than half the drag. Tests at 11.6 px/m: a Vedskjul placed
   0.4 m from the wing's north wall attaches on the tap; a shed 0.4 m away attaches with one 1 m drag towards the wall without overlapping.
3. [MINOR] Inward-moved edges of today's cabin stay "Hytta i dag": a block-edge piece whose edge has a move ghost on another line is new whatever
   part it lies in (the movedEdgeId test). Test: glass south −0.5 → moved piece isNew true; blk-main west +1 inward likewise.
4. [MINOR] restoreGhost's parallelSame path cascades into untouched coincident ends: apply the same guard as endpointsBack (untouched(base)).
   Add ±0.7 / ±1 m moves and drag sessions (snap radius 0.49 m) to the Ta tilbake sweep.
5. [MINOR] pullBackOpenings: also heal when the host is back to the geometry it had when the ghost was recorded (same line and length), the ghost
   place fits and the opening is within 0.15 m of it; allow returns in several steps when the opening lies between its ghost and the end it was
   pressed against and the user has not moved it. Tests: the two-step block cases (blk-bod −0.5 then +0.25 +0.25 → door-green-e 0.69 existing) and
   the stored-wall cases (w-103-korr.a shortened past d-104 then restored → d-104 0.53 existing).
6. [MINOR] todayPart ignores the block's own edge ghosts: build today's outline from the ghost lines where present. Test: a part-less copy with an
   edge ghost at x 9 and the glass at 9.5 gets a today part ending at x 9 after any edit.
7. [MINOR] rotateBlock on a free unit off the 0.1 m grid drifts 5 cm per turn: keep the centre and the original grid phase so +90/−90 returns the
   footprint exactly. Test with a Vedskjul placed at (13, 9).
8. [MINOR] Endpoint drags: guide extensions overshoot the 0.25 m reach — apply the reach and the half-drag rules to the snapped point's
   displacement |snapped − raw|, and skip extensions of walls on other storeys. Test: w-do-109 end a dragged 0.5 m west lands within 0.25 m of
   the pointer.
9. [MINOR] Dragging w-103-korr straight south tilts it (west end slides along w-104-diag, east end pinned): carry the coincident ends at the pinned
   corner along so the wall stays parallel, or keep it parallel and refuse with the hint. Test: w-103-korr moved 0.5 m south stays axis-parallel.
10. previewDrag per the contract above, with a test that it matches updateDrag's overlay for a wall, an edge and a unit drag and costs ≤ 2 ms.`,
    { label: 'editor-polish-core', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${PREVIEW_API}

TASK: editor polish, plan side — the leftovers of the second review, read ${FIX2_FINDINGS} in full (your items are the ones below).
OWNERSHIP: src/plan2d/editModel.ts, src/plan2d/usePlanEditing.ts, src/plan2d/layers/OpeningLayer.tsx, src/plan2d/layers/LabelLayer.tsx, their tests,
src/ui/warnings.ts (+test). NOT FurnitureLayer.tsx and not PlanView.tsx (the furniture engineer edits those; if PlanView must change, describe the
exact edit in your report).
1. [PERF, most important for the iPhone] Adaptive drag: wall, edge, block and unit drags derive the whole building stage every frame (≈ 45 ms on a
   PC, ≈ 300 ms on a phone-class CPU). Implement the preview contract: previewDrag every frame (the dragged element's outline, chips and indicators
   follow the finger), updateDrag at most every T ms (T = clamp(2 × last updateDrag duration, 16, 150)), a final updateDrag before endDrag. The
   overlay must render from the preview without waiting for derive. Test with fake timers: with updateDrag stubbed to take 100 ms, 20 frames give
   ≤ 3 updateDrag calls and 20 previewDrag calls, and the last pointer position is committed.
2. [MINOR] Short moves on the phone: use a 6 px drag threshold for presses that start on the selected element's body or one of its handles (keep
   10 px for pans and taps elsewhere), so a 0.5 m shed nudge at the starting zoom moves it instead of switching the selection to its room.
3. [MINOR] Room label taps: the drawn label's hit rect beats the wall corridor except within a ±3 px core of the wall line, so «Bod (ny)» is
   tappable at the starting zoom; keep walls tappable at ±4 px. Test the decision function with the Bod (ny) geometry (label point 5.5 px from
   w-bod-ved).
4. [MINOR] Touch end handles on openings appear only from one handle diameter (28 px): show them from half a diameter on touch (they sit outside
   the jambs). Test: door-mellom-vf at 23 px/m on touch has end handles.
5. [MINOR] Ghost openings are hit-tested above live openings: put removed openings' hit areas below the live ones so a ghost wins only outside a
   live opening. Test: win-106-s over the door-106-old ghost — a click at its centre selects win-106-s; a click beside it selects the ghost.
6. [MINOR] Loose-wall warnings repeat or give no place: name a direction or a neighbour room ("på terrassen" when outside the buildings) and merge
   identical lines with a count. Strings via a local file for the integrator.`,
    { label: 'editor-polish-plan', phase: 'Build', model: 'opus' }),
])

phase('Integrate')
const integration = await agent(`You are the INTEGRATOR of phase 2b on ${REPO}. You may edit any file. Read docs/phase2-plan.md (revision 3), STATUS.md,
${FIX2_FINDINGS}, then:

FURNITURE CORE:\n${catalog}\n\nFURNITURE 2D:\n${library2d}\n\nFURNITURE 3D:\n${models3d}\n\nSHARED STORE / OFFLINE:\n${shared}\n\nEDITOR POLISH CORE:\n${polishCore}\n\nEDITOR POLISH PLAN:\n${polishPlan}

1. Wire: library ↔ tool 'furniture', drop → addFurniture, properties, 3D models, clearances toggle in Vis, proposals menu + status pill + share
   dialog + trash + revisions + update toast + install card, previewDrag in the plan, strings in nb.ts (incl. the polish engineers' local strings);
   typecheck/lint/tests green; the repo stays LF. Firebase IS configured (src/state/firebaseConfig.ts, rules published): with the config the pill
   must reach «Lagret for alle» after the anonymous sign-in and the first save; offline, or with the config set to null, it reads «Kun på denne
   enheten …» and everything else keeps working (keep that path tested). Verify against Robin's real Firestore in a browser with a throwaway family
   id (prefix 'e2e-', ≥ 24 chars): create a proposal in one browser context, open the same \`#f=\` link in a second context and see it, edit it there
   and see the change arrive in the first; then delete the throwaway family's documents. Unit tests and Playwright use the local/fake adapters only.
2. Playwright (desktop, iPhone, pwa; keep the existing 31 scenarios): tap-place a toilet in Hovedbad (clearance visible), drag it into the door swing
   → door-blocked warning, rotate, duplicate, delete via the button; drag a bed in Soverom (ny fløy) against the wall (snaps back-to-wall); iPhone:
   tap-place and move a chair, open the proposals menu, create and rename a proposal, place a Vedskjul 0.4 m from the wing wall and see it attach,
   nudge a selected shed 0.5 m, tap «Bod (ny)»; desktop: delete a proposal with two confirmations and restore it from Papirkurv; main south +0.3
   then glass east +0.5 then Ta tilbake on every ghost → seed; a click on the centre of win-106-s selects it; pwa: offline reload. Screenshots:
   plan-furnished.png, 3d-inne-furnished.png (Inne + Ovenfra), phone-library.png, proposals-menu.png, share-dialog.png.
3. \`npm run build\` (dist must work at https://robinharald.github.io/hytte-planlegger/ — check asset URLs, manifest scope/start_url and the SW
   registration path for the chosen base; manifest + SW emitted; the Firebase chunk is a separate lazy chunk), \`npm run e2e\` (all projects); read
   screenshots; fix (max 6 iterations). Measure drag frame times in the browser (door, wall, edge, unit) with and without 4× CPU throttling and
   write them into STATUS.
4. STATUS.md / architecture.md / README (furniture, shared proposals, offline, install, Firebase setup pointer, editor polish, perf table) updated;
   «Kjente problemer» pruned; "Neste" lists phase 4/5 leftovers (PDF/PNG export, walk mode, sun UI polish, drainage helper, IFC overlay).
5. Commit in logical commits (English, imperative), each ending with
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   Do NOT push.
FINAL REPORT (<= 70 lines): test counts, what works, each polish finding → fixed/partly/not, open issues, the family-link format, and whether
firestore.rules changed (then Robin must publish it).`, { label: 'integrate-2b', phase: 'Integrate', model: 'opus' })

phase('Verify')
const VERIFY_SCHEMA = { type: 'object', properties: {
  summary: { type: 'string' }, resolved: { type: 'array', items: { type: 'string' } },
  findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, area: { type: 'string' }, file: { type: 'string' },
    problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['severity', 'area', 'file', 'problem', 'evidence', 'fix'] } } },
  required: ['summary', 'resolved', 'findings'] }
const VCOMMON = `You are reviewing phase 2b of ${REPO} after integration. Read docs/phase2-plan.md revision 3 §4–§7 and STATUS.md. Integrator's report:\n${integration}\n
You may run tests/scripts/Playwright (own dev server on a free port) and read anything; do NOT modify repository files (temporary scripts under
tmp-review/, deleted afterwards); do not commit; do not run \`npm run e2e\` (it rewrites committed screenshots).`
const verifiers = await parallel([
  () => agent(`${VCOMMON}\nLENS: furniture. Check every catalogue item renders in 2D and 3D at a sane size, placement/snapping/rotation/duplication/deletion
on desktop and iPhone, collision and clearance rules (incl. no-false-positive cases: wall cabinet over base cabinet, rug under sofa, loft beds vs lower
doors), seed furnishing matches the old model's layout, performance while dragging furniture (derive ≤ 5 ms), levels (bed in Soverom 1 at z −1.0),
Forslag D stays byte-identical, undo granularity for furniture actions.`, { label: 'verify:furniture', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }),
  () => agent(`${VCOMMON}\nLENS: shared proposals, saving, offline and the deploy. Verify the FamilyStore behaviours in local mode and with the fake adapter
(create/edit/rename/delete twice-confirmed/restore/revisions/conflict guard/Forslag D immutable), the firestore.rules against the data paths, the PWA
update flow (no auto reload; toast; too-new notices), offline reload with fonts, the production build base path and that the GitHub Pages workflow would
serve it, migration of a phase-1 autosave and a phase-1 delta link (railing + steps survive), that the Firebase code is not loaded without config,
that docs/firebase-oppsett.md matches the code, and — against the REAL Firestore with a throwaway family id (prefix 'e2e-', ≥ 24 chars, delete
afterwards) — that a proposal round-trips between two browser contexts, that a short id and a foreign path are denied, and that nothing but the
proposal data, display name and timestamps (no e-mail, device name, user agent or location) is written.`, { label: 'verify:shared', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }),
  () => agent(`${VCOMMON}\nLENS: editor polish and regressions. Read ${FIX2_FINDINGS}; for each of its findings state resolved or not with fresh
evidence (Node probes on the real seed through editActions, and Playwright on a 1366×768 laptop and iPhone 13 with touch): junction/stub ghosts,
attaching units on the phone, inward-moved edge status, Ta tilbake sweeps, opening heal in two steps, todayPart with ghosts, free-unit rotation,
guide-extension overshoot, the tilting corridor wall, the adaptive drag (frame times for wall/edge/unit drags with 4× CPU throttling: the outline must
follow the finger smoothly), short nudges on the phone, Bod (ny) tap, touch end handles, ghost-vs-live opening hits, loose-wall wording. Then regression
checks: lock, undo granularity (one step per drag incl. throttled drags), ghosts, 27 rooms, deck adaptation, seed revision 6 upgrade from revision 5
and 4 autosaves.`, { label: 'verify:editor', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }),
])
return { integration, verifiers: verifiers.filter(Boolean) }

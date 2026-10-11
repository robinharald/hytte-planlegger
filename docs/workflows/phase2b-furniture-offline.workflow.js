export const meta = {
  name: 'phase2b-furniture-offline',
  description: 'Phase 2b of the cabin planner: furniture catalogue, 2D/3D furniture, placement and collisions, seed furnishing; sharing/versions wording and offline PWA; integrate and verify',
  phases: [
    { title: 'Build', detail: 'catalogue+derive, 2D library+symbols, 3D models+drop, saving/sharing/offline (parallel)' },
    { title: 'Integrate', detail: 'wire, tests, e2e incl. offline project, screenshots, STATUS, commits' },
    { title: 'Verify', detail: 'furniture reviewer, saving/offline reviewer' },
  ],
}

const REPO = 'C:\\Users\\robin\\Projects\\hytte-planlegger'
const ONEDRIVE = 'C:\\Users\\robin\\OneDrive\\Byggeprosjekt hytte'

const COMMON = `You are an engineer on phase 2b of a cabin-planner web app. Repository: ${REPO} (Vite 8 + React 19 + TypeScript 6 strict,
\`verbatimModuleSyntax\` → \`import type\`, no enums; zustand + zundo + immer; vitest; Playwright; vite-plugin-pwa 2 installed). Phase 2a (editor)
is integrated and green. READ FIRST, completely: docs/phase2-plan.md (§4 furniture, §5 saving/sharing/offline, §3.6 Edit API), docs/architecture.md,
src/model/types.ts, src/model/derived.ts, src/state/editActions.ts (furniture action signatures are declared there), STATUS.md. Reference material
under ${ONEDRIVE} is read-only. Rules: only create/modify files in your OWNERSHIP list (read anything); no git commands; no dev server; vitest is
fine; English code, Norwegian UI strings in src/i18n/nb.ts (owned by the saving/offline engineer in this round — name needed strings in your report
and keep a local strings file meanwhile). Keep YOUR files typecheck-clean and tested.
FINAL REPORT (plain text, <= 60 lines): files, API implemented, deviations, strings needed, known gaps, what the integrator must do.`

const CATALOG_IDS = `Catalogue ids (append-only; use exactly these): seng-90, seng-120, seng-150, seng-180, koyeseng, nattbord, garderobeskap, kommode,
sofa-2, sofa-3, hjornesofa, lenestol, salongbord, teppe, tv-benk, bokhylle, vedovn, benkeskap, overskap, hoyskap, kjoleskap, kjokkenoy, spisebord-4,
spisebord-6, spisebord-8, stol, toalett, servant, dusj-80, dusj-90, dusj-100, dusjvegg, badekar, vaskemaskin, torketrommel, vaskesoyle, handkletorker,
sluk, varmtvannsbereder, badstubenk, badstuovn, hylle, skohylle, benk, skistativ, vedstabel, loungesofa, utebord, utestol, grill.`

phase('Build')
const [catalog, library2d, models3d, saving] = await Promise.all([
  agent(`${COMMON}

${CATALOG_IDS}

TASK: furniture catalogue, derive stage, collisions, seed furnishing, furniture actions. OWNERSHIP: src/furniture/catalog.ts (+test), src/geometry/
furnitureDerive.ts (+test) wired into the existing furniture stage of src/geometry/derive.ts (edit only that stage), src/state/editActions.ts
furniture action BODIES (addFurniture with size from the preset and levelId via levelAt, moveFurniture/rotateFurniture/duplicate/delete/setProps,
items following a moved wall face), src/model/seed/furniture.ts (+test) and the SEED_REVISION bump 4 → 5 in forslagD.ts.
Implement §4 exactly: FurnitureCatalogItem fields (sizes, stretch, clearance, snap, mount, elevation, needsDrain, symbol, model), the item list with
realistic Norwegian names and sizes, DerivedFurniture (footprint, bbox, levelId, roomId, floorZ, z, clearances, collisions, blocksDoors, needsDrain),
collision rules (same level, z-range overlap, not 'flat', walls by levelIds, doors by level, stairs/chimney/posts/hot tub, separating-axis tests,
5 mm tolerance), warnings, unknown-id fallback. Seed furnishing ported from the old model's buildD150() in
${ONEDRIVE}\\3d-planlegger\\reference\\forrige-modell-v16.html (beds, kitchen counter + tall units + island, dining table + chairs, sofa group + stove,
leseskrok chairs + table + shelf, toilets back-to-back at x 18.6, sinks, washer tower, shower, sauna benches + stove, wardrobe, pantry shelves, bod
shelves, water heater, log stack, outdoor lounge + table + chairs) with stable ids, backs snapped to inner faces within 0.15 m, lower-level items on
'lower', the lower-bathroom toilet facing the room. Tests: catalogue invariants, collisions (overlap, in-wall, door-blocked, wall-mounted vs base
cabinet no collision, rug under sofa no collision), seed: createForslagD() twice identical, every item in a room of its level or on the deck, no
furniture warnings, 27 rooms unchanged, derive furniture-only change ≤ 5 ms.`, { label: 'furniture-core', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${CATALOG_IDS}

TASK: furniture in the plan and the library panel. OWNERSHIP: src/plan2d/layers/FurnitureLayer.tsx (+symbols module), src/ui/FurnitureLibrary.tsx
(+styles), their tests. Implement §3.2 library behaviour (replaces the left column when the Møbler tool is active; categories as an accordion with
Norwegian names; search box; items show a small symbol + name + default size; TAP places in the selected room else the plan centre, pushed to the
nearest free wall per the snap rule; drag into the plan with pointer events, no HTML5 DnD; bottom sheet on phones), §4 2D symbols (recognisable:
bed with pillow and duvet line, bunk bed, wardrobe with door lines, sofa with cushions, armchair, tables with chairs, kitchen cabinets with counter
line, fridge, toilet, sink, shower with glass lines, bathtub, washer/dryer circles, stove, sauna benches, shelves, outdoor lounge, grill), clearance
zones as faint hatched areas when ui.showClearances, selection/rotation handle (rotate handle on the front edge; R key handled by the app),
collision outline in red, drop handling through PlanView's onDropFurniture prop → addFurniture. The Møbel properties editor fields (Navn, Størrelse
/ Bredde/Dybde when stretchable, Farge, Roter 90°, Dupliser, Slett, Rom read-only) go into src/ui/properties/FurnitureProps.tsx (you own that file).
Tests: symbol registry covers every catalogue id, tap-to-place math, library filtering.`, { label: 'furniture-2d', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

${CATALOG_IDS}

TASK: furniture in 3D. OWNERSHIP: src/view3d/Furniture.tsx, src/view3d/furnitureBuilders.ts (+test), src/view3d/materials.ts additions.
Build simple, recognisable parametric models for every catalogue id in the old model's look (${ONEDRIVE}\\3d-planlegger\\reference\\forrige-modell-v16.html:
bed() with frame/mattress/duvet colours, toilet(), chair(), counters with tops, sofa blocks, stove with pipe, sauna benches, hot-tub-like water for
the bathtub, logs texture for vedstabel, white porcelain, metal), scaled by DerivedFurniture size, placed at z = floorZ + elevation, rotated by
rotationDeg (plan frame → three.js via toWorld), selectable by click (Selection kind 'furniture'), highlight when selected, red tint when colliding
(when highlightNew/ clearances toggles say so), visible per storey in interior mode, and the 3D drop (View3D.onDropFurniture already resolves the
point) — nothing else in view3d changes. Instanced or merged where cheap (chairs). Tests: every catalogue id has a builder; builders return finite
bounds matching size within 5 %; rotation mapping.`, { label: 'furniture-3d', phase: 'Build', model: 'opus' }),

  agent(`${COMMON}

TASK: saving, sharing, link round trip, offline PWA. OWNERSHIP: src/state/persistence.ts (+tests), src/state/appStore.ts (or wherever the link/copy
flow lives), src/ui/ShareDialog.tsx, src/ui/VersionsPanel.tsx (rename/move to "Tidligere lagringer" under Mer), src/ui/UpdateToast.tsx,
src/ui/InstallCard.tsx, src/ui/TopBar.tsx edits, src/i18n/nb.ts, vite.config.ts (PWA plugin + base), index.html (manifest/apple-touch-icon), public/
icons (generate 180/192/512 PNGs from public/favicon.svg with a one-off node script using sharp if present in node_modules, else write them with a
tiny PNG encoder; commit the PNGs), playwright.config.ts (second project "pwa" against \`npm run build && npx vite preview --port 4173 --strictPort\`,
baseURL http://localhost:4173/hytte-planlegger/), e2e/offline.spec.ts, e2e/share-roundtrip.spec.ts.
Implement §5 exactly: wording (Forslag, autosave indicator, Tidligere lagringer with default names and "Før «X» ble åpnet"), "Send forslaget" with
navigator.share fallback copy and the two labelled links, Variant.copiedFrom round trip ("Du fortsetter på ditt eget forslag"), read-only mode with
greyed toolbar + "Endre dette forslaget", copy name prompt, one-time note, navigator.storage.persist(), iOS home-screen card, PWA with registerType
'prompt' + injectRegister false + useRegisterSW toast "Ny versjon av appen er klar. [Oppdater]" (save first, never auto-reload), too-new notices
wired to update, hourly/visibilitychange update checks, controllerchange notice, workbox globPatterns/navigateFallback/cleanupOutdatedCaches, base
'/hytte-planlegger/' in production and '/' in dev (check the GitHub Pages deploy workflow still works: dist served under that path). Tests: unit tests
for the link round trip and versions; Playwright share-roundtrip (open link → Endre → edit → reload same link → own copy, no duplicate) and offline
(service worker controlling → offline → reload → ready, fonts loaded).`, { label: 'saving-offline', phase: 'Build', model: 'opus' }),
])

phase('Integrate')
const integration = await agent(`You are the INTEGRATOR of phase 2b on ${REPO}. You may edit any file. Read docs/phase2-plan.md, STATUS.md, then:

FURNITURE CORE:\n${catalog}\n\nFURNITURE 2D:\n${library2d}\n\nFURNITURE 3D:\n${models3d}\n\nSAVING/OFFLINE:\n${saving}

1. Wire: library ↔ tool 'furniture', drop → addFurniture, properties, 3D models, clearances toggle in Vis, strings in nb.ts; typecheck/lint/tests green.
2. Playwright (desktop): tap-place a toilet in Hovedbad (clearance visible), drag it into the door swing → door-blocked warning, rotate, duplicate,
   delete via the button; drag a bed in Soverom (ny fløy) against the wall (snaps back-to-wall); touch project: tap-place and move a chair.
   Screenshots: plan-furnished.png, 3d-inne-furnished.png (Inne + Ovenfra), phone-library.png. Run the pwa project (share round trip + offline).
3. \`npm run build\` (check dist uses /hytte-planlegger/ base and the manifest/SW are emitted), \`npm run e2e\`; read screenshots; fix (max 6 iterations).
4. STATUS.md / architecture.md / README (furniture, saving, offline, install) updated; the "Neste" section lists phase 4/5 leftovers (PDF/PNG export,
   walk mode, sun UI polish, drainage helper, IFC overlay).
5. Commit in logical commits (English, imperative), each ending with
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Do NOT push.
FINAL REPORT: test counts, what works, open issues.`, { label: 'integrate-2b', phase: 'Integrate', model: 'opus' })

phase('Verify')
const VERIFY_SCHEMA = { type: 'object', properties: {
  summary: { type: 'string' }, resolved: { type: 'array', items: { type: 'string' } },
  findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, area: { type: 'string' }, file: { type: 'string' },
    problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['severity', 'area', 'file', 'problem', 'evidence', 'fix'] } } },
  required: ['summary', 'resolved', 'findings'] }
const VCOMMON = `You are reviewing phase 2b of ${REPO} after integration. Read docs/phase2-plan.md §4–§7 and STATUS.md. Integrator's report:\n${integration}\n
You may run tests/scripts/Playwright and read anything; do NOT modify repository files (temporary scripts under tmp-review/, deleted afterwards); do not commit.`
const verifiers = await parallel([
  () => agent(`${VCOMMON}\nLENS: furniture. Check every catalogue item renders in 2D and 3D at a sane size, placement/snapping/rotation/duplication/deletion,
collision and clearance rules (incl. the no-false-positive cases: wall cabinet over base cabinet, rug under sofa, loft beds vs lower doors), seed
furnishing matches the old model's layout, performance while dragging furniture (derive ≤ 5 ms), levels (bed in Soverom 1 at z −1.0).`, { label: 'verify:furniture', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }),
  () => agent(`${VCOMMON}\nLENS: saving, sharing, offline and the deploy. Verify the link round trip, versions wording/flows, read-only + "Endre dette forslaget",
the PWA update flow (no auto reload; toast; too-new notices), offline reload with fonts, the production build base path and that the GitHub Pages
workflow would serve it (inspect dist and .github/workflows), migration of a phase-1 autosave and a phase-1 delta link (railing + steps survive),
delta link sizes for seedRevision 3/4/5 projects.`, { label: 'verify:saving', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }),
])
return { integration, verifiers: verifiers.filter(Boolean) }

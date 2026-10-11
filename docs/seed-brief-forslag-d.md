# Seed brief: Forslag D as stored data

This is the authoritative list of what `src/model/seed/forslagD.ts` must contain. Existing-building numbers come
from the architect's IFC (docs/kalibrering-ifc.md); new parts from the spec (forslag-D-spec.json) and Robin's
answers of 2026-10-11. Plan coordinates, metres; heights relative to the main floor (level `main` = 0).
"Offset" of an opening = distance along the host from its start to the opening CENTRE (block edges run CCW:
south edge west→east, east edge south→north, north edge east→west, west edge north→south).
Door swings use the host-line form `{ hinge: 'start' | 'end', side: 'left' | 'right' }`: side = the side of the
host line a→b that the leaf opens into (left = (−dy, dx) = inside for exterior edges).

## Project
id `hytte-merkesvatnet`, name "Hytta ved Merkesvatnet", `seedRevision = SEED_REVISION` (start at 1), one variant
`forslag-d` named "Forslag D" with settings `{ defaultExteriorWall: { thickness 0.27, outerOffset 0.11 },
defaultInteriorThickness 0.12, areaLimit null }`.

## Levels
| id | name | storeyId | elevation | ceilingHeight | floorThickness |
|---|---|---|---|---|---|
| lower | Underetasje (soverom) | ground | -1.0 | 2.3 (underside of the loft floor at +1.3) | 0 |
| main | Hovedplan | ground | 0 | — (open to the roof; tie beams at 2.3–2.5) | 0 |
| loft | Hems | loft | 1.47 | — | 0.17 |

## Blocks (all: eaveHeight 2.22, roof thickness 0.31, overhangEave 0.51, overhangGable 0.35, turf, wall 0.27/0.11)
| id | name | polygon (CCW) | level | roof | isNew | parts | junctions |
|---|---|---|---|---|---|---|---|
| blk-main | Hytta, hoveddel | (0,0) (16,0) (16,6.2) (0,6.2) | main | gable, ridgeAxis x, pitch 28, ridgeHeight 3.87, drive pitch | false | part-main-old "Eksisterende" [0,12]×[0,6.2] existing; part-stue-ext "Stue forlenget" [12,16]×[0,6.2] new | blk-glass: open; blk-bod: wall; blk-wing: open |
| blk-glass | Glassutbygg (leseskrok) | (5,-2) (9,-2) (9,0) (5,0) | main | gable, ridgeAxis y, pitch 28, ridgeHeight 3.28, drive pitch | false | — | — |
| blk-bod | Bod-fløy | (5,6.2) (9,6.2) (9,12.1) (5,12.1) | main | gable, ridgeAxis y, pitch 28, ridgeHeight 3.28, drive pitch | false | part-bod-old "Bod-fløy i dag" [5,9]×[6.2,10.1] existing; part-bod-new "Ny bod + ved" [5,9]×[10.1,12.1] new | — |
| blk-wing | Ny tverrfløy | (16,-2) (20.8,-2) (20.8,6.2) (16,6.2) | main | gable, ridgeAxis y, pitch ≈34.5, ridgeHeight 3.87, drive height | true | — | — |

Floor zones on blk-main:
- zone-lower (level lower, kind `replace`): (0,0) (5.1,0) (5.1,2.18) (4.3,2.18) (4.3,4.24) (5.05,4.24) (5.05,6.2) (0,6.2)
- zone-loft (level loft, kind `add`): (0,0) (5.1,0) (5.1,2.18) (3.85,2.18) (3.85,3.1) (3.8,3.1) (3.8,4.24) (5.05,4.24) (5.05,6.2) (0,6.2)
  — the loft slab (hems 1 + landing + hems 2); the stairwells X 3.85..5.1 × Y 2.18..3.1 and X 3.8..5.05 × Y 3.1..4.24 are outside it.

Vertex ids: `v-main-sw, v-main-se, v-main-ne, v-main-nw` (edge id = start vertex id: south = v-main-sw, east = v-main-se,
north = v-main-ne, west = v-main-nw); likewise `v-glass-*`, `v-bod-*`, `v-wing-*`.

## Stored walls (thickness 0.12 unless noted; status `existing` unless marked NEW)
heightMode: lower-level partitions `auto` (stop under the loft floor); existing main-level partitions `fixed` 2.3;
new wing partitions `fixed` 2.4; walls marked ROOF use `roof` (from their level floor to the roof envelope).

Lower level (existing):
- w-104-103: (3.05,4.24)→(3.05,6.2)
- w-103-korr: (3.05,4.24)→(5.05,4.24); door `d-bad` 0.81×2.01 at offset 0.56 (x 3.61), swing { hinge 'start', side 'left' } (into the bathroom, +y side)
- w-103-102: (5.05,4.24)→(5.05,6.2) (bathroom / vindfang) ROOF
- w-104-diag: (2.25,3.1)→(3.05,4.24); door `d-104` 0.81×2.01 at offset 0.7, swing { hinge 'end', side 'left' } (into room 104)
- w-104-s: (0,3.1)→(2.25,3.1)
- w-105-diag: (3.1,2.18)→(2.25,3.1); door `d-105` 0.81×2.01 at offset 0.62, swing { hinge 'start', side 'left' } (into room 105)
- w-105-106: (3.1,0)→(3.1,2.18)
- w-106-korr: (3.1,2.18)→(5.1,2.18) ROOF; door `d-106` 0.81×2.01 at offset 0.58 (x 3.68), swing { hinge 'start', side 'right' } (into room 106, −y side)
- w-106-stue: (5.1,0)→(5.1,2.18) ROOF

Main level (existing, fixed 2.3 unless noted):
- w-korr-stue: (5.1,2.18)→(6.97,2.18)
- w-peis-w: (6.97,2.18)→(6.97,3.1)
- w-peis-n: (6.97,3.1)→(9,3.1)
- w-vf-korr: (5.05,4.24)→(8.35,4.24); frameless `opening` `o-vf` 1.2 wide × 2.1 high at offset 1.85 (x 6.9)
- w-vf-kjk: (8.35,4.24)→(8.35,6.2)
- w-mellom-boder: (5,7.62)→(9,7.62) kind `exterior-old`, thickness 0.27, heightMode auto; doors `d-do` 0.81×2.01 at offset 0.64 (x 5.64) swing { hinge 'start', side 'left' } (into Do), `d-bod109` 0.91×2.01 at offset 2.01 (x 7.01) swing { hinge 'start', side 'left' } (into the bod)
- w-do-109: (6.2,7.62)→(6.2,10.1) auto; w-109-108: (7.6,7.62)→(7.6,10.1) auto
- w-bod-gavl: (5,10.1)→(9,10.1) kind `exterior-old`, thickness 0.27, faceLeft 0.11 (ved side, +y), faceRight 0.16 (bod side), heightMode auto, no openings
- Dividers (kind `divider`, thickness 0): dv-leseskrok (5,0)→(9,0); dv-kjk-w (9,2.2)→(9,4.24); dv-korr-ne (8.35,4.24)→(9,4.24);
  dv-stue-n (9,2.2)→(16,2.2) NEW; dv-kjk-e (12,2.2)→(12,6.2) NEW; dv-pass-n (12,3.4)→(16,3.4) NEW

Main level (new, fixed 2.4 unless noted):
- w-bod-ved: (5,11.1)→(9,11.1) NEW, heightMode auto
- w-wing-w: (16,0)→(16,6.2) NEW; frameless opening `o-stue-gang` 1.2 × 2.1 at offset 2.8 (gang, y 2.2–3.4)
- w-gang-s: (16,2.2)→(20.8,2.2) NEW; doors `d-pantry` 0.7×2.0 at offset 0.7 swing { hinge 'start', side 'right' }, `d-wc` 0.7×2.0 at offset 2.0 swing { hinge 'start', side 'right' }, `d-bad2` 0.8×2.0 at offset 3.5 swing { hinge 'end', side 'right' } (all into the rooms on the −y side)
- w-gang-n: (16,3.4)→(20.8,3.4) NEW; door `d-sov-ny` 0.8×2.0 at offset 1.3 swing { hinge 'start', side 'left' } (into the bedroom, +y side)
- w-pantry-wc: (17.4,0)→(17.4,2.2) NEW; w-sauna-n: (16,0)→(18.6,0) NEW
- w-wc-bad: (18.6,-2)→(18.6,2.2) NEW; `saunaDoor` `d-badstue` 0.7×1.9 at offset 1.0 (y −1.0), swing { hinge 'start', side 'left' } (opens OUT of the sauna into the bathroom on the +x side, which is left of a→b going +y)

Loft level (existing, heightMode auto → roof):
- lw-split: (0,3.1)→(3.85,3.1); door `d-hems2` 0.81×1.81 at offset 3.24 swing { hinge 'end', side 'left' } (into Hems 2, +y)
- lw-landing: (2.65,2.18)→(2.65,3.1); door `d-hems1` 0.71×1.81 at offset 0.48 swing { hinge 'start', side 'left' } (into Hems 1, −x side)
- lw-106-top: (2.6,2.18)→(3.1,2.18) (short piece west of w-106-korr, which already runs to the roof)
- lw-hems2-s: (3.8,4.24)→(5.05,4.24); lw-hems2-w: (3.8,3.1)→(3.8,4.24)
- (x = 5.1 for y 0–2.18 and x = 5.05 for y 4.24–6.2 are covered by w-106-stue / w-103-102 with heightMode `roof`; do not duplicate)

## Openings on block edges
Status `existing` unless marked NEW; white frames, window mullions [2,2] unless noted; sill measured from the level in the
"level" column. Exterior doors that "swing out" = `{ hinge: 'start' or 'end' (the jamb nearer the adjacent wall corner, else 'start'), side: 'right' }`.

| id | host (block/edge) | offset | type | w×h | sill | level | notes |
|---|---|---|---|---|---|---|---|
| win-105-s | main / south | 1.73 | window | 1.11×1.21 | 0.8 | lower | |
| win-106-s | main / south | 3.68 | window | 1.1×1.2 | 0.8 | lower | NEW: replaces the removed exterior door of room 106 (Robin's decision) |
| door-stue-s | main / south | 10.5 | glassDoor | 1.6×2.05 | 0 | main | NEW, two leaves, swings out; replaces the existing window at x 10.36 |
| win-ext-s1 | main / south | 13.2 | window | 1.1×1.2 | 0.8 | main | NEW |
| win-ext-s2 | main / south | 14.8 | window | 1.1×1.2 | 0.8 | main | NEW |
| win-bad-n | main / north | 12.49 (x 3.51) | window | 0.61×1.21 | 0.8 | lower | |
| win-kjk-n | main / north | 5.41 (x 10.59) | window | 1.11×1.21 | 0.8 | main | |
| door-mellom-vf | main / north | 8.99 (x 7.01) | door | 0.91×2.01 | 0 | main | between mellombygg and vindfang, swing { hinge 'start', side 'left' } (into the vindfang) |
| door-spis-n | main / north | 3.3 (x 12.7) | glassDoor | 0.9×2.0 | 0 | main | NEW, swings out |
| win-spis-n | main / north | 1.4 (x 14.6) | window | 1.1×1.2 | 0.8 | main | NEW |
| win-104-w | main / west | 2.39 (y 3.81) | window | 1.11×1.21 | 0.8 | lower | |
| win-hems-w1 | main / west | 3.76 (y 2.44) | window | 1.11×1.01 | 0.53 | loft | |
| win-hems-w2 | main / west | 2.44 (y 3.76) | window | 1.11×1.01 | 0.53 | loft | |
| win-glass-s1 | glass / south | 1.07 (x 6.07) | window | 1.61×1.61 | 0.4 | main | mullions [3,2] |
| win-glass-s2 | glass / south | 2.94 (x 7.94) | window | 1.61×1.61 | 0.4 | main | mullions [3,2] |
| win-glass-e | glass / east | 1.04 (y -0.96) | window | 1.61×1.61 | 0.4 | main | mullions [3,2] |
| win-glass-w | glass / west | 0.96 (y -0.96) | window | 1.61×1.61 | 0.4 | main | mullions [3,2] |
| door-green-e | bod / east | 0.69 (y 6.89) | door | 0.91×2.01 | 0 | main | frame + leaf green, swings out |
| door-teknisk | bod / east | 2.7 (y 8.9) | door | 0.8×2.0 | 0 | main | NEW, swings out |
| door-bod-ny | bod / east | 4.4 (y 10.6) | door | 0.9×2.0 | 0 | main | NEW, green, swings out |
| open-ved | bod / east | 5.4 (y 11.6) | opening | 1.0 wide, fullHeight | 0 | main | NEW, open woodshed front towards the terrace (touches the block corner at y 12.1, allowed) |
| door-green-w | bod / west | 5.21 (y 6.89) | door | 0.91×2.01 | 0 | main | frame + leaf green, swings out |
| win-do-w | bod / west | 3.28 (y 8.82) | window | 0.61×1.21 | 0.8 | main | |
| win-badstue-s | wing / south | 1.3 (x 17.3) | window | 1.2×0.9 | 0.7 | main | NEW |
| win-gavl-s | wing / south | 2.4 (x 18.4) | window | 0.8×0.7 | 2.75 | main | NEW, high gable window |
| win-bad-s | wing / south | 4.15 (x 20.15) | window | 0.6×0.6 | 1.1 | main | NEW |
| win-bad-e1 | wing / east | 1.7 (y -0.3) | window | 0.6×0.6 | 1.1 | main | NEW |
| win-bad-e2 | wing / east | 3.5 (y 1.5) | window | 0.5×0.6 | 1.3 | main | NEW |
| door-gang-e | wing / east | 4.8 (y 2.8) | glassDoor | 1.0×2.05 | 0 | main | NEW, swings out |
| win-sov-n | wing / north | 2.8 (x 18.0) | window | 1.6×1.3 | 0.5 | main | NEW |
| win-gavl-n | wing / north | 2.4 (x 18.4) | window | 0.8×0.7 | 2.75 | main | NEW, high gable window |
| win-badstue-w | wing / west | 7.2 (y -1.0) | window | 1.0×0.9 | 0.7 | main | NEW |

Removed by the design, stored with status `removed` (plan shows them dashed as "rives"; no 3D): `win-stue-s-old`
(main/south offset 10.36, 1.11×1.21, sill 0.8, main) and `door-106-old` (main/south offset 3.68, 0.91×2.01, sill 0,
level lower). The east gable (x = 12) with its door (y 2.59) and windows (y 1.53, 4.68) disappears with the extension;
its wall no longer exists, so do NOT store those openings — they are listed in docs/kalibrering-ifc.md only.

## Rooms (anchor; faces are split by the dividers listed under walls and by the lower floor-zone boundary)
Lower: Soverom 1 (1.5,5.2) soverom · Bad (4.05,5.2) bad · Soverom 2 (1.2,1.4) soverom · Soverom 3 (4.1,1.1) soverom ·
Korridor (nedre) (3.6,3.6) gang.
Main: Korridor (øvre) (5.9,3.6) gang · Vindfang (6.7,5.3) vindfang · Leseskrok (7,-1) leseskrok · Stue (13.9,1.0) stue ·
Kjøkken (10.6,4.9) kjokken · Passasje (14,2.8) gang · Spiseplass (14,4.9) spiseplass.
Bod wing: Mellombygg (7,6.9) vindfang · Do (5.6,8.8) wc · Bod (6.9,8.8) bod · Teknisk / vask (8.3,8.8) teknisk (note "Tidligere bod 108") ·
Bod (ny) (7,10.6) bod · Ved (7,11.6) bod (floorMaterial `deck`, note "Åpent mot terrassen").
Wing: Gang (18.4,2.8) gang · Soverom (ny fløy) (18.4,4.8) soverom · Pantry (16.7,1.1) pantry · WC (18.0,1.1) wc ·
Hovedbad (19.7,0.3) bad · Badstue (17.3,-1.0) badstue.
Loft: Hems 1 (soverom) (2.5,1.1) hems · Hems 2 (soverom) (2,5) hems · Trapperepos (3.25,2.6) gang.

## Structure (z absolute)
Posts (0.11 square, bottom 0, top 3.5, existing): (5.1,3.1) (8.95,3.1) (11.9,3.1) — the last one stands in the removed
east gable; keep it as a free post (note in STATUS). New woodshed corner post: (8.93,12.03) size 0.14, bottom 0, top 2.22.
Ridge beam existing (0.03,3.1)→(11.97,3.1) z 3.5–3.86 width 0.12; new continuation (11.97,3.1)→(18.4,3.1) same section.
Tie beams (z 2.3–2.5, width 0.12, existing): (5.04,3.1)→(7.01,3.1), (8.89,3.1)→(11.97,3.1), (8.95,0.07)→(8.95,3.15).
Chimney min (7.08,2.48) max (7.63,3.03) bottom 0 top 5.2.
Stairs: `stair-loft` min (3.85,2.24) max (6.1,3.04) main→loft, up W; `stair-level` min (4.3,3.17) max (5.55,4.17) lower→main, up E.

## Outdoor (all new)
Deck `deck-terrasse` polygon: (5,-4.6) (23.2,-4.6) (23.2,12.1) (9,12.1) (9,6.2) (20.8,6.2) (20.8,-2) (16,-2) (16,0) (9,0) (9,-2) (5,-2);
topHeight -0.02. Railing `rail-terrasse` (deckId deck-terrasse, glass, 1.05) path:
(5,-2)→(5,-4.6)→(23.2,-4.6)→(23.2,12.1)→(9,12.1); gaps (distance along the path, all with steps: true)
[4.6,6.0] (x 7–8.4), [27.5,28.9] (y 2.1–3.5, opposite the corridor door), [33.8,35.2] (y 8.4–9.8).
Hot tub `tub-1` centre (21.7,-3.2), diameter 2.0.

## Site
originLatLon { lat: 68.613050, lon: 14.968157 }, planNorthBearing 106, floorElevation 161.0, waterLevel 152.0,
terrainId `merkesvatnet-2026-10`, timezone `Europe/Oslo`. groundWorks: one entry `gw-tomt` = polygon
(4.5,-5.1) (23.7,-5.1) (23.7,12.6) (4.5,12.6) with maxZ -0.45 (the terrain under the deck, bod wing and new wing is cut
so it never rises above 0.45 m below the main floor; the lower bedroom part is outside it).
Trees (bjork): (-4,4,5) (-6,12,6) (-3,-8,5) (33,12,6) (29,22,7) (25,26,5) (2,24,6) (13,25,5.5) (-9,30,6) (32,-10,5)
(36,-16,6.5) (-10,-2,5.5) as (x, y, height).

Terrain asset: `scripts/build-terrain.mjs` resamples data/geo/elev_{fine,coarse,wide}.json (metres E/N from the
ADDRESS point; plan origin at E 3.1, N 6.8; E = 3.1 − 0.2756·x + 0.9613·y, N = 6.8 − 0.9613·x − 0.2756·y) into a
`TerrainAsset { id: 'merkesvatnet-2026-10', grids }` with two plan-aligned grids in metres a.s.l. (NOT relative to
the floor): grid A x −100…120, y −100…100, 2 m spacing (bilinear from the finest geo grid covering each point);
grid B x −220…240, y −220…220, 10 m spacing; 2 decimals → `src/model/seed/terrain-merkesvatnet.json`
(imported as JSON by the app; never put into the Project).

## Expected invariants (tests)
Axis footprint: main 16×6.2 = 99.2 (existing 74.4 + new 24.8), glass 8.0, bod 23.6 (15.6 + 8.0), wing 39.36 → total 170.16
(existing 98.0, new 72.16). Every opening offset ± width/2 lies within its host edge/wall (end-touch allowed). Every room
anchor lies inside its block. All ids unique. Polygons CCW. Levels reference existing storeys; walls/rooms/openings reference
existing levels; junction/railing/host ids resolve.

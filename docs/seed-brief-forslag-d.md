# Seed brief: Forslag D as stored data

This is the authoritative list of what `src/model/seed/forslagD.ts` must contain. Existing-building numbers come
from the architect's IFC (docs/kalibrering-ifc.md); new parts from the spec (forslag-D-spec.json) and Robin's
answers of 2026-10-11. Plan coordinates, metres; heights relative to the main floor (level `main` = 0).
"Offset" of an opening = distance along the host from its start to the opening CENTRE (block edges run CCW:
south edge west→east, east edge south→north, north edge east→west, west edge north→south).

## Levels
| id | name | elevation | ceilingHeight |
|---|---|---|---|
| lower | Underetasje (soverom) | -1.0 | 2.3 (underside of the loft floor at +1.3) |
| main | Hovedplan | 0 | — (open to the roof; tie beams at 2.3–2.5) |
| loft | Hems | 1.47 | — |

## Blocks (all: eaveHeight 2.22, roof thickness 0.31, overhangEave 0.51, overhangGable 0.35, turf, wall 0.27/0.11)
| id | name | polygon (CCW) | level | roof | isNew | parts | junctions |
|---|---|---|---|---|---|---|---|
| blk-main | Hytta, hoveddel | (0,0) (16,0) (16,6.2) (0,6.2) | main | gable, ridgeAxis x, pitch 28, ridgeHeight 3.87, drive pitch | false | part-main-old "Eksisterende" [0,12]×[0,6.2] existing; part-stue-ext "Stue forlenget" [12,16]×[0,6.2] new | blk-glass: open; blk-bod: wall; blk-wing: open |
| blk-glass | Glassutbygg (leseskrok) | (5,-2) (9,-2) (9,0) (5,0) | main | gable, ridgeAxis y, pitch 28, ridgeHeight 3.28, drive pitch | false | — | — |
| blk-bod | Bod-fløy | (5,6.2) (9,6.2) (9,12.1) (5,12.1) | main | gable, ridgeAxis y, pitch 28, ridgeHeight 3.28, drive pitch | false | part-bod-old "Bod-fløy i dag" [5,9]×[6.2,10.1] existing; part-bod-new "Ny bod + ved" [5,9]×[10.1,12.1] new | — |
| blk-wing | Ny tverrfløy | (16,-2) (20.8,-2) (20.8,6.2) (16,6.2) | main | gable, ridgeAxis y, pitch ≈34.5, ridgeHeight 3.87, drive height | true | — | — |

Floor zones on blk-main:
- zone-lower (level lower, kind replace): (0,0) (5.1,0) (5.1,2.18) (4.3,2.18) (4.3,4.24) (5.05,4.24) (5.05,6.2) (0,6.2)
- zone-loft (level loft, kind add): (0,0) (5.1,0) (5.1,6.2) (0,6.2)

Vertex ids: `v-main-sw, v-main-se, v-main-ne, v-main-nw` (edge id = start vertex id: south = v-main-sw, east = v-main-se,
north = v-main-ne, west = v-main-nw); likewise `v-glass-*`, `v-bod-*`, `v-wing-*`.

## Stored walls (thickness 0.12 unless noted; `h` = fixed height above the level floor)
Lower level (existing):
- w-104-103: (3.05,4.24)→(3.05,6.2)
- w-103-korr: (3.05,4.24)→(5.05,4.24); door `d-bad` 0.81×2.01 at offset 0.56 (x 3.61), swings into the bathroom
- w-103-102: (5.05,4.24)→(5.05,6.2) (bathroom / vindfang)
- w-104-diag: (2.25,3.1)→(3.05,4.24); door `d-104` 0.81×2.01 at offset 0.7, swings into room 104
- w-104-s: (0,3.1)→(2.25,3.1)
- w-105-diag: (3.1,2.18)→(2.25,3.1); door `d-105` 0.81×2.01 at offset 0.62, swings into room 105
- w-105-106: (3.1,0)→(3.1,2.18)
- w-106-korr: (3.1,2.18)→(5.1,2.18); door `d-106` 0.81×2.01 at offset 0.58 (x 3.68), swings into room 106
- w-106-stue: (5.1,0)→(5.1,2.18)
Main level (existing, h 2.3):
- w-korr-stue: (5.1,2.18)→(6.97,2.18)
- w-peis-w: (6.97,2.18)→(6.97,3.1)
- w-peis-n: (6.97,3.1)→(9,3.1)
- w-vf-korr: (5.05,4.24)→(8.35,4.24); frameless `opening` `o-vf` 1.2 wide × 2.1 high at offset 1.85 (x 6.9)
- w-vf-kjk: (8.35,4.24)→(8.35,6.2)
- w-mellom-boder: (5,7.62)→(9,7.62) kind exterior-old, thickness 0.27, h auto; doors `d-do` 0.81×2.01 at offset 0.64 (x 5.64) into Do, `d-bod109` 0.91×2.01 at offset 2.01 (x 7.01) into the bod
- w-do-109: (6.2,7.62)→(6.2,10.1); w-109-108: (7.6,7.62)→(7.6,10.1)
- w-bod-gavl: (5,10.1)→(9,10.1) kind exterior-old, thickness 0.27, h auto, existing (no openings)
Main level (new):
- w-bod-ved: (5,11.1)→(9,11.1) h auto
- w-wing-w: (16,0)→(16,6.2); frameless opening `o-stue-gang` 1.2 × 2.1 at offset 2.8 (gang, y 2.2–3.4); h 2.4
- w-gang-s: (16,2.2)→(20.8,2.2); doors `d-pantry` 0.7×2.0 at offset 0.7, `d-wc` 0.7×2.0 at offset 2.0, `d-bad2` 0.8×2.0 at offset 3.5, all swinging into their rooms; h 2.4
- w-gang-n: (16,3.4)→(20.8,3.4); door `d-sov-ny` 0.8×2.0 at offset 1.3 into the bedroom; h 2.4
- w-pantry-wc: (17.4,0)→(17.4,2.2); w-sauna-n: (16,0)→(18.6,0); h 2.4
- w-wc-bad: (18.6,-2)→(18.6,2.2); `saunaDoor` `d-badstue` 0.7×1.9 at offset 1.0 (y -1.0), opens OUT of the sauna into the bathroom; h 2.4
Loft level (existing):
- lw-split: (0,3.1)→(3.85,3.1); door `d-hems2` 0.81×1.81 at offset 3.24 into Hems 2
- lw-landing: (2.65,2.18)→(2.65,3.1); door `d-hems1` 0.71×1.81 at offset 0.48 into Hems 1
- lw-106-top: (2.6,2.18)→(5.1,2.18) (the lower wall continues up through the loft)
- lw-hems1-e: (5.1,0)→(5.1,2.18)
- lw-hems2-e: (5.05,4.24)→(5.05,6.2); lw-hems2-s: (3.8,4.24)→(5.05,4.24); lw-hems2-w: (3.8,3.1)→(3.8,4.24)

## Openings on block edges
Existing (white frames, windows mullions [2,2] unless noted; sill measured from the level in the "level" column):
| id | host (block/edge) | offset | type | w×h | sill | level | notes |
|---|---|---|---|---|---|---|---|
| win-105-s | main / south | 1.73 | window | 1.11×1.21 | 0.8 | lower | |
| win-106-s | main / south | 3.68 | window | 1.1×1.2 | 0.8 | lower | NEW: replaces the removed exterior door of room 106 (Robin) |
| door-stue-s | main / south | 10.5 | glassDoor | 1.6×2.05 | 0 | main | NEW, two leaves, swings out; replaces the existing 1.11×1.21 window at x 10.36 |
| win-ext-s1 | main / south | 13.2 | window | 1.1×1.2 | 0.8 | main | NEW |
| win-ext-s2 | main / south | 14.8 | window | 1.1×1.2 | 0.8 | main | NEW |
| win-bad-n | main / north | 12.49 (x 3.51) | window | 0.61×1.21 | 0.8 | lower | |
| win-kjk-n | main / north | 5.41 (x 10.59) | window | 1.11×1.21 | 0.8 | main | |
| door-mellom-vf | main / north | 8.99 (x 7.01) | door | 0.91×2.01 | 0 | main | between mellombygg and vindfang, swings into the vindfang |
| door-spis-n | main / north | 3.3 (x 12.7) | glassDoor | 0.9×2.0 | 0 | main | NEW, swings out |
| win-spis-n | main / north | 1.4 (x 14.6) | window | 1.1×1.2 | 0.8 | main | NEW |
| win-104-w | main / west | 2.39 (y 3.81) | window | 1.11×1.21 | 0.8 | lower | |
| win-hems-w1 | main / west | 3.76 (y 2.44) | window | 1.11×1.01 | 0.53 | loft | |
| win-hems-w2 | main / west | 2.44 (y 3.76) | window | 1.11×1.01 | 0.53 | loft | |
| win-glass-s1 | glass / south | 1.07 (x 6.07) | window | 1.61×1.61 | 0.4 | main | mullions [3,2] |
| win-glass-s2 | glass / south | 2.94 (x 7.94) | window | 1.61×1.61 | 0.4 | main | mullions [3,2] |
| win-glass-e | glass / east | 1.04 (y -0.96) | window | 1.61×1.61 | 0.4 | main | mullions [3,2] |
| win-glass-w | glass / west | 0.96 (y -0.96) | window | 1.61×1.61 | 0.4 | main | mullions [3,2] |
| door-green-e | bod / east | 0.69 (y 6.89) | door | 0.91×2.01 | 0 | main | green, swings out |
| door-teknisk | bod / east | 2.7 (y 8.9) | door | 0.8×2.0 | 0 | main | NEW, swings out |
| door-bod-ny | bod / east | 4.4 (y 10.6) | door | 0.9×2.0 | 0 | main | NEW, green, swings out |
| open-ved | bod / east | 5.4 (y 11.6) | opening | 1.0×2.1 | 0 | main | NEW, open woodshed front towards the terrace |
| door-green-w | bod / west | 5.21 (y 6.89) | door | 0.91×2.01 | 0 | main | green, swings out |
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

Removed by the design (do NOT include): the east gable door (x 12, y 2.59) and its two windows (y 1.53, 4.68), the south
window at x 10.36 (replaced by door-stue-s), the south door of room 106 (replaced by win-106-s).

## Rooms (anchor; zones carry `zonePolygon`)
Lower: Soverom 1 (1.5,5.2) soverom · Bad (4.05,5.2) bad · Soverom 2 (1.2,1.4) soverom · Soverom 3 (4.1,1.1) soverom ·
Korridor (nedre) (3.6,3.6) gang.
Main: Korridor (øvre) zone (4.3,2.18)(6.97,2.18)(6.97,3.1)(9,3.1)(9,4.24)(4.3,4.24) anchor (5.9,3.6) gang ·
Vindfang (6.7,5.3) vindfang · Stue/kjøkken (åpen løsning) anchor (10,1) stue — the big face; zones inside it:
Leseskrok (5,-2)(9,-2)(9,0)(5,0) anchor (7,-1) leseskrok · Stue (5.1,0)(16,0)(16,2.2)(5.1,2.2) anchor (13.9,1.0) stue ·
Kjøkken (9,2.18)(12,2.18)(12,6.2)(8.35,6.2)(8.35,4.24)(9,4.24) anchor (10.6,4.9) kjokken ·
Passasje (12,2.2)(16,2.2)(16,3.4)(12,3.4) anchor (14,2.8) gang · Spiseplass (12,3.4)(16,3.4)(16,6.2)(12,6.2) anchor (14,4.9) spiseplass.
Bod wing: Mellombygg (7,6.9) vindfang · Do (5.6,8.8) wc · Bod (6.9,8.8) bod · Teknisk / vask (8.3,8.8) teknisk (note "Tidligere bod 108") ·
Bod (ny) (7,10.6) bod · Ved (7,11.6) bod (note "Åpent mot terrassen").
Wing: Gang (18.4,2.8) gang · Soverom (ny fløy) (18.4,4.8) soverom · Pantry (16.7,1.1) pantry · WC (18.0,1.1) wc ·
Hovedbad (19.7,0.3) bad · Badstue (17.3,-1.0) badstue.
Loft: Hems 1 (soverom) (2.5,1.1) hems · Hems 2 (soverom) (2,5) hems · Trapperepos (3.25,2.6) gang ·
Trappeåpning (3.9,2.6) apning · Åpning (4.4,3.7) apning.

## Structure
Posts (0.11 square, main level, bottom 0, top 3.5, existing): (5.1,3.1) (8.95,3.1) (11.9,3.1) — the last one stands
in the removed east gable; keep it as a free post (note in STATUS). Ridge beam existing (0.03,3.1)→(11.97,3.1) z 3.5–3.86
width 0.12; new continuation (11.97,3.1)→(18.4,3.1) same section. Tie beams (z 2.3–2.5, width 0.12, existing):
(5.04,3.1)→(7.01,3.1), (8.89,3.1)→(11.97,3.1), (8.95,0.07)→(8.95,3.15). Chimney min (7.08,2.48) max (7.63,3.03) top 5.2.
Stairs: `stair-loft` min (3.85,2.24) max (6.1,3.04) main→loft, up W; `stair-level` min (4.3,3.17) max (5.55,4.17) lower→main, up E.

## Outdoor (all new)
Deck polygon: (5,-4.6) (23.2,-4.6) (23.2,12.1) (9,12.1) (9,6.2) (20.8,6.2) (20.8,-2) (16,-2) (16,0) (9,0) (9,-2) (5,-2);
topHeight -0.02. Railing path (glass, 1.05): (5,-2)→(5,-4.6)→(23.2,-4.6)→(23.2,12.1)→(9,12.1); gaps (distance along
path) [4.6,6.0] (steps at x 7–8.4), [27.5,28.9] (y 2.1–3.5, opposite the corridor door), [33.8,35.2] (y 8.4–9.8).
Hot tub centre (21.7,-3.2), diameter 2.0.

## Site
originLatLon { lat: 68.613050, lon: 14.968157 }, planNorthBearing 106, floorElevation 161.0, waterLevel 152.0,
timezone Europe/Oslo. Trees (bjork): (-4,4,5) (-6,12,6) (-3,-8,5) (33,12,6) (29,22,7) (25,26,5) (2,24,6) (13,25,5.5)
(-9,30,6) (32,-10,5) (36,-16,6.5) (-10,-2,5.5) as (x, y, height). Terrain: `scripts/build-terrain.mjs` resamples
data/geo/elev_{fine,coarse,wide}.json (metres E/N from the ADDRESS point; plan origin at E 3.1, N 6.8;
E = 3.1 − 0.2756·x + 0.9613·y, N = 6.8 − 0.9613·x − 0.2756·y) into a plan-aligned grid x −60…80, y −60…60, 2 m spacing,
z = bilinear(finest grid covering the point) − 161.0, 2 decimals → `src/model/seed/terrain.json`.

## Expected invariants (tests)
Axis footprint: main 16×6.2 = 99.2 (existing 74.4 + new 24.8), glass 8.0, bod 23.6 (15.6 + 8.0), wing 39.36 → total 170.16
(existing 98.0, new 72.16). Every opening offset ± width/2 lies within its host edge/wall. Every room anchor lies inside
its block and inside its zonePolygon when it has one. All ids unique. Polygons CCW.

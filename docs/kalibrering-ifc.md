# IFC calibration notes (existing cabin) — derived 2026-10-11

Coordinate conversion web-ifc (Y-up world) -> spec coords: X = x + 4.71, Y = 1.79 - z, H = y (0 = main floor, kote 99.85).
Axis lines: 1=x0, 2=x5, 3=x9, 4=x12; A=y10.1, B=y6.2, C=y0, D=y-2. Axes sit at the OUTSIDE of the timber frame.

## Envelope (frame lines) — matches spec exactly
main [0,12]x[0,6.2]; glass bump [5,9]x[-2,0]; bod wing [5,9]x[6.2,10.1].
Exterior wall build-up (west gable, Plan 2): cladding -0.11..-0.07, battens -0.07..-0.01, wind board -0.01..0, frame 0..0.15, gips 0.15..0.16.
=> exterior wall total 0.27 m, 0.11 m OUTSIDE the axis line, inner face 0.16 inside. Cladding outline 12.22 x 6.42 etc.
=> BYA to cladding: main 78.45 + glass 8.90 + bodwing 16.92 = 104.3 m2 (spec says 98.0 on frame lines).
Mellombygg exterior walls only 0.11 thick (inner faces 5.11/8.89); bod-wing walls 0.16 (inner 9.94 north, 8.84 east, 5.16 west).
Interior walls 0.12.

## SPLIT LEVEL (new finding)
Slab tops: west part (x 0.2..5.55) at H=-1.0 (kote 98.85); main + bod wing at H=0 (kote 99.85). "Plate pa mark" PDF confirms.
Lower level rooms: 104 Sov, 105 Sov, 106 Sov, 103 Bad, west half of 101 Korridor (x<4.3). Doors to these have H=-1..1.
Level stair: X 4.3..5.55, Y 3.17..4.17, H -0.88..-0.17 (5 steps). Loft stair: X 3.85..6.1, Y 2.24..3.04, H 0.13..1.62 (from main level up to hems, rises westward).
Hems floor top H=1.47 (slab 1.3..1.47, 173 mm). Ceiling height in lower bedrooms 2.30.

## Roof
Pitch 28 deg (section PDF + geometry). Ridge main at y=3.1 (E-W); wing ridges at x=7.0 (N-S).
Eave: top of wall at outer face H=2.22 (Plan 2 eave walls 1.55..2.22). Roof underside at overhang edge H=1.96, overhang 0.51 beyond the axis line.
Main ridge: underside 3.87, top of turf 4.18. Wing ridge: beam top 3.26, top of turf 3.59. Roof build-up ~0.31 vertical (5 layers: tro, derbigum/vortepapp, oppforing, torvtak).
Glass-bump roof extends to y=2.0 (meets main slope); bod-wing roof from y=4.2 (meets main slope) to 10.61.
Ridge beam main: X 0.03..11.97, H 3.5..3.86; posts (0.11 sq) at x=5.1, 8.95, 11.9 on y=3.1, H 0..3.5. Tie beams H 2.3..2.5: x 5.04..7.01 and 8.89..11.97 at y=3.1, plus x=8.95 from y 0.07..3.15.
Stue-kjokken is open to the roof (no flat ceiling); loft plan shows "Kaldloft" over main part east of axis 2 = no floor.
Chimney X 7.08..7.63, Y 2.48..3.03.

## Rooms (inner faces) — IFC spaces
100 Stue-kjokken 28.9 m2 (IFC) / 34.4 (PDF incl?): poly (5.16,-1.84)(8.84,-1.84)(8.84,0.16)(11.84,0.16)(11.84,6.04)(8.41,6.05)(8.41,4.3)(9,4.3)(9,3.04)(7.08,3.03)(7.06,2.12)(5.16,2.12)
101 Korridor 10.1: Y 2.23..4.17 for X 3.13..6.91 + Y 3.16..4.17 for X 6.91..9 (west end diagonals (2.32,3.11),(3.18,2.24)); open to stue at x=9, y 3.16..4.17
102 V.F. X 5.11..8.29 Y 4.3..6.04 (5.53)  | 103 Bad X 3.11..4.99 Y 4.3..6.04 (3.27)
104 Sov X 0.16..2.99 Y 3.19..6.04 diag (2.24,3.19)-(2.99,4.19) (7.69) | 105 Sov X 0.16..3.04 Y 0.16..3.02 diag (3.04,2.22)-(2.24,3.02) (7.92)
106 Sov X 3.16..5.04 Y 0.16..2.12 (3.68) | 107 Mellombygg X 5.11..8.89 Y 6.31..7.49 (4.46)
108 Bod X 7.67..8.84 Y 7.76..9.94 (2.55) | 109 Bod X 6.26..7.54 (2.79) | 110 Do X 5.16..6.15 (2.16)
200 Hems01 X 0.16..5.04 Y 0.15..2.12 + X 0.16..2.6 Y 2.12..3.04 (11.8) | 201 Hems02 X 0.16..3.73 Y 3.16..6.04 + X 3.73..4.99 Y 4.3..6.04 (12.5)
Hems partition at y 3.04..3.16 (x 0.15..3.85); landing wall x 2.6..2.71 (y 2.13..3.04); hems doors: x=2.62 wall (y 2.31..3.0, 0.71) and y=3.14 wall (x 2.84..3.63, 0.81).
Interior wall centres: x=3.05 (104|103), x=5.05 (103|102), x=8.35 (102|stue), y=4.235 (korridor|103/102), y=2.18 (106/stue|korridor), x=5.1 (106|stue), x=6.2, x=7.6 (bod wing), y=7.62 (mellombygg|boder, 0.27 thick), fireplace wall y~3.1 x 7.08..9.

## Openings (centre, w x h, sill H above main floor)
Windows lower level (sill 0.8 above lower floor = H -0.2): W wall y=3.81 1.11x1.21; S wall x=1.73 1.11x1.21; N wall x=3.51 0.61x1.21 (bad)
Main level: glass bump 1.61x1.61 sill 0.4: W y=-0.96; S x=6.07, 7.94; E y=-0.96. S wall x=10.36 1.11x1.21 sill 0.8; N wall x=10.59 1.11x1.21 sill 0.8; E gable y=1.53 and y=4.68 1.11x1.21 sill 0.8; bod wing W x=5 y=8.82 0.61x1.21 sill 0.8.
Hems W gable: y=2.44 and y=3.76, 1.11x1.01, sill H 2.0.
Doors: W green x=5 y=6.89 0.91x2.01; E green x=9 y=6.89 0.91; E gable white x=12 y=2.59 0.81 (H 0..2.01); S door from 106 x=3.68 0.91 (lower level H -1..1.01!).
Interior: mellombygg->Do x=5.64 (0.81) on y=7.62; mellombygg->VF x=7.01 (0.91) on y=6.2; mellombygg->bod109 x=7.01 (0.91) on y=7.62; no door to 108.
korridor->bad x=3.61 (0.81) on y=4.24; korridor->106 x=3.68 (0.81) on y=2.18; diagonal doors to 104 (centre 2.55,3.54) and 105 (2.65,2.73) 0.81; VF->korridor opening 1.2 ("12x20") ~x 6.9.
Swing: IFC door types single swing L/R; exterior doors swing out? (check drawing arcs: east gable door swings OUT; green doors swing OUT; 106 south door swings OUT).

## Spec deviations to report
- split level -1.0 m for west part (spec/old model assume one level)
- pitch 28 (spec ~30.8), eave 2.22/ridge 4.18 above floor (spec 2.5/4.35 above floor = 2.9/4.75 above ground)
- exterior wall 0.27 thick with 0.11 cladding outside axis; BYA 104.3 vs 98
- hems windows 1.11x1.01 at y 2.44/3.76, sill H 2.0 (spec 0.9x0.8 at 2.3/4.0, sill 2.8)
- room 106 has exterior S door (x 3.68), no window; spec D removes door, adds nothing
- east gable: white door y=2.59 + windows y=1.53/4.68 removed by extension; ridge post at x=11.9 in that wall
- loft stair position X 3.85..6.1 Y 2.24..3.04 (spec: x 4.3-5.5, y 2.3-4.1 — that area is actually the level stair)
- bod 108 currently has no door; mellombygg walls 0.11 (uninsulated)

## Site georeference (from Kartverket, 2026-10-11)
- Address point Råbuveien 565, 1866 Hadsel, gnr/bnr 78/43: lat 68.612989, lon 14.968081 (EPSG:4258).
- Building footprint (Kartverket topo tiles, PCA of the drawn footprint): main long axis bearing 16°/196°.
  Plan +x (towards the white-door gable, x=12) points to bearing 196° (SSW). Plan +y (bod wing) points to bearing 106° (ESE).
  The glass bump (plan south, low y) therefore faces WNW (286°), towards Merkesvatnet.
- Plan origin (0,0) = main building SW corner on the axis line ≈ 3.1 m E, 6.8 m N of the address point → lat 68.613050, lon 14.968157.
- Terrain (Kartverket DTM1 via ws.geonorge.no/hoydedata, grids in data/geo/elev_*.json, metres E/N from the ADDRESS point):
  ground under the living-room gable (plan x=12) ≈ 160.5 m, under the bedroom gable (x=0) ≈ 159.5, at the glass bump ≈ 159.9,
  at the bod-wing gable ≈ 160.6, under the new wing ≈ 160.2, terrace SE corner ≈ 159.5, knoll top (25 m ESE) 162.
  Lake surface in the DTM = 152.0 m (the N50 label says 155.9; the DTM is used).
- Chosen main floor elevation: 161.0 m a.s.l. (plinth ≈ 0.5 m above ground at the living-room gable, lower bedroom floor 160.0 ≈ 0.5 m above ground there).
- Conversion plan → geo offsets from the ADDRESS point (metres): E = 3.1 − 0.2756·x + 0.9613·y ; N = 6.8 − 0.9613·x − 0.2756·y
  (sin/cos of 196° and 106°). Inverse: x = −0.2756·(E−3.1) − 0.9613·(N−6.8) ; y = 0.9613·(E−3.1) − 0.2756·(N−6.8).

## Seed decisions (2026-10-11)

Where the Forslag D spec (forslag-D-spec.json) and the IFC disagree, this is what `src/model/seed/forslagD.ts` stores and why.
Rule: the IFC wins for the existing building; the spec wins for the new parts; Robin's answers of 2026-10-11 settle the rest.

- One level → split level (IFC wins): the west part x < 5.1 (y < 2.18) / x < 4.3 (2.18..4.24) / x < 5.05 (y > 4.24) is at
  -1.0 m (`zone-lower`, kind replace), the hems slab at +1.47 with thickness 0.17 (`zone-loft`, kind add) and the lower ceiling at
  2.3. The spec and the old model assumed one floor at 0.
- Eave / ridge / pitch (IFC wins): eave underside 2.22 at the axis line, main ridge 3.87, wing ridges 3.28, pitch 28 deg, roof
  build-up 0.31, overhang 0.51 / 0.35. The spec's 2.5 / 4.35 above floor and ~30.8 deg are not used. The new wing keeps the
  spec's rule "ridge at the main ridge height" (3.87, drive 'height'), so its pitch follows from the 4.8 m width (~34.5 deg).
- Wall build-up (IFC wins, applied to new blocks too): exterior walls 0.27 thick with 0.11 (cladding + battens) OUTSIDE the axis
  line, so the room sizes of the spec (measured to the axis) hold. The spec's 0.22 is not used. BYA to the cladding is therefore
  larger than the spec's 98.0 / 170.2 on the axis lines; the app shows both (BYA and "aksemal").
- Hems windows (IFC wins): 1.11 x 1.01 at y 2.44 and 3.76, sill 0.53 above the hems floor (= +2.0); the spec's 0.9 x 0.8 at
  2.3 / 4.0 with sill 2.8 is not used.
- Stair positions (IFC wins): loft stair X 3.85..6.1, Y 2.24..3.04 (rises westward); level stair X 4.3..5.55, Y 3.17..4.17 (rises
  eastward). The spec placed the loft stair at x 4.3-5.5, y 2.3-4.1, which is really the level stair.
- Opening positions (IFC wins for existing openings): e.g. the SW window at x 1.73 (spec 1.72), the bathroom window at x 3.51
  (spec 3.42), the kitchen window at 10.59 (spec 10.6), the lower west window at y 3.81 (spec 3.73), the glass-bump windows at
  x 6.07 / 7.94 and y -0.96 (spec 6.0 / 8.0 / -1.0), green doors at y 6.89 (spec 6.9). New openings use the spec's positions.
- Room 106: the IFC shows an exterior door at x 3.68 and no window; the spec removes the door and adds nothing. Robin's decision:
  the door is removed (`door-106-old`, status removed, dashed "rives") and a window 1.1 x 1.2 with sill 0.8 replaces it
  (`win-106-s`, new).
- Living-room south wall: the existing window at x 10.36 (`win-stue-s-old`) is removed and the spec's 1.6 m glass door at
  x 10.5 takes its place; the old window is stored with status removed for the plan.
- East gable (x = 12): its white door (y 2.59) and the two windows (y 1.53, 4.68) disappear with the 4 m extension. The wall no
  longer exists in Forslag D, so these openings are NOT stored (listed above only).
- Free post at x 11.9: the ridge post in the removed east gable stays as a free post (0.11 sq, 0..3.5) under the ridge beam. It
  will need an architect's decision later (note in STATUS).
- Mellombygg walls: in reality only 0.11 thick (uninsulated) and the bod-wing walls 0.16. Accepted deviation: the seed keeps the
  common 0.27 / 0.11 build-up on the bod-wing block edges and stores the old north gable at y 10.1 as an asymmetric
  `exterior-old` wall (0.11 towards the woodshed, 0.16 towards the bod). Room sizes in the mellombygg are therefore ~5 cm too
  small per side.
- Bod 108 has no door today; Forslag D gives it an exterior door on the east wall (`door-teknisk`, new) and the room becomes
  "Teknisk / vask".
- Sauna door swing: stored as { hinge 'start', side 'right' } on `w-wc-bad` (a->b runs +y, so the bathroom side +x is the RIGHT
  side); the brief's prose says 'left' but describes the same +x side. It opens OUT of the sauna.

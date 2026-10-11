# Seed data: Forslag D and the Merkesvatnet terrain

This folder holds the bundled starting point of the app: the project "Hytta ved Merkesvatnet" with the single
variant "Forslag D" (`forslagD.ts`), and the terrain heightmap it stands on (`terrain-merkesvatnet.json`).
`docs/seed-brief-forslag-d.md` is the authoritative list of what the seed contains; this file explains where the
numbers come from and how to regenerate the terrain.

## Files

| File | What |
|---|---|
| `forslagD.ts` | `createForslagD(now?)` → fresh `Project`; `createForslagDVariant(now?)`; `SEED_REVISION`, `SEED_PROJECT_ID`, `SEED_VARIANT_ID`, `TERRAIN_ASSET_ID`, `SEED_TIMESTAMP` |
| `forslagD.test.ts` | Seed invariants (areas, opening fit, anchors, ids, references) and terrain asset checks |
| `terrain-merkesvatnet.json` | `TerrainAsset` (`id: 'merkesvatnet-2026-10'`), two plan-aligned grids in metres a.s.l. **Generated — do not edit by hand.** |

`createForslagD()` builds everything programmatically from small helpers (rectangles, `wall(a, b, …)`,
`onEdge(block, side, coordinate)`, `onWallAt(wall, point)`), so opening offsets are computed from plan coordinates
(rounded to the millimetre) rather than typed in. Every call returns a new deep object; timestamps come from the
`now` argument or the fixed `SEED_TIMESTAMP` (never `Date.now()`), so tests and snapshots are deterministic.
Bump `SEED_REVISION` whenever the seed content changes; the app compares it with `Project.seedRevision`.

## Where the numbers come from

**From the architect's IFC** (`docs/kalibrering-ifc.md`, the existing cabin as built):

- Block outlines on the axis lines: main `[0,12]×[0,6.2]`, glass bump `[5,9]×[-2,0]`, bod wing `[5,9]×[6.2,10.1]`.
- Exterior wall build-up 0.27 m with 0.11 m (cladding + battens) outside the axis line; interior walls 0.12.
- Split level: the west part (lower bedrooms, bathroom, lower corridor) at −1.0 m, hems floor at +1.47 (slab 0.17),
  lower ceiling 2.3. Floor zones `zone-lower` (replace) and `zone-loft` (add) on `blk-main` encode this.
- Roof: pitch 28°, eave underside 2.22 at the axis line, main ridge underside 3.87, wing ridges 3.28, build-up 0.31,
  overhang 0.51 at the eaves AND at every gable (main roof X −0.51..12.51, glass bump Y −2.51.., bod wing ..10.61). The new
  parts use the same 0.51.
- All existing interior walls, the diagonal bedroom walls, the old exterior walls that are now inside
  (`w-mellom-boder`, `w-bod-gavl`), the loft partitions, posts, ridge/tie beams, chimney and both stairs. The existing
  main-level partitions are `fixed` 2.5 (the IFC walls run H 0..2.5, the top of the tie beams); the corridor | vindfang
  wall `w-vf-korr` runs to x 9 (no divider between the corridor and the kitchen).
- All existing openings: centre, size, sill (hems windows at sill 0.53 above the loft floor = +2.0), green doors, the
  diagonal bedroom doors at the IFC centres (`d-104` offset 0.53, `d-105` offset 0.71).

**From the spec** (`forslag-D-spec.json`, Robin's proposal D):

- Living-room extension `[12,16]×[0,6.2]` (part `part-stue-ext` of `blk-main`, same roof), new wing
  `[16,20.8]×[-2,6.2]` with its ridge at the main ridge height (pitch follows, ≈ 34.5°), new bod + woodshed
  `[5,9]×[10.1,12.1]` (part `part-bod-new` of `blk-bod`).
- New interior walls, the corridor opening, the doors of the wing, all new windows and glass doors (`door-stue-s` has two
  leaves, `leaves: 2`), the dividers that split the open plan into Stue / Kjøkken / Passasje / Spiseplass.
- The new wing has a flat ceiling at 2.4 (`blk-wing.ceilingHeight`, cold loft above); its partitions are `auto` and stop
  there. The wall between the stue and the wing (`w-wing-w`, x = 16) is `roof`: it runs up under the main ridge (3.87)
  and closes the stue's gable triangle. The two high gable windows (`win-gavl-s/n`, sill 2.75) therefore sit above the
  ceiling and light the cold loft — an open question for Robin.
- Terrace polygon, glass railing with three stair gaps, hot tub, tree positions.

**Robin's decisions (2026-10-11)** — see "Seed decisions" in `docs/kalibrering-ifc.md` for the full list:

- Where the spec and the IFC disagree about the existing building, the IFC wins (split level, pitch, wall build-up,
  hems windows, stair positions, opening positions).
- The removed exterior door of room 106 is replaced by a window (`win-106-s`); the old door and the old living-room
  window at x 10.36 are kept with status `removed` for the "rives" plan symbol.
- The east gable at x = 12 disappears with the extension; its openings are not stored. The ridge post at x 11.9 stays
  as a free post.
- No area limiter (`areaLimit: null`).
- Review fixes of 2026-10-11 (`SEED_REVISION` 2): gable overhang 0.51, existing partitions 2.5, `w-vf-korr` to x 9 (divider
  `dv-korr-ne` removed), diagonal doors at the IFC centres, the wing ceiling 2.4 with `auto` partitions, `w-wing-w` to the
  roof, the two-leaf terrace door.

Small choices made while writing the seed (the brief is silent): every opening has an explicit `levelId`; outward
swinging exterior doors hinge at the jamb nearer an adjacent wall corner, else at `start`; the sauna door opens out of
the sauna into the bathroom (+x), which is the **right** side of its host `w-wc-bad` (a→b runs +y), so it is stored as
`side: 'right'` although the brief's prose says 'left'; the removed door keeps its outward swing; the open woodshed
front has `fullHeight: true` with a nominal `height` equal to the eave height (ignored by derive).

## Regenerating the terrain

```sh
npm run build-terrain        # = node scripts/build-terrain.mjs
```

Inputs: `data/geo/elev_fine.json` (±24 m, 2 m), `elev_coarse.json` (±80 m, 5 m), `elev_wide.json` (±200 m, 10 m)
— Kartverket DTM samples `{ e, n, z }` in metres east/north of the ADDRESS point (Råbuveien 565), z in metres a.s.l.

The script converts each plan node to geo offsets with the site calibration (plan origin at E 3.1, N 6.8; plan +x
bears 196°, plan +y bears 106°; `E = 3.1 − 0.2756·x + 0.9613·y`, `N = 6.8 − 0.9613·x − 0.2756·y`), samples the finest
geo grid covering it bilinearly (fine → coarse → wide; outside all three: nearest wide sample), rounds to 2 decimals
and writes two grids:

| Grid | Plan extent | Spacing | Size |
|---|---|---|---|
| A | x −100…120, y −100…100 | 2 m | 111 × 101 |
| B | x −220…240, y −220…220 | 10 m | 47 × 45 |

Heights are **metres above sea level** (the main floor is at `Site.floorElevation` = 161.0); `geometry/terrain.ts`
converts to floor-relative heights and applies the ground works. The lake (152.0 m) lies towards plan −y (WNW).
The script prints a sanity report: ground under the living-room gable (12, 3.1) ≈ 160.5–160.6, bedroom gable (0, 3.1)
≈ 159.4–159.5, glass bump (7, −2) ≈ 159.8–159.9, bod-wing gable (7, 10.1) ≈ 160.6–160.7, and the lake sample count.
Re-run it whenever `data/geo/*` or the calibration changes, and run `npx vitest run src/model/seed` afterwards.

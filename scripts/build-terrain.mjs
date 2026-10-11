#!/usr/bin/env node
/**
 * build-terrain.mjs — resample the Kartverket elevation grids in data/geo/ into the bundled terrain asset
 * src/model/seed/terrain-merkesvatnet.json (a `TerrainAsset`, see src/model/types.ts).
 *
 * Plain Node ESM, no dependencies. Run from the repository root: `node scripts/build-terrain.mjs`
 * (or `npm run build-terrain`).
 *
 * Inputs: data/geo/elev_{fine,coarse,wide}.json = { origin, half, step, points: [{ e, n, z }] } with e/n in
 * metres east/north of the ADDRESS point (Råbuveien 565) and z in metres above sea level; the points form a
 * square grid of (2·half/step + 1)² samples, e varying fastest.
 *
 * Output: two grids aligned with the PLAN frame (docs/architecture.md "Coordinate systems"), z in metres a.s.l.:
 *   A: x −100…120, y −100…100, 2 m spacing (111 × 101 samples)
 *   B: x −220…240, y −220…220, 10 m spacing (47 × 45 samples)
 * Each plan node is converted to geo offsets with the calibration in docs/kalibrering-ifc.md
 * ("Site georeference": plan origin at E 3.1, N 6.8; plan +x bears 196°, plan +y bears 106°) and sampled
 * bilinearly from the FINEST geo grid that covers it (fine ±24 m → coarse ±80 m → wide ±200 m). Outside all
 * three, the nearest wide sample is used (edge clamp). Values are rounded to 2 decimals; the JSON is compact.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO_DIR = resolve(ROOT, 'data/geo');
const OUT_FILE = resolve(ROOT, 'src/model/seed/terrain-merkesvatnet.json');
const ASSET_ID = 'merkesvatnet-2026-10';

// Plan origin in metres E/N of the address point, and the compass bearings of the plan axes.
const ORIGIN_E = 3.1;
const ORIGIN_N = 6.8;
const BEARING_X_DEG = 196; // plan +x (towards the living-room gable / new wing)
const BEARING_Y_DEG = 106; // plan +y (towards the bod wing) = Site.planNorthBearing

const PLAN_GRIDS = [
  { x0: -100, x1: 120, y0: -100, y1: 100, step: 2 },
  { x0: -220, x1: 240, y0: -220, y1: 220, step: 10 },
];

const toRad = (deg) => (deg * Math.PI) / 180;
const X_DIR = { e: Math.sin(toRad(BEARING_X_DEG)), n: Math.cos(toRad(BEARING_X_DEG)) }; // (−0.2756, −0.9613)
const Y_DIR = { e: Math.sin(toRad(BEARING_Y_DEG)), n: Math.cos(toRad(BEARING_Y_DEG)) }; // (0.9613, −0.2756)

/** Plan (x, y) → geo offsets (e, n) from the address point, metres. */
export function planToGeo(x, y) {
  return {
    e: ORIGIN_E + x * X_DIR.e + y * Y_DIR.e,
    n: ORIGIN_N + x * X_DIR.n + y * Y_DIR.n,
  };
}

/** Load one geo grid into a dense row-major array indexed [j * n + i] with i along e and j along n. */
export function loadGeoGrid(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const { half, step } = raw;
  const n = Math.round((2 * half) / step) + 1;
  const z = new Array(n * n).fill(NaN);
  for (const p of raw.points) {
    const i = Math.round((p.e + half) / step);
    const j = Math.round((p.n + half) / step);
    if (i < 0 || i >= n || j < 0 || j >= n) throw new Error(`${file}: point outside grid (${p.e}, ${p.n})`);
    if (typeof p.z !== 'number' || !Number.isFinite(p.z)) throw new Error(`${file}: bad z at (${p.e}, ${p.n})`);
    z[j * n + i] = p.z;
  }
  const missing = z.filter((v) => Number.isNaN(v)).length;
  if (missing > 0) throw new Error(`${file}: ${missing} grid cells have no sample`);
  return { half, step, n, z };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Bilinear sample of a geo grid at (e, n). Returns null when the point lies outside the grid. */
export function sampleGeo(grid, e, n) {
  const { half, step, n: size, z } = grid;
  if (e < -half || e > half || n < -half || n > half) return null;
  const fi = (e + half) / step;
  const fj = (n + half) / step;
  const i0 = clamp(Math.floor(fi), 0, size - 2);
  const j0 = clamp(Math.floor(fj), 0, size - 2);
  const tx = fi - i0;
  const ty = fj - j0;
  const z00 = z[j0 * size + i0];
  const z10 = z[j0 * size + i0 + 1];
  const z01 = z[(j0 + 1) * size + i0];
  const z11 = z[(j0 + 1) * size + i0 + 1];
  return (1 - ty) * ((1 - tx) * z00 + tx * z10) + ty * ((1 - tx) * z01 + tx * z11);
}

/** Nearest sample of a geo grid, with indices clamped to the grid (used outside every grid). */
export function nearestGeo(grid, e, n) {
  const { half, step, n: size, z } = grid;
  const i = clamp(Math.round((e + half) / step), 0, size - 1);
  const j = clamp(Math.round((n + half) / step), 0, size - 1);
  return z[j * size + i];
}

/** Height a.s.l. at geo offsets (e, n): finest covering grid, bilinear; else nearest sample of the last grid. */
export function sampleFinest(geoGrids, e, n) {
  for (const grid of geoGrids) {
    const v = sampleGeo(grid, e, n);
    if (v !== null) return v;
  }
  return nearestGeo(geoGrids[geoGrids.length - 1], e, n);
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Build one plan-aligned TerrainGrid (row-major z[j * nx + i], i along x, j along y). */
export function buildPlanGrid(spec, geoGrids) {
  const nx = Math.round((spec.x1 - spec.x0) / spec.step) + 1;
  const ny = Math.round((spec.y1 - spec.y0) / spec.step) + 1;
  const z = new Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = spec.y0 + j * spec.step;
    for (let i = 0; i < nx; i++) {
      const x = spec.x0 + i * spec.step;
      const g = planToGeo(x, y);
      z[j * nx + i] = round2(sampleFinest(geoGrids, g.e, g.n));
    }
  }
  return { x0: spec.x0, y0: spec.y0, dx: spec.step, dy: spec.step, nx, ny, z };
}

/** Bilinear sample of a finished plan grid (same rule the app uses), null outside. */
export function samplePlanGrid(grid, x, y) {
  const fi = (x - grid.x0) / grid.dx;
  const fj = (y - grid.y0) / grid.dy;
  if (fi < 0 || fi > grid.nx - 1 || fj < 0 || fj > grid.ny - 1) return null;
  const i0 = clamp(Math.floor(fi), 0, grid.nx - 2);
  const j0 = clamp(Math.floor(fj), 0, grid.ny - 2);
  const tx = fi - i0;
  const ty = fj - j0;
  const at = (i, j) => grid.z[j * grid.nx + i];
  return (1 - ty) * ((1 - tx) * at(i0, j0) + tx * at(i0 + 1, j0)) + ty * ((1 - tx) * at(i0, j0 + 1) + tx * at(i0 + 1, j0 + 1));
}

function main() {
  const geoGrids = ['elev_fine.json', 'elev_coarse.json', 'elev_wide.json'].map((f) => loadGeoGrid(resolve(GEO_DIR, f)));
  for (let k = 1; k < geoGrids.length; k++) {
    if (geoGrids[k].half <= geoGrids[k - 1].half) throw new Error('geo grids must be ordered finest (smallest) first');
  }

  const grids = PLAN_GRIDS.map((spec) => buildPlanGrid(spec, geoGrids));
  const asset = { id: ASSET_ID, grids };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(asset) + '\n', 'utf8');

  // --- report -------------------------------------------------------------------------------------------
  const [a, b] = grids;
  console.log(`wrote ${OUT_FILE}`);
  console.log(`grid A: ${a.nx} x ${a.ny} @ ${a.dx} m, z ${Math.min(...a.z)} .. ${Math.max(...a.z)}`);
  console.log(`grid B: ${b.nx} x ${b.ny} @ ${b.dx} m, z ${Math.min(...b.z)} .. ${Math.max(...b.z)}`);
  const checks = [
    ['living-room gable (12, 3.1)', 12, 3.1, 160.5],
    ['bedroom gable (0, 3.1)', 0, 3.1, 159.5],
    ['glass bump (7, -2)', 7, -2, 159.9],
    ['bod-wing gable (7, 10.1)', 7, 10.1, 160.6],
  ];
  for (const [label, x, y, expected] of checks) {
    const v = samplePlanGrid(a, x, y);
    console.log(`  ${label}: ${v.toFixed(2)} m a.s.l. (expected ≈ ${expected})`);
  }
  let lake = 0;
  let lakeSumX = 0;
  let lakeSumY = 0;
  for (let j = 0; j < b.ny; j++) {
    for (let i = 0; i < b.nx; i++) {
      if (b.z[j * b.nx + i] <= 152.5) {
        lake++;
        lakeSumX += b.x0 + i * b.dx;
        lakeSumY += b.y0 + j * b.dy;
      }
    }
  }
  if (lake > 0) {
    console.log(`  lake (z <= 152.5) in grid B: ${lake} samples, centroid plan (${(lakeSumX / lake).toFixed(0)}, ${(lakeSumY / lake).toFixed(0)})`);
  } else {
    console.log('  WARNING: no lake samples (z <= 152.5) in grid B');
  }
}

main();

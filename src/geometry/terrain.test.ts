import { describe, expect, it } from 'vitest';
import type { Site, TerrainAsset, TerrainGrid } from '../model/types';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import { TERRAIN_FALLBACK_Z, applyGroundWorks, sampleGridAsl, sampleTerrainAsl, terrainZAt } from './terrain';

/**
 * 3×3 synthetic grid over x 0..2 (dx 1), y 10..14 (dy 2):
 *   row j = 0 (y 10): 100 101 102
 *   row j = 1 (y 12): 110 111 112
 *   row j = 2 (y 14): 120 125 130   (not planar: bilinear, not linear)
 */
const GRID: TerrainGrid = { x0: 0, y0: 10, dx: 1, dy: 2, nx: 3, ny: 3, z: [100, 101, 102, 110, 111, 112, 120, 125, 130] };

/** Coarse grid covering x −10..10, y 0..20 with z = 150 + x (planar). */
const COARSE: TerrainGrid = {
  x0: -10,
  y0: 0,
  dx: 10,
  dy: 10,
  nx: 3,
  ny: 3,
  z: [140, 150, 160, 140, 150, 160, 140, 150, 160],
};

const SITE: Site = {
  originLatLon: { lat: 68.61305, lon: 14.968157 },
  planNorthBearing: 106,
  floorElevation: 100,
  terrainId: 't',
  groundWorks: [],
  timezone: 'Europe/Oslo',
  trees: [],
};

describe('sampleGridAsl (bilinear)', () => {
  it('returns the node values at the nodes', () => {
    expect(sampleGridAsl(GRID, 0, 10)).toBe(100);
    expect(sampleGridAsl(GRID, 2, 10)).toBe(102);
    expect(sampleGridAsl(GRID, 1, 12)).toBe(111);
    expect(sampleGridAsl(GRID, 2, 14)).toBe(130); // max corner, boundary inclusive
  });

  it('interpolates bilinearly inside cells and along edges', () => {
    expect(sampleGridAsl(GRID, 0.5, 10)).toBeCloseTo(100.5, 12);
    expect(sampleGridAsl(GRID, 0, 11)).toBeCloseTo(105, 12);
    expect(sampleGridAsl(GRID, 0.5, 11)).toBeCloseTo((100 + 101 + 110 + 111) / 4, 12);
    // Upper-right cell: corners 111, 112, 125, 130 → centre = mean, (1.25, 12.5) by the formula.
    expect(sampleGridAsl(GRID, 1.5, 13)).toBeCloseTo((111 + 112 + 125 + 130) / 4, 12);
    const tx = 0.25;
    const ty = 0.25;
    const expected = (1 - ty) * ((1 - tx) * 111 + tx * 112) + ty * ((1 - tx) * 125 + tx * 130);
    expect(sampleGridAsl(GRID, 1.25, 12.5)).toBeCloseTo(expected, 12);
    expect(sampleGridAsl(GRID, 2, 13)).toBeCloseTo((112 + 130) / 2, 12);
  });

  it('returns null outside the grid (beyond the tolerance)', () => {
    expect(sampleGridAsl(GRID, -0.01, 12)).toBeNull();
    expect(sampleGridAsl(GRID, 2.01, 12)).toBeNull();
    expect(sampleGridAsl(GRID, 1, 9.99)).toBeNull();
    expect(sampleGridAsl(GRID, 1, 14.01)).toBeNull();
    expect(sampleGridAsl(GRID, Number.NaN, 12)).toBeNull();
    expect(sampleGridAsl(GRID, 2 + 1e-12, 14 + 1e-12)).toBe(130);
  });

  it('degenerate grids: single column, bad spacing, missing / NaN values', () => {
    const column: TerrainGrid = { x0: 5, y0: 0, dx: 1, dy: 1, nx: 1, ny: 2, z: [10, 20] };
    expect(sampleGridAsl(column, 5, 0.5)).toBeCloseTo(15, 12);
    expect(sampleGridAsl(column, 5.5, 0.5)).toBeNull();
    expect(sampleGridAsl({ ...GRID, dx: 0 }, 1, 12)).toBeNull();
    expect(sampleGridAsl({ ...GRID, dy: -2 }, 1, 12)).toBeNull();
    expect(sampleGridAsl({ ...GRID, nx: 0 }, 0, 10)).toBeNull();
    expect(sampleGridAsl({ ...GRID, z: GRID.z.slice(0, 7) }, 1.5, 13)).toBeNull();
    expect(sampleGridAsl({ ...GRID, z: GRID.z.slice(0, 7) }, 0.5, 11)).toBeCloseTo(105.5, 12);
    const holed = { ...GRID, z: [...GRID.z] };
    holed.z[4] = Number.NaN;
    expect(sampleGridAsl(holed, 0.5, 11)).toBeNull();
    expect(sampleGridAsl(holed, 2, 10)).toBeNull(); // node (1,1) of the sampled cell is NaN
    expect(sampleGridAsl(holed, 2, 14)).toBeNull(); // cell (1,1)-(2,2) also contains it
  });
});

describe('sampleTerrainAsl (finest covering grid)', () => {
  it('prefers the finest grid, whatever the asset order', () => {
    for (const grids of [
      [GRID, COARSE],
      [COARSE, GRID],
    ]) {
      const t: TerrainAsset = { id: 't', grids };
      expect(sampleTerrainAsl(t, 0.5, 11)).toBeCloseTo(105.5, 12);
      expect(sampleTerrainAsl(t, -5, 5)).toBeCloseTo(145, 12); // only the coarse grid covers it
      expect(sampleTerrainAsl(t, 50, 50)).toBeNull();
    }
  });

  it('falls back to a coarser grid where the finer one has no data', () => {
    const holed = { ...GRID, z: [...GRID.z] };
    holed.z[4] = Number.NaN;
    const t: TerrainAsset = { id: 't', grids: [holed, COARSE] };
    expect(sampleTerrainAsl(t, 0.5, 11)).toBeCloseTo(150.5, 12);
    expect(sampleTerrainAsl({ id: 'e', grids: [] }, 0, 0)).toBeNull();
  });

  it('samples the bundled Merkesvatnet asset at the calibration points', () => {
    const t = terrainJson as TerrainAsset;
    const gable = sampleTerrainAsl(t, 12, 3.1)!;
    expect(gable).toBeGreaterThan(160.2);
    expect(gable).toBeLessThan(160.9);
    expect(sampleTerrainAsl(t, 0, 3.1)!).toBeLessThan(gable);
    expect(sampleTerrainAsl(t, 230, 0)).not.toBeNull(); // coarse grid only
    expect(sampleTerrainAsl(t, 1000, 0)).toBeNull();
  });
});

describe('terrainZAt (relative to the main floor, after ground works)', () => {
  const terrain: TerrainAsset = { id: 't', grids: [GRID, COARSE] };

  it('subtracts the floor elevation', () => {
    expect(terrainZAt(terrain, SITE, 1, 12)).toBeCloseTo(11, 12);
    expect(terrainZAt(terrain, SITE, -5, 5)).toBeCloseTo(45, 12);
  });

  it('falls back to −0.5 where no grid covers the point or without terrain', () => {
    expect(TERRAIN_FALLBACK_Z).toBe(-0.5);
    expect(terrainZAt(terrain, SITE, 50, 50)).toBe(-0.5);
    expect(terrainZAt(null, SITE, 1, 12)).toBe(-0.5);
  });

  it('ground works cut (never fill), boundary inclusive, lowest of overlapping works', () => {
    const site: Site = {
      ...SITE,
      groundWorks: [
        { id: 'a', polygon: [[0, 10], [1, 10], [1, 12], [0, 12]], maxZ: 1 },
        { id: 'b', polygon: [[0.5, 11], [2, 11], [2, 14], [0.5, 14]], maxZ: 5 },
        { id: 'fill', polygon: [[-10, 0], [-4, 0], [-4, 6], [-10, 6]], maxZ: 60 },
        { id: 'far', polygon: [[40, 40], [60, 40], [60, 60], [40, 60]], maxZ: -1.2 },
      ],
    };
    expect(terrainZAt(terrain, site, 0.25, 10.5)).toBe(1); // inside a only (terrain 2.75)
    expect(terrainZAt(terrain, site, 0.75, 11.5)).toBe(1); // a and b overlap → lowest (terrain 8.25)
    expect(terrainZAt(terrain, site, 1.5, 13)).toBe(5); // inside b only (terrain 19.5)
    expect(terrainZAt(terrain, site, 1, 12)).toBe(1); // on a's corner = inside
    expect(terrainZAt(terrain, site, -5, 5)).toBeCloseTo(45, 12); // maxZ above the terrain: no fill
    expect(terrainZAt(terrain, site, 50, 50)).toBe(-1.2); // the fallback is cut too
    expect(terrainZAt(terrain, site, 2, 10)).toBeCloseTo(2, 12); // outside every work
    expect(applyGroundWorks(site, 0.5, 10.5, 3)).toBe(1);
    expect(applyGroundWorks(site, 0.5, 10.5, 0.5)).toBe(0.5); // never fills
  });

  it('extra ground works (e.g. the implicit cuts under the blocks) are applied with the site ones', () => {
    const extra = [{ id: 'gw-blk', polygon: [[0, 10], [2, 10], [2, 14], [0, 14]] as [number, number][], maxZ: 3 }];
    expect(terrainZAt(terrain, SITE, 1, 12, extra)).toBe(3);
    expect(terrainZAt(terrain, SITE, 1, 12)).toBeCloseTo(11, 12);
    expect(terrainZAt(terrain, SITE, -5, 5, extra)).toBeCloseTo(45, 12); // outside the extra cut
    const site: Site = { ...SITE, groundWorks: [{ id: 's', polygon: extra[0].polygon, maxZ: 1 }] };
    expect(terrainZAt(terrain, site, 1, 12, extra)).toBe(1); // the lowest cut wins, whichever list it is in
    expect(applyGroundWorks(SITE, 1, 12, 9, extra)).toBe(3);
  });

  it('the seed: the building plot is cut to −0.45, the bedroom gable is not', () => {
    const project = createForslagD();
    const t = terrainJson as TerrainAsset;
    const site = project.site;
    expect(terrainZAt(t, site, 12, 3.1)).toBeLessThanOrEqual(-0.45);
    expect(terrainZAt(t, site, 12, 3.1)).toBeCloseTo(Math.min(-0.45, sampleTerrainAsl(t, 12, 3.1)! - 161), 12);
    expect(terrainZAt(t, site, 0, 3.1)).toBeCloseTo(sampleTerrainAsl(t, 0, 3.1)! - 161, 12);
  });
});

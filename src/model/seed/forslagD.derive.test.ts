/**
 * Forslag D through the real derive pipeline: rooms detected and named, no structural warnings, the axis total, and
 * the room areas against the architect's IFC spaces (docs/kalibrering-ifc.md). Prints the room schedule and the area
 * summary (console.table) so a run doubles as a report: `npx vitest run src/model/seed/forslagD.derive.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { deriveVariant } from '../../geometry/derive';
import { area, bbox, pointInPolygon } from '../../geometry/polygon';
import { combinedUndersideAt } from '../../geometry/roof';
import { terrainZAt } from '../../geometry/terrain';
import type { DerivedFloor, DerivedRoom, RoofSlope } from '../derived';
import type { TerrainAsset, Vec2 } from '../types';
import { createForslagD } from './forslagD';
import terrainJson from './terrain-merkesvatnet.json';

const project = createForslagD();
const variant = project.variants[0];
const terrain = terrainJson as unknown as TerrainAsset;
const derived = deriveVariant(variant, project.site, terrain);

const NAMES = [
  'Soverom 1',
  'Soverom 2',
  'Soverom 3',
  'Bad',
  'Korridor (nedre)',
  'Korridor (øvre)',
  'Vindfang',
  'Leseskrok',
  'Stue',
  'Kjøkken',
  'Passasje',
  'Spiseplass',
  'Mellombygg',
  'Do',
  'Bod',
  'Teknisk / vask',
  'Bod (ny)',
  'Ved',
  'Gang',
  'Soverom (ny fløy)',
  'Pantry',
  'WC',
  'Hovedbad',
  'Badstue',
  'Hems 1 (soverom)',
  'Hems 2 (soverom)',
  'Trapperepos',
];

/** Net areas of the IFC spaces (inner faces), m². */
const IFC_AREA: Record<string, number> = {
  Bad: 3.27,
  'Soverom 1': 7.69,
  'Soverom 2': 7.92,
  'Soverom 3': 3.68,
  Vindfang: 5.53,
  Mellombygg: 4.46,
  Do: 2.16,
  Bod: 2.79,
  'Teknisk / vask': 2.55,
  'Hems 1 (soverom)': 11.8,
  'Hems 2 (soverom)': 12.5,
};

const byName = new Map<string, DerivedRoom>();
for (const r of derived.rooms) if (r.room) byName.set(r.room.name, r);

const fmt = (v: number, d = 2) => v.toFixed(d).replace('.', ',');

describe('Forslag D derived', () => {
  it('is the real pipeline (not the stub)', () => {
    expect(derived.warnings.filter((w) => w.kind === 'generic')).toEqual([]);
    expect(derived.walls.length).toBeGreaterThan(0);
    expect(derived.roofs.length).toBe(4);
  });

  it('detects and names every room of the seed', () => {
    const missing = NAMES.filter((n) => !byName.has(n));
    expect(missing).toEqual([]);
    expect(derived.rooms.filter((r) => !r.room).map((r) => `${r.id} ${r.levelId} ${r.area.toFixed(2)}`)).toEqual([]);
    expect(derived.warnings.filter((w) => w.kind === 'room-anchor-lost' || w.kind === 'room-unnamed')).toEqual([]);
  });

  it('puts the rooms on their levels', () => {
    for (const n of ['Soverom 1', 'Soverom 2', 'Soverom 3', 'Bad', 'Korridor (nedre)']) expect(byName.get(n)?.levelId, n).toBe('lower');
    for (const n of ['Korridor (øvre)', 'Stue', 'Kjøkken', 'Hovedbad', 'Badstue', 'Ved']) expect(byName.get(n)?.levelId, n).toBe('main');
    for (const n of ['Hems 1 (soverom)', 'Hems 2 (soverom)', 'Trapperepos']) expect(byName.get(n)?.levelId, n).toBe('loft');
  });

  it('has no dangling walls and no opening outside its host', () => {
    expect(derived.warnings.filter((w) => w.kind === 'wall-dangling' || w.kind === 'opening-outside-host')).toEqual([]);
  });

  it('has only expected warnings', () => {
    expect(derived.warnings).toEqual([]);
  });

  it('has the axis total of the spec (170.16 m²)', () => {
    expect(derived.areas.axis.total).toBeCloseTo(170.16, 2);
    expect(derived.areas.axis.existing).toBeCloseTo(98.0, 2);
    expect(derived.areas.axis.new).toBeCloseTo(72.16, 2);
  });

  it('keeps the BYA / BRA invariants', () => {
    const { bya, bra } = derived.areas;
    expect(bya.existing + bya.new).toBeCloseTo(bya.total, 6);
    expect(bya.buildings + bya.decks).toBeCloseTo(bya.total, 6);
    expect(bra.existing + bra.new).toBeCloseTo(bra.total, 6);
    expect(bra.perLevel.reduce((s, l) => s + l.area, 0)).toBeCloseTo(bra.total, 6);
  });

  it('matches the IFC room areas within 0.15 m²', () => {
    const rows = Object.entries(IFC_AREA).map(([name, ifc]) => ({ name, ifc, derived: byName.get(name)?.area ?? NaN }));
    for (const r of rows) expect(Math.abs(r.derived - r.ifc), `${r.name}: ${r.derived.toFixed(2)} vs IFC ${r.ifc}`).toBeLessThanOrEqual(0.15);
  });

  it('prints the room schedule and the area summary', () => {
    const levelName = new Map(derived.levels.map((l) => [l.id, l.name]));
    const levelIndex = new Map(derived.levels.map((l, i) => [l.id, i]));
    const sorted = [...derived.rooms].sort(
      (a, b) => (levelIndex.get(a.levelId) ?? 0) - (levelIndex.get(b.levelId) ?? 0) || (a.room?.name ?? a.id).localeCompare(b.room?.name ?? b.id, 'nb'),
    );
    const rows = sorted.map((r) => {
      const name = r.room?.name ?? r.id;
      const ifc = IFC_AREA[name];
      return {
        rom: name,
        nivå: levelName.get(r.levelId) ?? r.levelId,
        mål: `${r.dims.approx ? 'ca. ' : ''}${fmt(r.dims.w)} × ${fmt(r.dims.h)}`,
        areal: fmt(r.area),
        eksisterende: fmt(r.areaExisting),
        nytt: fmt(r.areaNew),
        IFC: ifc === undefined ? '' : fmt(ifc),
        avvik: ifc === undefined ? '' : fmt(r.area - ifc),
      };
    });
    console.table(rows);
    const { bya, bra, axis } = derived.areas;
    console.table([
      { areal: 'BYA', total: fmt(bya.total), eksisterende: fmt(bya.existing), nytt: fmt(bya.new), merknad: `bygg ${fmt(bya.buildings)} + terrasse ${fmt(bya.decks)}` },
      ...bra.perLevel.map((l) => ({ areal: `BRA ${l.name}`, total: fmt(l.area), eksisterende: '', nytt: '', merknad: `brutto ${fmt(l.gross)}` })),
      { areal: 'BRA', total: fmt(bra.total), eksisterende: fmt(bra.existing), nytt: fmt(bra.new), merknad: '' },
      { areal: 'Aksemål', total: fmt(axis.total), eksisterende: fmt(axis.existing), nytt: fmt(axis.new), merknad: '' },
    ]);
    console.log('warnings', JSON.stringify(derived.warnings));
    expect(rows.length).toBe(derived.rooms.length);
  });
});

/** Points of a regular grid (step m) inside the polygon and outside its holes. */
function samples(polygon: Vec2[], holes: Vec2[][], step: number): Vec2[] {
  const { min, max } = bbox(polygon);
  const out: Vec2[] = [];
  for (let x = min[0] + step / 2; x < max[0]; x += step) {
    for (let y = min[1] + step / 2; y < max[1]; y += step) {
      const p: Vec2 = [x, y];
      if (pointInPolygon(p, polygon) && !holes.some((h) => pointInPolygon(p, h))) out.push(p);
    }
  }
  return out;
}

/** Underside z of a slope's plane at p (its polygon is the top surface). */
function slopeUnderside(s: RoofSlope, thickness: number, p: Vec2): number {
  const [x0, y0, z0] = s.polygon[0];
  const [nx, ny, nz] = s.normal;
  return z0 - (nx * (p[0] - x0) + ny * (p[1] - y0)) / nz - thickness;
}

const covers = (f: DerivedFloor, p: Vec2): boolean => pointInPolygon(p, f.polygon) && !f.holes.some((h) => pointInPolygon(p, h));
const floorArea = (f: DerivedFloor): number => area(f.polygon) - f.holes.reduce((acc, h) => acc + area(h), 0);

describe('Forslag D derived: review fixes', () => {
  it('no roof slab hangs below the roof envelope inside a room (0.1 m samples)', () => {
    const bad: string[] = [];
    for (const r of derived.rooms) {
      for (const p of samples(r.polygon, r.holes, 0.1)) {
        const top = combinedUndersideAt(derived.roofs, p[0], p[1]);
        if (top === null) continue;
        for (const roof of derived.roofs) {
          for (const s of roof.slopes) {
            if (!pointInPolygon(p, s.polygon.map((q): Vec2 => [q[0], q[1]]))) continue;
            const z = slopeUnderside(s, roof.thickness, p);
            if (z < top - 0.02) bad.push(`${r.room?.name ?? r.id}: ${roof.blockId} ${z.toFixed(2)} < ${top.toFixed(2)} at (${p[0].toFixed(2)}, ${p[1].toFixed(2)})`);
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('stairs: no floor above a stair bottom covers its footprint; the level stair is cut out with a floor at -1', () => {
    const stairs = derived.structure.flatMap((s) => (s.kind === 'stair' ? [s] : []));
    expect(stairs.map((s) => s.id).sort()).toEqual(['stair-level', 'stair-loft']);
    for (const s of stairs) {
      const { min, max } = bbox(s.footprint);
      const inner = samples(s.footprint, [], 0.05).filter((p) => p[0] > min[0] + 0.01 && p[0] < max[0] - 0.01 && p[1] > min[1] + 0.01 && p[1] < max[1] - 0.01);
      expect(inner.length).toBeGreaterThan(100);
      for (const f of derived.floors) {
        if (f.kind === 'ceiling' || f.z <= s.fromZ + 1e-6) continue;
        expect(inner.filter((p) => covers(f, p)).length, `${f.id} over ${s.id}`).toBe(0);
      }
    }
    // The level stair (4.3–5.55 × 3.17–4.17) is a notch in the upper corridor's floor and has a floor at −1 below.
    const korr = derived.rooms.find((r) => r.id === 'room-korr-ovre')!;
    const korrFloors = derived.floors.filter((f) => f.roomId === 'room-korr-ovre');
    expect(korrFloors.reduce((acc, f) => acc + floorArea(f), 0)).toBeCloseTo(korr.area - 1.25 * 1.0, 6);
    expect(korrFloors.some((f) => covers(f, [4.9, 3.7]))).toBe(false);
    const well = derived.floors.find((f) => f.id === 'stair-level/stairwell')!;
    expect(well).toMatchObject({ kind: 'slab', levelId: 'lower', z: -1 });
    expect(area(well.polygon)).toBeCloseTo(1.25, 9);
    expect(derived.floors.some((f) => f.id.startsWith('stair-loft/'))).toBe(false); // its bottom is covered
  });

  it('the terrain stays below every block floor: lowestFloorZ − 0.05 inside each outer outline', () => {
    for (const db of derived.blocks) {
      for (const p of samples(db.outer, [], 0.25)) {
        const z = terrainZAt(terrain, project.site, p[0], p[1], derived.groundWorks);
        expect(z, `${db.block.id} at (${p[0]}, ${p[1]})`).toBeLessThan(db.lowestFloorZ - 0.05);
      }
    }
    const bad = byName.get('Bad')!;
    for (const p of samples(bad.polygon, bad.holes, 0.05)) expect(terrainZAt(terrain, project.site, p[0], p[1], derived.groundWorks)).toBeLessThan(-1.05);
    expect(derived.groundWorks.map((g) => g.id)).toEqual(['gw-tomt', 'gw-blk-main', 'gw-blk-glass', 'gw-blk-bod', 'gw-blk-wing']);
  });

  // Needs the seed's w-wing-w with heightMode 'roof' (seed engineer, same round of review fixes).
  it('the wall x = 16 (stue | new wing) peaks under the main ridge at 3.87', () => {
    const w = derived.walls.find((x) => x.id === 'w-wing-w')!;
    expect(w.topZ).toBeCloseTo(3.87, 2);
  });

  it('the new wing has a flat ceiling at 2.4 and its partitions stop there', () => {
    const ceiling = derived.floors.find((f) => f.id === 'blk-wing/ceiling')!;
    expect(ceiling).toMatchObject({ kind: 'ceiling', levelId: 'main', thickness: 0.05, isNew: true });
    expect(ceiling.z).toBeCloseTo(2.45, 9);
    for (const id of ['w-gang-s', 'w-gang-n', 'w-pantry-wc', 'w-sauna-n', 'w-wc-bad']) {
      expect(derived.walls.find((x) => x.id === id)!.topZ, id).toBeCloseTo(2.4, 9);
    }
  });

  it('door-stue-s is a double door: two 0.8 m leaves opening out', () => {
    const o = derived.walls.flatMap((w) => w.openings).find((x) => x.id === 'door-stue-s')!;
    const a = o.swing!;
    const b = o.swing2!;
    expect(Math.hypot(a.closed[0] - a.hinge[0], a.closed[1] - a.hinge[1])).toBeCloseTo(0.8, 9);
    expect(Math.hypot(b.closed[0] - b.hinge[0], b.closed[1] - b.hinge[1])).toBeCloseTo(0.8, 9);
    expect(a.open[1]).toBeLessThan(-0.5);
    expect(b.open[1]).toBeLessThan(-0.5);
  });

  it('infill patches never overlap the openings that stay in the same wall piece', () => {
    for (const w of derived.walls) {
      for (const p of w.patches) {
        for (const o of w.openings.filter((x) => x.status !== 'removed')) {
          const ds = Math.min(p.offset + p.width / 2, o.offset + o.width / 2) - Math.max(p.offset - p.width / 2, o.offset - o.width / 2);
          const dz = Math.min(p.headZ, o.headZ) - Math.max(p.sillZ, o.sillZ);
          expect(ds > 1e-6 && dz > 1e-6, `${w.id}: patch over ${o.id}`).toBe(false);
        }
      }
    }
  });

  it('measures the loft BRA exactly: free height ≥ 1.9 m (y 2.163–4.037) plus the 0.6 m strip = 12.54 m²', () => {
    const loft = derived.areas.bra.perLevel.find((l) => l.levelId === 'loft')!;
    expect(loft.area).toBeCloseTo(12.536, 2);
  });
});

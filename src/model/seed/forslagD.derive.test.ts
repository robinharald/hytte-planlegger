/**
 * Forslag D through the real derive pipeline: rooms detected and named, no structural warnings, the axis total, and
 * the room areas against the architect's IFC spaces (docs/kalibrering-ifc.md). Prints the room schedule and the area
 * summary (console.table) so a run doubles as a report: `npx vitest run src/model/seed/forslagD.derive.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { deriveVariant } from '../../geometry/derive';
import type { DerivedRoom } from '../derived';
import type { TerrainAsset } from '../types';
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

import { describe, expect, it } from 'vitest';
import type { ModelWarning } from '../model/derived';
import { nb, warningText } from '../i18n/nb';
import { resolveSelection, sameSelection } from '../state/selection';
import type { Selection } from '../state/selection';
import { makeVariant } from '../state/testProject';
import { formatLength, formatPoint } from './format';
import { describeSelection, wallTitle } from './properties';
import { buildingSplit } from './areaFigures';
import { buildSchedule, planStoreyOf, shortLevelName, shortName, sortByLevelElevation, SPLIT_MIN_AREA } from './schedule';
import { projectSubtitle } from './labels';
import { EXT_WALL, INT_WALL, makeDerived } from './testDerived';
import { makeNameLookup, warningItems, warningTarget } from './warnings';

const resolve = (sel: Selection) => {
  const r = resolveSelection(makeDerived(), sel);
  if (!r) throw new Error(`unresolved ${sel.kind} ${sel.id}`);
  return r;
};

describe('format extras', () => {
  it('formatLength and formatPoint', () => {
    expect(formatLength(0.12)).toBe('0,12 m');
    expect(formatLength(2.2, 1)).toBe('2,2 m');
    expect(formatPoint([5, 6.2])).toBe('(5,0; 6,2)');
  });
});

describe('buildSchedule', () => {
  const schedule = buildSchedule(makeDerived());

  it('groups by level in ascending elevation and skips empty levels', () => {
    expect(schedule.groups.map((g) => g.levelId)).toEqual(['lower', 'main', 'loft']);
    expect(schedule.count).toBe(6);
  });

  it('sorts named rooms by name and puts unnamed faces last', () => {
    const main = schedule.groups.find((g) => g.levelId === 'main');
    expect(main?.rows.map((r) => r.name)).toEqual(['Hovedbad', 'Stue', nb.schedule.unnamed]);
    expect(main?.rows[2].unnamed).toBe(true);
    expect(main?.rows[2].typeName).toBeNull();
  });

  it('marks the dominant part and rooms spanning both', () => {
    const rows = schedule.groups.flatMap((g) => g.rows);
    const byId = (id: string) => rows.find((r) => r.id === id);
    expect(byId('room-1')?.part).toBe('existing');
    expect(byId('room-1')?.mixed).toBe(false);
    expect(byId('room-2')?.part).toBe('new');
    expect(byId('gang')?.mixed).toBe(true);
    expect(byId('gang')?.dims).toBe('2,0 × 2,5 m');
    expect(byId('room-1')?.selection).toEqual({ kind: 'room', id: 'room-1', levelId: 'main' });
  });

  it('excludes stair voids from the sums', () => {
    const loft = schedule.groups.find((g) => g.levelId === 'loft');
    expect(loft?.rows.find((r) => r.id === 'void')?.isVoid).toBe(true);
    expect(loft?.total).toBeCloseTo(8);
    expect(schedule.total).toBeCloseTo(5 + 20.04 + 6.5 + 1.2 + 8);
  });

  it('handles an empty model and rooms on unknown levels', () => {
    expect(buildSchedule(makeDerived({ rooms: [] }))).toEqual({ groups: [], total: 0, count: 0 });
    const d = makeDerived();
    const odd = buildSchedule({ ...d, rooms: [{ ...d.rooms[0], levelId: 'attic' }] });
    expect(odd.groups.map((g) => [g.levelId, g.levelName])).toEqual([['attic', 'attic']]);
  });

  it('treats tiny shares as not spanning', () => {
    const d = makeDerived();
    const tiny = { ...d.rooms[0], areaExisting: 20, areaNew: SPLIT_MIN_AREA / 2 };
    expect(buildSchedule({ ...d, rooms: [tiny] }).groups[0].rows[0].mixed).toBe(false);
  });

  it('helpers', () => {
    expect(shortLevelName('Underetasje (soverom)')).toBe('Underetasje');
    expect(shortLevelName('Hems')).toBe('Hems');
    expect(planStoreyOf('loft')).toBe('loft');
    expect(planStoreyOf('ground')).toBe('ground');
    const d = makeDerived();
    expect(sortByLevelElevation(d.areas.bra.perLevel, d.levels).map((l) => l.levelId)).toEqual(['lower', 'main', 'loft']);
  });
});

describe('describeSelection', () => {
  const derived = makeDerived();

  it('room with a record: type, level, block, dims, area, floor, rename id', () => {
    const d = describeSelection(resolve({ kind: 'room', id: 'room-1', levelId: 'main' }), derived);
    expect(d.title).toBe('Stue');
    expect(d.kindLabel).toBe('Rom');
    expect(d.roomId).toBe('room-1');
    const rows = Object.fromEntries(d.rows);
    expect(rows[nb.properties.fields.type]).toBe('Stue');
    expect(rows[nb.properties.fields.level]).toBe('Hovedplan');
    expect(rows[nb.properties.fields.block]).toBe('Hytta');
    expect(rows[nb.properties.fields.area]).toBe('20,0 m²');
    expect(rows[nb.properties.fields.status]).toBe('Eksisterende');
    expect(rows[nb.properties.fields.floor]).toBe('Tregulv');
  });

  it('room spanning both parts lists both shares; note shown', () => {
    const rows = Object.fromEntries(describeSelection(resolve({ kind: 'room', id: 'gang' }), derived).rows);
    expect(rows[nb.properties.fields.areaExisting]).toBe('3,0 m²');
    expect(rows[nb.properties.fields.areaNew]).toBe('2,0 m²');
    expect(rows[nb.properties.fields.note]).toBe('Trapp opp');
  });

  it('unnamed face has no rename id', () => {
    const d = describeSelection(resolve({ kind: 'room', id: 'face-abc' }), derived);
    expect(d.title).toBe(nb.schedule.unnamed);
    expect(d.roomId).toBeUndefined();
  });

  it('walls: exterior title with block, stored kinds from the variant', () => {
    expect(wallTitle(derived, EXT_WALL)).toBe('Yttervegg (Hytta)');
    expect(wallTitle(derived, INT_WALL)).toBe('Innervegg');
    expect(wallTitle(derived, INT_WALL, new Map([['w-1', 'exterior-old']]))).toBe('Tidligere yttervegg');
    const rows = Object.fromEntries(describeSelection(resolve({ kind: 'wall', id: 'w-1' }), derived).rows);
    expect(rows[nb.properties.fields.length]).toBe('4,0 m');
    expect(rows[nb.properties.fields.thickness]).toBe('0,12 m');
    expect(rows[nb.properties.fields.topZ]).toBe('2,30 m');
  });

  it('opening, block, deck, tree', () => {
    const o = describeSelection(resolve({ kind: 'opening', id: 'o-1' }), derived);
    expect(o.title).toBe('Vindu');
    expect(Object.fromEntries(o.rows)[nb.properties.fields.width]).toBe('1,2 × 1,1 m');
    const b = Object.fromEntries(describeSelection(resolve({ kind: 'block', id: 'blk-1' }), derived).rows);
    expect(b[nb.properties.fields.pitch]).toBe('28°');
    expect(b[nb.properties.fields.roof]).toBe('Saltak, torv');
    const deck = Object.fromEntries(describeSelection(resolve({ kind: 'deck', id: 'deck-1' }), derived).rows);
    expect(deck[nb.properties.fields.area]).toBe('12,0 m²');
    const tree = describeSelection(resolve({ kind: 'tree', id: 't-1' }), derived);
    expect(tree.title).toBe('Tre');
  });

  it('dangling selections resolve to null', () => {
    expect(resolveSelection(derived, { kind: 'room', id: 'gone' })).toBeNull();
    expect(resolveSelection(derived, { kind: 'opening', id: 'gone' })).toBeNull();
    expect(resolveSelection(derived, null)).toBeNull();
    expect(sameSelection({ kind: 'room', id: 'a' }, { kind: 'room', id: 'a', levelId: undefined })).toBe(true);
    expect(sameSelection({ kind: 'room', id: 'a' }, { kind: 'wall', id: 'a' })).toBe(false);
  });
});

describe('warnings', () => {
  const derived = makeDerived();
  const variant = makeVariant('v-1', 'Forslag D');

  it('texts use names and Norwegian number formatting', () => {
    const items = warningItems(derived, variant);
    expect(items[0].text).toBe('Rom uten navn på Hovedplan (1,2 m²).');
    expect(items[1].text).toContain('Innervegg w-1');
    expect(items[2].text).toBe('Arealet 170,2 m² er over grensen på 150,0 m².');
    expect(items[0].target).toEqual({ kind: 'room', id: 'face-abc', levelId: 'main' });
    expect(items[2].target).toBeNull();
  });

  it('every warning kind has a text and sensible target', () => {
    const names = makeNameLookup(derived, variant);
    const all: ModelWarning[] = [
      { kind: 'room-unnamed', faceId: 'f', levelId: 'main', area: 1 },
      { kind: 'room-anchor-lost', roomId: 'room-1' },
      { kind: 'room-small', roomId: 'room-1', area: 0.5, min: 1 },
      { kind: 'opening-outside-host', openingId: 'o' },
      { kind: 'opening-overlap', openingIds: ['a', 'b'] },
      { kind: 'opening-above-roof', openingId: 'o', headZ: 2.5, roofZ: 2.22 },
      { kind: 'opening-on-removed-edge', openingId: 'o' },
      { kind: 'door-blocked', openingId: 'o', by: 'w-1' },
      { kind: 'wall-dangling', wallId: 'w-1' },
      { kind: 'block-overlap', blockIds: ['blk-1', 'x'] },
      { kind: 'parts-overlap', blockId: 'blk-1' },
      { kind: 'roof-no-meet', blockId: 'blk-1', end: 'start' },
      { kind: 'area-limit', limit: 1, actual: 2 },
      { kind: 'generic', message: 'En melding' },
      { kind: 'block-self-intersecting', blockId: 'blk-1' },
      { kind: 'generic', message: 'geometry fallback: rooms on storey ground (polygon clipping failed)' },
    ];
    for (const w of all) {
      const text = warningText(w, names, (a) => `${a} m²`);
      expect(text.length).toBeGreaterThan(3);
      expect(text).not.toBe('Ukjent advarsel.');
    }
    expect(warningText(all[5], names, String)).toContain('2,50 m');
    expect(warningText(all[1], names, String)).toContain('«Stue»');
    expect(warningTarget(all[4])).toEqual({ kind: 'opening', id: 'a' });
    expect(warningTarget(all[9])).toEqual({ kind: 'block', id: 'blk-1' });
    expect(warningTarget(all[13])).toBeNull();
    expect(warningText(all[14], names, String)).toContain('krysser seg selv');
    expect(warningTarget(all[14])).toEqual({ kind: 'block', id: 'blk-1' });
    expect(warningText(all[15], names, String)).toMatch(/^En del av geometrien er forenklet.*teknisk: rooms on storey ground/);
    expect(warningText(all[13], names, String)).toBe('En melding');
  });
});

describe('review fixes: schedule, area figures, subtitle, strings', () => {
  it('schedule rows carry the block name and short dimensions', () => {
    const rows = buildSchedule(makeDerived()).groups.flatMap((g) => g.rows);
    const gang = rows.find((r) => r.id === 'gang');
    expect(gang?.blockName).toBe('Hytta');
    expect(gang?.dimsShort).toBe('2,0 × 2,5');
    expect(gang?.approx).toBe(false);
    const d = makeDerived();
    const unknown = buildSchedule({ ...d, rooms: [{ ...d.rooms[0], blockId: undefined }] }).groups[0].rows[0];
    expect(unknown.blockName).toBe('');
    expect(shortName('Glassutbygg (leseskrok)')).toBe('Glassutbygg');
  });

  it('buildingSplit separates the buildings from the decks', () => {
    const bya = { total: 235.5, existing: 102.18, new: 133.32, buildings: 178.33, decks: 57.18, perBlock: [] };
    const all = buildingSplit(bya, [{ isNew: true }]);
    expect(all?.existing).toBeCloseTo(102.18);
    expect(all?.new).toBeCloseTo(76.15);
    const old = buildingSplit({ ...bya, existing: 159.36, new: 76.15 }, [{ isNew: false }]);
    expect(old?.existing).toBeCloseTo(102.18);
    expect(old?.new).toBeCloseTo(76.15);
    expect(buildingSplit(bya, [{ isNew: true }, { isNew: false }])).toBeNull();
    expect(buildingSplit({ ...bya, decks: 0, total: 178.33, new: 76.15 }, [])?.new).toBeCloseTo(76.15);
  });

  it('the subtitle does not repeat the place name', () => {
    expect(projectSubtitle('Hytta ved Merkesvatnet')).toBe('Hytta ved Merkesvatnet');
    expect(projectSubtitle('Testhytte')).toBe('Testhytte · Merkesvatnet');
  });

  it('copy: one form of "fila", "Vil du …" questions, Veggtype, rull/knip, the derive-failed text', () => {
    const all = JSON.stringify(nb);
    expect(all).not.toMatch(/Filen|filen/);
    expect(nb.prompts.restoreVersion('X')).toMatch(/^Vil du hente versjonen «X»\?/);
    expect(nb.prompts.importProject('X')).toMatch(/^Vil du åpne «X» fra fila\?/);
    expect(nb.properties.fields.kind).toBe('Veggtype');
    expect(nb.view3d.hint).toContain('rull/knip for å zoome');
    expect(nb.help.items[0]).toContain('i Visning-panelet');
    expect(nb.warnings.deriveFailed('boom')).toBe('Modellen kunne ikke beregnes: boom');
    expect(nb.mode3d.presetNames.langsiden).toBe('Langsiden (mot vannet)');
    for (const key of Object.keys(nb.mode3d.presetNames)) expect(nb.mode3d.presetTitles[key], key).toBeTruthy();
    expect(nb.share.sharedName('Forslag D', 1)).toBe('Forslag D (delt)');
    expect(nb.share.sharedName('Forslag D', 3)).toBe('Forslag D (delt 3)');
  });
});

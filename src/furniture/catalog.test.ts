/**
 * Furniture catalogue invariants (docs/phase2-plan.md §4): the append-only id list, presets, stretch ranges, mounting,
 * drains, outlines, colours, and the helpers placement / clamping / local parts / clearances.
 */
import { describe, expect, it } from 'vitest';
import {
  FURNITURE_CATALOG,
  FURNITURE_CATEGORIES,
  WET_ROOM_TYPES,
  catalogItem,
  clampSize,
  isIndoor,
  itemsInCategory,
  libraryItems,
  localClearances,
  localParts,
  placementSize,
  presetOf,
} from './catalog';

/** The agreed ids, in this order (append-only: new entries go at the end, retired ones get `hidden`). */
const IDS = [
  'seng-90', 'seng-120', 'seng-150', 'seng-180', 'koyeseng', 'nattbord', 'garderobeskap', 'kommode',
  'sofa-2', 'sofa-3', 'hjornesofa', 'lenestol', 'salongbord', 'teppe', 'tv-benk', 'bokhylle', 'vedovn', 'benkeskap', 'overskap',
  'hoyskap', 'kjoleskap', 'kjokkenoy', 'spisebord-4', 'spisebord-6', 'spisebord-8', 'stol', 'toalett', 'servant', 'dusj-80',
  'dusj-90', 'dusj-100', 'dusjvegg', 'badekar', 'vaskemaskin', 'torketrommel', 'vaskesoyle', 'handkletorker', 'sluk',
  'varmtvannsbereder', 'badstubenk', 'badstuovn', 'hylle', 'skohylle', 'benk', 'skistativ', 'vedstabel', 'loungesofa', 'utebord',
  'utestol', 'grill',
];

const HEX = /^#[0-9a-f]{6}$/;

describe('catalogue entries', () => {
  it('has exactly the agreed ids, in order, each once', () => {
    expect(FURNITURE_CATALOG.map((c) => c.id)).toEqual(IDS);
    expect(new Set(IDS).size).toBe(IDS.length);
  });

  it('every entry is complete and sane', () => {
    const categories = new Set(FURNITURE_CATEGORIES.map((c) => c.id));
    for (const c of FURNITURE_CATALOG) {
      expect(c.name.trim().length, c.id).toBeGreaterThan(1);
      expect(categories.has(c.category), c.id).toBe(true);
      expect(c.sizes.length, c.id).toBeGreaterThan(0);
      expect(new Set(c.sizes.map((s) => s.key)).size, c.id).toBe(c.sizes.length);
      expect(c.sizes.some((s) => s.key === c.defaultSize), c.id).toBe(true);
      for (const s of c.sizes) {
        for (const v of [s.w, s.d, s.h]) {
          expect(Number.isFinite(v) && v > 0, `${c.id}/${s.key}`).toBe(true);
          expect(v, `${c.id}/${s.key}`).toBeLessThanOrEqual(4);
        }
        expect(s.label.trim().length, `${c.id}/${s.key}`).toBeGreaterThan(0);
      }
      for (const dim of ['w', 'd'] as const) {
        const r = c.stretch?.[dim];
        if (!r) continue;
        expect(r[0], c.id).toBeGreaterThan(0);
        expect(r[0], c.id).toBeLessThan(r[1]);
        // Every preset lies in the range (so clamping never changes a preset).
        for (const s of c.sizes) expect(s[dim] >= r[0] && s[dim] <= r[1], `${c.id}/${s.key}/${dim}`).toBe(true);
      }
      expect(c.elevation, c.id).toBeGreaterThanOrEqual(0);
      if (c.mount === 'wall') expect(c.elevation, c.id).toBeGreaterThan(0);
      else expect(c.elevation, c.id).toBe(0);
      if (c.mount === 'flat') for (const s of c.sizes) expect(s.h, c.id).toBeLessThanOrEqual(0.05);
      expect(c.symbol.length > 0 && c.model.length > 0, c.id).toBe(true);
      for (const col of c.colours ?? []) {
        expect(col.hex, c.id).toMatch(HEX);
        expect(col.label.length, c.id).toBeGreaterThan(0);
      }
      for (const v of Object.values(c.clearance ?? {})) expect(v > 0 && v <= 1.2, c.id).toBe(true);
      if (c.outline === 'l') {
        const p = presetOf(c);
        expect(c.seat, c.id).toBeGreaterThan(0);
        expect(c.seat as number, c.id).toBeLessThan(Math.min(p.w, p.d));
      }
    }
  });

  it('the realistic sizes the family expects', () => {
    const p = (id: string, key?: string) => presetOf(catalogItem(id)!, key);
    expect([p('seng-90').w, p('seng-90').d]).toEqual([0.9, 2.0]);
    expect([p('seng-180').w, p('seng-180').d]).toEqual([1.8, 2.0]);
    expect([p('toalett').w, p('toalett').d]).toEqual([0.4, 0.65]);
    expect(p('benkeskap').d).toBe(0.6);
    expect(p('benkeskap').h).toBe(0.9);
    expect(catalogItem('overskap')).toMatchObject({ mount: 'wall', elevation: 1.4 });
    expect(catalogItem('handkletorker')).toMatchObject({ mount: 'wall', elevation: 0.9 });
    expect(catalogItem('teppe')?.mount).toBe('flat');
    expect(catalogItem('sluk')?.mount).toBe('flat');
    expect([p('dusj-80').w, p('dusj-90').w, p('dusj-100').w]).toEqual([0.8, 0.9, 1.0]);
    expect(p('spisebord-8').w).toBeGreaterThan(p('spisebord-6').w);
    expect(p('spisebord-6').w).toBeGreaterThan(p('spisebord-4').w);
    expect(catalogItem('vedovn')?.clearance).toEqual({ around: 0.5 });
    expect(catalogItem('badstuovn')?.clearance).toEqual({ around: 0.3 });
    expect(catalogItem('toalett')?.clearance).toEqual({ front: 0.6 });
    expect(catalogItem('servant')?.clearance).toEqual({ front: 0.6 });
    expect(catalogItem('spisebord-6')?.clearance).toEqual({ around: 0.8 });
  });

  it('stretchable runs: kitchen, benches, shelves, wardrobes, rugs', () => {
    for (const id of ['benkeskap', 'overskap', 'hoyskap', 'kjokkenoy', 'badstubenk', 'hylle', 'garderobeskap', 'teppe', 'dusjvegg', 'vedstabel', 'benk', 'bokhylle']) {
      expect(catalogItem(id)?.stretch?.w, id).toBeDefined();
    }
    for (const id of ['seng-90', 'toalett', 'stol', 'kjoleskap']) expect(catalogItem(id)?.stretch, id).toBeUndefined();
  });

  it('drains: what needs a floor drain, and the wet room types', () => {
    const drained = FURNITURE_CATALOG.filter((c) => c.needsDrain).map((c) => c.id);
    expect(drained).toEqual(['toalett', 'servant', 'dusj-80', 'dusj-90', 'dusj-100', 'badekar', 'vaskemaskin', 'vaskesoyle', 'sluk', 'varmtvannsbereder']);
    expect([...WET_ROOM_TYPES].sort()).toEqual(['bad', 'badstue', 'kjokken', 'teknisk', 'wc']);
  });

  it('categories in library order, each with entries; only Ute is outdoors', () => {
    expect(FURNITURE_CATEGORIES.map((c) => c.name)).toEqual(['Soverom', 'Stue', 'Kjøkken', 'Bad / WC', 'Badstue', 'Annet', 'Ute']);
    for (const c of FURNITURE_CATEGORIES) expect(itemsInCategory(c.id).length, c.id).toBeGreaterThan(0);
    expect(libraryItems()).toHaveLength(IDS.length);
    expect(FURNITURE_CATALOG.filter((c) => !isIndoor(c)).map((c) => c.id)).toEqual(['loungesofa', 'utebord', 'utestol', 'grill']);
  });
});

describe('helpers', () => {
  it('catalogItem / presetOf / placementSize', () => {
    expect(catalogItem('rakett')).toBeNull();
    expect(placementSize('rakett')).toBeNull();
    expect(placementSize('seng-90')).toEqual({ size: { w: 0.9, d: 2.0, h: 0.5 }, sizeVariant: '90x200' });
    expect(placementSize('seng-90', '90x190')).toEqual({ size: { w: 0.9, d: 1.9, h: 0.5 }, sizeVariant: '90x190' });
    // An unknown size key falls back to the default preset.
    expect(placementSize('seng-90', 'xx')?.sizeVariant).toBe('90x200');
    // Fresh objects (an item's size is its own).
    expect(placementSize('stol')?.size).not.toBe(placementSize('stol')?.size);
  });

  it('clampSize: stretchable dimensions into their range, the rest as given, bad numbers from the fallback', () => {
    const benk = catalogItem('benkeskap');
    expect(clampSize(benk, { w: 9, d: 0.7, h: 0.9 }, { w: 1, d: 0.6, h: 0.9 })).toEqual({ w: 6, d: 0.7, h: 0.9 });
    expect(clampSize(benk, { w: 0.1, d: 0.6, h: 0.9 }, { w: 1, d: 0.6, h: 0.9 })).toEqual({ w: 0.3, d: 0.6, h: 0.9 });
    expect(clampSize(catalogItem('teppe'), { w: 3, d: 9, h: 0.01 }, { w: 2, d: 1.4, h: 0.01 })).toEqual({ w: 3, d: 4, h: 0.01 });
    expect(clampSize(null, { w: Number.NaN, d: -1, h: 2 }, { w: 1, d: 1, h: 1 })).toEqual({ w: 1, d: 1, h: 2 });
  });

  it('localParts: one rectangle, or the L of a corner sofa (back strip + chaise at local +x)', () => {
    expect(localParts(catalogItem('seng-90'), { w: 0.9, d: 2 })).toEqual([{ x0: -0.45, y0: -1, x1: 0.45, y1: 1 }]);
    expect(localParts(null, { w: 1, d: 1 })).toEqual([{ x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 }]);
    const l = localParts(catalogItem('hjornesofa'), { w: 2.7, d: 1.6 });
    expect(l).toHaveLength(2);
    expect(l[0].x0).toBeCloseTo(-1.35, 9);
    expect(l[0].x1).toBeCloseTo(1.35, 9);
    expect(l[0].y0).toBeCloseTo(-0.1, 9);
    expect(l[0].y1).toBeCloseTo(0.8, 9);
    expect(l[1].x0).toBeCloseTo(0.45, 9);
    expect(l[1].x1).toBeCloseTo(1.35, 9);
    expect(l[1].y0).toBeCloseTo(-0.8, 9);
    expect(l[1].y1).toBeCloseTo(-0.1, 9);
    // Too shallow for an L: a plain rectangle.
    expect(localParts(catalogItem('hjornesofa'), { w: 2.7, d: 0.8 })).toHaveLength(1);
  });

  it('localClearances: front strip, side strips, or four strips all around', () => {
    expect(localClearances(catalogItem('toalett'), { w: 0.4, d: 0.65 })).toEqual([{ x0: -0.2, y0: -0.325 - 0.6, x1: 0.2, y1: -0.325 }]);
    expect(localClearances(catalogItem('seng-90'), { w: 0.9, d: 2 })).toEqual([
      { x0: -0.95, y0: -1, x1: -0.45, y1: 1 },
      { x0: 0.45, y0: -1, x1: 0.95, y1: 1 },
    ]);
    const around = localClearances(catalogItem('vedovn'), { w: 0.5, d: 0.45 });
    expect(around).toHaveLength(4);
    const area = around.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    expect(area).toBeCloseTo(1.5 * 1.45 - 0.5 * 0.45, 9);
    expect(localClearances(catalogItem('stol'), { w: 0.45, d: 0.45 })).toEqual([]);
    expect(localClearances(null, { w: 1, d: 1 })).toEqual([]);
  });
});

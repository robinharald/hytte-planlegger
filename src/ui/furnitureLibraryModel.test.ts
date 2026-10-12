/**
 * The furniture library's list (furnitureLibraryModel.ts): every library entry of the catalogue once, in category
 * order with Norwegian names, default sizes in cm, the search (words, Norwegian letters, synonyms), and the category
 * that fits a room.
 */
import { describe, expect, it } from 'vitest';
import { FURNITURE_CATALOG, FURNITURE_CATEGORIES, libraryItems } from '../furniture/catalog';
import { categoryForRoomType, filterLibrary, groupByCategory, libraryEntries, normalizeSearch, sizeTextCm } from './furnitureLibraryModel';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('library entries', () => {
  it('lists every entry the catalogue offers, once, in catalogue order, with its default size', () => {
    const entries = libraryEntries();
    expect(ids(entries)).toEqual(ids(libraryItems()));
    expect(new Set(ids(entries)).size).toBe(entries.length);
    expect(entries.length).toBeGreaterThanOrEqual(50);
    const bed = entries.find((e) => e.id === 'seng-90')!;
    expect(bed.name).toBe('Seng 90');
    expect(bed.size).toEqual({ w: 0.9, d: 2.0, h: 0.5 });
    expect(bed.sizeText).toBe('90 × 200 cm');
    expect(sizeTextCm(0.555, 1.2)).toBe('56 × 120 cm');
  });

  it('leaves hidden entries out', () => {
    const hidden = FURNITURE_CATALOG.filter((c) => c.hidden).map((c) => c.id);
    for (const id of hidden) expect(ids(libraryEntries())).not.toContain(id);
  });

  it('groups by category in the catalogue order, with the Norwegian names, empty categories left out', () => {
    const groups = groupByCategory(libraryEntries());
    expect(groups.map((g) => g.name)).toEqual(FURNITURE_CATEGORIES.map((c) => c.name));
    expect(groups[0].name).toBe('Soverom');
    expect(groups.find((g) => g.id === 'bad')!.name).toBe('Bad / WC');
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(libraryEntries().length);
    expect(groupByCategory(filterLibrary(libraryEntries(), 'dusj')).map((g) => g.id)).toEqual(['bad']);
  });
});

describe('search', () => {
  const find = (q: string) => ids(filterLibrary(libraryEntries(), q));

  it('normalises case, Norwegian letters and accents', () => {
    expect(normalizeSearch('  Kjøleskap  ÆØÅ é ')).toBe('kjoleskap aeoa e');
    expect(find('kjøleskap')).toEqual(['kjoleskap']);
    expect(find('KJOLESKAP')).toEqual(['kjoleskap']);
    expect(find('hjørne')).toEqual(['hjornesofa']);
  });

  it('matches every word, anywhere in the name, id, category or synonyms', () => {
    expect(find('')).toHaveLength(libraryEntries().length);
    expect(find('   ')).toHaveLength(libraryEntries().length);
    expect(find('seng')).toEqual(expect.arrayContaining(['seng-90', 'seng-120', 'seng-150', 'seng-180', 'koyeseng']));
    expect(find('seng 150')).toEqual(['seng-150']);
    expect(find('dusj')).toEqual(expect.arrayContaining(['dusj-80', 'dusj-90', 'dusj-100', 'dusjvegg']));
    expect(find('wc')).toContain('toalett');
    expect(find('do')).toContain('toalett');
    expect(find('ovn')).toEqual(expect.arrayContaining(['vedovn', 'badstuovn']));
    expect(find('ute')).toEqual(expect.arrayContaining(['loungesofa', 'utebord', 'utestol', 'grill']));
    expect(find('badstue')).toEqual(expect.arrayContaining(['badstubenk', 'badstuovn']));
    expect(find('flygel')).toEqual([]);
  });
});

describe('category for a room', () => {
  it('opens the category that fits the selected room', () => {
    expect(categoryForRoomType('bad')).toBe('bad');
    expect(categoryForRoomType('wc')).toBe('bad');
    expect(categoryForRoomType('soverom')).toBe('soverom');
    expect(categoryForRoomType('hems')).toBe('soverom');
    expect(categoryForRoomType('kjokken')).toBe('kjokken');
    expect(categoryForRoomType('spiseplass')).toBe('kjokken');
    expect(categoryForRoomType('stue')).toBe('stue');
    expect(categoryForRoomType('badstue')).toBe('badstue');
    expect(categoryForRoomType('bod')).toBe('annet');
    expect(categoryForRoomType('apning')).toBeNull();
    expect(categoryForRoomType(undefined)).toBeNull();
  });
});

/**
 * What the furniture library lists (docs/phase2-plan.md §3.2): the catalogue's library entries (furniture/catalog.ts
 * `libraryItems`, hidden ones left out) grouped into the catalogue's categories, in catalogue order, each with its
 * default size, and the search. Pure (FurnitureLibrary.tsx renders it).
 *
 * Search: every word of the query must occur in the entry's name, id, category name or a few everyday synonyms
 * ("wc", "do" → Toalett; "kjøl" → Kjøleskap; "ovn" → Vedovn / Badstuovn; …). Case, Norwegian letters and accents do
 * not matter ("kjoleskap" finds "Kjøleskap", "hjørne" finds "Hjørnesofa").
 *
 * The category that opens first follows the selected room's type (a bathroom opens "Bad / WC").
 */
import { FURNITURE_CATEGORIES, libraryItems, presetOf } from '../furniture/catalog';
import type { FurnitureCatalogItem, FurnitureCategory } from '../furniture/catalog';
import type { RoomType } from '../model/types';
import { nb } from '../i18n/nb';

export interface LibraryEntry {
  id: string;
  name: string;
  category: FurnitureCategory;
  /** Default preset size (m). */
  size: { w: number; d: number; h: number };
  /** "90 × 200 cm". */
  sizeText: string;
  /** Normalised words the search looks in. */
  haystack: string;
}

export interface LibraryGroup {
  id: FurnitureCategory;
  name: string;
  items: LibraryEntry[];
}

/** Everyday words people search with, per catalogue id (normalised by the search). */
const SYNONYMS: Readonly<Record<string, string>> = {
  'seng-90': 'enkeltseng',
  'seng-120': 'dobbeltseng',
  'seng-150': 'dobbeltseng',
  'seng-180': 'dobbeltseng',
  koyeseng: 'seng barn',
  nattbord: 'seng',
  garderobeskap: 'klesskap skap klær',
  kommode: 'skuffer',
  hjornesofa: 'sofa',
  salongbord: 'bord',
  teppe: 'matte',
  'tv-benk': 'tv',
  bokhylle: 'reol bøker',
  vedovn: 'peis ovn',
  benkeskap: 'kjøkkenbenk benk skap',
  overskap: 'skap',
  hoyskap: 'skap',
  kjoleskap: 'kjøl frys',
  kjokkenoy: 'øy benk',
  'spisebord-4': 'bord',
  'spisebord-6': 'bord',
  'spisebord-8': 'bord',
  toalett: 'wc do klosett',
  servant: 'vask håndvask vaskeservant',
  'dusj-80': 'dusj',
  'dusj-90': 'dusj',
  'dusj-100': 'dusj',
  dusjvegg: 'dusj glass',
  vaskemaskin: 'vask klesvask',
  torketrommel: 'tørk',
  vaskesoyle: 'vaskemaskin tørketrommel',
  handkletorker: 'håndkle',
  sluk: 'avløp',
  varmtvannsbereder: 'bereder vann',
  badstubenk: 'sauna lave',
  badstuovn: 'sauna ovn',
  hylle: 'reol',
  skohylle: 'sko',
  skistativ: 'ski',
  vedstabel: 'ved',
  loungesofa: 'sofa ute',
  utebord: 'bord ute',
  utestol: 'stol ute',
};

/** Lower case, Norwegian letters spelled out (æ → ae, ø → o, å → a), accents stripped, one space between words. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "90 × 200 cm" (whole centimetres). */
export function sizeTextCm(w: number, d: number): string {
  return nb.library.size(Math.round(w * 100), Math.round(d * 100));
}

function entryOf(item: FurnitureCatalogItem): LibraryEntry {
  const p = presetOf(item, item.defaultSize);
  const category = FURNITURE_CATEGORIES.find((c) => c.id === item.category);
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    size: { w: p.w, d: p.d, h: p.h },
    sizeText: sizeTextCm(p.w, p.d),
    haystack: normalizeSearch([item.name, item.id, category?.name ?? '', SYNONYMS[item.id] ?? ''].join(' ')),
  };
}

let cache: LibraryEntry[] | null = null;

/** The library's entries in catalogue order (computed once). */
export function libraryEntries(): LibraryEntry[] {
  if (!cache) cache = libraryItems().map(entryOf);
  return cache;
}

/** Entries matching every word of `query` (an empty query matches everything). */
export function filterLibrary(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => words.every((w) => e.haystack.includes(w)));
}

/** The non-empty categories of `entries`, in the catalogue's category order. */
export function groupByCategory(entries: readonly LibraryEntry[]): LibraryGroup[] {
  const out: LibraryGroup[] = [];
  for (const c of FURNITURE_CATEGORIES) {
    const items = entries.filter((e) => e.category === c.id);
    if (items.length > 0) out.push({ id: c.id, name: c.name, items });
  }
  return out;
}

/** The library category that fits a room type (null: no preference). */
export function categoryForRoomType(type: RoomType | undefined): FurnitureCategory | null {
  switch (type) {
    case 'soverom':
    case 'hems':
      return 'soverom';
    case 'stue':
    case 'leseskrok':
      return 'stue';
    case 'kjokken':
    case 'spiseplass':
    case 'pantry':
      return 'kjokken';
    case 'bad':
    case 'wc':
    case 'teknisk':
      return 'bad';
    case 'badstue':
      return 'badstue';
    case 'gang':
    case 'vindfang':
    case 'bod':
    case 'annet':
      return 'annet';
    default:
      return null;
  }
}

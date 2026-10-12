/**
 * Furniture catalogue (docs/phase2-plan.md §4; schema from revision 2, unchanged in revision 3).
 *
 * Ids and size keys are APPEND-ONLY: saved projects, autosaves and share links refer to them. Retire an entry with
 * `hidden: true` (it stays resolvable, the library just stops offering it). A saved item stores its own `size`
 * (written at placement from the chosen preset), so changing a preset here never resizes saved furniture.
 *
 * Local frame of every item: `w` along the item's local x, `d` along its local y, `h` up. The BACK edge is at local
 * +y (headboard, cabinet back, sofa back, toilet cistern, the upper tier of a sauna bench), the FRONT at local −y.
 * `FurnitureItem.rotationDeg` turns the item counter-clockwise about its centre (`position`), so rotationDeg 0 has
 * the back towards plan north, 90 towards west, 180 towards south, 270 towards east (the old model's
 * `toilet(x, y, rot)` used the same convention, so its rotations carry over).
 *
 * Fields:
 *  - `sizes`: presets `{ key, label, w, d, h }` (metres); `defaultSize` is the key used when none is chosen.
 *  - `stretch`: free ranges [min, max] for w and/or d ("Bredde" / "Dybde" in Egenskaper; kitchen runs, benches,
 *    shelves, wardrobes, rugs). Dimensions without a range keep the preset value.
 *  - `clearance`: free floor wanted in front (local −y, across w), at both sides (local ±x, along d) or all around,
 *    drawn as faint hatching; it never raises a warning.
 *  - `snap`: 'back-to-wall' (the back edge snaps onto a wall face), 'corner' (back and one side), 'free'.
 *  - `mount`: 'floor', 'wall' (hangs on the wall: its z range starts at `elevation`), 'flat' (rugs, drains: never
 *    collides with other furniture and never blocks a door).
 *  - `elevation`: bottom of the item above its floor (Overskap 1.4, Håndkletørker 0.9; 0 otherwise).
 *  - `needsDrain`: needs a floor drain / waste pipe ('furniture-needs-wet-room' outside bad, wc, teknisk, badstue,
 *    kjokken).
 *  - `outline`: 'rect' (default) or 'l' — an L-shaped corner sofa: a back strip of depth `seat` over the whole width
 *    and a chaise of width `seat` at the local +x end reaching the front (`localParts`). Collisions use the parts, so
 *    a coffee table may stand in the free corner of the L.
 *  - `symbol` / `model`: keys of the 2D plan symbol and the 3D builder (one per kind of drawing; several catalogue
 *    entries share one, e.g. all beds draw 'bed').
 *  - `colours`: optional swatches; `FurnitureItem.colour` holds the chosen `hex` ('#rrggbb').
 */
import type { RoomType } from '../model/types';

export type FurnitureCategory = 'soverom' | 'stue' | 'kjokken' | 'bad' | 'badstue' | 'annet' | 'ute';

/** Library order and Norwegian names of the categories. */
export const FURNITURE_CATEGORIES: readonly { id: FurnitureCategory; name: string }[] = [
  { id: 'soverom', name: 'Soverom' },
  { id: 'stue', name: 'Stue' },
  { id: 'kjokken', name: 'Kjøkken' },
  { id: 'bad', name: 'Bad / WC' },
  { id: 'badstue', name: 'Badstue' },
  { id: 'annet', name: 'Annet' },
  { id: 'ute', name: 'Ute' },
];

export interface FurnitureSize {
  /** Stable key (append-only), stored as `FurnitureItem.sizeVariant`. */
  key: string;
  /** Norwegian label for the size chooser, e.g. "90 × 200". */
  label: string;
  w: number;
  d: number;
  h: number;
}

export type FurnitureSnap = 'back-to-wall' | 'corner' | 'free';
export type FurnitureMount = 'floor' | 'wall' | 'flat';

export interface FurnitureClearance {
  front?: number;
  sides?: number;
  around?: number;
}

export interface FurnitureColour {
  label: string;
  /** '#rrggbb' */
  hex: string;
}

export interface FurnitureCatalogItem {
  id: string;
  /** Norwegian name shown in the library and in Egenskaper. */
  name: string;
  category: FurnitureCategory;
  sizes: FurnitureSize[];
  defaultSize: string;
  stretch?: { w?: [number, number]; d?: [number, number] };
  colours?: FurnitureColour[];
  clearance?: FurnitureClearance;
  snap: FurnitureSnap;
  mount: FurnitureMount;
  /** Bottom of the item above its floor (m). */
  elevation: number;
  needsDrain?: boolean;
  /** 'rect' (default) or 'l' (corner sofa, see the header). */
  outline?: 'rect' | 'l';
  /** Depth of the L's back strip and width of its chaise (outline 'l'). */
  seat?: number;
  symbol: string;
  model: string;
  /** Retired: still resolvable, not offered in the library. */
  hidden?: boolean;
}

/** Room types where an item that needs a drain may stand without a warning. */
export const WET_ROOM_TYPES: ReadonlySet<RoomType> = new Set<RoomType>(['bad', 'wc', 'teknisk', 'badstue', 'kjokken']);

const size = (key: string, label: string, w: number, d: number, h: number): FurnitureSize => ({ key, label, w, d, h });

const TEXTILE: FurnitureColour[] = [
  { label: 'Grønn', hex: '#4d5e4c' },
  { label: 'Grå', hex: '#7b7d80' },
  { label: 'Sand', hex: '#c8b89a' },
  { label: 'Blå', hex: '#5d7590' },
];
const WOOD: FurnitureColour[] = [
  { label: 'Eik', hex: '#b08a5e' },
  { label: 'Furu', hex: '#d9b98a' },
  { label: 'Hvit', hex: '#eeeeea' },
  { label: 'Svart', hex: '#2b2b2b' },
];
const FRONTS: FurnitureColour[] = [
  { label: 'Hvit', hex: '#e9e7e0' },
  { label: 'Grønn', hex: '#6f7d68' },
  { label: 'Eik', hex: '#b08a5e' },
  { label: 'Grå', hex: '#8a8d90' },
];
const DUVETS: FurnitureColour[] = [
  { label: 'Blå', hex: '#6d8aa6' },
  { label: 'Rust', hex: '#b46a55' },
  { label: 'Grønn', hex: '#8a9a6a' },
  { label: 'Hvit', hex: '#f1efe8' },
];

/** The catalogue in library order (within each category). Append new entries; never rename or remove ids. */
export const FURNITURE_CATALOG: readonly FurnitureCatalogItem[] = [
  // --- Soverom -------------------------------------------------------------------------------------------------
  {
    id: 'seng-90',
    name: 'Seng 90',
    category: 'soverom',
    sizes: [size('90x200', '90 × 200', 0.9, 2.0, 0.5), size('90x190', '90 × 190', 0.9, 1.9, 0.5)],
    defaultSize: '90x200',
    colours: DUVETS,
    clearance: { sides: 0.5 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'bed',
    model: 'bed',
  },
  {
    id: 'seng-120',
    name: 'Seng 120',
    category: 'soverom',
    sizes: [size('120x200', '120 × 200', 1.2, 2.0, 0.5)],
    defaultSize: '120x200',
    colours: DUVETS,
    clearance: { sides: 0.5 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'bed',
    model: 'bed',
  },
  {
    id: 'seng-150',
    name: 'Seng 150',
    category: 'soverom',
    sizes: [size('150x200', '150 × 200', 1.5, 2.0, 0.5)],
    defaultSize: '150x200',
    colours: DUVETS,
    clearance: { sides: 0.6 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'bed',
    model: 'bed',
  },
  {
    id: 'seng-180',
    name: 'Seng 180',
    category: 'soverom',
    sizes: [size('180x200', '180 × 200', 1.8, 2.0, 0.5)],
    defaultSize: '180x200',
    colours: DUVETS,
    clearance: { sides: 0.6 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'bed',
    model: 'bed',
  },
  {
    id: 'koyeseng',
    name: 'Køyeseng',
    category: 'soverom',
    sizes: [size('90x200', '90 × 200', 0.97, 2.07, 1.6)],
    defaultSize: '90x200',
    colours: DUVETS,
    clearance: { sides: 0.5 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'bunk',
    model: 'bunk',
  },
  {
    id: 'nattbord',
    name: 'Nattbord',
    category: 'soverom',
    sizes: [size('45', '45 × 40', 0.45, 0.4, 0.5), size('35', '35 × 30', 0.35, 0.3, 0.5)],
    defaultSize: '45',
    colours: WOOD,
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'nightstand',
    model: 'nightstand',
  },
  {
    id: 'garderobeskap',
    name: 'Garderobeskap',
    category: 'soverom',
    sizes: [size('100', '100 × 60', 1.0, 0.6, 2.1), size('50', '50 × 60', 0.5, 0.6, 2.1)],
    defaultSize: '100',
    stretch: { w: [0.4, 3.0] },
    colours: FRONTS,
    clearance: { front: 0.7 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'wardrobe',
    model: 'wardrobe',
  },
  {
    id: 'kommode',
    name: 'Kommode',
    category: 'soverom',
    sizes: [size('80', '80 × 45', 0.8, 0.45, 0.8)],
    defaultSize: '80',
    colours: WOOD,
    clearance: { front: 0.6 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'chest',
    model: 'chest',
  },

  // --- Stue ----------------------------------------------------------------------------------------------------
  {
    id: 'sofa-2',
    name: 'Sofa, 2-seter',
    category: 'stue',
    sizes: [size('160', '160 × 90', 1.6, 0.9, 0.8)],
    defaultSize: '160',
    colours: TEXTILE,
    clearance: { front: 0.5 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'sofa',
    model: 'sofa',
  },
  {
    id: 'sofa-3',
    name: 'Sofa, 3-seter',
    category: 'stue',
    sizes: [size('220', '220 × 90', 2.2, 0.9, 0.8), size('250', '250 × 90', 2.5, 0.9, 0.8)],
    defaultSize: '220',
    colours: TEXTILE,
    clearance: { front: 0.5 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'sofa',
    model: 'sofa',
  },
  {
    id: 'hjornesofa',
    name: 'Hjørnesofa',
    category: 'stue',
    sizes: [size('270x160', '270 × 160', 2.7, 1.6, 0.8), size('300x200', '300 × 200', 3.0, 2.0, 0.8)],
    defaultSize: '270x160',
    stretch: { w: [1.8, 4.0], d: [1.2, 3.0] },
    colours: TEXTILE,
    clearance: { front: 0.5 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    outline: 'l',
    seat: 0.9,
    symbol: 'corner-sofa',
    model: 'corner-sofa',
  },
  {
    id: 'lenestol',
    name: 'Lenestol',
    category: 'stue',
    sizes: [size('80', '80 × 80', 0.8, 0.8, 0.85), size('70', '70 × 70', 0.7, 0.7, 0.85)],
    defaultSize: '80',
    colours: TEXTILE,
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'armchair',
    model: 'armchair',
  },
  {
    id: 'salongbord',
    name: 'Salongbord',
    category: 'stue',
    sizes: [size('120x60', '120 × 60', 1.2, 0.6, 0.45), size('60x60', '60 × 60', 0.6, 0.6, 0.45)],
    defaultSize: '120x60',
    colours: WOOD,
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'coffee-table',
    model: 'coffee-table',
  },
  {
    id: 'teppe',
    name: 'Teppe',
    category: 'stue',
    sizes: [size('200x140', '200 × 140', 2.0, 1.4, 0.01), size('240x170', '240 × 170', 2.4, 1.7, 0.01)],
    defaultSize: '200x140',
    stretch: { w: [0.6, 5.0], d: [0.6, 4.0] },
    colours: [
      { label: 'Sand', hex: '#b9a98c' },
      { label: 'Grå', hex: '#9a9a96' },
      { label: 'Rust', hex: '#a86a50' },
      { label: 'Blå', hex: '#6d8aa6' },
    ],
    snap: 'free',
    mount: 'flat',
    elevation: 0,
    symbol: 'rug',
    model: 'rug',
  },
  {
    id: 'tv-benk',
    name: 'TV-benk',
    category: 'stue',
    sizes: [size('160', '160 × 40', 1.6, 0.4, 0.5)],
    defaultSize: '160',
    colours: WOOD,
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'tv-bench',
    model: 'tv-bench',
  },
  {
    id: 'bokhylle',
    name: 'Bokhylle',
    category: 'stue',
    sizes: [size('80', '80 × 30', 0.8, 0.3, 1.9), size('80-lav', '80 × 30, lav', 0.8, 0.3, 0.8)],
    defaultSize: '80',
    stretch: { w: [0.4, 4.0] },
    colours: WOOD,
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'bookshelf',
    model: 'bookshelf',
  },
  {
    id: 'vedovn',
    name: 'Vedovn',
    category: 'stue',
    sizes: [size('50', '50 × 45', 0.5, 0.45, 1.0), size('60', '60 × 55', 0.6, 0.55, 1.1)],
    defaultSize: '50',
    clearance: { around: 0.5 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'stove',
    model: 'stove',
  },

  // --- Kjøkken -------------------------------------------------------------------------------------------------
  {
    id: 'benkeskap',
    name: 'Benkeskap',
    category: 'kjokken',
    sizes: [size('60', '60 × 60', 0.6, 0.6, 0.9), size('120', '120 × 60', 1.2, 0.6, 0.9), size('240', '240 × 60', 2.4, 0.6, 0.9)],
    defaultSize: '60',
    stretch: { w: [0.3, 6.0] },
    colours: FRONTS,
    clearance: { front: 0.9 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'base-cabinet',
    model: 'base-cabinet',
  },
  {
    id: 'overskap',
    name: 'Overskap',
    category: 'kjokken',
    sizes: [size('60', '60 × 35', 0.6, 0.35, 0.7), size('120', '120 × 35', 1.2, 0.35, 0.7)],
    defaultSize: '60',
    stretch: { w: [0.3, 6.0] },
    colours: FRONTS,
    snap: 'back-to-wall',
    mount: 'wall',
    elevation: 1.4,
    symbol: 'wall-cabinet',
    model: 'wall-cabinet',
  },
  {
    id: 'hoyskap',
    name: 'Høyskap',
    category: 'kjokken',
    sizes: [size('60', '60 × 60', 0.6, 0.6, 2.1)],
    defaultSize: '60',
    stretch: { w: [0.3, 3.0] },
    colours: FRONTS,
    clearance: { front: 0.9 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'tall-cabinet',
    model: 'tall-cabinet',
  },
  {
    id: 'kjoleskap',
    name: 'Kjøleskap',
    category: 'kjokken',
    sizes: [size('60', '60 × 65', 0.6, 0.65, 1.85), size('70', '70 × 70', 0.7, 0.7, 2.0)],
    defaultSize: '60',
    clearance: { front: 0.9 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'fridge',
    model: 'fridge',
  },
  {
    id: 'kjokkenoy',
    name: 'Kjøkkenøy',
    category: 'kjokken',
    sizes: [size('200x90', '200 × 90', 2.0, 0.9, 0.9), size('240x85', '240 × 85', 2.4, 0.85, 0.92)],
    defaultSize: '200x90',
    stretch: { w: [1.0, 4.0], d: [0.6, 1.4] },
    colours: FRONTS,
    clearance: { around: 0.9 },
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'island',
    model: 'island',
  },
  {
    id: 'spisebord-4',
    name: 'Spisebord for 4',
    category: 'kjokken',
    sizes: [size('120x80', '120 × 80', 1.2, 0.8, 0.74)],
    defaultSize: '120x80',
    colours: WOOD,
    clearance: { around: 0.8 },
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'dining-table',
    model: 'dining-table',
  },
  {
    id: 'spisebord-6',
    name: 'Spisebord for 6',
    category: 'kjokken',
    sizes: [size('180x90', '180 × 90', 1.8, 0.9, 0.74)],
    defaultSize: '180x90',
    colours: WOOD,
    clearance: { around: 0.8 },
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'dining-table',
    model: 'dining-table',
  },
  {
    id: 'spisebord-8',
    name: 'Spisebord for 8',
    category: 'kjokken',
    sizes: [size('240x100', '240 × 100', 2.4, 1.0, 0.74), size('260x100', '260 × 100', 2.6, 1.0, 0.74)],
    defaultSize: '240x100',
    colours: WOOD,
    clearance: { around: 0.8 },
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'dining-table',
    model: 'dining-table',
  },
  {
    id: 'stol',
    name: 'Stol',
    category: 'kjokken',
    sizes: [size('45', '45 × 45', 0.45, 0.45, 0.85)],
    defaultSize: '45',
    colours: WOOD,
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'chair',
    model: 'chair',
  },

  // --- Bad / WC ------------------------------------------------------------------------------------------------
  {
    id: 'toalett',
    name: 'Toalett',
    category: 'bad',
    sizes: [size('gulv', 'Gulvstående', 0.4, 0.65, 0.8), size('vegg', 'Vegghengt', 0.36, 0.55, 0.8)],
    defaultSize: 'gulv',
    clearance: { front: 0.6 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'toilet',
    model: 'toilet',
  },
  {
    id: 'servant',
    name: 'Servant med skap',
    category: 'bad',
    sizes: [size('60', '60 × 45', 0.6, 0.45, 0.85), size('100', '100 × 48', 1.0, 0.48, 0.85), size('45', '45 × 35', 0.45, 0.35, 0.85)],
    defaultSize: '60',
    colours: FRONTS,
    clearance: { front: 0.6 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'sink',
    model: 'sink',
  },
  {
    id: 'dusj-80',
    name: 'Dusj 80 × 80',
    category: 'bad',
    sizes: [size('80', '80 × 80', 0.8, 0.8, 2.0)],
    defaultSize: '80',
    clearance: { front: 0.6 },
    snap: 'corner',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'shower',
    model: 'shower',
  },
  {
    id: 'dusj-90',
    name: 'Dusj 90 × 90',
    category: 'bad',
    sizes: [size('90', '90 × 90', 0.9, 0.9, 2.0)],
    defaultSize: '90',
    clearance: { front: 0.6 },
    snap: 'corner',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'shower',
    model: 'shower',
  },
  {
    id: 'dusj-100',
    name: 'Dusj 100 × 100',
    category: 'bad',
    sizes: [size('100', '100 × 100', 1.0, 1.0, 2.0)],
    defaultSize: '100',
    clearance: { front: 0.6 },
    snap: 'corner',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'shower',
    model: 'shower',
  },
  {
    id: 'dusjvegg',
    name: 'Dusjvegg',
    category: 'bad',
    sizes: [size('90', '90 cm', 0.9, 0.05, 2.0)],
    defaultSize: '90',
    stretch: { w: [0.3, 1.6] },
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'shower-screen',
    model: 'shower-screen',
  },
  {
    id: 'badekar',
    name: 'Badekar',
    category: 'bad',
    sizes: [size('170x75', '170 × 75', 1.7, 0.75, 0.6), size('160x70', '160 × 70', 1.6, 0.7, 0.6)],
    defaultSize: '170x75',
    clearance: { front: 0.6 },
    snap: 'corner',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'bathtub',
    model: 'bathtub',
  },
  {
    id: 'vaskemaskin',
    name: 'Vaskemaskin',
    category: 'bad',
    sizes: [size('60', '60 × 60', 0.6, 0.6, 0.85)],
    defaultSize: '60',
    clearance: { front: 0.6 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'washer',
    model: 'washer',
  },
  {
    id: 'torketrommel',
    name: 'Tørketrommel',
    category: 'bad',
    sizes: [size('60', '60 × 60', 0.6, 0.6, 0.85)],
    defaultSize: '60',
    clearance: { front: 0.6 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'dryer',
    model: 'dryer',
  },
  {
    id: 'vaskesoyle',
    name: 'Vaskesøyle',
    category: 'bad',
    sizes: [size('60', '60 × 60', 0.6, 0.6, 1.75)],
    defaultSize: '60',
    clearance: { front: 0.6 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'washer-tower',
    model: 'washer-tower',
  },
  {
    id: 'handkletorker',
    name: 'Håndkletørker',
    category: 'bad',
    sizes: [size('50', '50 × 10', 0.5, 0.1, 0.8)],
    defaultSize: '50',
    snap: 'back-to-wall',
    mount: 'wall',
    elevation: 0.9,
    symbol: 'towel-rail',
    model: 'towel-rail',
  },
  {
    id: 'sluk',
    name: 'Sluk',
    category: 'bad',
    sizes: [size('15', '15 × 15', 0.15, 0.15, 0.01)],
    defaultSize: '15',
    snap: 'free',
    mount: 'flat',
    elevation: 0,
    needsDrain: true,
    symbol: 'drain',
    model: 'drain',
  },
  {
    id: 'varmtvannsbereder',
    name: 'Varmtvannsbereder',
    category: 'bad',
    sizes: [size('200', '200 liter', 0.56, 0.56, 1.5), size('120', '120 liter', 0.5, 0.5, 1.1)],
    defaultSize: '200',
    snap: 'corner',
    mount: 'floor',
    elevation: 0,
    needsDrain: true,
    symbol: 'water-heater',
    model: 'water-heater',
  },

  // --- Badstue -------------------------------------------------------------------------------------------------
  {
    id: 'badstubenk',
    name: 'Badstubenk',
    category: 'badstue',
    sizes: [size('200', '200 × 120', 2.0, 1.2, 0.95), size('150', '150 × 120', 1.5, 1.2, 0.95)],
    defaultSize: '200',
    stretch: { w: [0.6, 4.0], d: [0.5, 1.5] },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'sauna-bench',
    model: 'sauna-bench',
  },
  {
    id: 'badstuovn',
    name: 'Badstuovn',
    category: 'badstue',
    sizes: [size('45', '45 × 40', 0.45, 0.4, 0.8)],
    defaultSize: '45',
    clearance: { around: 0.3 },
    snap: 'corner',
    mount: 'floor',
    elevation: 0,
    symbol: 'sauna-stove',
    model: 'sauna-stove',
  },

  // --- Annet ---------------------------------------------------------------------------------------------------
  {
    id: 'hylle',
    name: 'Hylle',
    category: 'annet',
    sizes: [size('80', '80 × 35', 0.8, 0.35, 1.8), size('120', '120 × 35', 1.2, 0.35, 1.8)],
    defaultSize: '80',
    stretch: { w: [0.3, 6.0], d: [0.2, 0.8] },
    colours: WOOD,
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'shelf',
    model: 'shelf',
  },
  {
    id: 'skohylle',
    name: 'Skohylle',
    category: 'annet',
    sizes: [size('80', '80 × 30', 0.8, 0.3, 0.5)],
    defaultSize: '80',
    stretch: { w: [0.4, 2.0] },
    colours: WOOD,
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'shoe-rack',
    model: 'shoe-rack',
  },
  {
    id: 'benk',
    name: 'Benk',
    category: 'annet',
    sizes: [size('120', '120 × 35', 1.2, 0.35, 0.45)],
    defaultSize: '120',
    stretch: { w: [0.4, 3.0] },
    colours: WOOD,
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'bench',
    model: 'bench',
  },
  {
    id: 'skistativ',
    name: 'Skistativ',
    category: 'annet',
    sizes: [size('100', '100 × 30', 1.0, 0.3, 1.2)],
    defaultSize: '100',
    stretch: { w: [0.5, 3.0] },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'ski-rack',
    model: 'ski-rack',
  },
  {
    id: 'vedstabel',
    name: 'Vedstabel',
    category: 'annet',
    sizes: [size('200', '200 × 60', 2.0, 0.6, 1.2)],
    defaultSize: '200',
    stretch: { w: [0.4, 5.0], d: [0.3, 1.2] },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'log-stack',
    model: 'log-stack',
  },

  // --- Ute -----------------------------------------------------------------------------------------------------
  {
    id: 'loungesofa',
    name: 'Loungesofa',
    category: 'ute',
    sizes: [size('240', '240 × 80', 2.4, 0.8, 0.85), size('180', '180 × 80', 1.8, 0.8, 0.85)],
    defaultSize: '240',
    colours: TEXTILE,
    clearance: { front: 0.5 },
    snap: 'back-to-wall',
    mount: 'floor',
    elevation: 0,
    symbol: 'lounge-sofa',
    model: 'lounge-sofa',
  },
  {
    id: 'utebord',
    name: 'Utebord',
    category: 'ute',
    sizes: [size('lav', '120 × 80, lavt', 1.2, 0.8, 0.45), size('spise', '160 × 90', 1.6, 0.9, 0.74)],
    defaultSize: 'spise',
    colours: WOOD,
    clearance: { around: 0.6 },
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'outdoor-table',
    model: 'outdoor-table',
  },
  {
    id: 'utestol',
    name: 'Utestol',
    category: 'ute',
    sizes: [size('stol', '55 × 60', 0.55, 0.6, 0.9), size('lounge', '70 × 80, lenestol', 0.7, 0.8, 0.9)],
    defaultSize: 'stol',
    colours: WOOD,
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'outdoor-chair',
    model: 'outdoor-chair',
  },
  {
    id: 'grill',
    name: 'Grill',
    category: 'ute',
    sizes: [size('kule', 'Kulegrill', 0.6, 0.6, 1.0), size('gass', 'Gassgrill', 1.2, 0.6, 1.15)],
    defaultSize: 'kule',
    clearance: { around: 0.5 },
    snap: 'free',
    mount: 'floor',
    elevation: 0,
    symbol: 'grill',
    model: 'grill',
  },
];

const BY_ID = new Map(FURNITURE_CATALOG.map((c) => [c.id, c]));

/** The catalogue entry for an id, or null when unknown ('furniture-unknown'; drawn as a plain box of its size). */
export function catalogItem(id: string): FurnitureCatalogItem | null {
  return BY_ID.get(id) ?? null;
}

/** Entries the library offers (not hidden), in catalogue order. */
export function libraryItems(): FurnitureCatalogItem[] {
  return FURNITURE_CATALOG.filter((c) => !c.hidden);
}

/** Library entries of one category, in catalogue order. */
export function itemsInCategory(category: FurnitureCategory): FurnitureCatalogItem[] {
  return libraryItems().filter((c) => c.category === category);
}

/** The preset `key` of an entry, else its default preset. */
export function presetOf(item: FurnitureCatalogItem, key?: string): FurnitureSize {
  return item.sizes.find((s) => s.key === key) ?? item.sizes.find((s) => s.key === item.defaultSize) ?? item.sizes[0];
}

/**
 * Size written at placement: the preset `sizeVariant` (else the default) of a known entry as `{ size, sizeVariant }`;
 * null for an unknown id.
 */
export function placementSize(catalogId: string, sizeVariant?: string): { size: { w: number; d: number; h: number }; sizeVariant: string } | null {
  const item = catalogItem(catalogId);
  if (!item) return null;
  const p = presetOf(item, sizeVariant);
  return { size: { w: p.w, d: p.d, h: p.h }, sizeVariant: p.key };
}

/** Whether the entry stands indoors (every category but 'ute'). Indoor items outside every room warn. */
export function isIndoor(item: FurnitureCatalogItem): boolean {
  return item.category !== 'ute';
}

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));

/**
 * A size request for an item of this entry: stretchable dimensions clamped into their ranges, the others as given
 * (Egenskaper only offers Bredde / Dybde where the entry stretches). Non-finite or non-positive values are replaced by
 * `fallback`'s.
 */
export function clampSize(
  item: FurnitureCatalogItem | null,
  wanted: { w: number; d: number; h: number },
  fallback: { w: number; d: number; h: number },
): { w: number; d: number; h: number } {
  const ok = (v: number, f: number) => (Number.isFinite(v) && v > 0 ? v : f);
  let w = ok(wanted.w, fallback.w);
  let d = ok(wanted.d, fallback.d);
  const h = ok(wanted.h, fallback.h);
  if (item?.stretch?.w) w = clamp(w, item.stretch.w);
  if (item?.stretch?.d) d = clamp(d, item.stretch.d);
  return { w, d, h };
}

/** An axis-aligned rectangle in the item's local frame (centre at the origin, back at +y). */
export interface LocalRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The item's solid parts in its local frame: the whole w × d rectangle, or for an 'l' outline the back strip (depth
 * `seat`) and the chaise (width `seat`) at the local +x end down to the front. Unknown entries are a plain box.
 */
export function localParts(item: FurnitureCatalogItem | null, sz: { w: number; d: number }): LocalRect[] {
  const hw = sz.w / 2;
  const hd = sz.d / 2;
  if (item?.outline === 'l') {
    const seat = Math.min(item.seat ?? 0.9, sz.w, sz.d);
    if (seat < sz.d - 1e-9 && seat < sz.w - 1e-9) {
      return [
        { x0: -hw, y0: hd - seat, x1: hw, y1: hd },
        { x0: hw - seat, y0: -hd, x1: hw, y1: hd - seat },
      ];
    }
  }
  return [{ x0: -hw, y0: -hd, x1: hw, y1: hd }];
}

/** The clearance zones of an entry in its local frame (front, two sides, or the four strips all around). */
export function localClearances(item: FurnitureCatalogItem | null, sz: { w: number; d: number }): LocalRect[] {
  const c = item?.clearance;
  if (!c) return [];
  const hw = sz.w / 2;
  const hd = sz.d / 2;
  const out: LocalRect[] = [];
  if (c.around && c.around > 0) {
    const a = c.around;
    out.push({ x0: -hw - a, y0: -hd - a, x1: hw + a, y1: -hd }, { x0: -hw - a, y0: hd, x1: hw + a, y1: hd + a });
    out.push({ x0: -hw - a, y0: -hd, x1: -hw, y1: hd }, { x0: hw, y0: -hd, x1: hw + a, y1: hd });
    return out;
  }
  if (c.front && c.front > 0) out.push({ x0: -hw, y0: -hd - c.front, x1: hw, y1: -hd });
  if (c.sides && c.sides > 0) out.push({ x0: -hw - c.sides, y0: -hd, x1: -hw, y1: hd }, { x0: hw, y0: -hd, x1: hw + c.sides, y1: hd });
  return out;
}

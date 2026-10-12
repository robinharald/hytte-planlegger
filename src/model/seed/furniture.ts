/**
 * Seed furnishing of Forslag D (docs/phase2-plan.md §4), ported from the old model's `buildD150()`
 * (3d-planlegger/reference/forrige-modell-v16.html) as a table: `{ id: 'fu-<room>-<n>', catalogId, size, centre,
 * rotationDeg, levelId }`. The old model was one level (FLOOR 0.4) with plan coordinates in the same frame, so its
 * positions carry over; its `toilet(x, y, rot)` used the same local frame (cistern at local +y, CCW rotation).
 *
 * How the old layout was ported (every number below is the result, stored as is — `createForslagD()` derives nothing):
 *  - Each item's back (local +y) was snapped onto the nearest inner face of its derived room within 0.15 m (the old
 *    boxes stood up to 11 cm inside the calibrated walls); corner items (showers, the water heater, the stoves) also
 *    onto the side face.
 *  - Beds: the old `bed()` always put the pillow at the max-x / max-y end, so the head is turned to the end wall
 *    instead (Soverom 1: moved 0.31 m east onto w-104-103; Soverom 2: head on the west wall and moved 0.5 m south,
 *    out of the swing of d-105; Soverom 3: a 90 × 190 bed, as the room is 1.96 m deep).
 *  - Toilets: back to back at x 18.6 (WC / Hovedbad); the lower bathroom's and Do's toilets turned to face the room.
 *  - Sinks moved out of door swings (lower Bad: on the south wall east of d-bad; WC: on the south wall); the pantry's
 *    west shelf is 0.28 m deep so d-pantry clears it; the Bod (ny) shelf stops 0.68 m before the door; the
 *    Mellombygg bench stands on the south wall west of door-mellom-vf instead of in front of the west door.
 *  - The kitchen counter runs from the tall units (x 9.01) to x 12; the corner sofa's back stands on the Stue /
 *    Passasje divider (y 2.2) and its chaise against w-wing-w; the old fireplace in front of the chimney is a
 *    Vedovn of today's cabin.
 *  - Lower-level rooms (Soverom 1–3, Bad) are on 'lower'; the outdoor lounge stands on the deck ('main').
 *  - `isNew`: false for the furniture of today's rooms (bedrooms, lower Bad, Leseskrok, Mellombygg, Do, Bod, the
 *    fireplace), true for the rest.
 * Tests (furniture.test.ts): fresh objects every call, stable ids, every item in a room of its level or on the deck,
 * no furniture warnings on the derived seed, each wall-backed item's back on an inner face.
 */
import type { FurnitureItem, Id, Vec2 } from '../types';

interface Row {
  id: Id;
  catalogId: string;
  sizeVariant?: string;
  /** w, d, h (m). */
  size: [number, number, number];
  centre: Vec2;
  rotationDeg: number;
  levelId: Id;
  isNew: boolean;
}

const row = (
  id: Id,
  catalogId: string,
  size: [number, number, number],
  centre: Vec2,
  rotationDeg: number,
  levelId: Id,
  isNew: boolean,
  sizeVariant?: string,
): Row => ({ id, catalogId, size, centre, rotationDeg, levelId, isNew, ...(sizeVariant ? { sizeVariant } : {}) });

// Rotation: 0 = back to the north, 90 = west, 180 = south, 270 = east.
const ROWS: Row[] = [
  // --- lower level: Soverom 1–3, Bad (today's rooms) ---
  row('fu-sov1-1', 'seng-150', [1.5, 2.0, 0.5], [1.99, 5.2], 270, 'lower', false, '150x200'),
  row('fu-sov2-1', 'seng-150', [1.5, 2.0, 0.5], [1.16, 0.91], 90, 'lower', false, '150x200'),
  row('fu-sov3-1', 'seng-90', [0.9, 1.9, 0.5], [4.59, 1.17], 0, 'lower', false, '90x190'),
  row('fu-bad-1', 'toalett', [0.4, 0.65, 0.8], [3.4, 5.715], 0, 'lower', false, 'gulv'),
  row('fu-bad-2', 'servant', [0.6, 0.45, 0.85], [4.6, 4.525], 180, 'lower', false, '60'),
  row('fu-bad-3', 'dusjvegg', [0.94, 0.05, 2.0], [4.225, 5.57], 90, 'lower', false, '90'),

  // --- main level, today's cabin ---
  // Leseskrok (glass bump): two armchairs and a small table along the south windows, a bookshelf on the west wall, a rug.
  row('fu-leseskrok-1', 'lenestol', [0.8, 0.8, 0.85], [6.1, -1.44], 180, 'main', false, '80'),
  row('fu-leseskrok-2', 'lenestol', [0.8, 0.8, 0.85], [7.9, -1.44], 180, 'main', false, '80'),
  row('fu-leseskrok-3', 'salongbord', [0.6, 0.6, 0.45], [7.0, -1.35], 0, 'main', false, '60x60'),
  row('fu-leseskrok-4', 'bokhylle', [1.8, 0.3, 1.9], [5.31, -0.94], 90, 'main', false, '80'),
  row('fu-leseskrok-5', 'teppe', [2.4, 1.7, 0.01], [7.0, -0.95], 0, 'main', false, '240x170'),
  // The fireplace in front of the chimney (today's cabin).
  row('fu-stue-1', 'vedovn', [0.5, 0.45, 1.0], [7.355, 2.255], 0, 'main', false, '50'),
  // Mellombygg, Do, Bod.
  row('fu-mellombygg-1', 'benk', [1.0, 0.35, 0.45], [5.95, 6.485], 180, 'main', false, '120'),
  row('fu-do-1', 'toalett', [0.4, 0.65, 0.8], [5.6, 9.615], 0, 'main', false, 'gulv'),
  row('fu-bod-1', 'hylle', [1.2, 0.4, 1.8], [6.9, 9.74], 0, 'main', false, '120'),
  // Teknisk / vask (former bod 108): washing machine and the water heater.
  row('fu-teknisk-1', 'vaskemaskin', [0.6, 0.6, 0.85], [8.05, 8.055], 180, 'main', true, '60'),
  row('fu-teknisk-2', 'varmtvannsbereder', [0.56, 0.56, 1.5], [8.56, 9.66], 270, 'main', true, '200'),

  // --- kitchen with island ---
  row('fu-kjokken-1', 'hoyskap', [1.7, 0.6, 2.1], [8.71, 5.19], 90, 'main', true, '60'),
  row('fu-kjokken-2', 'benkeskap', [2.99, 0.6, 0.9], [10.505, 5.74], 0, 'main', true, '240'),
  row('fu-kjokken-3', 'kjokkenoy', [2.4, 0.85, 0.92], [10.7, 3.925], 0, 'main', true, '240x85'),

  // --- dining (north) and living room (south) in the extension ---
  row('fu-spiseplass-1', 'spisebord-8', [2.6, 1.0, 0.74], [14.2, 4.95], 0, 'main', true, '260x100'),
  row('fu-spiseplass-2', 'stol', [0.45, 0.45, 0.85], [13.4, 4.1], 180, 'main', true, '45'),
  row('fu-spiseplass-3', 'stol', [0.45, 0.45, 0.85], [14.2, 4.1], 180, 'main', true, '45'),
  row('fu-spiseplass-4', 'stol', [0.45, 0.45, 0.85], [15.0, 4.1], 180, 'main', true, '45'),
  row('fu-spiseplass-5', 'stol', [0.45, 0.45, 0.85], [13.4, 5.8], 0, 'main', true, '45'),
  row('fu-spiseplass-6', 'stol', [0.45, 0.45, 0.85], [14.2, 5.8], 0, 'main', true, '45'),
  row('fu-spiseplass-7', 'stol', [0.45, 0.45, 0.85], [15.0, 5.8], 0, 'main', true, '45'),
  row('fu-spiseplass-8', 'stol', [0.45, 0.45, 0.85], [12.55, 4.95], 90, 'main', true, '45'),
  row('fu-stue-2', 'hjornesofa', [3.25, 1.3, 0.8], [14.315, 1.55], 0, 'main', true, '270x160'),
  row('fu-stue-3', 'salongbord', [1.2, 0.6, 0.45], [14.0, 0.875], 0, 'main', true, '120x60'),
  row('fu-stue-4', 'teppe', [2.2, 1.15, 0.01], [13.9, 0.875], 0, 'main', true, '200x140'),
  row('fu-stue-5', 'lenestol', [0.7, 0.7, 0.85], [12.45, 0.7], 90, 'main', true, '70'),
  row('fu-stue-6', 'vedovn', [0.5, 0.45, 1.0], [15.715, 0.41], 270, 'main', true, '50'),

  // --- new wing ---
  // Bedroom over the whole north side, headboard to the east.
  row('fu-sov-ny-1', 'seng-180', [1.8, 2.0, 0.5], [19.64, 4.75], 270, 'main', true, '180x200'),
  row('fu-sov-ny-2', 'nattbord', [0.35, 0.3, 0.5], [20.49, 3.655], 270, 'main', true, '35'),
  row('fu-sov-ny-3', 'nattbord', [0.35, 0.3, 0.5], [20.49, 5.845], 270, 'main', true, '35'),
  row('fu-sov-ny-4', 'garderobeskap', [2.05, 0.6, 2.1], [16.36, 4.925], 90, 'main', true, '100'),
  row('fu-sov-ny-5', 'teppe', [1.2, 1.5, 0.01], [17.8, 4.75], 0, 'main', true, '200x140'),
  row('fu-sov-ny-6', 'lenestol', [0.7, 0.7, 0.85], [17.35, 5.69], 0, 'main', true, '70'),
  // Corridor rug.
  row('fu-gang-1', 'teppe', [4.2, 0.8, 0.01], [18.4, 2.8], 0, 'main', true, '200x140'),
  // Pantry: L-shaped shelves (the west run shallow enough for d-pantry's swing, and clear of the exterior walls' inner
  // corner at (16, 0), which reaches 0.16 into the room).
  row('fu-pantry-1', 'hylle', [1.93, 0.28, 2.0], [16.2, 1.135], 90, 'main', true, '80'),
  row('fu-pantry-2', 'hylle', [1.0, 0.35, 2.0], [16.84, 0.235], 180, 'main', true, '80'),
  // WC: toilet on the drain wall x 18.6 (back to back with the bathroom's), small sink on the south wall.
  row('fu-wc-1', 'toalett', [0.4, 0.65, 0.8], [18.215, 0.9], 270, 'main', true, 'gulv'),
  row('fu-wc-2', 'servant', [0.45, 0.35, 0.85], [17.75, 0.235], 180, 'main', true, '45'),
  // Hovedbad: toilet on the drain wall, sink on the east wall, washer tower, 90 × 90 shower in the south-east corner.
  row('fu-hovedbad-1', 'toalett', [0.4, 0.65, 0.8], [18.985, 0.9], 90, 'main', true, 'gulv'),
  row('fu-hovedbad-2', 'servant', [1.0, 0.48, 0.85], [20.4, 1.4], 270, 'main', true, '100'),
  row('fu-hovedbad-3', 'vaskesoyle', [0.6, 0.6, 1.75], [18.96, -0.2], 90, 'main', true, '60'),
  row('fu-hovedbad-4', 'dusj-90', [0.9, 0.9, 2.0], [20.19, -1.39], 270, 'main', true, '90'),
  // Badstue: two-tier bench along the north wall, stove in the south-east corner.
  row('fu-badstue-1', 'badstubenk', [1.95, 1.25, 0.95], [17.135, -0.685], 0, 'main', true, '200'),
  row('fu-badstue-2', 'badstuovn', [0.45, 0.4, 0.8], [18.34, -1.615], 270, 'main', true, '45'),

  // --- bod wing extension ---
  row('fu-bod-ny-1', 'hylle', [3.0, 0.35, 1.8], [6.66, 10.385], 180, 'main', true, '80'),
  row('fu-bod-ny-2', 'hylle', [0.4, 0.35, 1.8], [5.335, 10.76], 90, 'main', true, '80'),
  row('fu-ved-1', 'vedstabel', [3.3, 0.75, 1.7], [6.85, 11.565], 0, 'main', true, '200'),

  // --- outdoor furniture in front of the living room (deck) ---
  row('fu-terrasse-1', 'loungesofa', [2.4, 0.75, 0.85], [12.8, -0.825], 0, 'main', true, '240'),
  row('fu-terrasse-2', 'utebord', [1.2, 0.8, 0.45], [12.8, -2.3], 0, 'main', true, 'lav'),
  row('fu-terrasse-3', 'utestol', [0.7, 0.8, 0.9], [11.4, -2.6], 180, 'main', true, 'lounge'),
  row('fu-terrasse-4', 'utestol', [0.7, 0.8, 0.9], [14.2, -2.6], 180, 'main', true, 'lounge'),
];

/** The seed furniture (fresh objects on every call; stable ids). */
export function buildFurniture(): FurnitureItem[] {
  return ROWS.map((r) => {
    const item: FurnitureItem = {
      id: r.id,
      catalogId: r.catalogId,
      position: [r.centre[0], r.centre[1]],
      rotationDeg: r.rotationDeg,
      levelId: r.levelId,
      size: { w: r.size[0], d: r.size[1], h: r.size[2] },
      isNew: r.isNew,
    };
    if (r.sizeVariant) item.sizeVariant = r.sizeVariant;
    return item;
  });
}

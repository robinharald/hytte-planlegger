/**
 * Tiny but complete Project fixture for unit tests (store, persistence, selection). Not used by the app.
 * One gable block 6 × 4 m on level `main`, one room, no openings.
 */
import { CURRENT_SCHEMA_VERSION } from '../model/types';
import type { Project, Variant } from '../model/types';

export const TEST_ISO = '2026-10-11T10:00:00.000Z';

export function makeVariant(id: string, name: string): Variant {
  return {
    id,
    name,
    createdAt: TEST_ISO,
    levels: [
      { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
      { id: 'loft', name: 'Hems', storeyId: 'loft', elevation: 1.47, floorThickness: 0.17 },
    ],
    blocks: [
      {
        id: 'blk-1',
        name: 'Hytta',
        polygon: [
          { id: 'v-sw', p: [0, 0] },
          { id: 'v-se', p: [6, 0] },
          { id: 'v-ne', p: [6, 4] },
          { id: 'v-nw', p: [0, 4] },
        ],
        levelId: 'main',
        floorZones: [],
        parts: [],
        isNew: false,
        wall: { thickness: 0.27, outerOffset: 0.11 },
        eaveHeight: 2.22,
        roof: {
          type: 'gable',
          ridgeAxis: 'x',
          drive: 'pitch',
          pitchDeg: 28,
          ridgeHeight: 3.87,
          thickness: 0.31,
          overhangEave: 0.51,
          overhangGable: 0.35,
          material: 'turf',
        },
        junctions: [],
      },
    ],
    walls: [
      { id: 'w-1', a: [3, 0], b: [3, 4], thickness: 0.12, levelId: 'main', status: 'existing', kind: 'interior', heightMode: 'fixed', height: 2.3 },
    ],
    openings: [],
    rooms: [
      { id: 'room-1', name: 'Stue', type: 'stue', levelId: 'main', anchor: [1.5, 2] },
      { id: 'room-2', name: 'Soverom', type: 'soverom', levelId: 'main', anchor: [4.5, 2] },
    ],
    furniture: [],
    outdoor: { decks: [], hotTubs: [] },
    structure: [],
    settings: {
      defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 },
      defaultInteriorThickness: 0.12,
      areaLimit: null,
    },
  };
}

export function makeTestProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: 'test-project',
    name: 'Testhytte',
    createdAt: TEST_ISO,
    updatedAt: TEST_ISO,
    seedRevision: 1,
    site: {
      originLatLon: { lat: 68.61305, lon: 14.968157 },
      planNorthBearing: 106,
      floorElevation: 161,
      waterLevel: 152,
      terrainId: 'merkesvatnet-2026-10',
      groundWorks: [],
      timezone: 'Europe/Oslo',
      trees: [],
    },
    variants: [makeVariant('v-1', 'Forslag D')],
    activeVariantId: 'v-1',
    ...overrides,
  };
}

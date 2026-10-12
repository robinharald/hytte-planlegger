import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE_CATALOG, localParts } from '../furniture/catalog';
import { furnitureFootprint } from '../geometry/derive';
import type { DerivedFurniture } from '../model/derived';
import type { FurnitureItem, Vec2, Vec3 } from '../model/types';
import { fromWorld } from './coords';
import { FIXTURE_DERIVED } from './fixture';
import {
  CATALOG_MODELS,
  catalogSeat,
  clipPart,
  CORNER_SOFA_SEAT,
  emitFurnitureModel,
  FLUE_TOP,
  FURNITURE_CATALOG_IDS,
  FURNITURE_FRONT,
  FURNITURE_MAT,
  FURNITURE_MODELS,
  FURNITURE_SLOTS,
  furnitureClip,
  furnitureDropLevel,
  furnitureLocalToPlan,
  furnitureModel,
  furnitureTransform,
  MODEL_KEYS,
  modelHintName,
  modelSpecFor,
  parseFurnitureColour,
  partsBounds,
  STOVE_WITH_FLUE_MIN_H,
} from './furnitureBuilders';
import type { FurniturePart, FurnitureSize } from './furnitureBuilders';
import { isEmpty, meshBounds, signedVolume, triangleCount } from './geometryBuilders';
import { FURNITURE_PALETTE } from './materials';

/** Plausible catalogue sizes (w × d × h, m); the models must fit any size, see also SCALES. */
const TYPICAL: Record<(typeof FURNITURE_CATALOG_IDS)[number], [number, number, number]> = {
  'seng-90': [0.9, 2.0, 0.5],
  'seng-120': [1.2, 2.0, 0.9],
  'seng-150': [1.5, 2.0, 0.9],
  'seng-180': [1.8, 2.1, 0.55],
  koyeseng: [0.9, 2.0, 1.6],
  nattbord: [0.45, 0.4, 0.5],
  garderobeskap: [1.0, 0.6, 2.0],
  kommode: [0.8, 0.45, 0.8],
  'sofa-2': [1.6, 0.9, 0.8],
  'sofa-3': [2.2, 0.9, 0.8],
  hjornesofa: [2.6, 2.0, 0.8],
  lenestol: [0.8, 0.85, 0.9],
  salongbord: [1.2, 0.6, 0.45],
  teppe: [2.0, 1.4, 0.01],
  'tv-benk': [1.6, 0.4, 0.5],
  bokhylle: [0.8, 0.3, 2.0],
  vedovn: [0.55, 0.55, 1.0],
  benkeskap: [0.6, 0.6, 0.9],
  overskap: [0.6, 0.35, 0.7],
  hoyskap: [0.6, 0.6, 2.1],
  kjoleskap: [0.6, 0.65, 1.85],
  kjokkenoy: [2.2, 0.9, 0.9],
  'spisebord-4': [1.2, 0.8, 0.75],
  'spisebord-6': [1.8, 0.9, 0.75],
  'spisebord-8': [2.4, 1.0, 0.75],
  stol: [0.45, 0.5, 0.85],
  toalett: [0.4, 0.6, 0.8],
  servant: [0.6, 0.45, 0.85],
  'dusj-80': [0.8, 0.8, 2.0],
  'dusj-90': [0.9, 0.9, 2.0],
  'dusj-100': [1.0, 1.0, 2.0],
  dusjvegg: [0.9, 0.05, 2.0],
  badekar: [1.7, 0.75, 0.6],
  vaskemaskin: [0.6, 0.6, 0.85],
  torketrommel: [0.6, 0.6, 0.85],
  vaskesoyle: [0.6, 0.65, 1.75],
  handkletorker: [0.5, 0.1, 1.2],
  sluk: [0.15, 0.15, 0.01],
  varmtvannsbereder: [0.55, 0.55, 1.5],
  badstubenk: [1.8, 1.1, 0.95],
  badstuovn: [0.45, 0.45, 0.8],
  hylle: [0.8, 0.4, 1.8],
  skohylle: [0.8, 0.3, 0.5],
  benk: [1.2, 0.35, 0.45],
  skistativ: [1.0, 0.4, 1.8],
  vedstabel: [2.0, 0.6, 1.5],
  loungesofa: [2.0, 0.85, 0.85],
  utebord: [1.6, 0.9, 0.75],
  utestol: [0.6, 0.65, 0.9],
  grill: [1.2, 0.6, 1.15],
};

/** Size variations applied to every typical size (stretched, squashed, taller, lower). */
const SCALES: [number, number, number][] = [
  [1, 1, 1],
  [1.3, 0.85, 1.1],
  [0.8, 1.25, 0.9],
  [1.6, 1.0, 1.0],
];

const sizesOf = (id: (typeof FURNITURE_CATALOG_IDS)[number]): FurnitureSize[] =>
  SCALES.map(([a, b, c]) => {
    const [w, d, h] = TYPICAL[id];
    return { w: w * a, d: d * b, h: h * c };
  });

const TOL = 0.05;

function expectFits(b: { min: Vec3; max: Vec3 }, s: FurnitureSize, label: string) {
  const half: Vec3 = [s.w / 2, s.d / 2, s.h];
  const lo: Vec3 = [-s.w / 2, -s.d / 2, 0];
  const dims: Vec3 = [s.w, s.d, s.h];
  for (let k = 0; k < 3; k++) {
    for (const v of [b.min[k], b.max[k]]) expect(Number.isFinite(v), `${label} axis ${k} finite`).toBe(true);
    expect(Math.abs(b.min[k] - lo[k]), `${label} min[${k}] ${b.min[k]} vs ${lo[k]}`).toBeLessThanOrEqual(TOL * dims[k] + 1e-9);
    expect(Math.abs(b.max[k] - half[k]), `${label} max[${k}] ${b.max[k]} vs ${half[k]}`).toBeLessThanOrEqual(TOL * dims[k] + 1e-9);
  }
}

function item(over: Partial<FurnitureItem> = {}): FurnitureItem {
  return { id: 'f', catalogId: 'stol', position: [3, 2], rotationDeg: 0, levelId: 'main', size: { w: 0.5, d: 0.4, h: 0.9 }, isNew: true, ...over };
}

function derivedOf(it: FurnitureItem, z = 0): Pick<DerivedFurniture, 'item' | 'z'> {
  return { item: it, z };
}

describe('furniture models: coverage', () => {
  it('every catalogue id has a real model (not the placeholder) and every model is used', () => {
    expect(FURNITURE_CATALOG_IDS.length).toBe(50);
    expect(new Set(FURNITURE_CATALOG_IDS).size).toBe(50);
    expect(Object.keys(CATALOG_MODELS).sort()).toEqual([...FURNITURE_CATALOG_IDS].sort());
    for (const id of FURNITURE_CATALOG_IDS) {
      const spec = modelSpecFor(id);
      expect(spec.model, id).not.toBe('placeholder');
      expect(FURNITURE_MODELS[spec.model], id).toBeTypeOf('function');
      expect(furnitureModel(id, { w: TYPICAL[id][0], d: TYPICAL[id][1], h: TYPICAL[id][2] }).parts.length, id).toBeGreaterThan(0);
    }
    const used = new Set(Object.values(CATALOG_MODELS).map((s) => s.model));
    for (const name of Object.keys(FURNITURE_MODELS)) if (name !== 'placeholder') expect(used.has(name as never), name).toBe(true);
  });

  it('every slot has a palette colour, and each model colour slot is one the model uses', () => {
    for (const s of FURNITURE_SLOTS) expect(FURNITURE_PALETTE[s], s).toBeTypeOf('number');
    expect(FURNITURE_SLOTS.map((s) => FURNITURE_MAT[s])).toEqual(FURNITURE_SLOTS.map((_, i) => i));
    for (const id of FURNITURE_CATALOG_IDS) {
      const m = furnitureModel(id, { w: TYPICAL[id][0], d: TYPICAL[id][1], h: TYPICAL[id][2] });
      for (const s of m.colourSlots) expect(m.parts.some((p) => p.slot === s), `${id} uses ${s}`).toBe(true);
    }
  });

  it('unknown ids get the placeholder box (pine, the full size); a catalogue model hint picks a model for later ids', () => {
    const m = furnitureModel('ukjent-ting', { w: 0.7, d: 0.5, h: 1.2 });
    expect(m.name).toBe('placeholder');
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].slot).toBe('pine');
    expectFits(partsBounds(m.parts), { w: 0.7, d: 0.5, h: 1.2 }, 'placeholder');
    expect(modelSpecFor('seng-200', 'bed').model).toBe('bed');
    expect(modelSpecFor('seng-200', { kind: 'sofa' }).model).toBe('sofa');
    expect(modelSpecFor('seng-200', { builder: 'nonsense' }).model).toBe('placeholder');
    expect(modelSpecFor('stol', 'bed').model).toBe('chair'); // known ids keep their model
    expect(modelHintName({ name: 'chair' })).toBe('chair');
    expect(modelHintName(42)).toBeUndefined();
  });

  it('a missing or invalid size falls back to 1 × 1 × 1 m', () => {
    expect(furnitureModel('stol', null).size).toEqual({ w: 1, d: 1, h: 1 });
    expect(furnitureModel('stol', { w: Number.NaN, d: -1, h: 0.8 }).size).toEqual({ w: 1, d: 1, h: 0.8 });
  });
});

describe('furniture models: bounds match the stored size within 5 %', () => {
  for (const id of FURNITURE_CATALOG_IDS) {
    it(id, () => {
      for (const s of sizesOf(id)) {
        const m = furnitureModel(id, s);
        expectFits(partsBounds(m.parts), s, `${id} ${s.w.toFixed(2)}×${s.d.toFixed(2)}×${s.h.toFixed(2)}`);
        // extras (the flue, the tap) only rise above the size box, inside the footprint
        const extra = m.parts.filter((p) => p.extra);
        if (extra.length) {
          const b = partsBounds(extra, true);
          expect(b.min[0]).toBeGreaterThanOrEqual(-s.w / 2 - 1e-9);
          expect(b.max[0]).toBeLessThanOrEqual(s.w / 2 + 1e-9);
          expect(b.min[1]).toBeGreaterThanOrEqual(-s.d / 2 - 1e-9);
          expect(b.max[1]).toBeLessThanOrEqual(s.d / 2 + 1e-9);
          expect(b.min[2]).toBeGreaterThanOrEqual(0);
        }
        // the emitted mesh spans the same box (extras included) and is finite
        const data = emitFurnitureModel(m);
        expect(isEmpty(data.solid) && isEmpty(data.glass), id).toBe(false);
        const all = [data.solid, data.glass].filter((d) => !isEmpty(d)).map(meshBounds);
        const mb = { min: [0, 1, 2].map((k) => Math.min(...all.map((b) => b.min[k]))), max: [0, 1, 2].map((k) => Math.max(...all.map((b) => b.max[k]))) };
        const pb = partsBounds(m.parts, true);
        for (let k = 0; k < 3; k++) {
          expect(mb.min[k]).toBeCloseTo(pb.min[k], 6);
          expect(mb.max[k]).toBeCloseTo(pb.max[k], 6);
        }
        expect(data.solid.positions.every(Number.isFinite) && data.glass.positions.every(Number.isFinite)).toBe(true);
      }
    });
  }
});

describe('furniture models: geometry', () => {
  it('every part is a closed solid with outward normals', () => {
    for (const id of FURNITURE_CATALOG_IDS) {
      const m = furnitureModel(id, { w: TYPICAL[id][0], d: TYPICAL[id][1], h: TYPICAL[id][2] });
      let emitted = 0;
      for (const p of m.parts) {
        const d = emitFurnitureModel({ parts: [p] });
        const data = p.slot === 'glass' ? d.glass : d.solid;
        if (isEmpty(data)) continue;
        emitted++;
        expect(signedVolume(data), `${id} ${p.kind} ${p.slot}`).toBeGreaterThan(0);
      }
      expect(emitted, id).toBe(m.parts.length);
    }
  });

  it('merges an item into one solid mesh with one group per used slot, glass apart', () => {
    const bed = emitFurnitureModel(furnitureModel('seng-150', { w: 1.5, d: 2, h: 0.9 }));
    expect(bed.solid.indices).toHaveLength(FURNITURE_SLOTS.length);
    expect(triangleCount(bed.solid, FURNITURE_MAT.wood)).toBeGreaterThan(0);
    expect(triangleCount(bed.solid, FURNITURE_MAT.mattress)).toBeGreaterThan(0);
    expect(triangleCount(bed.solid, FURNITURE_MAT.duvetB)).toBeGreaterThan(0);
    expect(isEmpty(bed.glass)).toBe(true);
    const shower = emitFurnitureModel(furnitureModel('dusj-90', { w: 0.9, d: 0.9, h: 2 }));
    expect(triangleCount(shower.glass)).toBeGreaterThan(0);
    expect(triangleCount(shower.solid, FURNITURE_MAT.porcelain)).toBeGreaterThan(0);
    const logs = emitFurnitureModel(furnitureModel('vedstabel', { w: 2, d: 0.6, h: 1.5 }));
    expect(triangleCount(logs.solid, FURNITURE_MAT.logs)).toBe(4); // log ends on the front and the back
    expect(triangleCount(logs.solid, FURNITURE_MAT.dark)).toBe(6); // the two ends and the top
    const tub = emitFurnitureModel(furnitureModel('badekar', { w: 1.7, d: 0.75, h: 0.6 }));
    expect(triangleCount(tub.solid, FURNITURE_MAT.water)).toBeGreaterThan(0);
    const stove = emitFurnitureModel(furnitureModel('vedovn', { w: 0.55, d: 0.55, h: 1 }));
    expect(triangleCount(stove.solid, FURNITURE_MAT.black)).toBeGreaterThan(0);
    expect(triangleCount(stove.solid, FURNITURE_MAT.fire)).toBeGreaterThan(0);
  });

  it('the water of the bathtub lies below the rim inside the shell', () => {
    const m = furnitureModel('badekar', { w: 1.7, d: 0.75, h: 0.6 });
    const water = m.parts.filter((p) => p.slot === 'water');
    expect(water).toHaveLength(1);
    const b = partsBounds(water);
    expect(b.max[2]).toBeGreaterThan(0.3);
    expect(b.max[2]).toBeLessThan(0.6);
    expect(b.min[0]).toBeGreaterThan(-0.85 + 0.05);
    expect(b.max[1]).toBeLessThan(0.375 - 0.05);
  });

  it('fronts face local −y: chair back, toilet tank and shower head at +y, washer door and stove window at −y', () => {
    expect(FURNITURE_FRONT).toEqual([0, -1]);
    const tall = (id: string, s: FurnitureSize, above: number) =>
      partsBounds(furnitureModel(id, s).parts.filter((p) => partsBounds([p], true).min[2] >= above - 1e-9));
    expect(tall('stol', { w: 0.45, d: 0.5, h: 0.85 }, 0.5).min[1]).toBeGreaterThan(0.1); // the back rises at +y
    expect(tall('toalett', { w: 0.4, d: 0.6, h: 0.8 }, 0.6).min[1]).toBeGreaterThan(0); // tank at +y
    const shower = furnitureModel('dusj-90', { w: 0.9, d: 0.9, h: 2 });
    const small = (p: FurniturePart) => {
      const b = partsBounds([p]);
      return b.min[2] > 1.7 && b.max[0] - b.min[0] < 0.3 && b.max[1] - b.min[1] < 0.3;
    };
    const head = shower.parts.filter((p) => p.slot === 'metal' && small(p));
    expect(head.length).toBeGreaterThan(0);
    expect(partsBounds(head).min[1]).toBeGreaterThan(0.1);
    const washer = furnitureModel('vaskemaskin', { w: 0.6, d: 0.6, h: 0.85 });
    expect(partsBounds(washer.parts.filter((p) => p.kind === 'extrude')).min[1]).toBeCloseTo(-0.3, 9);
    const stove = furnitureModel('vedovn', { w: 0.55, d: 0.55, h: 1 });
    expect(partsBounds(stove.parts.filter((p) => p.slot === 'fire')).max[1]).toBeLessThan(-0.25);
  });

  it('beds: the head (headboard, pillows) at +y; a bed wider than deep turns with the head at +x', () => {
    const long = furnitureModel('seng-90', { w: 0.9, d: 2, h: 0.9 });
    const head = long.parts.filter((p) => p.slot === 'wood' && partsBounds([p]).max[2] > 0.8);
    expect(partsBounds(head).min[1]).toBeGreaterThan(0.9);
    const across = furnitureModel('seng-90', { w: 2, d: 0.9, h: 0.9 });
    const head2 = across.parts.filter((p) => p.slot === 'wood' && partsBounds([p]).max[2] > 0.8);
    expect(partsBounds(head2).min[0]).toBeGreaterThan(0.9);
    expectFits(partsBounds(across.parts), { w: 2, d: 0.9, h: 0.9 }, 'bed across');
  });

  it('the vedovn flue rises to FLUE_TOP when the height is the stove alone, and stays inside a height that includes it', () => {
    const low = furnitureModel('vedovn', { w: 0.55, d: 0.55, h: 1 });
    expect(low.top).toBeCloseTo(FLUE_TOP, 9);
    expect(low.parts.filter((p) => p.extra)).toHaveLength(1);
    const tall = furnitureModel('vedovn', { w: 0.55, d: 0.55, h: STOVE_WITH_FLUE_MIN_H + 0.7 });
    expect(tall.top).toBeCloseTo(STOVE_WITH_FLUE_MIN_H + 0.7, 9);
    expect(tall.parts.some((p) => p.extra)).toBe(false);
  });
});

describe('furniture models: interior cut', () => {
  it('clips every part at the local cut height and drops what lies above', () => {
    for (const id of FURNITURE_CATALOG_IDS) {
      const [w, d, h] = TYPICAL[id];
      const m = furnitureModel(id, { w, d, h });
      const cut = h * 0.5;
      const out = emitFurnitureModel(m, cut);
      for (const data of [out.solid, out.glass]) if (!isEmpty(data)) expect(meshBounds(data).max[2], id).toBeLessThanOrEqual(cut + 1e-9);
      expect(isEmpty(emitFurnitureModel(m, 0).solid), id).toBe(true);
    }
  });

  it('clips a horizontal extrusion (washer door) to its lower part', () => {
    const door: FurniturePart = { kind: 'extrude', axis: 'y', profile: [[0, 0], [1, 0], [1, 1], [0, 1]], a0: 0, a1: 0.1, slot: 'metal' };
    const cut = clipPart(door, 0.4);
    expect(cut && cut.kind === 'extrude' ? partsBounds([cut]).max[2] : null).toBeCloseTo(0.4, 9);
    expect(clipPart(door, 0)).toBeNull();
    expect(clipPart(door, 2)).toBe(door);
  });

  it('furnitureClip: none without a cut or when the cut misses, else the local height to the millimetre', () => {
    expect(furnitureClip(null, 0, 1)).toBeNull();
    expect(furnitureClip(1.3, 0, 0.9)).toBeNull();
    expect(furnitureClip(1.3, 0, 2.1)).toBe(1.3);
    expect(furnitureClip(1.3, -1.0, 2.1)).toBeNull();
    expect(furnitureClip(2.77, 1.47, 2.0)).toBe(1.3);
    expect(furnitureClip(1.3, 1.47, 2.0)).toBe(0);
    expect(furnitureClip(1.30049, 0, 2)).toBe(1.3);
  });
});

describe('furniture placement: rotation mapping (plan → three.js)', () => {
  const sizes = { w: 1.6, d: 0.7, h: 0.8 };
  for (const deg of [0, 30, 90, 180, 217, 270, -45]) {
    it(`rotationDeg ${deg}: the local footprint lands on derive's footprint, z at the item's bottom`, () => {
      const it0 = item({ catalogId: 'sofa-2', position: [7.25, -1.5], rotationDeg: deg, size: sizes });
      const f = derivedOf(it0, 0.42);
      const t = furnitureTransform(f);
      const o = new Object3D();
      o.position.set(...t.position);
      o.rotation.y = t.rotationY;
      o.updateMatrixWorld(true);
      const local: Vec2[] = [
        [-sizes.w / 2, -sizes.d / 2],
        [sizes.w / 2, -sizes.d / 2],
        [sizes.w / 2, sizes.d / 2],
        [-sizes.w / 2, sizes.d / 2],
      ];
      const expected = furnitureFootprint(it0);
      local.forEach(([x, y], i) => {
        // local plan (x, y, z) → local world (x, z, −y) → world → plan
        const p = fromWorld(new Vector3(x, 0.3, -y).applyMatrix4(o.matrixWorld));
        expect(p[0]).toBeCloseTo(expected[i][0], 9);
        expect(p[1]).toBeCloseTo(expected[i][1], 9);
        expect(p[2]).toBeCloseTo(0.42 + 0.3, 9);
        const q = furnitureLocalToPlan(f, [x, y, 0.3]);
        expect(q[0]).toBeCloseTo(p[0], 9);
        expect(q[1]).toBeCloseTo(p[1], 9);
        expect(q[2]).toBeCloseTo(p[2], 9);
      });
    });
  }

  it('an item turned 90° faces +x (east) in the plan', () => {
    const f = derivedOf(item({ rotationDeg: 90, position: [0, 0] }));
    const front = furnitureLocalToPlan(f, [FURNITURE_FRONT[0], FURNITURE_FRONT[1], 0]);
    expect(front[0]).toBeCloseTo(1, 9);
    expect(front[1]).toBeCloseTo(0, 9);
  });

  it('a non-finite rotation or z places the item unturned on the main floor', () => {
    const t = furnitureTransform({ item: item({ rotationDeg: Number.NaN }), z: Number.NaN });
    expect(t.rotationY).toBe(0);
    expect(t.position[1]).toBe(0);
  });
});

describe('furniture colour', () => {
  it('parses hex colours and palette slot names; anything else is ignored', () => {
    expect(parseFurnitureColour('#4d5e4c')).toBe(0x4d5e4c);
    expect(parseFurnitureColour('B46A55')).toBe(0xb46a55);
    expect(parseFurnitureColour('#abc')).toBe(0xaabbcc);
    expect(parseFurnitureColour(' #ffffff ')).toBe(0xffffff);
    expect(parseFurnitureColour('sofa', FURNITURE_PALETTE)).toBe(FURNITURE_PALETTE.sofa);
    expect(parseFurnitureColour('sofa')).toBeNull();
    expect(parseFurnitureColour('rød', FURNITURE_PALETTE)).toBeNull();
    expect(parseFurnitureColour('abc')).toBeNull();
    expect(parseFurnitureColour(undefined)).toBeNull();
  });
});

describe('furniture models against the catalogue (furniture/catalog.ts)', () => {
  it('every catalogue entry has its model, and its model key maps to the same model for later ids', () => {
    for (const entry of FURNITURE_CATALOG) {
      const spec = modelSpecFor(entry.id);
      expect(spec.model, entry.id).not.toBe('placeholder');
      expect(MODEL_KEYS[entry.model], `${entry.id}: model key ${entry.model}`).toBeDefined();
      expect(MODEL_KEYS[entry.model].model, entry.id).toBe(spec.model);
      expect(modelSpecFor(`${entry.id}-ny`, entry.model).model, entry.id).toBe(spec.model);
      if (entry.colours?.length) expect(spec.colourSlots.length, `${entry.id} takes its swatch colours`).toBeGreaterThan(0);
    }
  });

  it('every preset size of every entry is matched within 5 %', () => {
    for (const entry of FURNITURE_CATALOG) {
      for (const p of entry.sizes) {
        const s = { w: p.w, d: p.d, h: p.h };
        const m = furnitureModel(entry.id, s, entry.model, { seat: entry.seat });
        expectFits(partsBounds(m.parts), s, `${entry.id} ${p.key}`);
      }
    }
  });

  it("the corner sofa follows the catalogue's L: back strip and chaise at +x, the corner −x/−y left free", () => {
    const entry = FURNITURE_CATALOG.find((c) => c.id === 'hjornesofa')!;
    expect(entry.outline).toBe('l');
    for (const p of entry.sizes) {
      const m = furnitureModel(entry.id, p, entry.model, { seat: entry.seat });
      const rects = localParts(entry, p);
      expect(rects).toHaveLength(2);
      const [strip, chaise] = rects;
      expect(chaise.x0).toBeGreaterThan(0); // the chaise is at local +x
      for (const part of m.parts) {
        // inside the L = inside the strip (y ≥ its front edge) or inside the chaise column (x ≥ its inner edge)
        const b = partsBounds([part]);
        expect(b.min[1] >= strip.y0 - 1e-9 || b.min[0] >= chaise.x0 - 1e-9, `${p.key} part ${JSON.stringify(b)}`).toBe(true);
      }
      // seats reach both arms of the L
      const seats = m.parts.filter((x) => x.slot === 'sofa');
      expect(partsBounds(seats).min[0]).toBeCloseTo(-p.w / 2, 9);
      expect(partsBounds(seats).min[1]).toBeCloseTo(-p.d / 2, 9);
    }
    // a seat filling the depth gives a plain sofa
    const plain = { w: 2.7, d: 0.8, h: 0.8 };
    expect(furnitureModel('hjornesofa', plain, 'corner-sofa', { seat: 0.9 }).parts).toEqual(furnitureModel('sofa-ny', plain, 'sofa').parts);
    expect(CORNER_SOFA_SEAT).toBe(0.9);
    expect(catalogSeat({ catalog: entry as never })).toBe(entry.seat);
    expect(catalogSeat({ catalog: null })).toBeUndefined();
  });

  it('the grill is a kettle on a square footprint and a gas cart otherwise', () => {
    const kule = furnitureModel('grill', { w: 0.6, d: 0.6, h: 1.0 });
    const gass = furnitureModel('grill', { w: 1.2, d: 0.6, h: 1.15 });
    expect(kule.parts.some((p) => p.kind === 'extrude')).toBe(false);
    expect(kule.parts.filter((p) => p.kind === 'prism' && p.slot === 'black').length).toBeGreaterThanOrEqual(3);
    expect(gass.parts.some((p) => p.kind === 'extrude')).toBe(true);
  });
});

describe('3D drop level', () => {
  it('a floor hit keeps its level; a deck or terrain hit takes the ground storey level there', () => {
    expect(furnitureDropLevel(FIXTURE_DERIVED, { point: [2, 2], surface: 'floor', levelId: 'loft' })).toBe('loft');
    expect(furnitureDropLevel(FIXTURE_DERIVED, { point: [40, 40], surface: 'deck' })).toBe('main');
    expect(furnitureDropLevel(FIXTURE_DERIVED, { point: [-30, 5], surface: 'terrain' })).toBe('main');
    expect(furnitureDropLevel({ levels: [], storeys: [], blocks: [] }, { point: [0, 0], surface: 'terrain' })).toBe('main');
  });
});

/**
 * The 2D symbol registry (furnitureSymbols.ts): every catalogue id has its own symbol, symbols stay inside the
 * footprint (dining tables draw no chairs: those are Stol items), follow the item's size, and the rotate-handle /
 * collision / label helpers of the layer (furnitureLayerModel.ts).
 */
import { describe, expect, it } from 'vitest';
import type { DerivedFurniture, ModelWarning } from '../../model/derived';
import { labelFonts } from '../labelLayout';
import { bodyFill, codeFits, collidingFurnitureIds, furnitureLabelObstacles, labelFits, labelsOverFurniture, layoutLabelsClearOfFurniture, rotateHandle, rotationToward, toPlan, wrap180 } from './furnitureLayerModel';
import { FURNITURE_CATALOG } from '../../furniture/catalog';
import { CATALOG_SYMBOL_KINDS, FURNITURE_SYMBOLS, hasSymbol, primsBounds, symbolFor, symbolOverflow, symbolPrims } from './furnitureSymbols';
import type { SymbolPrim } from './furnitureSymbols';

/** The catalogue ids of phase 2b (append-only; docs/workflows/phase2b-furniture-offline.workflow.js). */
const CATALOG_IDS = [
  'seng-90',
  'seng-120',
  'seng-150',
  'seng-180',
  'koyeseng',
  'nattbord',
  'garderobeskap',
  'kommode',
  'sofa-2',
  'sofa-3',
  'hjornesofa',
  'lenestol',
  'salongbord',
  'teppe',
  'tv-benk',
  'bokhylle',
  'vedovn',
  'benkeskap',
  'overskap',
  'hoyskap',
  'kjoleskap',
  'kjokkenoy',
  'spisebord-4',
  'spisebord-6',
  'spisebord-8',
  'stol',
  'toalett',
  'servant',
  'dusj-80',
  'dusj-90',
  'dusj-100',
  'dusjvegg',
  'badekar',
  'vaskemaskin',
  'torketrommel',
  'vaskesoyle',
  'handkletorker',
  'sluk',
  'varmtvannsbereder',
  'badstubenk',
  'badstuovn',
  'hylle',
  'skohylle',
  'benk',
  'skistativ',
  'vedstabel',
  'loungesofa',
  'utebord',
  'utestol',
  'grill',
];

/** Plausible sizes (w × d) to draw each symbol at. */
const SIZES: [number, number][] = [
  [0.9, 2.0],
  [1.5, 2.05],
  [0.45, 0.4],
  [2.2, 0.9],
  [0.6, 0.6],
  [3.6, 0.6],
  [1.6, 0.9],
  [2.6, 1.7],
  [0.05, 0.05],
];

function coords(p: SymbolPrim): number[] {
  switch (p.k) {
    case 'rect':
      return [p.x, p.y, p.w, p.h, p.r ?? 0];
    case 'circle':
      return [p.cx, p.cy, p.r];
    case 'ellipse':
      return [p.cx, p.cy, p.rx, p.ry];
    case 'line':
      return [...p.a, ...p.b];
    case 'poly':
      return p.pts.flat();
  }
}

describe('symbol registry', () => {
  it('covers every catalogue id with its own symbol (no plain boxes)', () => {
    for (const id of CATALOG_IDS) {
      expect(hasSymbol(id), id).toBe(true);
      expect(symbolFor(id).kind, id).not.toBe('box');
    }
    expect(Object.keys(FURNITURE_SYMBOLS).sort()).toEqual([...CATALOG_IDS].sort());
  });

  it('covers the real catalogue too, and agrees with the catalogue’s own symbol keys', () => {
    for (const c of FURNITURE_CATALOG) {
      expect(hasSymbol(c.id), c.id).toBe(true);
      expect(CATALOG_SYMBOL_KINDS[c.symbol], `${c.id}: symbol key "${c.symbol}"`).toBe(symbolFor(c.id).kind);
    }
    expect(FURNITURE_CATALOG.map((c) => c.id).sort()).toEqual([...CATALOG_IDS].sort());
  });

  it('gives unknown ids a box with a cross', () => {
    expect(hasSymbol('flygel')).toBe(false);
    expect(symbolFor('flygel').kind).toBe('box');
    expect(symbolPrims('flygel', 1, 1).filter((p) => p.k === 'line')).toHaveLength(2);
    expect(hasSymbol('toString')).toBe(false);
  });

  it('draws every symbol with finite primitives inside its footprint at every size', () => {
    for (const id of CATALOG_IDS) {
      for (const [w, d] of SIZES) {
        const prims = symbolPrims(id, w, d);
        expect(prims.length, `${id} ${w}×${d}`).toBeGreaterThan(0);
        for (const p of prims) for (const v of coords(p)) expect(Number.isFinite(v), `${id} ${w}×${d} ${p.k}`).toBe(true);
        const b = primsBounds(prims)!;
        const over = symbolOverflow(id, w, d) + 1e-6;
        expect(b.min[0], `${id} ${w}×${d} min x`).toBeGreaterThanOrEqual(-w / 2 - over);
        expect(b.max[0], `${id} ${w}×${d} max x`).toBeLessThanOrEqual(w / 2 + over);
        expect(b.min[1], `${id} ${w}×${d} min y`).toBeGreaterThanOrEqual(-d / 2 - over);
        expect(b.max[1], `${id} ${w}×${d} max y`).toBeLessThanOrEqual(d / 2 + over);
      }
    }
  });

  it('follows the size: two pillows on a double bed, one on a single, three cushions on sofa-3', () => {
    const pillows = (id: string, w: number) => symbolPrims(id, w, 2).filter((p) => p.k === 'rect' && p.s === 'soft' && p.h < 0.5 && p.w < w - 0.01).length;
    expect(pillows('seng-90', 0.9)).toBe(1);
    expect(pillows('seng-150', 1.5)).toBe(2);
    const seat = (id: string) => symbolPrims(id, 2.2, 0.9).filter((p) => p.k === 'rect' && p.s === 'line').length;
    expect(seat('sofa-3')).toBe(3);
    expect(seat('sofa-2')).toBe(2);
  });

  it('puts the bed head and the WC cistern at the back (local +y), the shower glass at the front', () => {
    const bed = symbolPrims('seng-150', 1.5, 2);
    const head = bed.find((p) => p.k === 'rect' && p.s === 'soft' && p.w === 1.5)!;
    expect(head.k === 'rect' && head.y + head.h).toBeCloseTo(1, 9);
    const wc = symbolPrims('toalett', 0.4, 0.65);
    const tank = wc.find((p) => p.k === 'rect' && p.s === 'soft')!;
    expect(tank.k === 'rect' && tank.y + tank.h).toBeCloseTo(0.325, 9);
    const glass = symbolPrims('dusj-90', 0.9, 0.9).filter((p) => p.s === 'glass');
    expect(glass.length).toBe(2);
    for (const g of glass) expect(g.k === 'line' && Math.max(g.a[1], g.b[1])).toBeLessThan(-0.4);
  });

  it('draws a dining table alone, inside its footprint: its chairs are Stol items (no phantom seats)', () => {
    for (const [id, w, d] of [['spisebord-4', 1.2, 0.8], ['spisebord-6', 1.8, 0.9], ['spisebord-8', 2.6, 1.0], ['spisebord-6', 2.6, 1.8]] as const) {
      const prims = symbolPrims(id, w, d);
      // No chair seats (the old symbol drew one 'line' rect per chair) and no backrests.
      expect(prims.filter((p) => p.s === 'line' || p.s === 'soft'), `${id} ${w}×${d}`).toEqual([]);
      expect(prims.filter((p) => p.k === 'rect' && p.s === 'outline'), `${id} ${w}×${d}`).toHaveLength(1);
      const b = primsBounds(prims)!;
      expect(b.min[0]).toBeGreaterThanOrEqual(-w / 2 - 1e-9);
      expect(b.max[0]).toBeLessThanOrEqual(w / 2 + 1e-9);
      expect(b.min[1]).toBeGreaterThanOrEqual(-d / 2 - 1e-9);
      expect(b.max[1]).toBeLessThanOrEqual(d / 2 + 1e-9);
      expect(symbolOverflow(id, w, d)).toBe(0);
    }
    // The table top covers the whole footprint.
    const top = symbolPrims('spisebord-8', 2.6, 1.0).find((p) => p.k === 'rect' && p.s === 'outline')!;
    expect(top.k === 'rect' && [top.x, top.y, top.w, top.h]).toEqual([-1.3, -0.5, 2.6, 1.0]);
  });

  it('writes appliance codes', () => {
    expect(symbolFor('vaskemaskin').code).toBe('VM');
    expect(symbolFor('torketrommel').code).toBe('TT');
    expect(symbolFor('kjoleskap').code).toBe('KJ');
    expect(symbolFor('varmtvannsbereder').code).toBe('VV');
    expect(symbolFor('seng-90').code).toBeUndefined();
  });
});

function furniture(id: string, extra: Partial<DerivedFurniture> = {}): DerivedFurniture {
  return {
    id,
    item: { id, catalogId: 'stol', position: [0, 0], rotationDeg: 0, levelId: 'main', size: { w: 0.5, d: 0.5, h: 0.9 }, isNew: true },
    catalog: null,
    footprint: [],
    bbox: { min: [0, 0], max: [0, 0] },
    levelId: 'main',
    floorZ: 0,
    z: 0,
    clearances: [],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: true,
    ...extra,
  };
}

describe('layer helpers', () => {
  it('collects the colliding items from their own data and the warnings', () => {
    const items = [furniture('a', { collisions: ['b'] }), furniture('b'), furniture('c'), furniture('d', { blocksDoors: ['door-1'] }), furniture('e')];
    const warnings: ModelWarning[] = [
      { kind: 'furniture-in-wall', furnitureId: 'c', wallId: 'w-1' },
      { kind: 'door-blocked', openingId: 'door-2', by: 'e' },
      { kind: 'door-blocked', openingId: 'door-3', by: 'w-9' },
      { kind: 'furniture-overlap', furnitureIds: ['a', 'zz'] },
      { kind: 'furniture-outside', furnitureId: 'b' },
    ];
    expect(collidingFurnitureIds(items, warnings)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('puts the rotate handle outside the middle of the front edge', () => {
    const item = { position: [2, 3] as [number, number], rotationDeg: 0, size: { w: 1.5, d: 2 } };
    const h = rotateHandle(item, 50, 7);
    expect(h.edge).toEqual([2, 2]);
    expect(h.centre[0]).toBeCloseTo(2, 9);
    expect(h.centre[1]).toBeCloseTo(2 - 13 / 50, 9);
    expect(h.r).toBeCloseTo(7 / 50, 9);
    const turned = rotateHandle({ ...item, rotationDeg: 90 }, 50, 7);
    // Turned 90° CCW the front faces east.
    expect(turned.edge[0]).toBeCloseTo(3, 9);
    expect(turned.edge[1]).toBeCloseTo(3, 9);
    expect(toPlan({ position: [0, 0], rotationDeg: 180 }, [0, -1])[1]).toBeCloseTo(1, 9);
  });

  it('turns the front towards the pointer in 15° steps (1° fine)', () => {
    const item = { position: [0, 0] as [number, number], rotationDeg: 0 };
    expect(rotationToward(item, [0, -2])).toBe(0);
    expect(rotationToward(item, [2, 0])).toBe(90);
    expect(rotationToward(item, [0, 2])).toBe(180);
    expect(rotationToward(item, [-2, 0])).toBe(-90);
    expect(rotationToward(item, [2, -1.9])).toBe(45);
    expect(rotationToward(item, [Math.cos(-1.2), Math.sin(-1.2)], 1)).toBe(Math.round((-1.2 * 180) / Math.PI + 90));
    expect(rotationToward({ position: [0, 0], rotationDeg: 270 }, [2, 0])).toBe(180);
    expect(rotationToward(item, [0, 0])).toBe(0);
    expect(wrap180(270)).toBe(-90);
    expect(wrap180(-180)).toBe(180);
  });

  it('tints a symbol body lightly with the item colour (catalogue hex or an old colour name)', () => {
    expect(bodyFill(undefined, '#fafaf7')).toBe('#fafaf7');
    expect(bodyFill('#000000', '#ffffff')).toBe('#adadad');
    expect(bodyFill('wood', '#fafaf7')).toBe('#f1e4cf');
    expect(bodyFill('rainbow', '#fafaf7')).toBe('#fafaf7');
  });

  it('shows labels and codes only when they fit', () => {
    const box = { min: [0, 0] as [number, number], max: [1.5, 2] as [number, number] };
    expect(labelFits('Seng 150', box, 40)).toBe(true);
    expect(labelFits('Seng 150', box, 10)).toBe(false);
    expect(labelFits('Varmtvannsbereder', { min: [0, 0], max: [0.5, 0.5] }, 60)).toBe(false);
    expect(codeFits('VM', { w: 0.6, d: 0.6 }, 40)).toBe(true);
    expect(codeFits('VM', { w: 0.6, d: 0.6 }, 15)).toBe(false);
  });
});

describe('room names and furniture', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const room = {
    id: 'r1',
    room: { id: 'r1', name: 'Soverom', type: 'soverom' as const, levelId: 'main', anchor: [2, 1.5] as [number, number] },
    dims: { w: 4, h: 3, approx: false },
    area: 12,
    bbox: { min: [0, 0] as [number, number], max: [4, 3] as [number, number] },
    labelPoint: [2, 1.5] as [number, number],
    polygon: rect(0, 0, 4, 3),
    holes: [],
  };

  it('moves a name off the furniture under it, and keeps it when the room has no free place', () => {
    const scale = 40;
    const fonts = labelFonts(scale);
    const bed = rect(1.25, 0.5, 2.75, 2.5);
    const before = layoutLabelsClearOfFurniture([room], 'full', scale, fonts, [], []);
    expect(labelsOverFurniture(before, [bed], scale)).toHaveLength(1);
    const after = layoutLabelsClearOfFurniture([room], 'full', scale, fonts, [], [bed]);
    expect(after).toHaveLength(1);
    expect(labelsOverFurniture(after, [bed], scale)).toHaveLength(0);
    expect(after[0].at[0] < 1.25 || after[0].at[0] > 2.75).toBe(true);
    const full = rect(0, 0, 4, 3);
    const stays = layoutLabelsClearOfFurniture([room], 'full', scale, fonts, [], [full]);
    expect(stays).toHaveLength(1);
    expect(stays[0].at).toEqual(before[0].at);
  });

  it('a name moved off furniture may get shorter rather than stay on it', () => {
    const scale = 40;
    const fonts = labelFonts(scale);
    // Only a 0,45 m strip along the top is free: one line fits there, the full label (name, size, area) does not.
    const block = rect(0, 0, 4, 2.55);
    const after = layoutLabelsClearOfFurniture([room], 'full', scale, fonts, [], [block]);
    expect(labelsOverFurniture(after, [block], scale)).toHaveLength(0);
    expect(after[0].label.kind).not.toBe('full');
  });

  it('treats only solid items as obstacles; every footprint for the hit test', () => {
    const rug = furniture('rug', { item: { id: 'rug', catalogId: 'teppe', position: [0, 0], rotationDeg: 0, levelId: 'main', size: { w: 2, d: 1.4, h: 0.01 }, isNew: true }, footprint: rect(0, 0, 2, 1.4) });
    const sofa = furniture('sofa', { item: { id: 'sofa', catalogId: 'sofa-3', position: [0, 0], rotationDeg: 0, levelId: 'main', size: { w: 2.2, d: 0.9, h: 0.8 }, isNew: true }, footprint: rect(0, 2, 2.2, 2.9) });
    expect(furnitureLabelObstacles([rug, sofa])).toHaveLength(1);
    expect(furnitureLabelObstacles([rug, sofa], { flat: true })).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import type { Block, Opening, Variant, Vec2, Wall } from '../model/types';
import { makeTestProject, makeVariant } from '../state/testProject';
import { deriveDimensions, deriveVariant, dimensionText } from './derive';
import { area } from './polygon';

const site = makeTestProject().site;

/** The 6 × 4 m test cabin (gable, ridge along x) with a partition at x = 3 and two rooms. */
function cabin(edit: (v: Variant) => void = () => {}): Variant {
  const v = makeVariant('v', 'Test');
  edit(v);
  return v;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function block(id: string, r: Vec2[], extra: Partial<Block> = {}): Block {
  const base = makeVariant('tmp', 'tmp').blocks[0];
  return { ...base, id, name: id, polygon: r.map((p, i) => ({ id: `${id}-v${i}`, p })), junctions: [], ...extra };
}

const door = (id: string, wallId: string, offset: number): Opening => ({
  id,
  type: 'door',
  host: { kind: 'wall', wallId },
  offset,
  width: 0.8,
  height: 2.0,
  sill: 0,
  swing: { hinge: 'start', side: 'left' },
  style: { frameColour: 'white' },
  status: 'existing',
});

describe('deriveVariant', () => {
  it('is memoised on the identities of variant, site and terrain', () => {
    const v = cabin();
    const a = deriveVariant(v, site, null);
    expect(deriveVariant(v, site, null)).toBe(a);
    expect(deriveVariant({ ...v }, site, null)).not.toBe(a);
    expect(deriveVariant(v, { ...site }, null)).not.toBe(a);
  });

  it('runs the whole pipeline on a small cabin: storeys, walls, roofs, rooms, floors, areas', () => {
    const d = deriveVariant(cabin(), site, null);
    expect(d.warnings).toEqual([]);
    expect(d.storeys).toEqual([
      { id: 'ground', name: 'Hovedplan', levelIds: ['main'] },
      { id: 'loft', name: 'Hems', levelIds: ['loft'] },
    ]);
    expect(d.roofs).toHaveLength(1);
    expect(d.walls.filter((w) => w.isExterior)).toHaveLength(4);
    const names = d.rooms.map((r) => r.room?.name).sort();
    expect(names).toEqual(['Soverom', 'Stue']);
    const stue = d.rooms.find((r) => r.id === 'room-1')!;
    // inner faces: x 0.16 .. 2.94, y 0.16 .. 3.84
    expect(stue.area).toBeCloseTo(2.78 * 3.68, 6);
    expect(stue.levelId).toBe('main');
    expect(stue.storeyId).toBe('ground');
    expect(stue.blockId).toBe('blk-1');
    expect(stue.wallIds).toContain('w-1');
    expect(d.floors.filter((f) => f.kind === 'room').map((f) => f.id).sort()).toEqual(['room-1/floor', 'room-2/floor']);
    expect(d.areas.axis.total).toBeCloseTo(24, 9);
    expect(d.areas.rooms.map((r) => r.name).sort()).toEqual(['Soverom', 'Stue']);
    expect(d.bounds).toEqual({ min: [-0.11, -0.11], max: [6.11, 4.11] });
    expect(d.foundations).toEqual([{ blockId: 'blk-1', polygon: d.blocks[0].outer, topZ: 0, bottomZ: -0.5 - 0.3 }]);
    expect(d.wallUnion.map((u) => [u.storeyId, u.status])).toEqual([['ground', 'existing']]);
  });

  it('puts a threshold under a door between two rooms at the lower room', () => {
    const d = deriveVariant(
      cabin((v) => v.openings.push(door('d-1', 'w-1', 2))),
      site,
      null,
    );
    const t = d.floors.find((f) => f.id === 'd-1/threshold');
    expect(t).toMatchObject({ kind: 'threshold', levelId: 'main', z: 0, material: 'wood' });
    expect(t!.polygon).toHaveLength(4);
  });

  it('warns about faces without a room record and room records without a face', () => {
    const d = deriveVariant(
      cabin((v) => {
        v.rooms[1].anchor = [20, 20];
      }),
      site,
      null,
    );
    const unnamed = d.rooms.filter((r) => !r.room);
    expect(unnamed).toHaveLength(1);
    expect(unnamed[0].id).toMatch(/^face-/);
    expect(d.warnings).toEqual([
      { kind: 'room-anchor-lost', roomId: 'room-2' },
      { kind: 'room-unnamed', faceId: unnamed[0].id, levelId: 'main', area: unnamed[0].area },
    ]);
  });

  it('reports a free-standing stored wall as dangling, but not a partition that forms rooms', () => {
    const stub: Wall = { id: 'w-stub', a: [1, 1], b: [1, 2.5], thickness: 0.12, levelId: 'main', status: 'existing', kind: 'interior', heightMode: 'fixed', height: 2.3 };
    const d = deriveVariant(
      cabin((v) => v.walls.push(stub)),
      site,
      null,
    );
    expect(d.warnings).toEqual([{ kind: 'wall-dangling', wallId: 'w-stub' }]);
  });

  it('builds the loft from its add zone only: rooms inside the zone, a slab with the stair cut out, no dangling walls', () => {
    const d = deriveVariant(
      cabin((v) => {
        v.blocks[0].floorZones = [{ id: 'z-loft', levelId: 'loft', kind: 'add', polygon: rect(0, 0, 3, 4) }];
        v.rooms.push({ id: 'room-hems', name: 'Hems', type: 'hems', levelId: 'loft', anchor: [1.5, 2] });
        v.structure.push({ id: 'st', kind: 'stair', min: [2, 0.2], max: [2.9, 1.4], fromLevelId: 'main', toLevelId: 'loft', upDirection: 'N', isNew: false });
        // the partition runs to the roof so it bounds the loft
        v.walls[0].heightMode = 'roof';
        delete v.walls[0].height;
      }),
      site,
      null,
    );
    expect(d.warnings).toEqual([]);
    const hems = d.rooms.find((r) => r.id === 'room-hems')!;
    expect(hems).toMatchObject({ levelId: 'loft', storeyId: 'loft' });
    expect(d.rooms.filter((r) => r.storeyId === 'loft')).toHaveLength(1);
    // only the exterior walls beside the zone take part in the loft
    const loftExterior = d.walls.filter((w) => w.isExterior && w.storeyIds.includes('loft')).map((w) => w.id);
    expect(loftExterior.length).toBeGreaterThan(0);
    for (const id of loftExterior) {
      const w = d.walls.find((x) => x.id === id)!;
      expect(Math.min(w.a[0], w.b[0])).toBeLessThan(3 + 1e-9);
    }
    const slab = d.floors.find((f) => f.kind === 'slab')!;
    expect(slab).toMatchObject({ id: 'blk-1/z-loft/slab', levelId: 'loft', z: 1.47, thickness: 0.17 });
    // zone ∩ inner outline (0.16..3 × 0.16..3.84) with the stair (2..2.9 × 0.2..1.4) as a hole
    expect(area(slab.polygon)).toBeCloseTo(2.84 * 3.68, 6);
    expect(slab.holes).toHaveLength(1);
    expect(area(slab.holes[0])).toBeCloseTo(0.9 * 1.2, 6);
  });

  it('warns when BYA exceeds the area limit', () => {
    const d = deriveVariant(
      cabin((v) => {
        v.settings.areaLimit = 10;
      }),
      site,
      null,
    );
    expect(d.warnings).toEqual([{ kind: 'area-limit', limit: 10, actual: d.areas.bya.total }]);
  });
});

describe('dimensions', () => {
  it('formats lengths with a comma: one decimal, two when needed', () => {
    expect(dimensionText(4.8)).toBe('4,8');
    expect(dimensionText(20.8)).toBe('20,8');
    expect(dimensionText(6)).toBe('6,0');
    expect(dimensionText(3.95)).toBe('3,95');
  });

  it('gives a single block one piece per side, counter-clockwise with the line outside', () => {
    const d = deriveVariant(cabin(), site, null);
    expect(d.dimensions.map((x) => [x.a, x.b, x.offset, x.text, x.kind])).toEqual([
      [[0, 0], [6, 0], -1, '6,0', 'axisChain'],
      [[6, 0], [6, 4], -1, '4,0', 'axisChain'],
      [[6, 4], [0, 4], -1, '6,0', 'axisChain'],
      [[0, 4], [0, 0], -1, '4,0', 'axisChain'],
    ]);
  });

  it('chains a stepped facade on the outermost line and adds a total', () => {
    const v = cabin((x) => {
      x.blocks = [block('a', rect(0, 0, 6, 4)), block('b', rect(2, -2, 4, 0))];
    });
    const d = deriveVariant(v, site, null);
    const south = deriveDimensions(d.blocks).filter((x) => x.a[1] <= 0 && x.b[1] <= 0 && x.b[0] > x.a[0]);
    expect(south.map((x) => [x.a, x.b, x.offset, x.text, x.kind])).toEqual([
      [[0, 0], [2, 0], -3, '2,0', 'axisChain'],
      [[2, -2], [4, -2], -1, '2,0', 'axisChain'],
      [[4, 0], [6, 0], -3, '2,0', 'axisChain'],
      [[0, -2], [6, -2], -1.8, '6,0', 'axisTotal'],
    ]);
  });
});

/**
 * The parser on a synthetic IFC written here, with the real web-ifc (Node build, web-ifc-node.wasm): kinds, the
 * IFC frame (Z up) and the plan sections.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PARSER_VERSION, SECTION_HEIGHTS, parseIfcModel } from './parse';
import type { WebIfcApi, WebIfcModule } from './parse';
import { testIfc } from './testIfc';
import type { ParsedIfc } from './types';

let model: ParsedIfc;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

function segBounds(segs: Float32Array) {
  let length = 0;
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (let i = 0; i < segs.length; i += 4) {
    length += Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]);
    for (const [u, v] of [
      [segs[i], segs[i + 1]],
      [segs[i + 2], segs[i + 3]],
    ]) {
      min[0] = Math.min(min[0], u);
      min[1] = Math.min(min[1], v);
      max[0] = Math.max(max[0], u);
      max[1] = Math.max(max[1], v);
    }
  }
  return { length, min, max };
}

beforeAll(async () => {
  const mod = (await import('web-ifc')) as unknown as WebIfcModule;
  const api: WebIfcApi = new mod.IfcAPI();
  await api.Init();
  const text = testIfc([
    { type: 'IFCWALL', at: [0, 0, 0], size: [4, 0.2, 2.5], storey: 0 },
    // an upper-storey wall (Hems) and a main-level wall without a storey, both reaching through the Hems cut
    { type: 'IFCWALL', at: [0, 2, 1.5], size: [2, 0.1, 1.5], storey: 2.5 },
    { type: 'IFCWALL', at: [3, 1, 0], size: [0.1, 1, 3] },
    { type: 'IFCSLAB', at: [0, 0, -0.2], size: [4, 3, 0.2], predefined: 'FLOOR' },
    { type: 'IFCSLAB', at: [0, 0, 2.5], size: [4, 3, 0.2], predefined: 'ROOF' },
    { type: 'IFCSLAB', at: [0, 3, 2.5], size: [4, 0.5, 1] },
    { type: 'IFCWINDOW', at: [1, 0, 0.8], size: [1, 0.2, 1.2] },
    { type: 'IFCDOOR', at: [2.5, 0, 0], size: [0.9, 0.2, 2] },
    { type: 'IFCCOLUMN', at: [3.5, 2.5, 0], size: [0.1, 0.1, 2.5] },
    { type: 'IFCSPACE', at: [0, 0, 0], size: [4, 3, 2.5] },
  ]);
  model = parseIfcModel(mod, api, new TextEncoder().encode(text), { name: 'test.ifc', size: text.length });
  api.Dispose();
}, 60_000);

describe('parseIfcModel', () => {
  it('sorts the elements into kinds and leaves spaces out', () => {
    expect(model.version).toBe(PARSER_VERSION);
    expect(model.schema).toBe('IFC4');
    expect(model.fileName).toBe('test.ifc');
    // the FLOOR slab is a slab; the ROOF slab and the 1 m high untyped slab are roof
    expect(model.counts).toEqual({ wall: 3, window: 1, door: 1, roof: 2, slab: 1, other: 1 });
    expect(model.meshes.map((m) => m.kind).sort()).toEqual(['door', 'other', 'roof', 'slab', 'wall', 'window']);
    for (const m of model.meshes) {
      expect(m.indices.length % 3).toBe(0);
      expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3);
    }
  });

  it('keeps the IFC frame: Z up, the first wall from (0, 0, 0) to (4, 0.2, 2.5)', () => {
    const wall = model.meshes.find((m) => m.kind === 'wall')!;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    // the first wall's 8 corners come first (walls are merged in file order)
    for (let i = 0; i < 8 * 3; i += 3) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], wall.positions[i + a]);
        hi[a] = Math.max(hi[a], wall.positions[i + a]);
      }
    }
    expect(lo.map(r4)).toEqual([0, 0, 0]);
    expect(hi.map(r4)).toEqual([4, 0.2, 2.5]);
    expect(model.min.map(r4)).toEqual([0, 0, -0.2]);
    expect(model.max.map(r4)).toEqual([4, 3.5, 3.5]);
  });

  it('cuts walls, windows and doors at the storeys’ section heights', () => {
    const at = (storey: 'ground' | 'loft', kind: string) => model.sections.find((s) => s.storey === storey && s.kind === kind);
    // Plan 1 (0.9): the first wall and the storey-less one; the upper wall starts at 1.5
    const wall = segBounds(at('ground', 'wall')!.segments);
    expect(at('ground', 'wall')!.planH).toBe(SECTION_HEIGHTS.ground);
    expect(wall.length).toBeCloseTo(2 * (4 + 0.2) + 2 * (0.1 + 1), 4);
    expect(wall.min.map(r4)).toEqual([0, 0]);
    expect(wall.max.map(r4)).toEqual([4, 2]);
    expect(segBounds(at('ground', 'window')!.segments).length).toBeCloseTo(2 * (1 + 0.2), 4);
    expect(segBounds(at('ground', 'door')!.segments).length).toBeCloseTo(2 * (0.9 + 0.2), 4);
    // Hems (2.1): only the upper storey's wall — not the main-level walls the plane also cuts; the window (0.8–2.0)
    // and the door (0–2.0) end below the cut
    const loft = segBounds(at('loft', 'wall')!.segments);
    expect(loft.length).toBeCloseTo(2 * (2 + 0.1), 4);
    expect(loft.min.map(r4)).toEqual([0, 2]);
    expect(loft.max.map(r4)).toEqual([2, 2.1]);
    expect(at('loft', 'window')).toBeUndefined();
    expect(at('loft', 'door')).toBeUndefined();
  });

  it('reads storey elevations in the file’s length unit', async () => {
    const mod = (await import('web-ifc')) as unknown as WebIfcModule;
    const api: WebIfcApi = new mod.IfcAPI();
    await api.Init();
    // millimetre file: «Plan 2» at 2500 mm is an upper storey, a storey at 500 mm is not
    const text = testIfc(
      [
        { type: 'IFCWALL', at: [0, 0, 1.5], size: [1, 0.1, 1.5], storey: 2.5 },
        { type: 'IFCWALL', at: [0, 1, 0], size: [1, 0.1, 3], storey: 0.5 },
      ],
      { unit: 'MILLI' },
    );
    const m = parseIfcModel(mod, api, new TextEncoder().encode(text), { name: 'mm.ifc', size: text.length });
    api.Dispose();
    const loft = m.sections.find((s) => s.storey === 'loft' && s.kind === 'wall')!;
    // web-ifc scales the geometry to metres; only the first wall is on the Hems
    expect(segBounds(loft.segments).max.map(r4)).toEqual([1, 0.1]);
  });
});

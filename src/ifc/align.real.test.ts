/**
 * Alignment of the architect's IFC with the seed's existing walls through the calibrated transform (transform.ts). The
 * file is read from the path in the HYTTE_IFC environment variable when set and skipped otherwise; it is never copied
 * into the repository.
 * The IFC walls are cut at 0.3, 0.9 and 1.5 m above the main floor (each face is then seen between the windows: the
 * glass bump's windows start at 0.4, the main level's at 0.8, the lower level's end at 1.01).
 * - every outer (cladding) face of the seed's existing exterior walls has the IFC's outermost wall edge within 5 cm;
 * - every inner face has the IFC's gypsum face within 5 cm (the mellombygg's real 0.11 walls, 5 cm thinner than the
 *   seed's — docs/kalibrering-ifc.md "Seed decisions" — lie between its doors and partitions, which are not sampled);
 * - no IFC wall edge outside the house's axis outline lies more than 5 cm outside the seed's walls (the old cladding
 *   at the east gable's corners lies in the new extension's walls).
 * The measured offsets are printed (run with --silent=false).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import { createForslagD } from '../model/seed/forslagD';
import type { DerivedVariant } from '../model/derived';
import { measureFaces, segmentsToPlan, strayEdges } from './align';
import type { FaceFit } from './align';
import { parseIfcModel } from './parse';
import { sliceTriangles } from './slice';
import type { WebIfcApi, WebIfcModule } from './parse';
import { IFC_CALIBRATION } from './transform';
import type { ParsedIfc } from './types';


interface NodeFs {
  existsSync(p: string): boolean;
  readFileSync(p: string): Uint8Array;
}
const nodeProcess = (globalThis as unknown as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?(id: 'node:fs'): NodeFs } }).process;
const IFC_PATH = nodeProcess?.env?.HYTTE_IFC ?? '';
const fs = nodeProcess?.getBuiltinModule?.('node:fs');
const present = !!fs && IFC_PATH !== '' && fs.existsSync(IFC_PATH);

let model: ParsedIfc;
let derived: DerivedVariant;
/** IFC wall sections at 0.3, 0.9 and 1.5 m, IFC frame. */
let wallCuts: Float32Array;
let fits: FaceFit[];

const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;
const existingExterior = () => derived.walls.filter((w) => w.isExterior && w.status === 'existing' && !w.isGhost);
const liveFootprints = () => derived.walls.filter((w) => !w.isGhost && w.footprint.length >= 3).map((w) => w.footprint);

describe.skipIf(!present)('IFC overlay alignment with the seed (real file)', () => {
  beforeAll(async () => {
    const mod = (await import('web-ifc')) as unknown as WebIfcModule;
    const api: WebIfcApi = new mod.IfcAPI();
    await api.Init();
    const bytes = new Uint8Array(fs!.readFileSync(IFC_PATH));
    model = parseIfcModel(mod, api, bytes, { name: 'real.ifc', size: bytes.length });
    api.Dispose();
    const project = createForslagD();
    derived = deriveVariant(project.variants[0], project.site, null);
    const wallMesh = model.meshes.find((m) => m.kind === 'wall')!;
    const cuts: number[] = [];
    for (const h of [0.3, 0.9, 1.5]) sliceTriangles(wallMesh.positions, wallMesh.indices, h - IFC_CALIBRATION.dz, cuts);
    wallCuts = Float32Array.from(cuts);
    fits = measureFaces(segmentsToPlan(IFC_CALIBRATION, wallCuts), existingExterior(), { obstacles: liveFootprints() });
    for (const f of fits) {
      console.log(
        `${f.face.padEnd(5)} ${f.wallId.padEnd(44)} matched ${String(f.matched).padStart(2)}/${String(f.samples).padStart(2)}` +
          `  median ${cm(f.median).padStart(8)}  max ${cm(f.maxAbs).padStart(7)}`,
      );
    }
  }, 120_000);

  it('parses the architect’s model into walls, windows, doors, roof and slabs', () => {
    expect(model.schema).toBe('IFC4');
    expect(model.counts.wall).toBeGreaterThan(150);
    expect(model.counts.window).toBe(14);
    expect(model.counts.door).toBe(13);
    expect(model.counts.roof).toBe(30);
    expect(model.counts.slab).toBe(5);
    for (const kind of ['wall', 'window', 'door'] as const) {
      expect(model.sections.some((s) => s.storey === 'ground' && s.kind === kind)).toBe(true);
    }
  });

  it('every existing exterior wall’s cladding face has the IFC within 5 cm', () => {
    const outer = fits.filter((f) => f.face === 'outer');
    expect(outer.length).toBe(10);
    for (const f of outer) {
      expect(f.matched, f.wallId).toBeGreaterThan(f.samples / 2);
      expect(f.maxAbs, f.wallId).toBeLessThanOrEqual(0.05);
    }
  });

  it('every inner face has the IFC within 5 cm', () => {
    const inner = fits.filter((f) => f.face === 'inner');
    expect(inner.length).toBe(10);
    for (const f of inner) {
      expect(f.matched, f.wallId).toBeGreaterThan(f.samples / 2);
      expect(f.maxAbs, f.wallId).toBeLessThanOrEqual(0.05);
    }
  });

  it('no IFC exterior wall edge lies more than 5 cm outside the seed’s walls', () => {
    const stray = strayEdges(segmentsToPlan(IFC_CALIBRATION, wallCuts), derived.blocks, liveFootprints());
    const worst = stray.reduce((m, s) => Math.max(m, s.distance), 0);
    console.log(`IFC wall edges outside the axis outline: ${stray.length}, farthest from a seed wall ${cm(worst)}`);
    expect(stray.length).toBeGreaterThan(20);
    expect(worst).toBeLessThanOrEqual(0.05);
  });

  it('a 3 cm shift is caught', () => {
    const shifted = measureFaces(segmentsToPlan({ ...IFC_CALIBRATION, dx: IFC_CALIBRATION.dx + 0.03 }, wallCuts), existingExterior(), {
      obstacles: liveFootprints(),
    });
    const west = shifted.find((f) => f.face === 'outer' && f.wallId.startsWith('blk-main/v-main-nw'))!;
    expect(west.median).toBeCloseTo(-0.03, 3);
  });
});

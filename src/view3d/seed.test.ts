/**
 * The 3D builders on the real Forslag D seed, through the real derive pipeline. Skipped while
 * geometry/derive.ts is still the integration stub (its derived model is empty).
 */
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { GroundWork, TerrainAsset, TerrainGrid, Vec2 } from '../model/types';
import { CAMERA_FOV, presetView, presetWorld, REF_BOUNDS } from './cameras';
import { fromWorld, toWorld } from './coords';
import * as B from './geometryBuilders';
import { groundZFn } from './ground';
import { blockLabels, cameraInRoom, roomLabels } from './labelDefs';
import { computeVisibility } from './visibility';

const project = createForslagD();
const variant = project.variants[0];
const terrain = terrainJson as unknown as TerrainAsset;
const derived = deriveVariant(variant, project.site, terrain);
const isStub = derived.warnings.some((w) => w.kind === 'generic' && /stub/i.test(w.message));

const finite = (d: B.MeshData) => d.positions.every(Number.isFinite);

describe.skipIf(isStub)('3D builders on the Forslag D seed', () => {
  it('builds every wall piece as positive-volume solids, uncut and cut', () => {
    for (const mode of ['ute', 'inne'] as const) {
      for (const storey of derived.storeys) {
        const vis = computeVisibility(derived, mode, storey.id, 1.6);
        for (const w of derived.walls) {
          if (w.isDivider || w.status === 'removed' || w.footprint.length < 3 || !vis.isWallVisible(w)) continue;
          const d = B.buildWallPieces(w, vis.cutZFor(w)).data;
          expect(finite(d), w.id).toBe(true);
          expect(B.signedVolume(d), w.id).toBeGreaterThan(0);
          for (const o of w.openings) {
            const ob = B.buildOpening(o, w, vis.cutZFor(w));
            expect(finite(ob.solid) && finite(ob.glass), o.id).toBe(true);
          }
        }
      }
    }
  });

  it('puts the cladding of exterior pieces on the outside of the block', () => {
    for (const w of derived.walls.filter((x) => x.isExterior && x.source.kind === 'blockEdge')) {
      if (w.source.kind !== 'blockEdge') continue;
      const { blockId, edgeId } = w.source;
      const edge = derived.blocks.find((b) => b.block.id === blockId)?.edges.find((e) => e.edgeId === edgeId);
      if (!edge) continue;
      const d = B.buildWallPieces(w).data;
      for (const c of B.triangleCentroids(d, B.WALL_MAT.outside)) {
        const s = (c[0] - w.a[0]) * edge.outward[0] + (c[1] - w.a[1]) * edge.outward[1];
        expect(s, w.id).toBeCloseTo(w.faceRight, 6);
      }
    }
  });

  it('builds roofs, floors, outdoor and structure without NaN', () => {
    for (const r of derived.roofs) {
      for (const s of r.slopes) expect(B.signedVolume(B.buildRoofSlope(s, r.thickness)), r.blockId).toBeGreaterThan(0);
      expect(finite(B.buildRoofTrims(r))).toBe(true);
    }
    for (const f of derived.floors) expect(finite(B.buildFloor(f)), f.id).toBe(true);
    for (const d of derived.outdoor.decks) expect(finite(B.buildDeck(d)), d.id).toBe(true);
    for (const r of derived.outdoor.railings) {
      expect(finite(B.buildRailing(r).solid), r.id).toBe(true);
      for (const s of r.steps) expect(finite(B.buildSteps(s)), s.id).toBe(true);
    }
    for (const s of derived.structure) expect(finite(B.buildStructure(s)), s.id).toBe(true);
    for (const f of derived.foundations) expect(finite(B.buildFoundation(f)), f.blockId).toBe(true);
  });

  it('has bounds matching the camera presets reference (doc views reproduce exactly)', () => {
    for (let k = 0; k < 2; k++) {
      expect(derived.bounds.min[k]).toBeCloseTo(REF_BOUNDS.min[k], 1);
      expect(derived.bounds.max[k]).toBeCloseTo(REF_BOUNDS.max[k], 1);
    }
  });

  it('labels blocks and the named rooms of each storey', () => {
    expect(blockLabels(derived).length).toBe(derived.blocks.length);
    for (const s of derived.storeys) expect(roomLabels(derived, s.id, 1.6).length).toBeGreaterThan(0);
  });

  it("'inne-stua' stands in the stue and has its label, Passasje and Spiseplass in frame", () => {
    for (const aspect of [0.55, 0.9, 1.6, 2.2]) {
      const v = presetWorld('inne-stua', derived.bounds, aspect);
      const camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 1000);
      camera.position.copy(v.position);
      camera.lookAt(v.target);
      camera.updateMatrixWorld();
      // 2.3 = the default cut (store.ts DEFAULT_UI): the Stue tag (cut + 0.3 above its floor, 1.8 m from the eye) is
      // then above the frame and Labels.tsx pins it to the bottom centre as the camera's own room.
      for (const cut of [1.2, 1.6, 2.3]) {
        const labels = roomLabels(derived, 'ground', cut);
        const inside = labels.filter((l) => cameraInRoom(l, fromWorld(v.position))).map((l) => l.title);
        expect(inside).toEqual(['Stue']);
        for (const name of cut > 2 ? ['Passasje', 'Spiseplass'] : ['Stue', 'Passasje', 'Spiseplass']) {
          const l = labels.find((x) => x.title === name)!;
          const ndc = toWorld(...l.at).project(camera);
          // inside the view with room for a tag (about 130 × 36 px in a 600 px high pane)
          expect(Math.abs(ndc.x), `${name} x at aspect ${aspect}, cut ${cut}`).toBeLessThan(0.8);
          expect(ndc.y, `${name} y at aspect ${aspect}, cut ${cut}`).toBeGreaterThan(-0.9);
          expect(ndc.y, `${name} y at aspect ${aspect}, cut ${cut}`).toBeLessThan(0.8);
          expect(ndc.z).toBeLessThan(1);
        }
      }
    }
    expect(presetView('inne-stua', derived.bounds).position[2]).toBeCloseTo(1.55, 9);
  });

  it('renders the terrain below every room floor with the ground works of the derived contract', () => {
    // DerivedVariant.groundWorks = the site's cuts + one per block (outer outline, lowestFloorZ − 0.1); built here
    // from the seed so the renderer is checked whatever stage the derive pipeline is at
    const contract: GroundWork[] = [
      ...project.site.groundWorks,
      ...derived.blocks.map((b) => ({ id: `implicit-${b.block.id}`, polygon: b.outer, maxZ: b.lowestFloorZ - 0.1 })),
    ];
    expectTerrainBelowFloors(contract);
    expect(() => expectTerrainBelowFloors([])).toThrow(/reaches floor/); // the raw terrain does reach the lower floor
  });

  it('renders the terrain below every room floor with derived.groundWorks', () => {
    expect(derived.groundWorks.length).toBeGreaterThan(project.site.groundWorks.length); // the per-block cuts
    expectTerrainBelowFloors(derived.groundWorks);
  });
});

/** Height of the rendered terrain (grid A, or the fine patch where there is one) at a plan point. */
function renderedTerrainZ(works: GroundWork[]): (x: number, y: number) => number {
  const gridA = terrain.grids[0];
  const zAt = groundZFn(terrain, project.site, works);
  const patch = B.terrainPatch(gridA, works.map((w) => w.polygon));
  return (x, y) => {
    const inPatch = patch && x >= patch.extent.min[0] && x <= patch.extent.max[0] && y >= patch.extent.min[1] && y <= patch.extent.max[1];
    return triangulatedZ(inPatch ? patch.grid : gridA, zAt, x, y);
  };
}

/** The builder's triangulation of a grid cell: (v00, v10, v11) below the diagonal, (v00, v11, v01) above it. */
function triangulatedZ(g: Pick<TerrainGrid, 'x0' | 'y0' | 'dx' | 'dy'>, zAt: (x: number, y: number) => number, x: number, y: number): number {
  const fi = (x - g.x0) / g.dx;
  const fj = (y - g.y0) / g.dy;
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const u = fi - i;
  const w = fj - j;
  const z = (a: number, b: number) => zAt(g.x0 + (i + a) * g.dx, g.y0 + (j + b) * g.dy);
  return u >= w ? z(0, 0) + u * (z(1, 0) - z(0, 0)) + w * (z(1, 1) - z(1, 0)) : z(0, 0) + u * (z(1, 1) - z(0, 1)) + w * (z(0, 1) - z(0, 0));
}

function expectTerrainBelowFloors(works: GroundWork[]): void {
  const zAt = renderedTerrainZ(works);
  const step = 0.1;
  let checked = 0;
  for (const f of derived.floors.filter((x) => x.kind === 'room')) {
    const xs = f.polygon.map((p) => p[0]);
    const ys = f.polygon.map((p) => p[1]);
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
        const p: Vec2 = [x, y];
        if (!inside(p, f.polygon)) continue;
        checked++;
        const z = zAt(x, y);
        if (z >= f.z - 0.02) expect.fail(`terrain ${z.toFixed(3)} at (${x.toFixed(2)}, ${y.toFixed(2)}) reaches floor ${f.id} at ${f.z}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(1000);
}

function inside(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < xi + ((p[1] - yi) * (xj - xi)) / (yj - yi)) c = !c;
  }
  return c;
}

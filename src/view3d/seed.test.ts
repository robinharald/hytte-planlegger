/**
 * The 3D builders on the real Forslag D seed, through the real derive pipeline. Skipped while
 * geometry/derive.ts is still the integration stub (its derived model is empty).
 */
import { describe, expect, it } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { TerrainAsset } from '../model/types';
import { REF_BOUNDS } from './cameras';
import * as B from './geometryBuilders';
import { blockLabels, roomLabels } from './labelDefs';
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
});

/**
 * Seed invariants for Forslag D (docs/seed-brief-forslag-d.md, "Expected invariants") plus structural checks of
 * the bundled terrain asset. Pure data tests: a local shoelace / point-in-polygon, no geometry module imports.
 */
import { describe, expect, it } from 'vitest';
import type { Block, Opening, Project, TerrainAsset, TerrainGrid, Variant, Vec2 } from '../types';
import { CURRENT_SCHEMA_VERSION } from '../types';
import terrainJson from './terrain-merkesvatnet.json';
import { SEED_REVISION, SEED_TIMESTAMP, TERRAIN_ASSET_ID, createForslagD } from './forslagD';

const terrain = terrainJson as TerrainAsset;

// ---------------------------------------------------------------------------
// local helpers
// ---------------------------------------------------------------------------

function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Even-odd point in polygon; points on the boundary count as inside. */
function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
    if (Math.abs(cross) < 1e-9 && Math.min(xi, xj) - 1e-9 <= x && x <= Math.max(xi, xj) + 1e-9 && Math.min(yi, yj) - 1e-9 <= y && y <= Math.max(yi, yj) + 1e-9) {
      return true;
    }
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const blockPolygon = (b: Block): Vec2[] => b.polygon.map((v) => v.p);

function hostLength(variant: Variant, o: Opening): number {
  const host = o.host;
  if (host.kind === 'wall') {
    const w = variant.walls.find((x) => x.id === host.wallId);
    if (!w) throw new Error(`${o.id}: unknown wall ${host.wallId}`);
    return dist(w.a, w.b);
  }
  const b = variant.blocks.find((x) => x.id === host.blockId);
  if (!b) throw new Error(`${o.id}: unknown block ${host.blockId}`);
  const i = b.polygon.findIndex((v) => v.id === host.edgeId);
  if (i < 0) throw new Error(`${o.id}: unknown edge ${host.edgeId}`);
  return dist(b.polygon[i].p, b.polygon[(i + 1) % b.polygon.length].p);
}

function hostKey(o: Opening): string {
  return o.host.kind === 'wall' ? `wall:${o.host.wallId}` : `edge:${o.host.blockId}/${o.host.edgeId}`;
}

/** Bilinear sample of a plan grid; null outside. Mirrors geometry/terrain.ts and scripts/build-terrain.mjs. */
function sampleGrid(g: TerrainGrid, x: number, y: number): number | null {
  const fi = (x - g.x0) / g.dx;
  const fj = (y - g.y0) / g.dy;
  if (fi < 0 || fi > g.nx - 1 || fj < 0 || fj > g.ny - 1) return null;
  const i0 = Math.min(Math.floor(fi), g.nx - 2);
  const j0 = Math.min(Math.floor(fj), g.ny - 2);
  const tx = fi - i0;
  const ty = fj - j0;
  const at = (i: number, j: number) => g.z[j * g.nx + i];
  return (1 - ty) * ((1 - tx) * at(i0, j0) + tx * at(i0 + 1, j0)) + ty * ((1 - tx) * at(i0, j0 + 1) + tx * at(i0 + 1, j0 + 1));
}

function collectIds(project: Project): string[] {
  const ids: string[] = [project.id];
  ids.push(...project.site.trees.map((t) => t.id), ...project.site.groundWorks.map((g) => g.id));
  for (const v of project.variants) {
    ids.push(v.id);
    ids.push(...v.levels.map((l) => l.id));
    for (const b of v.blocks) {
      ids.push(b.id, ...b.polygon.map((p) => p.id), ...b.parts.map((p) => p.id), ...b.floorZones.map((z) => z.id));
    }
    ids.push(...v.walls.map((w) => w.id), ...v.openings.map((o) => o.id), ...v.rooms.map((r) => r.id));
    ids.push(...v.structure.map((s) => s.id), ...v.furniture.map((f) => f.id));
    ids.push(...v.outdoor.decks.map((d) => d.id), ...v.outdoor.railings.map((r) => r.id), ...v.outdoor.hotTubs.map((h) => h.id));
  }
  return ids;
}

const project = createForslagD();
const variant = project.variants[0];
const levelById = new Map(variant.levels.map((l) => [l.id, l]));
const blockById = new Map(variant.blocks.map((b) => [b.id, b]));
const main = blockById.get('blk-main')!;
const zone = (id: string): Vec2[] => main.floorZones.find((z) => z.id === id)!.polygon;

// ---------------------------------------------------------------------------

describe('createForslagD', () => {
  it('returns a fresh deep object each call, equal for the same `now`', () => {
    const a = createForslagD();
    const b = createForslagD();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    a.variants[0].blocks[0].polygon[0].p[0] = 99;
    a.variants[0].walls.push({ ...a.variants[0].walls[0], id: 'x' });
    expect(b.variants[0].blocks[0].polygon[0].p[0]).toBe(0);
    expect(b.variants[0].walls.find((w) => w.id === 'x')).toBeUndefined();
    expect(a.variants[0].blocks[1].wall).not.toBe(a.variants[0].blocks[0].wall);
  });

  it('uses `now` for every timestamp, else the fixed seed timestamp', () => {
    expect(project.createdAt).toBe(SEED_TIMESTAMP);
    expect(project.updatedAt).toBe(SEED_TIMESTAMP);
    expect(variant.createdAt).toBe(SEED_TIMESTAMP);
    const p = createForslagD('2030-01-02T03:04:05.000Z');
    expect(p.createdAt).toBe('2030-01-02T03:04:05.000Z');
    expect(p.updatedAt).toBe('2030-01-02T03:04:05.000Z');
    expect(p.variants[0].createdAt).toBe('2030-01-02T03:04:05.000Z');
  });

  it('has the project header from the brief', () => {
    expect(project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(project.id).toBe('hytte-merkesvatnet');
    expect(project.name).toBe('Hytta ved Merkesvatnet');
    expect(project.seedRevision).toBe(SEED_REVISION);
    expect(SEED_REVISION).toBe(1);
    expect(project.variants).toHaveLength(1);
    expect(project.activeVariantId).toBe(variant.id);
    expect(variant.id).toBe('forslag-d');
    expect(variant.name).toBe('Forslag D');
    expect(variant.settings).toEqual({ defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 }, defaultInteriorThickness: 0.12, areaLimit: null });
    expect(variant.furniture).toEqual([]);
  });

  it('survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(project))).toEqual(project);
  });
});

describe('levels', () => {
  it('match the brief', () => {
    expect(variant.levels.map((l) => [l.id, l.storeyId, l.elevation, l.ceilingHeight, l.floorThickness])).toEqual([
      ['lower', 'ground', -1.0, 2.3, 0],
      ['main', 'ground', 0, undefined, 0],
      ['loft', 'loft', 1.47, undefined, 0.17],
    ]);
  });
  it('reference the two storeys only', () => {
    for (const l of variant.levels) expect(['ground', 'loft']).toContain(l.storeyId);
  });
});

describe('blocks', () => {
  it('are the four blocks of the brief with CCW polygons, parts and zones', () => {
    expect(variant.blocks.map((b) => b.id)).toEqual(['blk-main', 'blk-glass', 'blk-bod', 'blk-wing']);
    for (const b of variant.blocks) {
      expect(signedArea(blockPolygon(b)), b.id).toBeGreaterThan(0);
      for (const p of b.parts) expect(signedArea(p.polygon), p.id).toBeGreaterThan(0);
      for (const z of b.floorZones) expect(signedArea(z.polygon), z.id).toBeGreaterThan(0);
      expect(b.polygon.map((v) => v.id)).toEqual(['sw', 'se', 'ne', 'nw'].map((c) => `v-${b.id.slice(4)}-${c}`));
      expect(b.wall).toEqual({ thickness: 0.27, outerOffset: 0.11 });
      expect(b.eaveHeight).toBe(2.22);
      expect(b.roof.type).toBe('gable');
      expect(b.roof.thickness).toBe(0.31);
      expect(b.roof.overhangEave).toBe(0.51);
      expect(b.roof.overhangGable).toBe(0.35);
      expect(b.roof.material).toBe('turf');
      expect(b.levelId).toBe('main');
      // parts and zones lie inside the block polygon
      for (const poly of [...b.parts.map((p) => p.polygon), ...b.floorZones.map((z) => z.polygon)]) {
        for (const p of poly) expect(pointInPolygon(p, blockPolygon(b)), `${b.id} ${p}`).toBe(true);
      }
    }
    expect(blockPolygon(main)).toEqual([[0, 0], [16, 0], [16, 6.2], [0, 6.2]]);
    expect(main.parts.map((p) => [p.id, p.isNew])).toEqual([['part-main-old', false], ['part-stue-ext', true]]);
    expect(main.floorZones.map((z) => [z.id, z.levelId, z.kind])).toEqual([['zone-lower', 'lower', 'replace'], ['zone-loft', 'loft', 'add']]);
    expect(main.junctions).toEqual([
      { otherBlockId: 'blk-glass', policy: 'open' },
      { otherBlockId: 'blk-bod', policy: 'wall' },
      { otherBlockId: 'blk-wing', policy: 'open' },
    ]);
    expect(blockById.get('blk-bod')!.parts.map((p) => [p.id, p.isNew])).toEqual([['part-bod-old', false], ['part-bod-new', true]]);
  });

  it('have the calibrated roofs', () => {
    const roofs = Object.fromEntries(variant.blocks.map((b) => [b.id, b.roof]));
    expect(roofs['blk-main']).toMatchObject({ ridgeAxis: 'x', pitchDeg: 28, ridgeHeight: 3.87, drive: 'pitch' });
    expect(roofs['blk-glass']).toMatchObject({ ridgeAxis: 'y', pitchDeg: 28, ridgeHeight: 3.28, drive: 'pitch' });
    expect(roofs['blk-bod']).toMatchObject({ ridgeAxis: 'y', pitchDeg: 28, ridgeHeight: 3.28, drive: 'pitch' });
    expect(roofs['blk-wing']).toMatchObject({ ridgeAxis: 'y', ridgeHeight: 3.87, drive: 'height' });
    expect(roofs['blk-wing'].pitchDeg).toBeCloseTo(34.5, 1);
    expect(blockById.get('blk-wing')!.isNew).toBe(true);
    expect(main.isNew).toBe(false);
  });

  it('junction ids resolve', () => {
    for (const b of variant.blocks) for (const j of b.junctions) expect(blockById.has(j.otherBlockId), `${b.id} → ${j.otherBlockId}`).toBe(true);
  });
});

describe('axis areas (shoelace over blocks and parts)', () => {
  it('total 170.16 = existing 98.0 + new 72.16', () => {
    let total = 0;
    let existing = 0;
    let fresh = 0;
    for (const b of variant.blocks) {
      const blockArea = signedArea(blockPolygon(b));
      total += blockArea;
      let partsArea = 0;
      for (const p of b.parts) {
        const a = signedArea(p.polygon);
        partsArea += a;
        if (p.isNew) fresh += a;
        else existing += a;
      }
      const remainder = blockArea - partsArea;
      expect(remainder).toBeGreaterThanOrEqual(-1e-9);
      if (b.isNew) fresh += remainder;
      else existing += remainder;
    }
    expect(total).toBeCloseTo(170.16, 6);
    expect(existing).toBeCloseTo(98.0, 6);
    expect(fresh).toBeCloseTo(72.16, 6);
    const perBlock = Object.fromEntries(variant.blocks.map((b) => [b.id, signedArea(blockPolygon(b))]));
    expect(perBlock).toEqual({ 'blk-main': expect.closeTo(99.2, 6), 'blk-glass': expect.closeTo(8.0, 6), 'blk-bod': expect.closeTo(23.6, 6), 'blk-wing': expect.closeTo(39.36, 6) });
  });
});

describe('walls', () => {
  it('are all present with existing levels and the brief heights', () => {
    expect(variant.walls).toHaveLength(36);
    for (const w of variant.walls) {
      expect(levelById.has(w.levelId), w.id).toBe(true);
      expect(dist(w.a, w.b), w.id).toBeGreaterThan(0.01);
      if (w.kind === 'divider') {
        expect(w.thickness).toBe(0);
        expect(w.id.startsWith('dv-')).toBe(true);
      } else {
        expect(w.thickness).toBeGreaterThan(0);
      }
      if (w.heightMode === 'fixed') expect(w.height, w.id).toBeGreaterThan(0);
      else expect(w.height, w.id).toBeUndefined();
    }
    const byId = Object.fromEntries(variant.walls.map((w) => [w.id, w]));
    expect(byId['w-103-102']).toMatchObject({ levelId: 'lower', heightMode: 'roof' });
    expect(byId['w-106-korr']).toMatchObject({ levelId: 'lower', heightMode: 'roof' });
    expect(byId['w-106-stue']).toMatchObject({ levelId: 'lower', heightMode: 'roof' });
    expect(byId['w-104-103']).toMatchObject({ levelId: 'lower', heightMode: 'auto', thickness: 0.12 });
    expect(byId['w-korr-stue']).toMatchObject({ levelId: 'main', heightMode: 'fixed', height: 2.3, status: 'existing' });
    expect(byId['w-gang-s']).toMatchObject({ levelId: 'main', heightMode: 'fixed', height: 2.4, status: 'new' });
    expect(byId['w-mellom-boder']).toMatchObject({ kind: 'exterior-old', thickness: 0.27, heightMode: 'auto' });
    expect(byId['w-bod-gavl']).toMatchObject({ kind: 'exterior-old', thickness: 0.27, faceLeft: 0.11, faceRight: 0.16 });
    expect(byId['w-bod-ved']).toMatchObject({ status: 'new', heightMode: 'auto' });
    expect(byId['dv-stue-n']).toMatchObject({ kind: 'divider', status: 'new', a: [9, 2.2], b: [16, 2.2] });
    expect(byId['lw-split']).toMatchObject({ levelId: 'loft', heightMode: 'auto' });
    expect(variant.walls.filter((w) => w.kind === 'divider')).toHaveLength(6);
    expect(variant.walls.filter((w) => w.levelId === 'loft')).toHaveLength(5);
    expect(variant.walls.filter((w) => w.status === 'new')).toHaveLength(10);
  });
});

describe('openings', () => {
  const openingLevel = (o: Opening) => levelById.get(o.levelId!)!;

  it('are all present, with existing levels and resolvable hosts', () => {
    expect(variant.openings).toHaveLength(49);
    expect(variant.openings.filter((o) => o.status === 'removed').map((o) => o.id).sort()).toEqual(['door-106-old', 'win-stue-s-old']);
    for (const o of variant.openings) {
      expect(o.levelId, o.id).toBeDefined();
      expect(levelById.has(o.levelId!), o.id).toBe(true);
      expect(o.width, o.id).toBeGreaterThan(0);
      expect(o.height, o.id).toBeGreaterThan(0);
      expect(o.sill, o.id).toBeGreaterThanOrEqual(0);
      expect(() => hostLength(variant, o), o.id).not.toThrow();
      const host = o.host;
      if (host.kind === 'wall') {
        const w = variant.walls.find((x) => x.id === host.wallId)!;
        expect(w.kind, `${o.id} hosted on a divider`).not.toBe('divider');
        expect(w.levelId, `${o.id} level ≠ wall level`).toBe(o.levelId);
      }
      if (o.type === 'door' || o.type === 'glassDoor' || o.type === 'saunaDoor') {
        expect(o.sill, o.id).toBe(0);
        expect(o.swing, `${o.id} has no swing`).toBeDefined();
      } else {
        expect(o.swing, o.id).toBeUndefined();
      }
      if (o.type === 'window') expect(o.style.mullions, o.id).toBeDefined();
    }
  });

  it('fit inside their hosts (end touch within 1 mm allowed)', () => {
    for (const o of variant.openings) {
      const L = hostLength(variant, o);
      const start = o.offset - o.width / 2;
      const end = o.offset + o.width / 2;
      expect(start, `${o.id} starts before its host`).toBeGreaterThanOrEqual(-1e-3);
      expect(end, `${o.id} ends past its host (${end} > ${L})`).toBeLessThanOrEqual(L + 1e-3);
    }
    // the woodshed front touches the block corner exactly
    const ved = variant.openings.find((o) => o.id === 'open-ved')!;
    expect(ved.offset + ved.width / 2).toBeCloseTo(hostLength(variant, ved), 9);
    expect(ved.fullHeight).toBe(true);
  });

  it('do not overlap on the same host (removed ones excluded; z ranges considered)', () => {
    const live = variant.openings.filter((o) => o.status !== 'removed');
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (hostKey(a) !== hostKey(b)) continue;
        const planOverlap = Math.abs(a.offset - b.offset) < (a.width + b.width) / 2 - 1e-6;
        const za = openingLevel(a).elevation + a.sill;
        const zb = openingLevel(b).elevation + b.sill;
        const zOverlap = za < zb + b.height - 1e-6 && zb < za + a.height - 1e-6;
        expect(planOverlap && zOverlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('have the offsets computed from the brief coordinates', () => {
    const byId = Object.fromEntries(variant.openings.map((o) => [o.id, o]));
    const expectOffset = (id: string, offset: number) => expect(byId[id].offset, id).toBeCloseTo(offset, 9);
    expectOffset('win-bad-n', 12.49);
    expectOffset('win-kjk-n', 5.41);
    expectOffset('door-mellom-vf', 8.99);
    expectOffset('win-104-w', 2.39);
    expectOffset('win-hems-w1', 3.76);
    expectOffset('win-hems-w2', 2.44);
    expectOffset('win-glass-e', 1.04);
    expectOffset('win-glass-w', 0.96);
    expectOffset('door-green-e', 0.69);
    expectOffset('door-green-w', 5.21);
    expectOffset('win-do-w', 3.28);
    expectOffset('open-ved', 5.4);
    expectOffset('win-badstue-w', 7.2);
    expectOffset('win-bad-e1', 1.7);
    expectOffset('win-sov-n', 2.8);
    expectOffset('d-bad', 0.56);
    expectOffset('d-106', 0.58);
    expectOffset('o-vf', 1.85);
    expectOffset('d-do', 0.64);
    expectOffset('d-bod109', 2.01);
    expectOffset('o-stue-gang', 2.8);
    expectOffset('d-pantry', 0.7);
    expectOffset('d-wc', 2.0);
    expectOffset('d-bad2', 3.5);
    expectOffset('d-sov-ny', 1.3);
    expectOffset('d-badstue', 1.0);
    expectOffset('d-hems2', 3.24);
    expectOffset('d-hems1', 0.48);
    expect(byId['win-hems-w1']).toMatchObject({ levelId: 'loft', sill: 0.53, width: 1.11, height: 1.01 });
    expect(byId['win-105-s']).toMatchObject({ levelId: 'lower', sill: 0.8, host: { kind: 'blockEdge', blockId: 'blk-main', edgeId: 'v-main-sw' } });
    expect(byId['door-stue-s']).toMatchObject({ type: 'glassDoor', status: 'new', swing: { hinge: 'start', side: 'right' } });
    expect(byId['door-green-e'].style).toEqual({ frameColour: 'green', leaf: 'green' });
    expect(byId['win-glass-s1'].style.mullions).toEqual([3, 2]);
    expect(byId['win-gavl-s']).toMatchObject({ sill: 2.75, height: 0.7 });
    expect(byId['d-badstue']).toMatchObject({ type: 'saunaDoor', swing: { hinge: 'start', side: 'right' } });
    expect(byId['door-106-old']).toMatchObject({ status: 'removed', levelId: 'lower', offset: 3.68 });
    expect(byId['win-stue-s-old']).toMatchObject({ status: 'removed', levelId: 'main', offset: 10.36 });
  });
});

describe('rooms', () => {
  it('are all present with existing levels', () => {
    expect(variant.rooms).toHaveLength(27);
    for (const r of variant.rooms) expect(levelById.has(r.levelId), r.id).toBe(true);
    expect(variant.rooms.filter((r) => r.levelId === 'lower')).toHaveLength(5);
    expect(variant.rooms.filter((r) => r.levelId === 'loft')).toHaveLength(3);
    expect(variant.rooms.find((r) => r.id === 'room-ved')).toMatchObject({ floorMaterial: 'deck', note: 'Åpent mot terrassen' });
    expect(variant.rooms.find((r) => r.id === 'room-teknisk')).toMatchObject({ type: 'teknisk', note: 'Tidligere bod 108' });
  });

  it('anchors lie inside a block polygon and in the right floor zone', () => {
    const lowerZone = zone('zone-lower');
    const loftZone = zone('zone-loft');
    for (const r of variant.rooms) {
      const containing = variant.blocks.filter((b) => pointInPolygon(r.anchor, blockPolygon(b)));
      expect(containing.length, `${r.id} anchor outside every block`).toBeGreaterThanOrEqual(1);
      if (r.levelId === 'lower') expect(pointInPolygon(r.anchor, lowerZone), `${r.id} outside zone-lower`).toBe(true);
      if (r.levelId === 'loft') expect(pointInPolygon(r.anchor, loftZone), `${r.id} outside zone-loft`).toBe(true);
      if (r.levelId === 'main' && containing.some((b) => b.id === 'blk-main')) {
        expect(pointInPolygon(r.anchor, lowerZone), `${r.id} (main) inside zone-lower`).toBe(false);
      }
    }
  });

  it('anchors are not shared between rooms', () => {
    const keys = variant.rooms.map((r) => `${r.levelId}:${r.anchor.join(',')}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('structure, outdoor, site', () => {
  it('structure elements reference existing levels and have sane z', () => {
    expect(variant.structure).toHaveLength(12);
    for (const s of variant.structure) {
      if (s.kind === 'stair') {
        expect(levelById.has(s.fromLevelId), s.id).toBe(true);
        expect(levelById.has(s.toLevelId), s.id).toBe(true);
        expect(levelById.get(s.toLevelId)!.elevation).toBeGreaterThan(levelById.get(s.fromLevelId)!.elevation);
        expect(s.max[0]).toBeGreaterThan(s.min[0]);
        expect(s.max[1]).toBeGreaterThan(s.min[1]);
      } else if (s.kind === 'chimney') {
        expect(s.top).toBeGreaterThan(s.bottom);
        expect(s.max[0]).toBeGreaterThan(s.min[0]);
      } else {
        expect(s.top, s.id).toBeGreaterThan(s.bottom);
      }
    }
    const stairLoft = variant.structure.find((s) => s.id === 'stair-loft');
    expect(stairLoft).toMatchObject({ kind: 'stair', fromLevelId: 'main', toLevelId: 'loft', upDirection: 'W', min: [3.85, 2.24], max: [6.1, 3.04] });
    const stairLevel = variant.structure.find((s) => s.id === 'stair-level');
    expect(stairLevel).toMatchObject({ kind: 'stair', fromLevelId: 'lower', toLevelId: 'main', upDirection: 'E' });
    expect(variant.structure.find((s) => s.id === 'post-3')).toMatchObject({ kind: 'post', position: [11.9, 3.1], isNew: false });
    expect(variant.structure.find((s) => s.id === 'post-ved')).toMatchObject({ kind: 'post', size: 0.14, top: 2.22, isNew: true });
  });

  it('deck is CCW, railing references the deck and its gaps match the spec coordinates', () => {
    const { decks, railings, hotTubs } = variant.outdoor;
    expect(decks).toHaveLength(1);
    expect(signedArea(decks[0].polygon)).toBeGreaterThan(0);
    expect(decks[0]).toMatchObject({ id: 'deck-terrasse', topHeight: -0.02, isNew: true });
    expect(railings).toHaveLength(1);
    const rail = railings[0];
    expect(decks.some((d) => d.id === rail.deckId)).toBe(true);
    expect(rail).toMatchObject({ height: 1.05, style: 'glass', isNew: true });
    expect(rail.gaps).toEqual([
      { from: 4.6, to: 6.0, steps: true },
      { from: 27.5, to: 28.9, steps: true },
      { from: 33.8, to: 35.2, steps: true },
    ]);
    let pathLength = 0;
    for (let i = 0; i + 1 < rail.path.length; i++) pathLength += dist(rail.path[i], rail.path[i + 1]);
    for (const g of rail.gaps) {
      expect(g.to).toBeGreaterThan(g.from);
      expect(g.to).toBeLessThanOrEqual(pathLength + 1e-9);
    }
    // the railing path runs along deck edges
    for (const p of rail.path) expect(pointInPolygon(p, decks[0].polygon), `${p}`).toBe(true);
    expect(hotTubs).toEqual([{ id: 'tub-1', centre: [21.7, -3.2], diameter: 2.0, isNew: true }]);
  });

  it('site matches the brief and references the bundled terrain', () => {
    const site = project.site;
    expect(site.originLatLon).toEqual({ lat: 68.61305, lon: 14.968157 });
    expect(site.planNorthBearing).toBe(106);
    expect(site.floorElevation).toBe(161.0);
    expect(site.waterLevel).toBe(152.0);
    expect(site.timezone).toBe('Europe/Oslo');
    expect(site.terrainId).toBe(TERRAIN_ASSET_ID);
    expect(site.terrainId).toBe(terrain.id);
    expect(site.groundWorks).toHaveLength(1);
    expect(site.groundWorks[0]).toMatchObject({ id: 'gw-tomt', maxZ: -0.45 });
    expect(signedArea(site.groundWorks[0].polygon)).toBeGreaterThan(0);
    expect(site.trees).toHaveLength(12);
    for (const t of site.trees) {
      expect(t.kind).toBe('bjork');
      expect(t.height).toBeGreaterThan(0);
    }
  });
});

describe('ids', () => {
  it('are unique across the whole project', () => {
    const ids = collectIds(project);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    expect(ids.length).toBeGreaterThan(150);
  });
});

describe('terrain asset', () => {
  it('has two plan-aligned grids of the specified extent, finest first', () => {
    expect(terrain.id).toBe('merkesvatnet-2026-10');
    expect(terrain.grids).toHaveLength(2);
    const [a, b] = terrain.grids;
    expect(a).toMatchObject({ x0: -100, y0: -100, dx: 2, dy: 2, nx: 111, ny: 101 });
    expect(b).toMatchObject({ x0: -220, y0: -220, dx: 10, dy: 10, nx: 47, ny: 45 });
    for (const g of terrain.grids) {
      expect(g.z).toHaveLength(g.nx * g.ny);
      for (const z of g.z) {
        expect(Number.isFinite(z)).toBe(true);
        expect(z).toBeGreaterThan(100);
        expect(z).toBeLessThan(400);
        expect(Math.round(z * 100) / 100).toBe(z);
      }
    }
  });

  it('matches the calibrated ground heights under the cabin (m a.s.l.)', () => {
    const a = terrain.grids[0];
    expect(sampleGrid(a, 12, 3.1)).toBeCloseTo(160.5, 0);
    expect(sampleGrid(a, 0, 3.1)).toBeCloseTo(159.5, 0);
    expect(sampleGrid(a, 7, -2)).toBeCloseTo(159.9, 0);
    expect(sampleGrid(a, 7, 10.1)).toBeCloseTo(160.6, 0);
    for (const [x, y, expected] of [[12, 3.1, 160.5], [0, 3.1, 159.5], [7, -2, 159.9], [7, 10.1, 160.6]]) {
      expect(Math.abs(sampleGrid(a, x, y)! - expected), `(${x}, ${y})`).toBeLessThan(0.3);
    }
    // the main floor sits ~0.5 m above the ground at the living-room gable
    expect(project.site.floorElevation - sampleGrid(a, 12, 3.1)!).toBeGreaterThan(0.2);
    expect(project.site.floorElevation - sampleGrid(a, 12, 3.1)!).toBeLessThan(0.8);
    // the two grids agree where they overlap
    expect(sampleGrid(terrain.grids[1], 0, 0)!).toBeCloseTo(sampleGrid(a, 0, 0)!, 0);
  });

  it('contains the lake towards plan −y in the wide grid', () => {
    const b = terrain.grids[1];
    const water = project.site.waterLevel!;
    let lakeSouth = 0;
    let lakeNorthEast = 0;
    for (let j = 0; j < b.ny; j++) {
      for (let i = 0; i < b.nx; i++) {
        if (b.z[j * b.nx + i] > water + 0.5) continue;
        const x = b.x0 + i * b.dx;
        const y = b.y0 + j * b.dy;
        if (y < -40) lakeSouth++;
        if (y > 40 && x > 40) lakeNorthEast++;
      }
    }
    expect(lakeSouth).toBeGreaterThan(50);
    expect(lakeNorthEast).toBe(0);
    expect(Math.min(...b.z)).toBeLessThanOrEqual(152.5);
  });
});

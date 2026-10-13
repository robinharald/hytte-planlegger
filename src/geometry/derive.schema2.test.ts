/**
 * Schema 2 / phase 2 additions to deriveVariant (docs/phase2-plan.md §2 "Derived additions"): the memo split into
 * building / outdoor / furniture stages (shared instances, timing), block junctions, wall-piece ranges, ghosts,
 * opening levels, the locked flag, levelAt, the implicit remainder of a block with parts, the furniture stage
 * and the deck warnings.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { levelAt } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { Block, Deck, FurnitureItem, Opening, TerrainAsset, Variant, Vec2 } from '../model/types';
import { makeTestProject, makeVariant } from '../state/testProject';
import { deriveVariant, furnitureFootprint } from './derive';
import { area } from './polygon';

const site = makeTestProject().site;

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

const item = (id: string, position: Vec2, extra: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id,
  catalogId: 'seng-150',
  position,
  rotationDeg: 0,
  levelId: 'main',
  size: { w: 1.5, d: 2, h: 0.5 },
  isNew: true,
  ...extra,
});

const deck = (polygon: Vec2[], extra: Partial<Deck> = {}): Deck => ({
  id: 'deck',
  polygon: polygon.map((p, i) => ({ id: `deck-v${i}`, p })),
  topHeight: 0,
  isNew: true,
  noRailingEdges: [],
  steps: [],
  ...extra,
});

const terrain = terrainJson as unknown as TerrainAsset;

// ---------------------------------------------------------------------------
// Memo split
// ---------------------------------------------------------------------------

describe('deriveVariant: stages memoised on the sub-collections', () => {
  const seed = createForslagD();
  const base = seed.variants[0];

  it('two variants differing only in furniture share the building and the outdoor (same array instances)', () => {
    const a = deriveVariant(base, seed.site, terrain);
    const furnished = produce(base, (v) => {
      v.furniture.push(item('seng', [18.5, 4.5]));
    });
    const b = deriveVariant(furnished, seed.site, terrain);
    expect(b).not.toBe(a);
    for (const key of ['walls', 'rooms', 'floors', 'roofs', 'blocks', 'wallUnion', 'structure', 'dimensions', 'foundations'] as const) {
      expect(b[key], key).toBe(a[key]);
    }
    expect(b.outdoor).toBe(a.outdoor);
    // The seed is furnished (revision 6): one more item.
    expect(b.furniture).toHaveLength(a.furniture.length + 1);
    // The furniture stage resolves the catalogue entry and the room on the item's storey.
    const seng = b.furniture.find((f) => f.id === 'seng');
    expect(seng).toMatchObject({ id: 'seng', levelId: 'main', floorZ: 0, z: 0, roomId: 'room-sov-ny' });
    expect(seng?.catalog?.id).toBe('seng-150');
  });

  it('an outdoor-only edit (the hot tub) keeps the building and recomputes the outdoor', () => {
    const a = deriveVariant(base, seed.site, terrain);
    const moved = produce(base, (v) => {
      v.outdoor.hotTubs[0].centre = [22, 9];
    });
    const b = deriveVariant(moved, seed.site, terrain);
    expect(b.walls).toBe(a.walls);
    expect(b.rooms).toBe(a.rooms);
    expect(b.areas.bra).toBe(a.areas.bra);
    expect(b.outdoor).not.toBe(a.outdoor);
    expect(b.outdoor.hotTubs[0].centre).toEqual([22, 9]);
    expect(b.areas.bya.total).toBeCloseTo(a.areas.bya.total, 9);
  });

  it('an opening-only edit keeps the building stage: only the walls holding openings, the floors and the warnings change', () => {
    const a = deriveVariant(base, seed.site, terrain);
    const moved = produce(base, (v) => {
      v.openings.find((o) => o.id === 'door-mellom-vf')!.offset += 0.3;
    });
    const b = deriveVariant(moved, seed.site, terrain);
    for (const key of ['rooms', 'roofs', 'blocks', 'wallUnion', 'structure', 'dimensions', 'foundations', 'outdoor', 'groundWorks'] as const) {
      expect(b[key], key).toBe(a[key]);
    }
    expect(b.areas.bra).toBe(a.areas.bra);
    expect(b.areas.bya).toBe(a.areas.bya);
    expect(b.walls).not.toBe(a.walls);
    // Walls without openings are the same objects; the door's host is a new one with the door at its new place.
    const host = b.walls.find((w) => w.openings.some((o) => o.id === 'door-mellom-vf'))!;
    expect(a.walls.find((w) => w.id === host.id)).not.toBe(host);
    const bare = b.walls.filter((w) => w.openings.length === 0 && w.patches.length === 0);
    expect(bare.length).toBeGreaterThan(10);
    for (const w of bare) expect(a.walls.find((x) => x.id === w.id), w.id).toBe(w);
    // The same model as a derive from scratch (fresh object identities, nothing memoised).
    const fresh = deriveVariant(JSON.parse(JSON.stringify(moved)) as Variant, seed.site, terrain);
    expect(b.walls).toEqual(fresh.walls);
    expect(b.floors).toEqual(fresh.floors);
    expect(b.warnings).toEqual(fresh.warnings);
    expect(b.areas).toEqual(fresh.areas);
    // The memoised pieces were not written to: the base derive still has the door at its old place.
    expect(deriveVariant(JSON.parse(JSON.stringify(base)) as Variant, seed.site, terrain).walls).toEqual(a.walls);
  });

  it('a block edit recomputes the building (and everything after it)', () => {
    const a = deriveVariant(base, seed.site, terrain);
    const wider = produce(base, (v) => {
      const wing = v.blocks.find((x) => x.id === 'blk-wing')!;
      for (const vx of wing.polygon) if (vx.p[0] > 20) vx.p = [21, vx.p[1]];
    });
    const b = deriveVariant(wider, seed.site, terrain);
    expect(b.walls).not.toBe(a.walls);
    expect(b.outdoor).not.toBe(a.outdoor);
    expect(b.areas.bya.buildings).toBeGreaterThan(a.areas.bya.buildings);
  });

  it('is fast: a block-edge change ≤ 60 ms, an opening-only change ≤ 8 ms, a furniture-only change ≤ 5 ms (best of several runs; × 2.5 locally, × 3 on CI)', () => {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    // The full suite runs the test files in parallel workers, which slows a single derive down: slack locally too (the
    // phase 3 tests made the suite heavier; × 1.5 measured 102 ms against 90 under the full run).
    const slack = env.CI ? 3 : 2.5;
    deriveVariant(base, seed.site, terrain); // warm-up (JIT, shared memo)
    const best = (n: number, make: (k: number) => Variant): number => {
      let min = Infinity;
      for (let k = 0; k < n; k++) {
        const v = make(k);
        const t0 = performance.now();
        deriveVariant(v, seed.site, terrain);
        min = Math.min(min, performance.now() - t0);
      }
      return min;
    };
    // 20 runs: under the full parallel suite (editActions.restore.test.ts alone runs ~50 s) 10 were not always enough.
    const blockEdge = best(20, (k) =>
      produce(base, (v) => {
        const wing = v.blocks.find((x) => x.id === 'blk-wing')!;
        for (const vx of wing.polygon) if (vx.p[0] > 20) vx.p = [20.8 + 0.01 * (k + 1), vx.p[1]];
      }),
    );
    const furnitureOnly = best(10, (k) =>
      produce(base, (v) => {
        v.furniture.push(item(`f-${k}`, [18.5, 4.5 + 0.01 * k]));
      }),
    );
    const openingOnly = best(10, (k) =>
      produce(base, (v) => {
        v.openings.find((o) => o.id === 'door-mellom-vf')!.offset += 0.01 * (k + 1);
      }),
    );
    expect(blockEdge).toBeLessThanOrEqual(60 * slack);
    expect(furnitureOnly).toBeLessThanOrEqual(5 * slack);
    // An opening drag frame (fix round 2 after 2a): the building stage is reused, only the opening stage runs.
    expect(openingOnly).toBeLessThanOrEqual(8 * slack);
  });
});

// ---------------------------------------------------------------------------
// Derived additions
// ---------------------------------------------------------------------------

describe('deriveVariant: derived additions', () => {
  it('lists the block junctions with the partner edge and the role of this block', () => {
    // a (listed first) keeps the shared wall x = 6; b's piece is removed. c is 'open' to b along y = 4.
    const a = block('a', rect(0, 0, 6, 4));
    const b = block('b', rect(6, 0, 10, 4), { junctions: [{ otherBlockId: 'c', policy: 'open' }] });
    const c = block('c', rect(6, 4, 10, 8));
    const d = deriveVariant({ ...makeVariant('v', 'v'), blocks: [a, b, c], walls: [], rooms: [] }, site, null);
    const [da, db, dc] = d.blocks;
    expect(da.junctions).toEqual([{ edgeIndex: 1, s0: 0, s1: 4, otherBlockId: 'b', otherEdgeIndex: 3, role: 'owner' }]);
    expect(db.junctions).toEqual([
      { edgeIndex: 2, s0: 0, s1: 4, otherBlockId: 'c', otherEdgeIndex: 0, role: 'open' },
      { edgeIndex: 3, s0: 0, s1: 4, otherBlockId: 'a', otherEdgeIndex: 1, role: 'removed' },
    ]);
    expect(dc.junctions).toEqual([{ edgeIndex: 0, s0: 0, s1: 4, otherBlockId: 'b', otherEdgeIndex: 2, role: 'open' }]);
  });

  it('gives exterior pieces their range on the edge (s0, s1), split at part boundaries', () => {
    const v: Variant = {
      ...makeVariant('v', 'v'),
      blocks: [block('b', rect(0, 0, 6, 4), { parts: [{ id: 'old', name: 'Gammel', polygon: rect(0, 0, 4, 4), isNew: false }] })],
      walls: [],
      rooms: [],
    };
    const south = deriveVariant(v, site, null).walls.filter((w) => w.source.kind === 'blockEdge' && w.source.edgeId === 'b-v0');
    expect(south.map((w) => (w.source.kind === 'blockEdge' ? [w.source.partId, w.source.s0, w.source.s1] : null))).toEqual([
      ['old', 0, 4],
      ['b-implicit', 4, 6],
    ]);
  });

  it('the implicit remainder of a block with explicit parts is new: an edge dragged outwards adds new area only', () => {
    const v: Variant = {
      ...makeVariant('v', 'v'),
      blocks: [block('b', rect(0, 0, 8, 4), { isNew: false, parts: [{ id: 'old', name: 'Gammel', polygon: rect(0, 0, 6, 4), isNew: false }] })],
      walls: [],
      rooms: [],
    };
    const d = deriveVariant(v, site, null);
    expect(d.blocks[0].parts.map((p) => [p.part.id, p.isImplicit, p.part.isNew])).toEqual([
      ['old', false, false],
      ['b-implicit', true, true],
    ]);
    expect(d.areas.axis.existing).toBeCloseTo(24, 9);
    expect(d.areas.axis.new).toBeCloseTo(8, 9);
  });

  it('removed walls are ghosts: in the plan data, not in room detection; removed openings are ghosts with their level', () => {
    const v = makeVariant('v', 'v');
    v.walls[0].status = 'removed';
    const ghostDoor: Opening = {
      id: 'o-ghost',
      type: 'door',
      host: { kind: 'wall', wallId: 'w-1' },
      offset: 2,
      width: 0.8,
      height: 2,
      sill: 0,
      style: { frameColour: 'white' },
      status: 'removed',
    };
    v.openings.push(ghostDoor);
    const d = deriveVariant(v, site, null);
    const w = d.walls.find((x) => x.id === 'w-1')!;
    expect(w.isGhost).toBe(true);
    expect(d.walls.filter((x) => x.isExterior).every((x) => !x.isGhost)).toBe(true);
    expect(w.openings[0]).toMatchObject({ id: 'o-ghost', isGhost: true, levelId: 'main' });
    // One room left (the two records share the face): the ghost wall does not split it.
    expect(d.rooms).toHaveLength(1);
    expect(d.warnings).toContainEqual({ kind: 'room-anchor-lost', roomId: 'room-2' });
    expect(d.wallUnion.map((u) => u.status)).toContain('removed');
  });

  it('openings carry the level their sill is measured from', () => {
    const p = createForslagD();
    const d = deriveVariant(p.variants[0], p.site, terrain);
    const openings = d.walls.flatMap((w) => w.openings);
    for (const o of openings) {
      expect(o.levelId, o.id).toBe(o.opening.levelId);
      expect(o.isGhost, o.id).toBe(o.status === 'removed');
    }
    expect(openings.filter((o) => o.isGhost).length).toBeGreaterThan(0); // the old room-106 door and living-room window
  });

  it('passes the variant lock and the block-edge ghosts through', () => {
    const v = { ...makeVariant('v', 'v'), locked: true, ghosts: [{ id: 'g', a: [0, 0] as Vec2, b: [6, 0] as Vec2 }] };
    const d = deriveVariant(v, site, null);
    expect(d.locked).toBe(true);
    expect(d.ghosts).toEqual([{ id: 'g', a: [0, 0], b: [6, 0] }]);
    const plain = deriveVariant(makeVariant('v', 'v'), site, null);
    expect(plain.locked).toBe(false);
    expect(plain.ghosts).toEqual([]);
  });

  it('a block floorMaterial is the default floor of its rooms', () => {
    const v = makeVariant('v', 'v');
    v.blocks[0].floorMaterial = 'deck';
    v.rooms[1].floorMaterial = 'tile';
    const d = deriveVariant(v, site, null);
    expect(d.rooms.find((r) => r.id === 'room-1')!.floorMaterial).toBe('deck');
    expect(d.rooms.find((r) => r.id === 'room-2')!.floorMaterial).toBe('tile');
  });

  it('decks: trimmed by the building, the railing on the free runs, blocked steps warn', () => {
    const v: Variant = {
      ...makeVariant('v', 'v'),
      outdoor: {
        decks: [
          deck(rect(-2, -3, 8, 1), {
            railing: { style: 'glass', height: 1.05 },
            steps: [
              { id: 'ok', edgeId: 'deck-v0', offset: 5, width: 1.2 },
              { id: 'under-house', edgeId: 'deck-v2', offset: 5, width: 1.2 },
            ],
          }),
        ],
        hotTubs: [],
      },
    };
    const d = deriveVariant(v, site, null);
    const dk = d.outdoor.decks[0];
    // The cabin's outer outline (−0.11 … 6.11 × −0.11 … 4.11) cuts the deck's north-middle part away.
    expect(area(dk.pieces[0][0])).toBeCloseTo(10 * 4 - 6.22 * 1.11, 6);
    expect(d.outdoor.railings[0].id).toBe('deck/railing');
    expect(d.outdoor.steps.map((s) => [s.id, s.blocked])).toEqual([
      ['ok', false],
      ['under-house', true],
    ]);
    expect(d.warnings).toEqual([{ kind: 'deck-steps-blocked', stepsId: 'under-house', deckId: 'deck' }]);
  });

  it('furniture: footprint = the size rectangle rotated about the position; bbox, room and clearances', () => {
    const f = item('bed', [3, 2], { rotationDeg: 90 });
    const fp = furnitureFootprint(f);
    const xs = fp.map((p) => p[0]);
    const ys = fp.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(2, 9);
    expect(Math.max(...xs)).toBeCloseTo(4, 9);
    expect(Math.min(...ys)).toBeCloseTo(1.25, 9);
    expect(Math.max(...ys)).toBeCloseTo(2.75, 9);
    expect(area(fp)).toBeCloseTo(3, 9);
    const v = { ...makeVariant('v', 'v'), furniture: [item('bed', [1.5, 2]), item('out', [20, 20])] };
    const d = deriveVariant(v, site, null);
    expect(d.furniture[0]).toMatchObject({ id: 'bed', roomId: 'room-1', item: v.furniture[0], collisions: [], blocksDoors: [], needsDrain: false });
    // A 150 bed wants 0,6 m at both long sides (furniture/catalog.ts).
    expect(d.furniture[0].clearances).toHaveLength(2);
    expect(d.furniture[0].bbox).toEqual({ min: [0.75, 1], max: [2.25, 3] });
    expect(d.furniture[1].roomId).toBeUndefined();
  });
});

describe('levelAt', () => {
  const p = createForslagD();
  const d = deriveVariant(p.variants[0], p.site, terrain);

  it('finds the floor level at a point on a storey: zones first, then the block level', () => {
    expect(levelAt(d, 'ground', [2, 2])).toBe('lower'); // the lower bedroom part (zone-lower)
    expect(levelAt(d, 'ground', [8, 2])).toBe('main'); // the stue
    expect(levelAt(d, 'ground', [18, 2])).toBe('main'); // the new wing
    expect(levelAt(d, 'loft', [2, 2])).toBe('loft'); // over the bedrooms (zone-loft)
  });

  it('falls back to the storey level closest to the main floor (the deck, the terrain), and to the first level', () => {
    expect(levelAt(d, 'ground', [22, 0])).toBe('main');
    expect(levelAt(d, 'loft', [22, 0])).toBe('loft');
    expect(levelAt(d, 'nope', [0, 0])).toBe(d.levels[0].id);
  });
});

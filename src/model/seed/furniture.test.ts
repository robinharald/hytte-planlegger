/**
 * The seed furnishing (seed/furniture.ts, ported from the old model's buildD150()): deterministic, stable ids, every
 * item in a room of its level or on the deck, no furniture warnings, backs on inner faces, the rooms unchanged.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { catalogItem } from '../../furniture/catalog';
import { deriveVariant } from '../../geometry/derive';
import { backEdge } from '../../geometry/furnitureDerive';
import { distancePointSegment, pointInPolygon } from '../../geometry/polygon';
import type { Vec2 } from '../types';
import { createForslagD } from './forslagD';
import { buildFurniture } from './furniture';

const project = createForslagD();
const variant = project.variants[0];
const derived = deriveVariant(variant, project.site, null);
const byId = (id: string) => variant.furniture.find((f) => f.id === id)!;

describe('seed furniture', () => {
  it('createForslagD() twice gives identical furniture, as fresh objects', () => {
    const a = createForslagD();
    const b = createForslagD();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.variants[0].furniture).toEqual(b.variants[0].furniture);
    expect(a.variants[0].furniture[0]).not.toBe(b.variants[0].furniture[0]);
    expect(a.variants[0].furniture[0].position).not.toBe(b.variants[0].furniture[0].position);
    expect(buildFurniture()).toEqual(variant.furniture);
  });

  it('stable readable ids, known catalogue entries and presets, sane sizes and levels', () => {
    const ids = variant.furniture.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const levelIds = new Set(variant.levels.map((l) => l.id));
    for (const f of variant.furniture) {
      expect(f.id).toMatch(/^fu-[a-z0-9-]+-\d+$/);
      const c = catalogItem(f.catalogId);
      expect(c, f.id).not.toBeNull();
      expect(c?.sizes.some((s) => s.key === f.sizeVariant), f.id).toBe(true);
      for (const v of [f.size.w, f.size.d, f.size.h]) expect(v > 0 && v <= 5, f.id).toBe(true);
      expect(levelIds.has(f.levelId), f.id).toBe(true);
      expect([0, 90, 180, 270]).toContain(f.rotationDeg);
    }
  });

  it('ports the old layout: beds, kitchen, dining, living room, leseskrok, baths, sauna, storage, outdoor lounge', () => {
    const count = (catalogId: string) => variant.furniture.filter((f) => f.catalogId === catalogId).length;
    expect(count('seng-90') + count('seng-150') + count('seng-180')).toBe(4);
    expect([count('hoyskap'), count('benkeskap'), count('kjokkenoy')]).toEqual([1, 1, 1]);
    expect([count('spisebord-8'), count('stol')]).toEqual([1, 7]);
    expect([count('hjornesofa'), count('vedovn')]).toEqual([1, 2]);
    expect(variant.furniture.filter((f) => f.id.startsWith('fu-leseskrok-')).map((f) => f.catalogId).sort()).toEqual(
      ['bokhylle', 'lenestol', 'lenestol', 'salongbord', 'teppe'].sort(),
    );
    expect([count('toalett'), count('servant'), count('vaskesoyle'), count('dusj-90'), count('dusjvegg')]).toEqual([4, 3, 1, 1, 1]);
    expect([count('badstubenk'), count('badstuovn'), count('garderobeskap'), count('varmtvannsbereder'), count('vedstabel')]).toEqual([1, 1, 1, 1, 1]);
    expect(variant.furniture.filter((f) => f.catalogId === 'hylle').map((f) => f.id)).toEqual([
      'fu-bod-1',
      'fu-pantry-1',
      'fu-pantry-2',
      'fu-bod-ny-1',
      'fu-bod-ny-2',
    ]);
    expect([count('loungesofa'), count('utebord'), count('utestol')]).toEqual([1, 1, 2]);
  });

  it('every item stands in a room of its level, or (outdoor furniture) on the deck', () => {
    const deck = derived.outdoor.decks[0];
    for (const df of derived.furniture) {
      const f = df.item;
      if (catalogItem(f.catalogId)?.category === 'ute') {
        expect(df.roomId, f.id).toBeUndefined();
        expect(pointInPolygon(f.position, deck.pieces[0][0]), f.id).toBe(true);
        expect(df.floorZ, f.id).toBeCloseTo(deck.topZ, 9);
        continue;
      }
      const room = derived.rooms.find((r) => r.id === df.roomId);
      expect(room?.room, f.id).toBeDefined();
      expect(room?.levelId, f.id).toBe(f.levelId);
      expect(df.levelId, f.id).toBe(f.levelId);
      // The whole footprint inside the room (corners within 1 mm of it).
      for (const p of df.footprint) {
        const inside = pointInPolygon(p, room!.polygon) || room!.polygon.some((q, i) => distancePointSegment(p, q, room!.polygon[(i + 1) % room!.polygon.length]) < 0.001);
        // The corner sofa's back stands on the Stue / Passasje divider, its footprint reaching it.
        expect(inside, `${f.id} corner ${p}`).toBe(true);
      }
    }
  });

  it('lower-level rooms are furnished on the lower level; their floor is at −1.0', () => {
    for (const id of ['fu-sov1-1', 'fu-sov2-1', 'fu-sov3-1', 'fu-bad-1', 'fu-bad-2', 'fu-bad-3']) {
      expect(byId(id).levelId, id).toBe('lower');
      expect(derived.furniture.find((f) => f.id === id)?.floorZ, id).toBe(-1);
    }
  });

  it('the derived seed has no furniture warnings, no collisions and no blocked doors', () => {
    expect(derived.warnings.filter((w) => w.kind.startsWith('furniture-') || w.kind === 'door-blocked')).toEqual([]);
    for (const df of derived.furniture) {
      expect(df.collisions, df.id).toEqual([]);
      expect(df.blocksDoors, df.id).toEqual([]);
    }
  });

  it('the 27 rooms are unchanged by the furniture (the same derived rooms)', () => {
    const bare = produce(variant, (v) => {
      v.furniture = [];
    });
    const d0 = deriveVariant(bare, project.site, null);
    expect(derived.rooms).toBe(d0.rooms);
    expect(derived.rooms.filter((r) => r.room)).toHaveLength(27);
  });

  it('backs stand on an inner face of their room (snapped within 0.15 m when ported)', () => {
    for (const df of derived.furniture) {
      const f = df.item;
      const c = catalogItem(f.catalogId);
      // Free-standing entries, outdoor furniture, and the fireplace (its back is on the chimney) are not wall-backed.
      if (!c || c.snap === 'free' || c.category === 'ute' || f.id === 'fu-stue-1') continue;
      const room = derived.rooms.find((r) => r.id === df.roomId)!;
      const [p, q] = backEdge(f);
      const onFace = room.polygon.some((a, i) => {
        const b = room.polygon[(i + 1) % room.polygon.length];
        const line = (x: Vec2) => {
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const L = Math.hypot(dx, dy);
          return L < 1e-9 ? Infinity : Math.abs((x[0] - a[0]) * dy - (x[1] - a[1]) * dx) / L;
        };
        return line(p) < 0.001 && line(q) < 0.001 && (distancePointSegment(p, a, b) < 0.001 || distancePointSegment(q, a, b) < 0.001);
      });
      expect(onFace, f.id).toBe(true);
    }
    // The fireplace's back is on the chimney's south face.
    expect(backEdge(byId('fu-stue-1'))[0][1]).toBeCloseTo(2.48, 9);
  });

  it('toilets: the lower bathroom one faces the room; WC and Hovedbad back to back at x 18.6', () => {
    const lower = byId('fu-bad-1');
    const [p, q] = backEdge(lower);
    expect(p[1]).toBeCloseTo(6.04, 9);
    expect(q[1]).toBeCloseTo(6.04, 9);
    expect(lower.position[1]).toBeLessThan(6.04);
    const wc = backEdge(byId('fu-wc-1'));
    const bath = backEdge(byId('fu-hovedbad-1'));
    expect(wc[0][0]).toBeCloseTo(18.54, 9);
    expect(bath[0][0]).toBeCloseTo(18.66, 9);
    expect(byId('fu-wc-1').position[1]).toBe(byId('fu-hovedbad-1').position[1]);
  });
});

/**
 * Fallbacks when polygon-clipping fails: with every boolean operation throwing, deriveVariant must still return a
 * usable model (rooms found and named, roofs, floors, finite areas) plus 'generic' geometry-fallback warnings; with
 * every FIRST attempt throwing, the retry on the next snap grid gives the normal result without warnings.
 */
import { describe, expect, it, vi } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import { GEOMETRY_FALLBACK, deriveVariant } from './derive';

const state = vi.hoisted(() => ({ mode: 'off' as 'off' | 'always' | 'alternate', calls: 0 }));

vi.mock('polygon-clipping', async (importOriginal) => {
  type Op = (...args: unknown[]) => unknown;
  const actual = ((await importOriginal()) as { default: Record<'union' | 'intersection' | 'difference' | 'xor', Op> }).default;
  const wrap =
    (fn: Op): Op =>
    (...args) => {
      state.calls++;
      if (state.mode === 'always' || (state.mode === 'alternate' && state.calls % 2 === 1)) throw new Error('mocked polygon-clipping failure');
      return fn(...args);
    };
  return {
    default: { union: wrap(actual.union), intersection: wrap(actual.intersection), difference: wrap(actual.difference), xor: wrap(actual.xor) },
  };
});

function derive(mode: typeof state.mode) {
  state.mode = mode;
  state.calls = 0;
  try {
    const p = createForslagD();
    return deriveVariant(p.variants[0], p.site, null);
  } finally {
    state.mode = 'off';
  }
}

describe('deriveVariant when polygon-clipping fails', () => {
  const normal = derive('off');

  it('every operation failing: no throw, rooms still found and named, warnings say what fell back', () => {
    const d = derive('always');
    expect(d.rooms.filter((r) => r.room).length).toBe(27);
    expect(d.warnings.filter((w) => w.kind === 'room-anchor-lost' || w.kind === 'room-unnamed')).toEqual([]);
    const generic = d.warnings.filter((w) => w.kind === 'generic');
    expect(generic.length).toBeGreaterThan(0);
    for (const w of generic) if (w.kind === 'generic') expect(w.message.startsWith(GEOMETRY_FALLBACK)).toBe(true);
    // Rooms fall back to their wall-axis faces (a bit larger than the inner faces).
    const stue = d.rooms.find((r) => r.id === 'room-stue')!;
    expect(stue.area).toBeGreaterThan(normal.rooms.find((r) => r.id === 'room-stue')!.area);
    expect(generic.some((w) => w.kind === 'generic' && w.message.includes('"Stue"'))).toBe(true);
    expect(d.roofs).toHaveLength(4);
    expect(d.roofs.every((r) => r.slopes.length > 0 && r.outline.length >= 3)).toBe(true);
    expect(d.walls.length).toBe(normal.walls.length);
    expect(d.floors.some((f) => f.kind === 'room')).toBe(true);
    expect(d.wallUnion.length).toBeGreaterThan(0);
    for (const v of [d.areas.bya.total, d.areas.bra.total, d.areas.axis.total]) expect(Number.isFinite(v) && v > 0).toBe(true);
  });

  it('every first attempt failing: the retry on a coarser grid gives the normal result', () => {
    const d = derive('alternate');
    expect(state.calls).toBeGreaterThan(100); // the mock really ran (half of the calls failed)
    expect(d.warnings).toEqual(normal.warnings);
    const before = new Map(normal.rooms.map((r) => [r.id, r.area]));
    for (const r of d.rooms) expect(r.area, r.id).toBeCloseTo(before.get(r.id)!, 4);
    expect(d.areas.bra.total).toBeCloseTo(normal.areas.bra.total, 3);
  });
});

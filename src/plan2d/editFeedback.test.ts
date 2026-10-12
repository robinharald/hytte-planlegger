import { describe, expect, it } from 'vitest';
import { EMPTY_FEEDBACK, chipText, isVec2, normalizeFeedback, normalizeSnap, readGhost, resultId, sessionOrNull } from './editFeedback';

describe('normalizeFeedback', () => {
  it('reads markers, guides, chips and a ghost ring', () => {
    const fb = normalizeFeedback({
      indicators: [{ kind: 'endpoint', p: [1, 2] }, { type: 'extension', a: [0, 0], b: [5, 0] }, { point: [3, 3] }, { kind: 'bogus' }, null, 7],
      chips: [{ a: [0, 0], b: [1.2, 0], value: 1.2 }, { a: [0, 1], b: [0, 3] }, { at: [4, 4], text: 'venstre 0,85' }, { a: [0, 0] }],
      ghost: [
        [0, 0],
        [2, 0],
        [2, 1],
      ],
    });
    expect(fb.markers).toEqual([
      { kind: 'endpoint', p: [1, 2] },
      { kind: 'point', p: [3, 3] },
    ]);
    expect(fb.guides).toEqual([{ kind: 'extension', a: [0, 0], b: [5, 0] }]);
    expect(fb.chips).toEqual([
      { a: [0, 0], b: [1.2, 0], at: [0.6, 0], text: '1,20 m' },
      { a: [0, 1], b: [0, 3], at: [0, 2], text: '2,00 m' },
      { at: [4, 4], text: 'venstre 0,85' },
    ]);
    expect(fb.ghost).toEqual([
      [
        [0, 0],
        [2, 0],
        [2, 1],
      ],
    ]);
  });

  it('tolerates missing or malformed parts', () => {
    expect(normalizeFeedback(undefined)).toBe(EMPTY_FEEDBACK);
    expect(normalizeFeedback(null)).toBe(EMPTY_FEEDBACK);
    expect(normalizeFeedback([1, 2])).toBe(EMPTY_FEEDBACK);
    expect(normalizeFeedback({})).toEqual(EMPTY_FEEDBACK);
    expect(normalizeFeedback({ indicators: 'x', chips: {}, ghost: 3 })).toEqual(EMPTY_FEEDBACK);
  });
});

describe('readGhost', () => {
  it('accepts rings, multipolygons, objects and segments', () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(readGhost(ring)).toEqual([ring]);
    expect(readGhost([ring, ring])).toEqual([ring, ring]);
    expect(readGhost([[ring]])).toEqual([ring]);
    expect(readGhost({ polygon: ring })).toEqual([ring]);
    expect(readGhost({ polygons: [ring] })).toEqual([ring]);
    expect(readGhost({ a: [0, 0], b: [2, 0] })).toEqual([
      [
        [0, 0],
        [2, 0],
      ],
    ]);
    expect(readGhost([[0, 0]])).toEqual([]);
    expect(readGhost(null)).toEqual([]);
  });
});

describe('normalizeSnap, resultId, sessionOrNull', () => {
  it('reads the snapped point or falls back', () => {
    expect(normalizeSnap({ point: [1, 2], indicators: [{ p: [1, 2] }] }, [0, 0]).point).toEqual([1, 2]);
    expect(normalizeSnap({ point: [1, 2], indicators: [{ p: [1, 2] }] }, [0, 0]).feedback.markers).toHaveLength(1);
    expect(normalizeSnap([3, 4], [0, 0])).toEqual({ point: [3, 4], feedback: EMPTY_FEEDBACK });
    expect(normalizeSnap({ snapped: [5, 6] }, [0, 0]).point).toEqual([5, 6]);
    expect(normalizeSnap(undefined, [7, 8]).point).toEqual([7, 8]);
    expect(normalizeSnap({ point: [NaN, 1] }, [7, 8]).point).toEqual([7, 8]);
  });

  it('reads ids and sessions', () => {
    expect(resultId('w-1')).toBe('w-1');
    expect(resultId({ id: 'w-2' })).toBe('w-2');
    expect(resultId('')).toBeNull();
    expect(resultId(null)).toBeNull();
    expect(resultId(undefined)).toBeNull();
    expect(sessionOrNull(null)).toBeNull();
    expect(sessionOrNull(undefined)).toBeNull();
    expect(sessionOrNull(false)).toBeNull();
    const s = { kind: 'wall' };
    expect(sessionOrNull(s)).toBe(s);
  });

  it('formats chip lengths with two decimals and a comma', () => {
    expect(chipText(1.2)).toBe('1,20 m');
    expect(chipText(0.854)).toBe('0,85 m');
    expect(isVec2([1, 2])).toBe(true);
    expect(isVec2([1])).toBe(false);
    expect(isVec2(['1', 2])).toBe(false);
  });
});

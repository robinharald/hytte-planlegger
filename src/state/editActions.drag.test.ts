/**
 * Drag performance of the editor core (fix round after phase 2a): `updateDrag` derives nothing for drags that cannot
 * change a room face (openings, the deck, steps, hot tub, trees, furniture) — no room reconciliation per frame; the
 * plan's render derives the stored variant once. Building drags still reconcile (one derive of the frame's result).
 * `deriveVariant` is wrapped (pass-through) to count the derivations.
 */
import { describe, expect, it, vi } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import * as A from './editActions';
import { createAppStore, selectActiveVariant } from './store';
import type { Selection } from './selection';

const counter = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../geometry/derive', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../geometry/derive')>();
  return {
    ...mod,
    deriveVariant: (...args: Parameters<typeof mod.deriveVariant>) => {
      counter.calls++;
      return mod.deriveVariant(...args);
    },
  };
});

function proposal() {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

/** deriveVariant calls made by three updateDrag frames of a drag of `sel` from `p0`. */
function derivesPerDrag(sel: Selection, p0: Vec2, steps: Vec2[], handle?: A.DragHandle): number {
  const store = proposal();
  const session = A.beginDrag(store, sel, p0, handle);
  expect(session).not.toBeNull();
  const before = selectActiveVariant(store.getState());
  counter.calls = 0;
  for (const p of steps) A.updateDrag(store, session, p);
  const calls = counter.calls;
  expect(selectActiveVariant(store.getState())).not.toBe(before);
  A.endDrag(store, session);
  return calls;
}

describe('updateDrag: no derive per frame for opening and outdoor drags', () => {
  it.each<[string, Selection, Vec2, Vec2[], A.DragHandle | undefined]>([
    ['opening', { kind: 'opening', id: 'door-mellom-vf' }, [7.01, 6.2], [[7.3, 6.2], [7.6, 6.2], [7.9, 6.2]], undefined],
    ['opening resize', { kind: 'opening', id: 'win-kjk-n' }, [5.4, 6.2], [[5.2, 6.2], [5.0, 6.2], [4.9, 6.2]], 'end'],
    ['hot tub', { kind: 'hotTub', id: 'tub-1' }, [21.7, -3.2], [[21, -3.2], [20, -3.2], [19, -3.2]], undefined],
    ['deck edge', { kind: 'deckEdge', id: 'deck-terrasse-v0' }, [15, -4.6], [[15, -4.8], [15, -5], [15, -5.3]], undefined],
    ['steps', { kind: 'steps', id: 'rail-terrasse/steps/0' }, [12.3, -4.6], [[13, -4.6], [14, -4.6], [15, -4.6]], undefined],
    ['tree', { kind: 'tree', id: 'tree-1' }, [-4, 4], [[-3, 4], [-2, 5], [-1, 6]], undefined],
  ])('%s', (_name, sel, p0, steps, handle) => {
    expect(derivesPerDrag(sel, p0, steps, handle)).toBe(0);
  });

  it('a wall drag still reconciles the rooms (one derive per frame)', () => {
    expect(derivesPerDrag({ kind: 'wall', id: 'w-gang-n' }, [18, 3.4], [[18, 3.6], [18, 3.8], [18, 4.0]])).toBe(3);
  });
});

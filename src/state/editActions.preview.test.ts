/**
 * The drag-preview contract (polish round, phase 2b): `previewDrag(session, pointer, modifiers)` is the cheap part of
 * `updateDrag` — the same snap and overlay plus the dragged element's target outline — with no store change and no
 * derive, ≤ 2 ms per call on the seed. The plan calls it every frame and `updateDrag` at most every T ms.
 */
import { describe, expect, it, vi } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import * as A from './editActions';
import type { Selection } from './selection';
import { createAppStore, selectActiveVariant } from './store';

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

type Store = ReturnType<typeof createAppStore>;

function proposal(): Store {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

const LAPTOP = { snapRadiusM: 12 / 23.5 };
const PHONE = { snapRadiusM: 24 / 11.6, coarse: true };

/** A store with a placed Vedskjul on the deck (free), and its id. */
function withShed(): { store: Store; id: string } {
  const store = proposal();
  const id = A.placeUnit(store, 'vedskjul', [14, 9.35], 0) as string;
  store.getState().clearHistory();
  return { store, id };
}

type Case = { name: string; setup: () => { store: Store; sel: Selection; handle?: A.DragHandle }; from: Vec2; to: Vec2[]; mods: A.DragModifiers };

const CASES: Case[] = [
  { name: 'wall w-gang-n', setup: () => ({ store: proposal(), sel: { kind: 'wall', id: 'w-gang-n' } }), from: [18, 3.4], to: [[18, 3.62], [18.1, 3.93], [18, 4.31]], mods: LAPTOP },
  { name: "the wing's east edge", setup: () => ({ store: proposal(), sel: { kind: 'blockEdge', id: 'v-wing-se' } }), from: [20.8, 4], to: [[21.13, 4], [21.47, 4.2], [20.42, 4]], mods: LAPTOP },
  {
    name: 'a Vedskjul (phone)',
    setup: () => {
      const { store, id } = withShed();
      return { store, sel: { kind: 'block', id } };
    },
    from: [14, 9.35],
    to: [[13.1, 9.4], [12.2, 9.9], [14.3, 11.3]],
    mods: PHONE,
  },
];

describe('previewDrag', () => {
  it.each(CASES)('$name: the same indicators, chips and ghost as updateDrag, and the target where updateDrag puts it', ({ setup, from, to, mods }) => {
    const { store, sel, handle } = setup();
    const session = A.beginDrag(store, sel, from, handle, { snapRadiusM: mods.snapRadiusM });
    expect(session).not.toBeNull();
    for (const p of to) {
      const before = selectActiveVariant(store.getState());
      const preview = A.previewDrag(session, p, mods);
      expect(selectActiveVariant(store.getState())).toBe(before);
      const update = A.updateDrag(store, session, p, mods);
      expect(preview.indicators).toEqual(update.indicators);
      expect(preview.chips).toEqual(update.chips);
      expect(preview.ghost).toEqual(update.ghost);
      // The target outline is where the applied drag put the element.
      const v = selectActiveVariant(store.getState());
      const actual: Vec2[] =
        sel.kind === 'wall'
          ? (() => {
              const w = v.walls.find((x) => x.id === sel.id);
              return w ? [w.a, w.b] : [];
            })()
          : sel.kind === 'blockEdge'
            ? (() => {
                const b = v.blocks.find((x) => x.polygon.some((q) => q.id === sel.id));
                const i = b ? b.polygon.findIndex((q) => q.id === sel.id) : -1;
                return b && i >= 0 ? [b.polygon[i].p, b.polygon[(i + 1) % b.polygon.length].p] : [];
              })()
            : (v.blocks.find((x) => x.id === sel.id)?.polygon.map((q) => q.p) ?? []);
      expect(preview.target).toHaveLength(1);
      expect(preview.target[0]).toHaveLength(actual.length);
      preview.target[0].forEach((q, k) => {
        expect(q[0]).toBeCloseTo(actual[k][0], 9);
        expect(q[1]).toBeCloseTo(actual[k][1], 9);
      });
    }
    A.endDrag(store, session);
  });

  it('derives nothing, changes nothing and costs at most 2 ms per call (median of 40)', () => {
    for (const { setup, from, to, mods, name } of CASES) {
      const { store, sel, handle } = setup();
      const session = A.beginDrag(store, sel, from, handle, { snapRadiusM: mods.snapRadiusM });
      const before = store.getState().project;
      counter.calls = 0;
      const times: number[] = [];
      for (let k = 0; k < 40; k++) {
        const p = to[k % to.length];
        const t0 = performance.now();
        A.previewDrag(session, [p[0] + k * 0.003, p[1]], mods);
        times.push(performance.now() - t0);
      }
      expect(counter.calls, name).toBe(0);
      expect(store.getState().project, name).toBe(before);
      times.sort((a, b) => a - b);
      expect(times[20], `${name}: median ${times[20].toFixed(3)} ms`).toBeLessThanOrEqual(2);
      A.cancelDrag(store, session);
    }
  });

  it('a null or ended session gives the empty preview; the bound action takes (session, pointer, modifiers)', () => {
    const store = proposal();
    expect(A.previewDrag(null, [0, 0])).toEqual(A.EMPTY_PREVIEW);
    const session = A.beginDrag(store, { kind: 'wall', id: 'w-gang-n' }, [18, 3.4]);
    const bound = A.bindEditActions(store);
    expect(bound.previewDrag(session, [18, 3.7], LAPTOP).target).toHaveLength(1);
    A.endDrag(store, session);
    expect(bound.previewDrag(session, [18, 3.7], LAPTOP)).toEqual(A.EMPTY_PREVIEW);
  });

  it('every other drag kind previews its target too (opening, endpoint, corner, deck, steps, hot tub, tree)', () => {
    const store = proposal();
    const deck = selectActiveVariant(store.getState()).outdoor.decks[0];
    const kinds: [Selection, Vec2, Vec2, A.DragHandle?][] = [
      [{ kind: 'opening', id: 'door-mellom-vf' }, [7.01, 6.2], [7.5, 6.2]],
      [{ kind: 'opening', id: 'win-kjk-n' }, [5.4, 6.2], [5.0, 6.2], 'end'],
      [{ kind: 'wall', id: 'w-vf-korr' }, [9, 4.24], [9, 4.6], 'b'],
      [{ kind: 'blockVertex', id: 'v-wing-ne' }, [20.8, 6.2], [21.1, 6.5]],
      [{ kind: 'deckEdge', id: deck.polygon[0].id }, [15, -4.6], [15, -5]],
      [{ kind: 'deckVertex', id: deck.polygon[1].id }, deck.polygon[1].p, [deck.polygon[1].p[0] + 0.5, deck.polygon[1].p[1]]],
      [{ kind: 'deck', id: deck.id }, [12, 8], [12.5, 8]],
      [{ kind: 'steps', id: deck.steps[0].id }, [12.3, -4.6], [13, -4.6]],
      [{ kind: 'hotTub', id: 'tub-1' }, [21.7, -3.2], [21, -3.2]],
      [{ kind: 'tree', id: 'tree-1' }, [-4, 4], [-3, 4]],
    ];
    for (const [sel, from, to, handle] of kinds) {
      const session = A.beginDrag(store, sel, from, handle, LAPTOP);
      expect(session, `${sel.kind} ${sel.id}`).not.toBeNull();
      const preview = A.previewDrag(session, to, LAPTOP);
      expect(preview.target.length, `${sel.kind} ${sel.id}`).toBeGreaterThan(0);
      expect(preview.ghost.length, `${sel.kind} ${sel.id}`).toBeGreaterThan(0);
      A.cancelDrag(store, session);
    }
  });
});

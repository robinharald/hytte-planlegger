/** Phase-2 store additions: replaceVariant, updateSite, transactionBase, toasts, tool state. */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createAppStore, DEFAULT_UI, selectActiveVariant, TOAST_LIMIT } from './store';
import { makeTestProject } from './testProject';

const setup = () => createAppStore(makeTestProject());

describe('replaceVariant / updateSite', () => {
  it('stores the object as-is, one history entry; identical object is a no-op', () => {
    const s = setup();
    const v = selectActiveVariant(s.getState());
    s.getState().replaceVariant(v.id, v);
    expect(s.temporal.getState().pastStates).toHaveLength(0);
    const next = produce(v, (d) => {
      d.name = 'Ny';
    });
    s.getState().replaceVariant(v.id, next);
    expect(selectActiveVariant(s.getState())).toBe(next);
    expect(s.temporal.getState().pastStates).toHaveLength(1);
    s.getState().undo();
    expect(selectActiveVariant(s.getState()).name).toBe(v.name);
  });

  it('the same transaction label merges consecutive calls into one undo step', () => {
    const s = setup();
    for (const name of ['A', 'B', 'C']) {
      const v = selectActiveVariant(s.getState());
      s.getState().replaceVariant(
        v.id,
        produce(v, (d) => {
          d.name = name;
        }),
        { transaction: 'nudge:x' },
      );
    }
    expect(s.temporal.getState().pastStates).toHaveLength(1);
  });

  it('read-only: nothing changes', () => {
    const s = createAppStore(makeTestProject(), { readOnly: true });
    const v = selectActiveVariant(s.getState());
    s.getState().replaceVariant(
      v.id,
      produce(v, (d) => {
        d.name = 'X';
      }),
    );
    s.getState().updateSite((site) => {
      site.trees.push({ id: 't', position: [0, 0], height: 5, kind: 'bjork' });
    });
    expect(selectActiveVariant(s.getState())).toBe(v);
    expect(s.getState().project.site.trees).toHaveLength(0);
  });

  it('updateSite edits the site with a history entry', () => {
    const s = setup();
    s.getState().updateSite((site) => {
      site.trees.push({ id: 't', position: [0, 0], height: 5, kind: 'bjork' });
    });
    expect(s.getState().project.site.trees).toHaveLength(1);
    expect(s.getState().canUndo).toBe(true);
  });
});

describe('transactionBase', () => {
  it('is the project at beginTransaction, null outside', () => {
    const s = setup();
    expect(s.getState().transactionBase()).toBeNull();
    const p = s.getState().project;
    s.getState().beginTransaction('drag');
    expect(s.getState().transactionBase()).toBe(p);
    s.getState().cancelTransaction();
    expect(s.getState().transactionBase()).toBeNull();
  });
});

describe('toasts and tool state', () => {
  it('show / refresh / limit / dismiss, never in the history', () => {
    const s = setup();
    const a = s.getState().showToast({ text: 'Slettet.', undo: true });
    expect(s.getState().showToast({ text: 'Slettet.', undo: true })).toBe(a);
    expect(s.getState().toasts).toEqual([{ id: a, text: 'Slettet.', undo: true, seq: 1 }]);
    for (let i = 0; i < 5; i++) s.getState().showToast({ text: `t${i}` });
    expect(s.getState().toasts).toHaveLength(TOAST_LIMIT);
    expect(s.getState().toasts.map((t) => t.text)).toEqual(['t2', 't3', 't4']);
    s.getState().dismissToast(s.getState().toasts[0].id);
    expect(s.getState().toasts).toHaveLength(2);
    expect(s.temporal.getState().pastStates).toHaveLength(0);
  });

  it('defaults: Velg, no options, no clearances, no hint', () => {
    expect(DEFAULT_UI).toMatchObject({ tool: 'select', toolOptions: {}, showClearances: false, hint: null });
    const s = setup();
    s.getState().setUi({ tool: 'unit', toolOptions: { unitTemplate: 'vedskjul', unitRotation90: 1 }, hint: 'Trykk der bygget skal stå' });
    expect(s.getState().ui).toMatchObject({ tool: 'unit', toolOptions: { unitTemplate: 'vedskjul' } });
    expect(s.temporal.getState().pastStates).toHaveLength(0);
  });
});

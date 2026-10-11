import { describe, expect, it } from 'vitest';
import { CAMERA_PRESET_KEYS, createAppStore, DEFAULT_UI, defaultActiveView, EYE_LEVEL_CUT, nextStamp, presetUi, selectActiveVariant, SPLIT_MIN_WIDTH } from './store';
import { makeTestProject, makeVariant } from './testProject';

function setup(ui = {}) {
  return createAppStore(makeTestProject(), ui);
}

const roomName = (s: ReturnType<typeof setup>, id = 'room-1') =>
  selectActiveVariant(s.getState()).rooms.find((r) => r.id === id)?.name;

describe('initial state', () => {
  it('starts with the project, default ui and empty history', () => {
    const s = setup();
    expect(s.getState().project.id).toBe('test-project');
    expect(s.getState().ui).toEqual(DEFAULT_UI);
    expect(s.getState().canUndo).toBe(false);
    expect(s.getState().canRedo).toBe(false);
  });

  it('merges a partial initial ui', () => {
    const s = setup({ activeView: 'plan', readOnly: true });
    expect(s.getState().ui.activeView).toBe('plan');
    expect(s.getState().ui.readOnly).toBe(true);
    expect(s.getState().ui.cutHeight).toBe(DEFAULT_UI.cutHeight);
  });
});

describe('project actions and undo/redo', () => {
  it('renameRoom creates one history entry and undo/redo restore it', () => {
    const s = setup();
    s.getState().renameRoom('room-1', 'Storstue');
    expect(roomName(s)).toBe('Storstue');
    expect(s.getState().canUndo).toBe(true);
    s.getState().undo();
    expect(roomName(s)).toBe('Stue');
    expect(s.getState().canUndo).toBe(false);
    expect(s.getState().canRedo).toBe(true);
    s.getState().redo();
    expect(roomName(s)).toBe('Storstue');
    expect(s.getState().canRedo).toBe(false);
  });

  it('renameRoom ignores blank names, unknown rooms and unchanged names', () => {
    const s = setup();
    s.getState().renameRoom('room-1', '   ');
    s.getState().renameRoom('nope', 'X');
    s.getState().renameRoom('room-1', 'Stue');
    expect(s.temporal.getState().pastStates).toHaveLength(0);
    s.getState().renameRoom('room-1', '  Peisestue ');
    expect(roomName(s)).toBe('Peisestue');
  });

  it('updates updatedAt on edits', () => {
    const s = setup();
    const before = s.getState().project.updatedAt;
    s.getState().renameRoom('room-1', 'Storstue');
    expect(s.getState().project.updatedAt).not.toBe(before);
  });

  it('setUi and select never create history entries', () => {
    const s = setup();
    s.getState().setUi({ showGrid: false, cutHeight: 2 });
    s.getState().select({ kind: 'room', id: 'room-1' });
    expect(s.getState().ui.showGrid).toBe(false);
    expect(s.getState().ui.selection).toEqual({ kind: 'room', id: 'room-1' });
    expect(s.temporal.getState().pastStates).toHaveLength(0);
    expect(s.getState().canUndo).toBe(false);
  });

  it('a new edit clears the redo stack', () => {
    const s = setup();
    s.getState().renameRoom('room-1', 'A');
    s.getState().undo();
    expect(s.getState().canRedo).toBe(true);
    s.getState().renameRoom('room-1', 'B');
    expect(s.getState().canRedo).toBe(false);
  });

  it('undo clears the selection without adding history', () => {
    const s = setup();
    s.getState().renameRoom('room-1', 'A');
    s.getState().select({ kind: 'room', id: 'room-1' });
    s.getState().undo();
    expect(s.getState().ui.selection).toBeNull();
    expect(s.temporal.getState().pastStates).toHaveLength(0);
    expect(s.temporal.getState().futureStates).toHaveLength(1);
  });

  it('undo/redo with empty stacks are harmless', () => {
    const s = setup();
    s.getState().undo();
    s.getState().redo();
    expect(s.getState().project.id).toBe('test-project');
  });

  it('respects the history limit', () => {
    const s = createAppStore(makeTestProject(), {}, { historyLimit: 3 });
    for (let i = 0; i < 6; i++) s.getState().renameRoom('room-1', `Navn ${i}`);
    expect(s.temporal.getState().pastStates).toHaveLength(3);
  });

  it('updateVariant with the same transaction label collapses into one entry', () => {
    const s = setup();
    for (const h of [2.5, 2.6, 2.7]) {
      s.getState().updateActiveVariant(
        (v) => {
          v.blocks[0].eaveHeight = h;
        },
        { transaction: 'eave' },
      );
    }
    expect(s.temporal.getState().pastStates).toHaveLength(1);
    expect(selectActiveVariant(s.getState()).blocks[0].eaveHeight).toBe(2.7);
    s.getState().undo();
    expect(selectActiveVariant(s.getState()).blocks[0].eaveHeight).toBe(2.22);
  });

  it('a different action ends a transaction group', () => {
    const s = setup();
    s.getState().updateActiveVariant((v) => void (v.blocks[0].eaveHeight = 2.5), { transaction: 'eave' });
    s.getState().renameRoom('room-1', 'X');
    s.getState().updateActiveVariant((v) => void (v.blocks[0].eaveHeight = 2.6), { transaction: 'eave' });
    expect(s.temporal.getState().pastStates).toHaveLength(3);
  });

  it('updateVariant on an unknown variant changes nothing', () => {
    const s = setup();
    const before = s.getState().project;
    s.getState().updateVariant('nope', (v) => void (v.name = 'X'));
    expect(s.getState().project).toBe(before);
    expect(s.getState().canUndo).toBe(false);
  });
});

describe('transactions', () => {
  it('begin/commit produce exactly one history entry for many edits', () => {
    const s = setup();
    s.getState().beginTransaction('drag');
    expect(s.getState().inTransaction()).toBe(true);
    for (let i = 1; i <= 10; i++) {
      s.getState().updateActiveVariant((v) => {
        v.blocks[0].polygon[1].p = [6 + i * 0.1, 0];
      });
    }
    expect(s.temporal.getState().pastStates).toHaveLength(0);
    s.getState().commitTransaction();
    expect(s.getState().inTransaction()).toBe(false);
    expect(s.temporal.getState().pastStates).toHaveLength(1);
    expect(selectActiveVariant(s.getState()).blocks[0].polygon[1].p).toEqual([7, 0]);
    s.getState().undo();
    expect(selectActiveVariant(s.getState()).blocks[0].polygon[1].p).toEqual([6, 0]);
    s.getState().redo();
    expect(selectActiveVariant(s.getState()).blocks[0].polygon[1].p).toEqual([7, 0]);
  });

  it('an empty transaction adds nothing', () => {
    const s = setup();
    s.getState().beginTransaction('noop');
    s.getState().commitTransaction();
    expect(s.temporal.getState().pastStates).toHaveLength(0);
  });

  it('cancelTransaction restores the start without history', () => {
    const s = setup();
    s.getState().renameRoom('room-1', 'Før');
    s.getState().beginTransaction('drag');
    s.getState().renameRoom('room-1', 'Under');
    s.getState().cancelTransaction();
    expect(roomName(s)).toBe('Før');
    expect(s.temporal.getState().pastStates).toHaveLength(1);
    // Tracking works again afterwards.
    s.getState().renameRoom('room-1', 'Etter');
    expect(s.temporal.getState().pastStates).toHaveLength(2);
  });

  it('undo is blocked during a transaction; a second begin commits the first', () => {
    const s = setup();
    s.getState().beginTransaction('a');
    s.getState().renameRoom('room-1', 'A');
    s.getState().undo();
    expect(roomName(s)).toBe('A');
    s.getState().beginTransaction('b');
    s.getState().renameRoom('room-1', 'B');
    s.getState().commitTransaction();
    expect(s.temporal.getState().pastStates).toHaveLength(2);
    s.getState().undo();
    expect(roomName(s)).toBe('A');
    s.getState().undo();
    expect(roomName(s)).toBe('Stue');
  });

  it('commit without begin is a no-op', () => {
    const s = setup();
    s.getState().commitTransaction();
    s.getState().cancelTransaction();
    expect(s.temporal.getState().pastStates).toHaveLength(0);
  });
});

describe('variants', () => {
  it('duplicateVariant deep-copies with a new variant id only and activates the copy', () => {
    const s = setup();
    const id = s.getState().duplicateVariant('v-1', 'Forslag E');
    expect(id).toBeTruthy();
    const { project } = s.getState();
    expect(project.variants).toHaveLength(2);
    expect(project.activeVariantId).toBe(id);
    const [orig, copy] = project.variants;
    expect(copy.id).toBe(id);
    expect(copy.id).not.toBe(orig.id);
    expect(copy.name).toBe('Forslag E');
    expect(copy.basedOnId).toBe('v-1');
    expect(copy.blocks[0].id).toBe(orig.blocks[0].id);
    expect(copy.rooms.map((r) => r.id)).toEqual(orig.rooms.map((r) => r.id));
    expect(copy.blocks[0]).not.toBe(orig.blocks[0]);
    // Editing the copy leaves the original alone.
    s.getState().renameRoom('room-1', 'Kopistue');
    expect(s.getState().project.variants[0].rooms[0].name).toBe('Stue');
    expect(s.getState().project.variants[1].rooms[0].name).toBe('Kopistue');
    // One undo removes the edit, the next the duplicate.
    s.getState().undo();
    s.getState().undo();
    expect(s.getState().project.variants).toHaveLength(1);
    expect(s.getState().project.activeVariantId).toBe('v-1');
  });

  it('duplicateVariant uses "(kopi)" for a blank name and returns null for unknown ids', () => {
    const s = setup();
    s.getState().duplicateVariant('v-1', '  ');
    expect(s.getState().project.variants[1].name).toBe('Forslag D (kopi)');
    expect(s.getState().duplicateVariant('nope', 'x')).toBeNull();
  });

  it('setActiveVariant switches, clears selection and ignores unknown ids', () => {
    const s = createAppStore(makeTestProject({ variants: [makeVariant('v-1', 'A'), makeVariant('v-2', 'B')] }));
    s.getState().select({ kind: 'room', id: 'room-1' });
    s.getState().setActiveVariant('v-2');
    expect(s.getState().project.activeVariantId).toBe('v-2');
    expect(s.getState().ui.selection).toBeNull();
    s.getState().setActiveVariant('nope');
    expect(s.getState().project.activeVariantId).toBe('v-2');
  });

  it('renameVariant and deleteVariant (never the last one)', () => {
    const s = createAppStore(makeTestProject({ variants: [makeVariant('v-1', 'A'), makeVariant('v-2', 'B')], activeVariantId: 'v-2' }));
    s.getState().renameVariant('v-2', ' C ');
    expect(s.getState().project.variants[1].name).toBe('C');
    s.getState().deleteVariant('v-2');
    expect(s.getState().project.variants.map((v) => v.id)).toEqual(['v-1']);
    expect(s.getState().project.activeVariantId).toBe('v-1');
    s.getState().deleteVariant('v-1');
    expect(s.getState().project.variants).toHaveLength(1);
    s.getState().undo();
    expect(s.getState().project.variants).toHaveLength(2);
    expect(s.getState().project.activeVariantId).toBe('v-2');
  });

  it('addVariant appends, optionally activates and records the seed revision', () => {
    const s = setup();
    s.getState().addVariant(makeVariant('v-new', 'Ny'), { activate: true, seedRevision: 7 });
    expect(s.getState().project.activeVariantId).toBe('v-new');
    expect(s.getState().project.seedRevision).toBe(7);
    s.getState().addVariant(makeVariant('v-new', 'Duplikat'));
    expect(s.getState().project.variants).toHaveLength(2);
  });
});

describe('read-only', () => {
  it('makes project actions, undo and transactions no-ops', () => {
    const s = setup({ readOnly: true });
    const before = s.getState().project;
    s.getState().renameRoom('room-1', 'X');
    s.getState().setProject(makeTestProject({ name: 'Annet' }));
    s.getState().updateActiveVariant((v) => void (v.name = 'X'));
    expect(s.getState().duplicateVariant('v-1', 'X')).toBeNull();
    s.getState().renameVariant('v-1', 'X');
    s.getState().addVariant(makeVariant('v-2', 'B'));
    s.getState().beginTransaction('x');
    expect(s.getState().inTransaction()).toBe(false);
    expect(s.getState().project).toBe(before);
    expect(s.getState().canUndo).toBe(false);
  });

  it('still lets a viewer switch variants, without history', () => {
    const p = makeTestProject({ variants: [makeVariant('v-1', 'A'), makeVariant('v-2', 'B')] });
    const s = createAppStore(p, { readOnly: true });
    s.getState().setActiveVariant('v-2');
    expect(s.getState().project.activeVariantId).toBe('v-2');
    expect(s.getState().project.updatedAt).toBe(p.updatedAt);
    expect(s.temporal.getState().pastStates).toHaveLength(0);
  });

  it('replaceProject is unguarded, patches ui and clears history', () => {
    const s = setup();
    s.getState().renameRoom('room-1', 'X');
    s.getState().select({ kind: 'room', id: 'room-1' });
    s.getState().replaceProject(makeTestProject({ id: 'other' }), { readOnly: true, source: 'link' });
    expect(s.getState().project.id).toBe('other');
    expect(s.getState().ui.readOnly).toBe(true);
    expect(s.getState().ui.source).toBe('link');
    expect(s.getState().ui.selection).toBeNull();
    expect(s.getState().canUndo).toBe(false);
    s.getState().replaceProject(makeTestProject({ id: 'mine' }), { readOnly: false, source: 'local' });
    s.getState().renameRoom('room-1', 'Y');
    expect(s.getState().canUndo).toBe(true);
  });

  it('replaceProject during a transaction ends it', () => {
    const s = setup();
    s.getState().beginTransaction('drag');
    s.getState().replaceProject(makeTestProject({ id: 'other' }));
    expect(s.getState().inTransaction()).toBe(false);
    s.getState().renameRoom('room-1', 'Z');
    expect(s.temporal.getState().pastStates).toHaveLength(1);
  });
});

describe('review fixes', () => {
  it('a later updateVariant with the label of a committed transaction gets its own undo step', () => {
    const s = setup();
    const id = s.getState().project.activeVariantId;
    s.getState().beginTransaction('slider');
    s.getState().updateVariant(id, (v) => void (v.name = 'A'), { transaction: 'slider' });
    s.getState().commitTransaction();
    expect(s.temporal.getState().pastStates).toHaveLength(1);
    s.getState().updateVariant(id, (v) => void (v.name = 'B'), { transaction: 'slider' });
    expect(s.temporal.getState().pastStates).toHaveLength(2);
    s.getState().undo();
    expect(selectActiveVariant(s.getState()).name).toBe('A');
  });

  it('the same after a cancelled transaction', () => {
    const s = setup();
    const id = s.getState().project.activeVariantId;
    s.getState().updateVariant(id, (v) => void (v.name = 'A'), { transaction: 'slider' });
    s.getState().beginTransaction('slider');
    s.getState().updateVariant(id, (v) => void (v.name = 'X'), { transaction: 'slider' });
    s.getState().cancelTransaction();
    s.getState().updateVariant(id, (v) => void (v.name = 'B'), { transaction: 'slider' });
    expect(s.temporal.getState().pastStates).toHaveLength(2);
  });

  it('undo, redo and setProject give the project a fresh, strictly later updatedAt without history entries', () => {
    const s = setup();
    s.getState().renameRoom('room-1', 'A');
    const edited = s.getState().project.updatedAt;
    s.getState().undo();
    const undone = s.getState().project.updatedAt;
    expect(Date.parse(undone)).toBeGreaterThan(Date.parse(edited));
    expect(s.temporal.getState().pastStates).toHaveLength(0);
    expect(s.temporal.getState().futureStates).toHaveLength(1);
    s.getState().redo();
    expect(Date.parse(s.getState().project.updatedAt)).toBeGreaterThan(Date.parse(undone));
    expect(roomName(s)).toBe('A');
    const old = makeTestProject({ name: 'Gammel', updatedAt: '2001-01-01T00:00:00.000Z' });
    s.getState().setProject(old);
    expect(s.getState().project.name).toBe('Gammel');
    expect(s.getState().project.updatedAt).not.toBe(old.updatedAt);
    expect(old.updatedAt).toBe('2001-01-01T00:00:00.000Z');
    expect(s.temporal.getState().pastStates).toHaveLength(2);
  });

  it('nextStamp is strictly increasing and later than its arguments', () => {
    const a = nextStamp();
    const b = nextStamp();
    expect(b > a).toBe(true);
    expect(nextStamp('2999-01-01T00:00:00.000Z')).toBe('2999-01-01T00:00:00.001Z');
  });

  it('addVariants adds several variants as one undo step and activates one', () => {
    const s = setup();
    s.getState().addVariants([makeVariant('v-a', 'A'), makeVariant('v-b', 'B'), makeVariant('v-1', 'Duplikat')], { activeId: 'v-b' });
    expect(s.getState().project.variants.map((v) => v.id)).toEqual(['v-1', 'v-a', 'v-b']);
    expect(s.getState().project.activeVariantId).toBe('v-b');
    expect(s.temporal.getState().pastStates).toHaveLength(1);
    s.getState().undo();
    expect(s.getState().project.variants).toHaveLength(1);
    s.getState().addVariants([]);
    expect(s.temporal.getState().pastStates).toHaveLength(0);
  });

  it('replaceProject can bring back saved undo/redo stacks', () => {
    const s = setup();
    s.getState().renameRoom('room-1', 'A');
    s.getState().renameRoom('room-1', 'B');
    s.getState().undo();
    const kept = { project: s.getState().project, history: s.getState().history() };
    expect(kept.history.past).toHaveLength(1);
    expect(kept.history.future).toHaveLength(1);
    s.getState().replaceProject(makeTestProject({ id: 'shared' }), { readOnly: true });
    expect(s.getState().canUndo).toBe(false);
    s.getState().replaceProject(kept.project, { readOnly: false }, kept.history);
    expect(s.getState().canUndo).toBe(true);
    expect(s.getState().canRedo).toBe(true);
    s.getState().redo();
    expect(roomName(s)).toBe('B');
    s.getState().undo();
    s.getState().undo();
    expect(roomName(s)).toBe('Stue');
  });

  it('defaults: plan view below 1600 px, "Begge" from 1600 px; cut height 1.3; langsiden preset', () => {
    expect(defaultActiveView(1400)).toBe('plan');
    expect(defaultActiveView(375)).toBe('plan');
    expect(defaultActiveView(SPLIT_MIN_WIDTH)).toBe('split');
    expect(DEFAULT_UI.activeView).toBe('plan');
    expect(DEFAULT_UI.activeViewChosen).toBe(false);
    expect(DEFAULT_UI.cutHeight).toBe(1.3);
    expect(CAMERA_PRESET_KEYS).toContain('langsiden');
  });

  it("'inne-stua' raises a cut height below eye level to 2.3; other presets keep it", () => {
    expect(presetUi('inne-stua', { cutHeight: 1.3 })).toEqual({ preset: 'inne-stua', cutHeight: EYE_LEVEL_CUT });
    expect(presetUi('inne-stua', { cutHeight: 2.5 })).toEqual({ preset: 'inne-stua' });
    expect(presetUi('oversikt', { cutHeight: 1.3 })).toEqual({ preset: 'oversikt' });
    expect(EYE_LEVEL_CUT).toBe(2.3);
  });
});

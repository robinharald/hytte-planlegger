// @vitest-environment jsdom
/**
 * Fix round after 2a, UX findings "Undo from toasts", "Toast after Nytt forslag" and "Warnings are hard to see", with
 * the REAL editor core and the real Forslag D on the app store singleton:
 *  - one toast per user action ("Slettet." merged with the room merge), and its Angre undoes exactly that step;
 *  - a later step (a nudge) closes the delete's toast, so its Angre can never undo the nudge;
 *  - "Nytt forslag" toasts without Angre and closes the first-run card; the toasts keep clear of the card;
 *  - an edit that makes a new warning shows it once as a toast with "Vis";
 *  - (second fix round) that toast goes as soon as its warning is gone or the next edit is made, and a newer warning
 *    toast replaces it, so "Vis" never opens an empty panel and two warning toasts never contradict each other.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nb } from '../i18n/nb';
import { appStore } from '../state/appStore';
import { bindEditActions } from '../state/editActions';
import { selectActiveVariant } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { deleteResolved, nudgeSelection, resolveCurrent } from './commands';
import { createNewProposal, uiEditActionsFrom } from './editorBridge';
import { FirstRunCard } from './FirstRunCard';
import { FIRST_RUN_KEY } from './firstRun';
import { Toasts } from './Toasts';
import { toastBottomAvoiding } from './toastLayout';
import { toastRegistry } from './toastRegistry';
import { retireResolved, useNewWarningToasts } from './warningToasts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialProject = appStore.getState().project;
const core = bindEditActions(appStore);
const actions = uiEditActionsFrom(core);
let container: HTMLDivElement;
let root: Root;

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const toastEls = () => [...document.querySelectorAll<HTMLElement>('[data-testid="toast"]')];
const wall = (id: string) => selectActiveVariant(appStore.getState()).walls.find((w) => w.id === id);
const click = (el: Element | null) => {
  if (!el) throw new Error('element not found');
  act(() => (el as HTMLElement).click());
};

function WarningWatcher() {
  useNewWarningToasts();
  return null;
}

function deleteWall(id: string) {
  act(() => appStore.getState().select({ kind: 'wall', id }));
  const r = resolveCurrent();
  if (!r) throw new Error(`cannot resolve ${id}`);
  act(() => void deleteResolved(r, actions));
}

beforeEach(() => {
  appStore.getState().replaceProject(initialProject, { readOnly: false, source: 'local', selection: null, tool: 'select', activeView: 'plan' });
  appStore.setState({ toasts: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <>
        <Toasts />
        <WarningWatcher />
      </>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// First in the file: the card's open state lives in a module-level store, read from (fresh) storage at load.
describe('"Nytt forslag" and the first-run card', () => {
  it('the created toast has no Angre; making a proposal closes the first-run card for good', () => {
    act(() =>
      root.render(
        <>
          <FirstRunCard />
          <Toasts />
        </>,
      ),
    );
    expect(byTestId('first-run')).not.toBeNull();
    act(() => void createNewProposal());
    expect(appStore.getState().toasts.map((t) => t.text)).toEqual([nb.proposals.created('Mitt forslag')]);
    expect(byTestId('toast')).not.toBeNull();
    expect(byTestId('toast-undo')).toBeNull();
    expect(byTestId('first-run')).toBeNull();
    expect(window.localStorage.getItem(FIRST_RUN_KEY)).not.toBeNull();
  });

  it('toasts sit above the first-run card where they would cover it', () => {
    const viewport = { width: 1366, height: 768 };
    // The card at the bottom left of the stage (left 240 … 660, top 560): the centred toasts (403 … 963) overlap it.
    expect(toastBottomAvoiding({ left: 240, right: 660, top: 560 }, viewport)).toBe(768 - 560 + 8);
    // Clear of the toasts' column: nothing to avoid.
    expect(toastBottomAvoiding({ left: 12, right: 380, top: 560 }, viewport)).toBeNull();
    expect(toastBottomAvoiding(null, viewport)).toBeNull();
  });
});

describe('undo from toasts', () => {
  beforeEach(() => act(() => void createNewProposal()));

  it('resize, then a delete that merges two rooms: ONE toast, and its Angre undoes only the delete', () => {
    act(() => void actions.resizeRoom('room-sov-ny', 'd', 2.4, 'min'));
    expect(wall('w-gang-n')?.a[1]).toBeCloseTo(3.58, 3);
    act(() => appStore.setState({ toasts: [] }));

    deleteWall('w-104-103');
    expect(wall('w-104-103')?.status).toBe('removed');
    expect(toastEls()).toHaveLength(1);
    expect(toastEls()[0].querySelector('.toast-text')?.textContent).toBe(`Slettet. ${nb.editor.merged('Soverom 1', 'Bad')}`);
    expect(toastEls()[0].querySelector('.toast-text')?.textContent).toBe('Slettet. «Soverom 1» og «Bad» er nå ett rom.');
    expect(document.querySelectorAll('[data-testid="toast-undo"]')).toHaveLength(1);

    click(byTestId('toast-undo'));
    expect(wall('w-104-103')?.status).toBe('existing');
    expect(deriveForState(appStore.getState()).rooms.map((r) => r.id)).toEqual(expect.arrayContaining(['room-sov1', 'room-bad']));
    // The earlier resize is kept, and nothing is left to press again.
    expect(wall('w-gang-n')?.a[1]).toBeCloseTo(3.58, 3);
    expect(toastEls()).toHaveLength(0);
  });

  it('delete, then a nudge: the delete toast closes, so its Angre cannot undo the nudge', () => {
    deleteWall('w-104-103');
    const toast = appStore.getState().toasts.find((t) => t.undo);
    expect(toast).toBeDefined();
    expect(toastRegistry().isCurrent(toast!)).toBe(true);

    act(() => nudgeSelection({ kind: 'wall', id: 'w-gang-n' }, 0, 0.1, actions));
    expect(wall('w-gang-n')?.a[1]).toBeCloseTo(3.5, 3);
    const undo = byTestId('toast-undo') as HTMLButtonElement | null;
    if (undo) expect(undo.disabled).toBe(true);
    expect(appStore.getState().toasts.some((t) => t.undo)).toBe(false);

    // Even a stale handle does nothing: the nudge and the delete both stay.
    expect(toastRegistry().isCurrent(toast!)).toBe(false);
    act(() => void toastRegistry().undo([toast!]));
    expect(wall('w-gang-n')?.a[1]).toBeCloseTo(3.5, 3);
    expect(wall('w-104-103')?.status).toBe('removed');
  });

  it('the toolbar\'s Angre also closes the toast of the step it undid', () => {
    act(() => appStore.setState({ toasts: [] }));
    deleteWall('w-104-103');
    expect(toastEls()).toHaveLength(1);
    act(() => appStore.getState().undo());
    expect(wall('w-104-103')?.status).toBe('existing');
    expect(toastEls()).toHaveLength(0);
  });
});

describe('new warnings', () => {
  beforeEach(() => act(() => void createNewProposal()));

  it('an edit that makes a new warning shows it once, by name and place, with "Vis"', () => {
    act(() => appStore.setState({ toasts: [] }));
    const door = selectActiveVariant(appStore.getState()).openings.find((o) => o.id === 'd-sov-ny');
    expect(door?.host).toEqual({ kind: 'wall', wallId: 'w-gang-n' });
    // A window right on top of the door (UX evidence: "Åpninger overlapper: Dør d-sov-ny, Vindu op-…").
    act(() => void core.addOpening({ kind: 'wall', wallId: 'w-gang-n' }, door!.offset, 'window'));
    const shown = appStore.getState().toasts.filter((t) => toastRegistry().showsWarnings(t.id));
    expect(shown).toHaveLength(1);
    expect(shown[0].text).toMatch(/^Ny advarsel: /);
    expect(shown[0].text).toContain('overlapper hverandre');
    expect(shown[0].text).not.toMatch(/d-sov-ny|op-/);
    expect(byTestId('toast-show-warnings')).not.toBeNull();

    // A later edit that keeps the warning does not show it again.
    act(() => appStore.setState({ toasts: [] }));
    act(() => nudgeSelection({ kind: 'wall', id: 'w-104-103' }, 0.01, 0, actions));
    expect(appStore.getState().toasts.filter((t) => toastRegistry().showsWarnings(t.id))).toHaveLength(0);

    // Undo is not an edit: the warning going away and coming back with Gjør om is not news.
    act(() => appStore.getState().undo());
    act(() => appStore.getState().undo());
    expect(appStore.getState().toasts.filter((t) => toastRegistry().showsWarnings(t.id))).toHaveLength(0);
  });

  const warningToastEls = () => appStore.getState().toasts.filter((t) => toastRegistry().showsWarnings(t.id));

  it('the toast goes when its warning is gone: draw a wall across a room, then name the new piece', () => {
    act(() => appStore.setState({ toasts: [] }));
    // A wall across Soverom (ny fløy) (UX evidence d5): the strip it cuts off has no name.
    act(() => void core.addWall([16, 4.75], [20.8, 4.75]));
    const unnamed = deriveForState(appStore.getState()).warnings.find((w) => w.kind === 'room-unnamed');
    expect(unnamed).toBeDefined();
    expect(warningToastEls()).toHaveLength(1);
    expect(warningToastEls()[0].text).toMatch(/^Ny advarsel: Rom uten navn på Hovedplan/);
    expect(byTestId('toast-show-warnings')).not.toBeNull();

    if (unnamed?.kind !== 'room-unnamed') throw new Error('no unnamed room');
    act(() => void core.nameFace(unnamed.faceId, 'Kontor', { levelId: unnamed.levelId }));
    expect(deriveForState(appStore.getState()).warnings).toEqual([]);
    expect(warningToastEls()).toHaveLength(0);
    expect(byTestId('toast-show-warnings')).toBeNull();
    expect(toastEls()).toHaveLength(0);
  });

  it('a later edit retires the toast, and a newer warning toast replaces it (never two at once)', () => {
    act(() => appStore.setState({ toasts: [] }));
    act(() => void core.addWall([16, 4.75], [20.8, 4.75]));
    expect(warningToastEls()).toHaveLength(1);
    const first = warningToastEls()[0].id;

    // An edit that leaves the warning in place still closes the toast (like an undo toast).
    act(() => nudgeSelection({ kind: 'wall', id: 'w-104-103' }, 0.01, 0, actions));
    expect(appStore.getState().toasts.some((t) => t.id === first)).toBe(false);

    // A new warning: exactly one warning toast, the new one.
    const door = selectActiveVariant(appStore.getState()).openings.find((o) => o.id === 'd-sov-ny');
    act(() => void core.addOpening({ kind: 'wall', wallId: 'w-gang-n' }, door!.offset, 'window'));
    expect(warningToastEls()).toHaveLength(1);
    expect(warningToastEls()[0].text).toContain('overlapper hverandre');
    expect(document.querySelectorAll('[data-testid="toast-show-warnings"]')).toHaveLength(1);
  });

  it('a warning toast is closed as soon as none of the warnings it announced is left, even without a new step', () => {
    let id = '';
    act(() => {
      id = appStore.getState().showToast({ text: 'Ny advarsel: X' });
      toastRegistry().markShowsWarnings(id, ['kind=room-small|roomId=r']);
    });
    act(() => retireResolved(new Set(['kind=room-small|roomId=r', 'kind=other'])));
    expect(appStore.getState().toasts.some((t) => t.id === id)).toBe(true);
    act(() => retireResolved(new Set(['kind=other'])));
    expect(appStore.getState().toasts.some((t) => t.id === id)).toBe(false);
  });
});

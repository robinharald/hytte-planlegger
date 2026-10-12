// @vitest-environment jsdom
/**
 * The Egenskaper panel wired to the REAL editor core (state/editActions.ts) and the real Forslag D through the real
 * derive pipeline, on the app store singleton (bootstrapped with the locked base proposal):
 *  - on Forslag D a typed size is refused with the toast and nothing changes;
 *  - after "Nytt forslag", Dybde 2,40 on Soverom (ny fløy) moves w-gang-n (§7 "set a room's dybde to 2,40 by typing");
 *  - deleting the existing wall w-104-103 leaves a ghost the panel offers to take back, and "Ta tilbake" restores it.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nb } from '../i18n/nb';
import { appStore } from '../state/appStore';
import { addWall, useEditActions } from '../state/editActions';
import { deriveForState } from '../state/useDerived';
import { createNewProposal, EditActionsProvider, uiEditActionsFrom } from './editorBridge';
import { PropertiesPanel } from './PropertiesPanel';
import { Toasts } from './Toasts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialProject = appStore.getState().project;
let container: HTMLDivElement;
let root: Root;

function Wired() {
  return (
    <EditActionsProvider actions={uiEditActionsFrom(useEditActions())}>
      <PropertiesPanel />
      <Toasts />
    </EditActionsProvider>
  );
}

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const input = (testId: string) => container.querySelector<HTMLInputElement>(`[data-testid="${testId}"] input`) as HTMLInputElement;
function typeAndEnter(el: HTMLInputElement, text: string) {
  act(() => el.focus());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
}
/** Type into a plain input (the "Gi navn" name field). */
function setText(el: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const wall = (id: string) => {
  const s = appStore.getState();
  return s.project.variants.find((v) => v.id === s.project.activeVariantId)?.walls.find((w) => w.id === id);
};
const room = (id: string) => deriveForState(appStore.getState()).rooms.find((r) => r.id === id);

beforeEach(() => {
  appStore.getState().replaceProject(initialProject, { readOnly: false, source: 'local', selection: null, tool: 'select' });
  appStore.setState({ toasts: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Wired />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Egenskaper with the editor core on Forslag D', () => {
  it('the base proposal refuses a typed size; a new proposal takes Dybde 2,40 by moving w-gang-n', () => {
    act(() => appStore.getState().select({ kind: 'room', id: 'room-sov-ny', levelId: 'main' }));
    expect(byTestId('locked-notice')).not.toBeNull();
    const before = appStore.getState().project;
    act(() => void input('room-size-d').dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true })));
    expect(appStore.getState().toasts.map((t) => t.text)).toContain(nb.proposals.locked);
    expect(appStore.getState().project).toBe(before);

    act(() => void createNewProposal());
    act(() => appStore.getState().select({ kind: 'room', id: 'room-sov-ny', levelId: 'main' }));
    expect(byTestId('locked-notice')).toBeNull();
    expect(input('room-size-d').value).toBe('2,58');
    typeAndEnter(input('room-size-d'), '2,40');
    expect(room('room-sov-ny')?.dims.h).toBeCloseTo(2.4, 3);
    expect(wall('w-gang-n')?.a[1]).toBeCloseTo(3.58, 3);
    expect(input('room-size-d').value).toBe('2,40');
  });

  it('deleting the existing wall w-104-103 leaves a ghost; "Ta tilbake" restores it', () => {
    act(() => void createNewProposal());
    act(() => appStore.getState().select({ kind: 'wall', id: 'w-104-103' }));
    expect(byTestId('properties-status')?.textContent).toBe('Hytta i dag');
    act(() => byTestId('wall-delete')?.click());
    expect(wall('w-104-103')?.status).toBe('removed');
    expect(appStore.getState().toasts.map((t) => t.text)).toContain(nb.toasts.deleted);
    expect(byTestId('properties-status')?.textContent).toBe('Fjernet');
    act(() => byTestId('ghost-restore')?.click());
    expect(wall('w-104-103')?.status).toBe('existing');
    expect(appStore.getState().ui.selection).toEqual({ kind: 'wall', id: 'w-104-103' });
    expect(byTestId('properties-status')?.textContent).toBe('Hytta i dag');
  });

  it('"Gi navn" on a new piece selects the new room, so Egenskaper shows it (not "finnes ikke lenger")', () => {
    act(() => void createNewProposal());
    act(() => void addWall(appStore, [18.95, 3.4], [18.95, 6.2]));
    const face = deriveForState(appStore.getState()).rooms.find((r) => !r.room && r.levelId === 'main');
    if (!face) throw new Error('no unnamed piece');
    act(() => appStore.getState().select({ kind: 'room', id: face.id, levelId: 'main' }));
    setText(container.querySelector<HTMLInputElement>('[data-testid="name-face-input"]') as HTMLInputElement, 'Kontor');
    act(() => byTestId('name-face')?.click());
    const sel = appStore.getState().ui.selection;
    expect(sel?.kind).toBe('room');
    expect(sel?.id).not.toBe(face.id);
    expect(room(sel!.id)?.room?.name).toBe('Kontor');
    expect(container.textContent).not.toContain(nb.properties.dangling);
    expect(byTestId('properties-title')?.textContent).toBe('Kontor');
  });
});

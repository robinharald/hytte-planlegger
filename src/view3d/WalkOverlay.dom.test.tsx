// @vitest-environment jsdom
/** «Gå rundt» / «Avslutt» over the 3D view and the touch joystick (WalkOverlay.tsx → walkState). */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOYSTICK_RADIUS, WalkOverlay } from './WalkOverlay';
import { resetView3dLocal, startWalk, view3dLocal, walkInput } from './walkState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetView3dLocal();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetView3dLocal();
});

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function pointer(el: Element, type: string, x: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 7 });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  act(() => {
    el.dispatchEvent(e);
  });
}

describe('WalkOverlay', () => {
  it('«Gå rundt» starts a walk; «Avslutt» ends it', () => {
    act(() => root.render(<WalkOverlay walking={false} coarse={false} />));
    expect(byTestId('walk-joystick')).toBeNull();
    act(() => byTestId('walk-start-3d')!.click());
    expect(view3dLocal.getState().walk).not.toBeNull();
    act(() => root.render(<WalkOverlay walking coarse={false} />));
    expect(byTestId('walk-start-3d')).toBeNull();
    expect(byTestId('walk-joystick')).toBeNull(); // no joystick with a mouse
    act(() => byTestId('walk-exit')!.click());
    expect(view3dLocal.getState().walk).toBeNull();
  });

  it('the joystick drives the walk input and wakes the render loop; letting go stops', () => {
    startWalk();
    const wake = vi.fn();
    walkInput.wake = wake;
    act(() => root.render(<WalkOverlay walking coarse />));
    const base = byTestId('walk-joystick')!;
    // base centre at (100, 400)
    base.getBoundingClientRect = () => ({ left: 100 - JOYSTICK_RADIUS, top: 400 - JOYSTICK_RADIUS, width: 2 * JOYSTICK_RADIUS, height: 2 * JOYSTICK_RADIUS, right: 100 + JOYSTICK_RADIUS, bottom: 400 + JOYSTICK_RADIUS, x: 0, y: 0, toJSON: () => ({}) });
    pointer(base, 'pointerdown', 100, 400 - JOYSTICK_RADIUS); // straight up: full speed ahead
    expect(walkInput.joy.forward).toBeCloseTo(1, 9);
    expect(walkInput.joy.strafe).toBeCloseTo(0, 9);
    expect(wake).toHaveBeenCalled();
    pointer(base, 'pointermove', 100 + 3 * JOYSTICK_RADIUS, 400); // far right: clamped
    expect(walkInput.joy.strafe).toBeCloseTo(1, 9);
    expect(walkInput.joy.forward).toBeCloseTo(0, 9);
    pointer(base, 'pointerup', 100 + 3 * JOYSTICK_RADIUS, 400);
    expect(walkInput.joy).toEqual({ strafe: 0, forward: 0 });
  });
});

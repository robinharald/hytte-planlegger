// @vitest-environment jsdom
/**
 * The 3D panel's «Gå rundt» chip and the «Sol og skygge» panel (Controls.tsx) against the app store singleton, with
 * `deriveVariant` mocked to the hand-made fixture (as panels.test.tsx).
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDerived } from './testDerived';

vi.mock('../geometry/derive', () => ({ deriveVariant: () => makeDerived() }));

const { appStore } = await import('../state/appStore');
const { Controls } = await import('./Controls');
const { resetView3dLocal, view3dLocal } = await import('../view3d/walkState');
const { siteClock } = await import('../view3d/sunPanel');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const initialProject = appStore.getState().project;

function render(node: ReactNode) {
  act(() => root.render(node));
}
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('element not found');
  act(() => (el as HTMLElement).click());
};

beforeEach(() => {
  resetView3dLocal();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  appStore.getState().replaceProject(initialProject, { readOnly: false, source: 'local', activeView: '3d', mode3d: 'ute', selection: null });
  appStore.getState().setUi({ sun: { date: '2026-06-21', minutes: 900 }, preset: 'oversikt' });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetView3dLocal();
});

describe('«Gå rundt» in the 3D panel', () => {
  it('starts and ends the walk; a camera preset or the Plan tab ends it', () => {
    render(<Controls isPhone={false} />);
    const chip = () => byTestId('preset-walk');
    expect(chip()?.textContent).toBe('Gå rundt');
    click(chip());
    expect(view3dLocal.getState().walk).not.toBeNull();
    expect(chip()?.getAttribute('aria-pressed')).toBe('true');
    expect(chip()?.textContent).toBe('Avslutt');
    // while walking no preset is shown as the view
    expect(byTestId('preset-oversikt')?.getAttribute('aria-pressed')).toBe('false');
    click(chip());
    expect(view3dLocal.getState().walk).toBeNull();
    expect(view3dLocal.getState().returnToPreset).toBe(false);

    click(chip());
    click(byTestId('preset-ovenfra'));
    expect(view3dLocal.getState().walk).toBeNull();
    expect(view3dLocal.getState().returnToPreset).toBe(true);
    expect(appStore.getState().ui.preset).toBe('ovenfra');

    click(chip());
    click(byTestId('view-tab-plan'));
    expect(view3dLocal.getState().walk).toBeNull();
  });
});

describe('«Sol og skygge»', () => {
  const note = () => byTestId('sun-day')?.textContent ?? '';

  it('Midtsommer: the sun is up all day, the whole slider is daylight, no ticks', () => {
    render(<Controls isPhone={false} />);
    click(byTestId('sun-preset-midsummer'));
    expect(appStore.getState().ui.sun).toEqual({ date: '2026-06-21', minutes: 900 });
    expect(byTestId('sun-preset-midsummer')?.getAttribute('aria-pressed')).toBe('true');
    expect(note()).toContain('Sola er oppe hele døgnet');
    expect(byTestId('sun-daylight')?.children).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid^="sun-tick-"]')).toHaveLength(0);
  });

  it('Midtvinter: polar night, said once, no daylight band', () => {
    render(<Controls isPhone={false} />);
    click(byTestId('sun-preset-midwinter'));
    expect(appStore.getState().ui.sun.date).toBe('2026-12-21');
    expect(appStore.getState().ui.sun.minutes).toBe(900); // the time is kept
    expect(note().match(/Sola er under horisonten/g)).toHaveLength(1);
    expect(byTestId('sun-daylight')?.children).toHaveLength(0);
  });

  it('Jevndøgn: sunrise and sunset ticks on the slider, also as its datalist', () => {
    render(<Controls isPhone={false} />);
    click(byTestId('sun-preset-equinox'));
    expect(appStore.getState().ui.sun.date).toBe('2026-03-20');
    expect(byTestId('sun-tick-rise')?.textContent).toMatch(/^↑0[56]:\d\d$/);
    expect(byTestId('sun-tick-set')?.textContent).toMatch(/^↓18:\d\d$/);
    expect(note()).toMatch(/Soloppgang 0[56]:\d\d · Solnedgang 18:\d\d/);
    const options = [...container.querySelectorAll('datalist#sun-time-ticks option')].map((o) => Number(o.getAttribute('value')));
    expect(options).toHaveLength(2);
    for (const v of options) expect(v % 5).toBe(0);
    expect(byTestId('sun-time')?.getAttribute('list')).toBe('sun-time-ticks');
  });

  it('I dag: the date and the time now at the cabin', () => {
    render(<Controls isPhone={false} />);
    click(byTestId('sun-preset-today'));
    const clock = siteClock(appStore.getState().project.site, new Date());
    expect(appStore.getState().ui.sun.date).toBe(clock.date);
    expect(Math.abs(appStore.getState().ui.sun.minutes - clock.minutes)).toBeLessThanOrEqual(5);
    expect(byTestId('sun-preset-today')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('the shadows switch', () => {
    render(<Controls isPhone={false} />);
    const box = byTestId('toggle-shadows') as HTMLInputElement;
    expect(box.checked).toBe(true);
    click(box);
    expect(view3dLocal.getState().shadows).toBe(false);
    expect((byTestId('toggle-shadows') as HTMLInputElement).checked).toBe(false);
  });

  it('is compact on a phone: the four days in one row, no separate time field, one slider', () => {
    render(<Controls isPhone />);
    expect(container.querySelector('aside.controls input[type="time"]')).toBeNull();
    expect(container.querySelectorAll('aside.controls input[type="range"]')).toHaveLength(1);
    const row = byTestId('sun-preset-midsummer')?.parentElement;
    expect(row?.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    expect(row?.children).toHaveLength(4);
  });
});

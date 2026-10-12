// @vitest-environment jsdom
/**
 * NumberField (docs/phase2-plan.md §3.7 "Number fields"): "2,4" / "2,40" / "2.40" accepted, unit, two decimals,
 * inputmode decimal, −/+ 10 cm, > 30 rejected; commit on Enter / Tab / blur, Esc restores; locked fields refuse.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField';
import { acceptNumber, differs, parseDecimal, stepValue } from './numberInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('parseDecimal / acceptNumber', () => {
  it('accepts comma and point decimals, a trailing unit and spaces', () => {
    for (const t of ['2,4', '2,40', '2.40', ' 2,4 ', '2,4 m', '2,40m', '2.4M']) expect(parseDecimal(t), t).toBe(2.4);
    expect(parseDecimal('3')).toBe(3);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal('28°')).toBe(28);
    expect(parseDecimal('-0,3')).toBe(-0.3);
    expect(parseDecimal('−0,3')).toBe(-0.3);
  });

  it('rejects anything that is not one plain number', () => {
    for (const t of ['', ' ', 'abc', '2,4,0', '2..4', '1e3', '2 4', '2,4 cm', '--1']) expect(parseDecimal(t), t).toBeNull();
  });

  it('rounds to the field decimals and rejects values outside [min, max] (max 30 m by default)', () => {
    const rule = { min: 0, max: 30, decimals: 2 };
    expect(acceptNumber('2,405', rule)).toBe(2.41);
    expect(acceptNumber('30', rule)).toBe(30);
    expect(acceptNumber('30,01', rule)).toBeNull();
    expect(acceptNumber('31', rule)).toBeNull();
    expect(acceptNumber('-0,1', rule)).toBeNull();
    expect(acceptNumber('x', rule)).toBeNull();
  });

  it('differs / stepValue work in the field precision', () => {
    expect(differs(2.4, 2.4001, 2)).toBe(false);
    expect(differs(2.4, 2.41, 2)).toBe(true);
    const rule = { min: 0, max: 30, decimals: 2 };
    expect(stepValue(2.4, 0.1, rule)).toBe(2.5);
    expect(stepValue(0.05, -0.1, rule)).toBe(0);
    expect(stepValue(29.95, 0.1, rule)).toBe(30);
  });
});

describe('NumberField', () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (node: ReactNode) => act(() => root.render(node));
  const input = () => container.querySelector('input') as HTMLInputElement;
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button.nf-step')];

  /** Type into the input the way React sees it (native value setter + input event). */
  function type(text: string) {
    const el = input();
    act(() => {
      el.focus();
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  function key(k: string) {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    act(() => void input().dispatchEvent(ev));
    return ev;
  }
  function blur() {
    act(() => input().blur());
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows two decimals with a comma, the unit and inputmode decimal', () => {
    render(<NumberField label="Dybde ↕" value={2.4} onCommit={() => {}} />);
    expect(input().value).toBe('2,40');
    expect(input().getAttribute('inputmode')).toBe('decimal');
    expect(container.querySelector('.nf-unit')?.textContent).toBe('m');
    expect(container.querySelector('label')?.textContent).toBe('Dybde ↕');
  });

  it('commits on Enter, Tab and blur, only when the value changed', () => {
    const onCommit = vi.fn();
    render(<NumberField label="L" value={2.4} onCommit={onCommit} />);
    type('2.5');
    key('Enter');
    expect(onCommit).toHaveBeenLastCalledWith(2.5);
    type('2,60 m');
    key('Tab');
    expect(onCommit).toHaveBeenLastCalledWith(2.6);
    type('3,1');
    blur();
    expect(onCommit).toHaveBeenLastCalledWith(3.1);
    expect(onCommit).toHaveBeenCalledTimes(3);
    type('2,400');
    key('Enter');
    expect(onCommit).toHaveBeenCalledTimes(3);
  });

  it('Esc restores the model value without committing and is swallowed', () => {
    const onCommit = vi.fn();
    render(<NumberField label="L" value={2.4} onCommit={onCommit} />);
    type('9');
    expect(input().value).toBe('9');
    const ev = key('Escape');
    expect(ev.defaultPrevented).toBe(true);
    expect(input().value).toBe('2,40');
    blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('rejects values above 30 m and garbage with a message, and shows the old value again', () => {
    const onCommit = vi.fn();
    render(<NumberField label="L" value={2.4} onCommit={onCommit} />);
    type('31');
    key('Enter');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe('2,40');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('30 m');
    type('to meter');
    blur();
    expect(onCommit).not.toHaveBeenCalled();
    type('2,5');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('−/+ change the value by 10 cm and commit right away', () => {
    const onCommit = vi.fn();
    render(<NumberField label="L" value={2.4} onCommit={onCommit} />);
    const [minus, plus] = buttons();
    expect(minus.getAttribute('aria-label')).toBe('Mindre (−10 cm)');
    act(() => plus.click());
    expect(onCommit).toHaveBeenLastCalledWith(2.5);
    act(() => minus.click());
    expect(onCommit).toHaveBeenLastCalledWith(2.3);
  });

  it('degrees: own unit, step and limits', () => {
    const onCommit = vi.fn();
    render(<NumberField label="Takvinkel" unit="°" decimals={1} value={28} min={3} max={60} step={1} stepLabel="1°" onCommit={onCommit} />);
    expect(input().value).toBe('28,0');
    type('34,5');
    key('Enter');
    expect(onCommit).toHaveBeenLastCalledWith(34.5);
    type('75');
    key('Enter');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('60 °');
  });

  it('locked: read-only, typing and −/+ call onLocked and never commit', () => {
    const onCommit = vi.fn();
    const onLocked = vi.fn();
    render(<NumberField label="L" value={2.4} onCommit={onCommit} locked onLocked={onLocked} />);
    expect(input().readOnly).toBe(true);
    key('5');
    expect(onLocked).toHaveBeenCalledTimes(1);
    act(() => buttons()[1].click());
    expect(onLocked).toHaveBeenCalledTimes(2);
    key('Tab');
    expect(onLocked).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('read-only (e.g. "Endres under bygningsdelen"): no stepper, a note, nothing commits', () => {
    const onCommit = vi.fn();
    render(<NumberField label="L" value={3.68} readOnly note="Endres under bygningsdelen" onCommit={onCommit} />);
    expect(buttons()).toHaveLength(0);
    expect(container.textContent).toContain('Endres under bygningsdelen');
    type('5');
    key('Enter');
    expect(onCommit).not.toHaveBeenCalled();
  });
});

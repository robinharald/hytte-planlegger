// @vitest-environment jsdom
/**
 * «Avløp og sluk» in the plan (PlumbingLayer.tsx) and in Vis (ui/PlumbingToggle.tsx): the seed's suggested stack with a
 * dashed run from each fixture of the new wing and today's drains marked; a far toilet in red with its distance; a
 * stack dragged along the walls with the runs following live and one `onMoveStack` on release (the plan's tracker only
 * counts the pointer); a tap picks a stack (delete button / the hint line), a press elsewhere drops it; on touch a drag
 * on a stack that is not picked is the plan's and its target stays off the toilets beside it; read-only has no hit
 * areas; the Vis toggle shows the lines and «Legg til avløpsstamme» only in a proposal that can be edited.
 */
import { produce } from 'immer';
import { act } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveVariant } from '../../geometry/derive';
import type { VariantPlumbing } from '../../geometry/plumbing';
import type { DerivedVariant } from '../../model/derived';
import { nb } from '../../i18n/nb';
import { createForslagD } from '../../model/seed/forslagD';
import terrainJson from '../../model/seed/terrain-merkesvatnet.json';
import type { TerrainAsset, Variant, Vec2 } from '../../model/types';
import { appStore } from '../../state/appStore';
import { plumbingView, setPlumbingVisible, todayWetRoomIds } from '../../state/plumbingActions';
import { selectActiveVariant } from '../../state/store';
import { PlumbingToggle } from '../../ui/PlumbingToggle';
import { pointerHandOff } from '../usePanZoom';
import { COLLISION } from './furnitureLayerModel';
import { PlumbingLayer } from './PlumbingLayer';
import type { PlumbingLayerProps } from './PlumbingLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = createForslagD();
const seed = project.variants[0];
const derive = (v: Variant): DerivedVariant => deriveVariant(v, project.site, terrainJson as unknown as TerrainAsset);
const seedDerived = derive(seed);
const today = todayWetRoomIds();
const farDerived = derive(
  produce(seed, (d) => {
    const f = d.furniture.find((x) => x.id === 'fu-wc-1')!;
    f.position = [1.0, 5.715];
    f.rotationDeg = 0;
    f.levelId = 'lower';
  }),
);

/** Plan point ↔ client px: 40 px/m, y down, origin at client (0, 400). */
const toClient = (p: Vec2): [number, number] => [p[0] * 40, 400 - p[1] * 40];
const clientToPlan = (x: number, y: number): Vec2 => [x / 40, (400 - y) / 40];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function draw(props: Partial<PlumbingLayerProps> = {}, parentDown = vi.fn()) {
  act(() =>
    root.render(
      <svg onPointerDown={parentDown}>
        <PlumbingLayer derived={seedDerived} todayRoomIds={today} storeyId="ground" scale={40} clientToPlan={clientToPlan} {...props} />
      </svg>,
    ),
  );
  return parentDown;
}

const q = (sel: string) => container.querySelector(sel);
const qa = (sel: string) => [...container.querySelectorAll(sel)];

function pointer(el: Element, type: string, at: [number, number], extra: Partial<PointerEventInit> = {}) {
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: at[0], clientY: at[1], ...extra }));
  });
}

const stackAt = (id: string): Vec2 => {
  const c = q(`[data-drain-stack="${id}"] circle`)!;
  return [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))];
};
const runOf = (id: string): Vec2[] =>
  q(`[data-drain-run="${id}"]`)!
    .getAttribute('points')!
    .split(' ')
    .map((p) => p.split(',').map(Number) as Vec2);

describe('PlumbingLayer', () => {
  it("draws the seed's suggested stack, a dashed run per fixture of the new wing and today's drains", () => {
    draw();
    const stack = q('[data-drain-stack="suggested-ground"]');
    expect(stack?.getAttribute('data-drain-suggested')).toBe('true');
    expect(stackAt('suggested-ground')[0]).toBeCloseTo(18.6, 6);
    const runs = qa('[data-drain-run]');
    expect(runs.map((r) => r.getAttribute('data-drain-run')).sort()).toEqual(['fu-hovedbad-1', 'fu-hovedbad-2', 'fu-hovedbad-3', 'fu-hovedbad-4', 'fu-wc-1', 'fu-wc-2']);
    expect(runs.every((r) => r.getAttribute('data-drain-state') === 'ok' && r.getAttribute('stroke-dasharray') === '6 4')).toBe(true);
    expect(qa('[data-drain-point][data-drain-state="today"]')).toHaveLength(5);
    expect(qa('[data-drain-far]')).toHaveLength(0);
    // Distances at 40 px/m («0,4 m»); none on fine runs when zoomed out.
    expect(qa('[data-drain-label]').map((l) => l.textContent)).toContain('0,4 m');
    // Read-only by default: no hit areas, so taps reach the plan.
    expect(qa('[data-drain-hit]')).toHaveLength(0);
    draw({ scale: 10 });
    expect(qa('[data-drain-label]')).toHaveLength(0);
  });

  it('draws nothing on a storey without fixtures or stacks', () => {
    draw({ storeyId: 'loft' });
    expect(q('[data-layer="plumbing"]')).toBeNull();
  });

  it('outlines a far toilet in red with its distance', () => {
    draw({ derived: farDerived });
    expect(q('[data-drain-far="fu-wc-1"]')?.getAttribute('stroke')).toBe(COLLISION);
    expect(q('[data-drain-run="fu-wc-1"]')?.getAttribute('stroke')).toBe(COLLISION);
    // Zoomed out, the far distance is still written.
    draw({ derived: farDerived, scale: 10 });
    expect(q('[data-drain-label="fu-wc-1"]')?.textContent).toMatch(/^\d+,\d m$/);
  });

  it('drags a stack along the walls, the runs following, and moves it once on release', () => {
    const onMoveStack = vi.fn();
    const parentDown = draw({ editable: true, onMoveStack });
    const hit = q('[data-drain-hit="suggested-ground"]')!;
    pointer(hit, 'pointerdown', toClient(stackAt('suggested-ground')));
    // The plan's tracker only counts the press.
    const e = parentDown.mock.calls.at(-1)?.[0] as ReactPointerEvent | undefined;
    expect(e && pointerHandOff(e.nativeEvent)?.kind).toBe('held');
    pointer(hit, 'pointermove', toClient([18.75, 1.6]));
    // Snapped onto the wall between WC and Hovedbad; the WC toilet's run ends there.
    const p = stackAt('suggested-ground');
    expect(p[0]).toBeCloseTo(18.6, 6);
    expect(p[1]).toBeCloseTo(1.6, 6);
    expect(runOf('fu-wc-1').at(-1)).toEqual(p);
    expect(onMoveStack).not.toHaveBeenCalled();
    pointer(hit, 'pointerup', toClient([18.75, 1.6]));
    expect(onMoveStack).toHaveBeenCalledTimes(1);
    expect(onMoveStack.mock.calls[0][0]).toBe('suggested-ground');
    expect(onMoveStack.mock.calls[0][1]).toEqual(p);
    // The preview is gone: the stack is where the props say (still the suggestion here).
    expect(q('[data-drain-stack="suggested-ground"]')?.getAttribute('data-drain-suggested')).toBe('true');
  });

  it('a tap on a stored stack offers to delete it; a press elsewhere drops the pick', () => {
    const plumbing: VariantPlumbing = { stacks: [{ id: 's1', p: [18.6, 1.0], storeyId: 'ground' }] };
    const onDeleteStack = vi.fn();
    draw({ editable: true, plumbing, onDeleteStack });
    expect(q('[data-drain-stack="s1"]')?.getAttribute('data-drain-suggested')).toBeNull();
    const hit = q('[data-drain-hit="s1"]')!;
    pointer(hit, 'pointerdown', toClient([18.6, 1.0]));
    pointer(hit, 'pointerup', toClient([18.6, 1.0]));
    expect(q('[data-drain-delete="s1"]')).not.toBeNull();
    // Elsewhere: the pick goes.
    pointer(document.body, 'pointerdown', [5, 5]);
    expect(q('[data-drain-delete="s1"]')).toBeNull();
    // Pick again and delete.
    pointer(hit, 'pointerdown', toClient([18.6, 1.0]));
    pointer(hit, 'pointerup', toClient([18.6, 1.0]));
    const del = q('[data-drain-delete="s1"]')!;
    pointer(del.querySelector('circle')!, 'pointerdown', [0, 0]);
    pointer(del.querySelector('circle')!, 'pointerup', [0, 0]);
    expect(onDeleteStack).toHaveBeenCalledWith('s1');
  });

  it('a tap on the suggested stack puts its hint in the hint line instead of a delete button', () => {
    const onHint = vi.fn<(t: string | null) => void>();
    draw({ editable: true, onHint });
    const hit = q('[data-drain-hit="suggested-ground"]')!;
    pointer(hit, 'pointerdown', toClient(stackAt('suggested-ground')));
    pointer(hit, 'pointerup', toClient(stackAt('suggested-ground')));
    expect(onHint).toHaveBeenLastCalledWith(nb.plumbing.suggestedNote);
    // not in the plan (it ran past the plan's edge on a phone)
    expect(q('[data-drain-hint]')).toBeNull();
    expect(q('[data-drain-delete]')).toBeNull();
    // the pick goes: so does the hint
    pointer(document.body, 'pointerdown', [5, 5]);
    expect(onHint).toHaveBeenLastCalledWith(null);
  });

  describe('on a touch screen', () => {
    const touch = (el: Element, type: string, at: [number, number], pointerId = 7) => pointer(el, type, at, { pointerType: 'touch', pointerId });
    const plumbing: VariantPlumbing = { stacks: [{ id: 's1', p: [18.6, 1.0], storeyId: 'ground' }] };

    it('a drag on a stack that is not picked pans the plan; a tap picks it, then a drag moves it', () => {
      const onMoveStack = vi.fn();
      const parentDown = draw({ editable: true, coarse: true, plumbing, onMoveStack });
      const at = toClient([18.6, 1.0]);
      const hit = () => q('[data-drain-hit="s1"]')!;
      touch(hit(), 'pointerdown', at);
      // the plan's own press (it pans)
      const e = parentDown.mock.calls.at(-1)?.[0] as ReactPointerEvent | undefined;
      expect(e && pointerHandOff(e.nativeEvent)).toBeNull();
      touch(hit(), 'pointermove', [at[0] + 40, at[1]]);
      touch(hit(), 'pointerup', [at[0] + 40, at[1]]);
      expect(onMoveStack).not.toHaveBeenCalled();
      expect(stackAt('s1')[0]).toBeCloseTo(18.6, 6);
      expect(q('[data-drain-delete="s1"]')).toBeNull();
      // a second finger makes it a pinch, never a tap
      touch(hit(), 'pointerdown', at);
      touch(document.body, 'pointerdown', [5, 5], 8);
      touch(hit(), 'pointerup', at);
      expect(q('[data-drain-delete="s1"]')).toBeNull();
      // a tap picks it
      touch(hit(), 'pointerdown', at);
      touch(hit(), 'pointerup', [at[0] + 3, at[1]]);
      expect(q('[data-drain-delete="s1"]')).not.toBeNull();
      // now a drag on it is held and moves it along the wall
      touch(hit(), 'pointerdown', at);
      const held = parentDown.mock.calls.at(-1)?.[0] as ReactPointerEvent | undefined;
      expect(held && pointerHandOff(held.nativeEvent)?.kind).toBe('held');
      touch(hit(), 'pointermove', toClient([18.75, 1.6]));
      touch(hit(), 'pointerup', toClient([18.75, 1.6]));
      expect(onMoveStack).toHaveBeenCalledTimes(1);
      expect(onMoveStack.mock.calls[0][1][1]).toBeCloseTo(1.6, 6);
    });

    it('the target of a stack that is not picked: never under the drawn stack (10 px), else at most 0,25 m', () => {
      const hitPx = (scale: number) => {
        draw({ editable: true, coarse: true, scale });
        return Number(q('[data-drain-hit="suggested-ground"]')!.getAttribute('r')) * scale;
      };
      // The phone's starting zoom (11,56 px/m) and the review's 23,1 and 34,7 px/m: the drawn 9 px stack and its ring
      // (fix round 3 after phase 3: 0,25 m was a 2,9 px target there, a tap 5 px off picked the wall under it).
      for (const scale of [11.56, 23.1, 34.7]) expect(hitPx(scale), `${scale}`).toBeCloseTo(10, 6);
      // Between, the 0,25 m cap: the WC's toilet (0,5 m from the stack) stays outside the target.
      expect(hitPx(60)).toBeCloseTo(0.25 * 60, 6);
      const r = Number(q('[data-drain-hit="suggested-ground"]')!.getAttribute('r'));
      const toilet = seedDerived.furniture.find((f) => f.id === 'fu-wc-1')!;
      const c = toilet.footprint.reduce<Vec2>((a, p) => [a[0] + p[0] / toilet.footprint.length, a[1] + p[1] / toilet.footprint.length], [0, 0]);
      const st = stackAt('suggested-ground');
      expect(Math.hypot(c[0] - st[0], c[1] - st[1])).toBeGreaterThan(r);
      // Zoomed in, a finger-sized target again.
      expect(hitPx(80)).toBeCloseTo(16, 6);
    });
  });
});

describe('PlumbingToggle', () => {
  const initial = appStore.getState().project;
  afterEach(() => {
    setPlumbingVisible(false);
    appStore.getState().replaceProject(initial, { readOnly: false, selection: null });
  });

  it('shows the lines while on; «Legg til avløpsstamme» only in a proposal', () => {
    appStore.getState().replaceProject(createForslagD(), { readOnly: false, selection: null });
    act(() => root.render(<PlumbingToggle />));
    const box = q('[data-testid="toggle-plumbing"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(q('[data-testid="plumbing-info"]')).toBeNull();
    act(() => box.click());
    expect(plumbingView.getState().visible).toBe(true);
    const info = q('[data-testid="plumbing-info"]')!;
    expect(info.textContent).toContain('WC og Hovedbad: toalettene står rygg mot rygg på veggen ved x 18,6 – det er fint.');
    // Forslag D cannot be edited: no button.
    expect(q('[data-testid="plumbing-add-stack"]')).toBeNull();

    act(() => appStore.getState().duplicateVariant('forslag-d', 'Mitt forslag'));
    const add = q('[data-testid="plumbing-add-stack"]') as HTMLButtonElement;
    expect(add).not.toBeNull();
    act(() => add.click());
    expect(selectActiveVariant(appStore.getState()).plumbing?.stacks).toHaveLength(1);
  });

  it('a far fixture is a line that selects it', () => {
    const p = createForslagD();
    p.variants.push(
      produce(p.variants[0], (d) => {
        d.id = 'mitt';
        d.name = 'Mitt forslag';
        delete d.locked;
        const f = d.furniture.find((x) => x.id === 'fu-wc-1')!;
        f.position = [1.0, 5.715];
        f.rotationDeg = 0;
        f.levelId = 'lower';
      }),
    );
    p.activeVariantId = 'mitt';
    appStore.getState().replaceProject(p, { readOnly: false, selection: null });
    setPlumbingVisible(true);
    act(() => root.render(<PlumbingToggle />));
    const far = q('[data-testid="plumbing-far"] button') as HTMLButtonElement;
    expect(far.textContent).toMatch(/^Soverom 1: toalettet står/);
    act(() => far.click());
    expect(appStore.getState().ui.selection).toMatchObject({ kind: 'furniture', id: 'fu-wc-1' });
  });
});

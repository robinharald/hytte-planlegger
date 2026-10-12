// @vitest-environment jsdom
/**
 * Hit order of live openings and their "Fjernet" ghosts (editor polish, phase 2b; the second review: a ghost drawn
 * above a new opening placed where the old one was took every click on the new one's middle). The layer draws the
 * live corridors, then the ghosts, then the live openings, so a click on a live opening's body selects it and the ghost
 * wins only outside that body. Hit testing through svgHitTest.ts (the browser's rules on the rendered plan).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../../model/derived';
import { createForslagD } from '../../model/seed/forslagD';
import type { Vec2 } from '../../model/types';
import { createAppStore } from '../../state/store';
import { deriveForState } from '../../state/useDerived';
import { findOpening } from '../editModel';
import { PlanView } from '../PlanView';
import { selectionFromTarget } from '../selection';
import { svgElementAt } from '../svgHitTest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function seedDerived(): DerivedVariant {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  return deriveForState(store.getState());
}

function rootMatrix(svg: SVGSVGElement): number[] {
  const t = svg.querySelector('[data-plan-root]')!.getAttribute('transform')!;
  return /^matrix\(([^)]+)\)$/.exec(t)![1].split(' ').map(Number);
}

function renderAt(derived: DerivedVariant, scale: number, coarse: boolean, highlightNew = true): SVGSVGElement {
  act(() =>
    root.render(
      <PlanView
        derived={derived}
        site={createForslagD().site}
        planStorey="ground"
        selection={null}
        onSelect={() => {}}
        showLabels
        showDims={false}
        showGrid={false}
        showRoofPlan={false}
        highlightNew={highlightNew}
        coarsePointer={coarse}
      />,
    ),
  );
  const svg = container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
  for (let i = 0; i < 6 && Math.abs(rootMatrix(svg)[0] / scale - 1) > 1e-9; i++) {
    const f = Math.min(2, Math.max(0.5, scale / rootMatrix(svg)[0]));
    act(() => {
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(f) / 0.0015, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
    });
  }
  expect(rootMatrix(svg)[0]).toBeCloseTo(scale, 6);
  return svg;
}

function tapAt(svg: SVGSVGElement, p: Vec2): string {
  const [s, , , , tx, ty] = rootMatrix(svg);
  const sel = selectionFromTarget(svgElementAt(svg, [s * p[0] + tx, -s * p[1] + ty]));
  return sel ? `${sel.kind}:${sel.id}` : 'none';
}

/** Plan point at `along` m from an opening's centre along its host and `acrossPx` screen px across it (+: left). */
function nearOpening(d: DerivedVariant, id: string, along: number, acrossPx: number, scale: number): Vec2 {
  const { wall, opening } = findOpening(d, id)!;
  const l = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const u: Vec2 = [(wall.b[0] - wall.a[0]) / l, (wall.b[1] - wall.a[1]) / l];
  const s = opening.offset + along;
  const k = acrossPx / scale;
  return [wall.a[0] + u[0] * s - u[1] * k, wall.a[1] + u[1] * s + u[0] * k];
}

describe('a new opening over the ghost of an old one', () => {
  it('win-106-s over the door-106-old ghost: its centre selects the window, beside it the ghost', () => {
    const d = seedDerived();
    const win = findOpening(d, 'win-106-s')!;
    const ghost = findOpening(d, 'door-106-old')!;
    expect(ghost.opening.status).toBe('removed');
    expect(ghost.wall.id).toBe(win.wall.id);
    expect(Math.abs(ghost.opening.offset - win.opening.offset)).toBeLessThan(1e-9);
    for (const [scale, coarse] of [
      [23.5, false],
      [11.6, true],
      [40, false],
    ] as const) {
      const svg = renderAt(d, scale, coarse);
      const band = Number(svg.getAttribute('data-hit-band'));
      // On the window's drawn body (its centre, and 0,3 m along): the window.
      expect(tapAt(svg, nearOpening(d, 'win-106-s', 0, 0, scale)), `${scale} centre`).toBe('opening:win-106-s');
      expect(tapAt(svg, nearOpening(d, 'win-106-s', 0.3, 0, scale)), `${scale} body`).toBe('opening:win-106-s');
      // Beside the wall body, still within the band: the ghost (before: also the ghost; now the only place it wins;
      // zoomed in further the body is wider than the band, and a second tap on the selected window selects the ghost:
      // editModel.ts cycleOpeningGhost).
      const outside = win.wall.faceRight * scale + 1;
      expect(outside).toBeLessThan(band / 2);
      expect(tapAt(svg, nearOpening(d, 'win-106-s', 0, -outside, scale)), `${scale} beside`).toBe('ghost:door-106-old');
      // Past the ghost's jamb but inside the window's (the window is 1,1 m, the old door 0,91 m): the window.
      expect(tapAt(svg, nearOpening(d, 'win-106-s', 0.5, -outside, scale)), `${scale} past the ghost`).toBe('opening:win-106-s');
    }
  });

  it('door-stue-s over the win-stue-s-old ghost: the door from its middle, the ghost beside the wall', () => {
    const d = seedDerived();
    const door = findOpening(d, 'door-stue-s')!;
    const svg = renderAt(d, 23.5, false);
    const ghost = findOpening(d, 'win-stue-s-old')!;
    // The ghost's centre is 0,14 m from the door's: on the door's body the door wins there too.
    const shift = ghost.opening.offset - door.opening.offset;
    expect(tapAt(svg, nearOpening(d, 'door-stue-s', shift, 0, 23.5))).toBe('opening:door-stue-s');
    expect(tapAt(svg, nearOpening(d, 'door-stue-s', shift, -(door.wall.faceRight * 23.5 + 1), 23.5))).toBe('ghost:win-stue-s-old');
  });

  it('without "Vis hva som er nytt" no ghost is drawn and the window takes the band', () => {
    const d = seedDerived();
    const svg = renderAt(d, 23.5, false, false);
    expect(svg.querySelector('[data-opening-id="door-106-old"]')).toBeNull();
    const win = findOpening(d, 'win-106-s')!;
    expect(tapAt(svg, nearOpening(d, 'win-106-s', 0, -(win.wall.faceRight * 23.5 + 1), 23.5))).toBe('opening:win-106-s');
  });

  it('draws the live corridors first, then the ghosts, then the live openings; one corridor per opening', () => {
    const d = seedDerived();
    const svg = renderAt(d, 23.5, false);
    const layer = svg.querySelector('[data-layer="openings"]')!;
    const corridors = layer.querySelector('[data-layer="opening-corridors"]')!;
    const ghost = layer.querySelector('[data-opening-id="door-106-old"]')!;
    const live = layer.querySelector('[data-opening-id="win-106-s"]')!;
    expect(corridors.compareDocumentPosition(ghost) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ghost.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(layer.querySelectorAll('[data-opening-corridor="win-106-s"]')).toHaveLength(1);
    expect(layer.querySelectorAll('[data-opening-corridor="door-106-old"]')).toHaveLength(1);
    // The live corridor carries its opening's selection.
    expect(selectionFromTarget(corridors.querySelector('[data-opening-corridor="win-106-s"]'))).toMatchObject({ kind: 'opening', id: 'win-106-s' });
    expect(selectionFromTarget(ghost.querySelector('[data-opening-corridor="door-106-old"]'))).toEqual({ kind: 'ghost', id: 'door-106-old' });
  });
});

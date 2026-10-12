// @vitest-environment jsdom
/**
 * Phone taps on the real seed, through the rendered plan (svgHitTest.ts replays the browser's SVG hit testing, so the
 * layer order, the bands and the label hit areas are the ones PlanView really draws).
 *
 * History: the first phase-2a review found that at the iPhone's starting zoom (11,6 px/m) a tap on a room's name
 * selected a wall or a door in 18 of 24 rooms (24 px touch bands were metres wide); the first fix round narrowed the
 * band to 0,25 m (2,9 px there) and made the labels hit areas on top, and the second review found that walls, doors
 * and ghosts then needed a tap within ±1,4 px. Now the band is 0,25 m but at least 10 px (editModel.ts `hitBandPx`)
 * and the label hit areas lie BELOW the walls, openings and ghosts: ±4 px from a wall or a door selects it, and a tap on
 * a room's name still selects the room.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import * as A from '../state/editActions';
import { createAppStore } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { CORRIDOR_PX, TOUCH_BAND_MIN_PX, findOpening, hitBandPx, wallsById } from './editModel';
import type { PlanSelection } from './editTypes';
import { PlanView } from './PlanView';
import { selectionFromTarget } from './selection';
import { svgElementAt } from './svgHitTest';

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

function proposal() {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

const PHONE = 11.6;
const LAPTOP = 23.5;

/** Render the plan of `derived` (Plan 1, "Vis hva som er nytt" on) and zoom it to `scale` px/m. */
function renderAt(derived: DerivedVariant, scale: number, coarse: boolean): SVGSVGElement {
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
        highlightNew
        coarsePointer={coarse}
      />,
    ),
  );
  const svg = container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
  for (let i = 0; i < 4 && Math.abs(zoomOf(svg) / scale - 1) > 1e-9; i++) {
    const f = Math.min(2, Math.max(0.5, scale / zoomOf(svg)));
    act(() => {
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(f) / 0.0015, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
    });
  }
  expect(zoomOf(svg)).toBeCloseTo(scale, 6);
  return svg;
}

function rootMatrix(svg: SVGSVGElement): number[] {
  const t = svg.querySelector('[data-plan-root]')!.getAttribute('transform')!;
  return /^matrix\(([^)]+)\)$/.exec(t)![1].split(' ').map(Number);
}

const zoomOf = (svg: SVGSVGElement) => rootMatrix(svg)[0];

function scr(svg: SVGSVGElement, p: Vec2): Vec2 {
  const [s, , , , tx, ty] = rootMatrix(svg);
  return [s * p[0] + tx, -s * p[1] + ty];
}

/** What a tap at a plan point selects: the topmost hit element's selection, `kind:id`. */
function tapAt(svg: SVGSVGElement, p: Vec2): string {
  const el = svgElementAt(svg, scr(svg, p));
  const sel: PlanSelection | null = selectionFromTarget(el);
  return sel ? `${sel.kind}:${sel.id}` : 'none';
}

/** Plan points `px` screen pixels on both sides of `c`, across the direction `u`. */
function across(svg: SVGSVGElement, c: Vec2, u: Vec2, px: number): Vec2[] {
  const k = px / zoomOf(svg);
  return [-1, 1].map((sgn) => [c[0] - u[1] * k * sgn, c[1] + u[0] * k * sgn] as Vec2);
}

const unitOf = (a: Vec2, b: Vec2): Vec2 => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

/** Centre and direction of a stored wall (its first piece) or of an opening. */
function wallCentre(d: DerivedVariant, id: string): { c: Vec2; u: Vec2 } {
  const w = wallsById(d.walls, id)[0];
  return { c: [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], u: unitOf(w.a, w.b) };
}

function openingCentre(d: DerivedVariant, id: string): { c: Vec2; u: Vec2 } {
  const { wall, opening } = findOpening(d, id)!;
  const u = unitOf(wall.a, wall.b);
  return { c: [wall.a[0] + u[0] * opening.offset, wall.a[1] + u[1] * opening.offset], u };
}

describe('the touch hit band (editModel.ts hitBandPx)', () => {
  it('is 0,25 m in plan metres, but at least 10 px and at most 24 px; 12 px with a mouse', () => {
    expect(TOUCH_BAND_MIN_PX).toBe(10);
    expect(hitBandPx(true, PHONE)).toBe(10);
    expect(hitBandPx(true, 46)).toBeCloseTo(11.5, 6);
    expect(hitBandPx(true, 60)).toBe(15);
    expect(hitBandPx(true, 138)).toBe(24);
    expect(hitBandPx(false, PHONE)).toBe(CORRIDOR_PX);
    expect(hitBandPx(true, Number.NaN)).toBe(24);
  });

  it('the plan shows it on its svg (data-hit-band) for the e2e tests', () => {
    const svg = renderAt(deriveForState(proposal().getState()), PHONE, true);
    expect(svg.getAttribute('data-hit-band')).toBe('10');
  });
});

describe('phone (11,6 px/m): walls, doors and ghosts are tappable, room names still select the room', () => {
  it('taps ±4 px from w-gang-n, w-104-103, dv-pass-n, d-sov-ny and o-vf select them (before: ±1,4 px)', () => {
    const d = deriveForState(proposal().getState());
    const svg = renderAt(d, PHONE, true);
    for (const id of ['w-gang-n', 'w-104-103', 'dv-pass-n']) {
      const { c, u } = wallCentre(d, id);
      for (const p of across(svg, c, u, 4)) expect(tapAt(svg, p), id).toBe(`wall:${wallsById(d.walls, id)[0].id}`);
    }
    for (const id of ['d-sov-ny', 'o-vf', 'door-mellom-vf']) {
      const { c, u } = openingCentre(d, id);
      for (const p of across(svg, c, u, 4)) expect(tapAt(svg, p), id).toBe(`opening:${id}`);
    }
  });

  it('the ghost of door-mellom-vf (moved 1,5 m) is selected by taps ±4 px from it', () => {
    const store = proposal();
    const d0 = deriveForState(store.getState());
    const offset = findOpening(d0, 'door-mellom-vf')!.opening.offset;
    expect(A.moveOpening(store, 'door-mellom-vf', offset + 1.5)).toBe(true);
    const d = deriveForState(store.getState());
    const ghost = d.walls.flatMap((w) => w.openings).find((o) => o.isGhost && o.id.startsWith('door-mellom-vf'))!;
    expect(ghost).toBeDefined();
    const svg = renderAt(d, PHONE, true);
    const { c, u } = openingCentre(d, ghost.id);
    for (const p of across(svg, c, u, 4)) expect(tapAt(svg, p)).toBe(`ghost:${ghost.id}`);
  });

  it('at least 22 of the 24 rooms are selected by a tap on their name (or their label point when no name fits)', () => {
    // Without the seed's furniture: a label point with no name drawn over a bed selects the bed (furniture layer).
    const d = { ...deriveForState(proposal().getState()), furniture: [] };
    const svg = renderAt(d, PHONE, true);
    const rooms = d.rooms.filter((r) => r.storeyId === 'ground');
    expect(rooms).toHaveLength(24);
    const misses: string[] = [];
    for (const r of rooms) {
      const hit = svg.querySelector(`[data-room-label-hit="${r.id}"]`);
      // The label's centre: its ScreenText group sits at the label's plan point.
      const g = hit?.parentElement?.getAttribute('transform');
      const at: Vec2 = g ? (/translate\(([^ ]+) ([^)]+)\)/.exec(g)!.slice(1, 3).map(Number) as Vec2) : r.labelPoint;
      const got = tapAt(svg, at);
      if (got !== `room:${r.id}`) misses.push(`${r.room?.name ?? r.id} → ${got}`);
    }
    expect(rooms.length - misses.length, misses.join('; ')).toBeGreaterThanOrEqual(22);
  });

  it('the label points of the 8 rooms the phone e2e test taps: all 8 select their room', () => {
    const d = { ...deriveForState(proposal().getState()), furniture: [] };
    const svg = renderAt(d, PHONE, true);
    const names = ['Stue', 'Kjøkken', 'Spiseplass', 'Soverom (ny fløy)', 'Hovedbad', 'Soverom 1', 'Soverom 2', 'Vindfang'];
    const rooms = d.rooms.filter((r) => r.room && names.includes(r.room.name));
    expect(rooms).toHaveLength(8);
    const misses = rooms.map((r) => ({ r, got: tapAt(svg, r.labelPoint) })).filter(({ r, got }) => got !== `room:${r.id}`);
    expect(misses.map(({ r, got }) => `${r.room?.name} → ${got}`)).toEqual([]);
  });

  it('furnished seed: on the phone every room name drawn selects its room; with a mouse a name over furniture gives the item', () => {
    const d = deriveForState(proposal().getState());
    expect(d.furniture.length).toBeGreaterThan(50);
    for (const [scale, coarse] of [
      [PHONE, true],
      [LAPTOP, false],
    ] as const) {
      const svg = renderAt(d, scale, coarse);
      const drawn = d.rooms.filter((r) => r.storeyId === 'ground' && svg.querySelector(`[data-room-label-hit="${r.id}"]`));
      // As many names as without furniture (7 on the phone: Stue, Kjøkken, Bad, Bod (ny), Gang, Soverom (ny fløy),
      // Passasje; names move off furniture rather than disappear).
      const withArea = (s: SVGSVGElement) => [...s.querySelectorAll('[data-room-label]')].filter((l) => (l.textContent ?? '').includes('m²')).length;
      const areaFurnished = withArea(svg);
      const bare = renderAt({ ...d, furniture: [] }, scale, coarse);
      const bareCount = d.rooms.filter((r) => r.storeyId === 'ground' && bare.querySelector(`[data-room-label-hit="${r.id}"]`)).length;
      // A name moved off furniture may drop its area line (the bed under it stays tappable): on the laptop 10 of the
      // 17 areas stay in the labels (Romskjema and Egenskaper have them all).
      expect(areaFurnished).toBeLessThanOrEqual(withArea(bare));
      if (scale === LAPTOP) expect(areaFurnished).toBeGreaterThanOrEqual(10);
      // The same root (and svg) again with the furniture: the bare render above replaced it.
      renderAt(d, scale, coarse);
      expect(drawn.length).toBe(bareCount);
      expect(drawn.length).toBeGreaterThanOrEqual(scale === PHONE ? 7 : 20);
      const misses = drawn.flatMap((r) => {
        const g = svg.querySelector(`[data-room-label-hit="${r.id}"]`)!.parentElement!.getAttribute('transform')!;
        const at = /translate\(([^ ]+) ([^)]+)\)/.exec(g)!.slice(1, 3).map(Number) as Vec2;
        const got = tapAt(svg, at);
        return got === `room:${r.id}` ? [] : [{ name: r.room?.name ?? r.id, got }];
      });
      // Phone: names win (rooms are tapped by name; a second tap there gives the item, `cycleFurnitureRoom`). Mouse:
      // the furniture under a name wins (a second click on it gives the room).
      if (scale === PHONE) expect(misses, `${scale} px/m`).toEqual([]);
      else for (const m of misses) expect(m.got, m.name).toMatch(/^furniture:/);
      // The bed in Soverom 1 (no name drawn there on the phone) is tapped where it is.
      if (scale === PHONE) expect(tapAt(svg, d.furniture.find((f) => f.id === 'fu-sov1-1')!.item.position)).toBe('furniture:fu-sov1-1');
      if (scale === LAPTOP) {
        // The bed in Soverom (ny fløy): its middle is the bed's (the room's name moved off it).
        expect(tapAt(svg, [19.64, 4.75])).toBe('furniture:fu-sov-ny-1');
        // A rug is taken by its edge only: inside it, the room under it; the coffee table on it is drawn above it.
        expect(tapAt(svg, [6.4, -0.5])).toBe('room:room-leseskrok');
        expect(tapAt(svg, [5.8, -0.6])).toBe('furniture:fu-leseskrok-5');
        // The coffee table on the rug: where the room's name covers it the name wins (a name keeps its tap area above
        // furniture), elsewhere the table.
        const box = svg.querySelector('[data-room-label-hit="room-leseskrok"]')!.getAttribute('data-label-box')!.split(' ').map(Number);
        const inBox = (p: Vec2) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
        const table: Vec2[] = [];
        for (let x = 6.72; x < 7.3; x += 0.04) for (let y = -1.63; y < -1.06; y += 0.04) table.push([x, y]);
        for (const p of table) expect(tapAt(svg, p), `${p}`).toBe(inBox(p) ? 'room:room-leseskrok' : 'furniture:fu-leseskrok-3');
      }
    }
    // Two full plan renders of the furnished seed per scale (about 4 s alone, more while the whole suite runs).
  }, 30_000);

  it('laptop (23,5 px/m, mouse): every room by its name, and walls ±4 px', () => {
    // Without the seed's furniture (with a mouse an item under a name wins the click).
    const d = { ...deriveForState(proposal().getState()), furniture: [] };
    const svg = renderAt(d, LAPTOP, false);
    const rooms = d.rooms.filter((r) => r.storeyId === 'ground');
    const ok = rooms.filter((r) => {
      const g = svg.querySelector(`[data-room-label-hit="${r.id}"]`)?.parentElement?.getAttribute('transform');
      const at: Vec2 = g ? (/translate\(([^ ]+) ([^)]+)\)/.exec(g)!.slice(1, 3).map(Number) as Vec2) : r.labelPoint;
      return tapAt(svg, at) === `room:${r.id}`;
    });
    expect(ok).toHaveLength(24);
    for (const id of ['w-gang-n', 'w-104-103', 'dv-pass-n']) {
      const { c, u } = wallCentre(d, id);
      for (const p of across(svg, c, u, 4)) expect(tapAt(svg, p), id).toBe(`wall:${wallsById(d.walls, id)[0].id}`);
    }
  });
});

describe('ghosts are not covered by room names', () => {
  it('after deleting w-104-103, a click on its ghost at (3,05; 5,2) selects the ghost (it selected Soverom 1)', () => {
    const store = proposal();
    expect(A.deleteWall(store, 'w-104-103')).toBe(true);
    const d = deriveForState(store.getState());
    for (const [scale, coarse] of [
      [LAPTOP, false],
      [PHONE, true],
      [40, false],
    ] as const) {
      const svg = renderAt(d, scale, coarse);
      expect(tapAt(svg, [3.05, 5.2]), `${scale}`).toBe('ghost:w-104-103');
      // The merged room's name keeps clear of the ghost (labels avoid ghosts while they are shown).
      for (const hit of svg.querySelectorAll('[data-room-label-hit]')) {
        const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => Number(hit.getAttribute(a)));
        const t = /translate\(([^ ]+) ([^)]+)\)/.exec(hit.parentElement!.getAttribute('transform')!)!.slice(1, 3).map(Number);
        const c = scr(svg, [t[0], t[1]]);
        const g = scr(svg, [3.05, 5.2]);
        const inside = g[0] >= c[0] + x && g[0] <= c[0] + x + w && g[1] >= c[1] + y && g[1] <= c[1] + y + h;
        expect(inside, hit.getAttribute('data-room-label-hit') ?? '').toBe(false);
      }
    }
  });
});

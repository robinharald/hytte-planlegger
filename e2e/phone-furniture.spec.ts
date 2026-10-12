/**
 * Phase 2b on a phone (the 'iphone' project: iPhone 13 viewport and touch on Chromium), dad's iPhone:
 *  - Møbler opens the library as a bottom sheet; a tap on "Stol" places a chair, closes the sheet and selects the
 *    chair; a finger drags it 1 m;
 *  - the proposals menu: "+ Nytt forslag" in the menu makes a proposal, "Gi nytt navn" renames it;
 *  - Nytt bygg → Vedskjul tapped 0.4 m from the wing's north wall attaches to it (the placement reaches the whole
 *    pointer radius again); the selected shed nudged 0.5 m with a finger at the starting zoom moves 0.5 m;
 *  - a tap on «Bod (ny)»'s name selects the room (the second review: the wall's band won).
 * Fix round after 2b:
 *  - with the bed in Soverom (ny fløy) selected, the review's taps at the starting zoom (wardrobe, armchair, door,
 *    rug) select what the plan has there and never turn the bed (the rotate handle is not drawn there on touch);
 *    zoomed in, with the handle drawn, taps on the wardrobe, the door d-sov-ny and the rug's edge select them, and a
 *    tap on the handle where it stands on the rug goes to what lies under it; the bed never turns;
 *  - a pinch with one finger on the rotate handle (where it stands on the floor, so the handle keeps the press) and
 *    one on the bed zooms and moves nothing, whichever finger comes first; a lone tap on the handle still turns it;
 *  - with nothing selected, a library tap places the item in a room on screen; Slett in the mini-bar and the next
 *    tap-place too, three times (before: each one landed farther south, under the sheet, on the lawn);
 *  - Nytt bygg → Vedskjul tapped in the middle of the north deck stays within 0.3 m of the tap (no 2 m snap);
 *  - a selected door has its end handles outside its jambs at the starting zoom; dragging one stores whole cm and the
 *    other jamb stays.
 * Screenshot: phone-library.png (the library sheet), phone-rotate-handle.png (zoomed in, the bed's handle).
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { Vec2 } from '../src/model/types';
import {
  activeVariant,
  assertNoGenericWarnings,
  collectPageErrors,
  derivedFurniture,
  dismissToasts,
  type HytteWindow,
  loadAndWaitReady,
  planScale,
  planToClient,
  projectOnScreen,
  roomTapPoint,
  selection,
  shoot,
  skipFirstRun,
  tapPlan,
  touchDrag,
  touchSession,
} from './helpers';

function bbox(poly: Vec2[]): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(...poly.map((p) => p[0])),
    y0: Math.min(...poly.map((p) => p[1])),
    x1: Math.max(...poly.map((p) => p[0])),
    y1: Math.max(...poly.map((p) => p[1])),
  };
}

async function phoneProposal(page: Page): Promise<void> {
  await loadAndWaitReady(page);
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('new-proposal').tap();
  await expect.poll(async () => (await projectOnScreen(page)).variants.length).toBe(2);
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'true');
  await dismissToasts(page);
  await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
}

async function pinch(cdp: CDPSession, at: Vec2, d0: number, d1: number, steps = 10): Promise<void> {
  const pts = (d: number) => [
    { x: at[0] - d, y: at[1], id: 1 },
    { x: at[0] + d, y: at[1], id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Is the client point inside the plan's box on screen (and inside the viewport)? */
async function onPlan(page: Page, p: Vec2): Promise<boolean> {
  const box = await page.getByTestId('plan-view').boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) return false;
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, vp.height);
  return p[0] > box.x + 2 && p[0] < box.x + box.width - 2 && p[1] > top + 2 && p[1] < bottom - 2;
}

/**
 * A client point of `footprint` (plan metres, sampled on a grid, middle first) where the topmost plan element is
 * `selector`'s, also 3 px around it (the rotate handle hidden, as if it were not drawn); null if there is none.
 */
async function pointHitting(page: Page, footprint: Vec2[], selector: string): Promise<Vec2 | null> {
  return page.evaluate(
    ({ footprint, selector }) => {
      type P = [number, number];
      const svg = document.querySelector<SVGSVGElement>('[data-testid=plan-view]');
      const m = svg?.querySelector<SVGGElement>('[data-plan-root]')?.getScreenCTM();
      if (!svg || !m) throw new Error('the plan is not on screen');
      const toClient = (q: P): P => {
        const pt = svg.createSVGPoint();
        pt.x = q[0];
        pt.y = q[1];
        const r = pt.matrixTransform(m);
        return [r.x, r.y];
      };
      const xs = footprint.map((q) => q[0]);
      const ys = footprint.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const cands: P[] = [];
      for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) cands.push([x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * j) / 20]);
      const c: P = [(x0 + x1) / 2, (y0 + y1) / 2];
      cands.sort((a, b) => Math.hypot(a[0] - c[0], a[1] - c[1]) - Math.hypot(b[0] - c[0], b[1] - c[1]));
      const rotate = [...document.querySelectorAll<SVGElement>('[data-layer="furniture-rotate"]')];
      rotate.forEach((el) => (el.style.display = 'none'));
      try {
        for (const q of cands) {
          const [x, y] = toClient(q);
          if (x < 6 || y < 6 || x > innerWidth - 6 || y > innerHeight - 6) continue;
          // The point and 3 px around it (a finger's tap is adjusted to nearby targets).
          const around: P[] = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]];
          if (around.every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy)?.closest(selector))) return [x, y] as P;
        }
        return null;
      } finally {
        rotate.forEach((el) => (el.style.display = ''));
      }
    },
    { footprint, selector },
  );
}

/** The rotate handle of `id` on screen: its middle and radius (client px), or null when it is not drawn. */
async function rotateHandle(page: Page, id: string): Promise<{ at: Vec2; r: number } | null> {
  const hit = page.locator(`[data-testid=plan-view] [data-rotate-hit="${id}"]`);
  if ((await hit.count()) === 0) return null;
  const b = await hit.boundingBox();
  return b ? { at: [b.x + b.width / 2, b.y + b.height / 2], r: b.width / 2 } : null;
}

/** What lies under a client point with the rotate handles hidden: 'floor' (a room, block or deck, no item, no name) or what else. */
async function underHandle(page: Page, at: Vec2, rug: Vec2[]): Promise<string> {
  return page.evaluate(
    ({ at, rug }) => {
      const svg = document.querySelector<SVGSVGElement>('[data-testid=plan-view]');
      const inv = svg?.querySelector<SVGGElement>('[data-plan-root]')?.getScreenCTM()?.inverse();
      if (!svg || !inv) throw new Error('the plan is not on screen');
      const rotate = [...document.querySelectorAll<SVGElement>('[data-layer="furniture-rotate"]')];
      rotate.forEach((el) => (el.style.display = 'none'));
      try {
        const el = document.elementFromPoint(at[0], at[1]);
        if (!el) return 'nothing';
        if (el.closest('[data-room-label-hit]')) return 'room name';
        const item = el.closest('[data-furniture-id]');
        if (item) return `item ${item.getAttribute('data-furniture-id')}`;
        if (el.closest('[data-sel-kind="opening"], [data-sel-kind="wall"], [data-sel-kind="ghost"]')) return 'wall or opening';
        const pt = svg.createSVGPoint();
        pt.x = at[0];
        pt.y = at[1];
        const q = pt.matrixTransform(inv);
        const xs = rug.map((r) => r[0]);
        const ys = rug.map((r) => r[1]);
        if (q.x >= Math.min(...xs) && q.x <= Math.max(...xs) && q.y >= Math.min(...ys) && q.y <= Math.max(...ys)) return 'rug';
        return 'floor';
      } finally {
        rotate.forEach((el) => (el.style.display = ''));
      }
    },
    { at, rug },
  );
}

test.describe('phase 2b on an iPhone', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('the library as a sheet: tap "Stol" to place a chair, then drag it 1 m', async ({ page }, testInfo) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    const before = new Set((await activeVariant(page)).furniture.map((f) => f.id));
    await page.getByTestId('tool-furniture').tap();
    const sheet = page.getByTestId('furniture-library-sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300);
    await shoot(page, testInfo, 'phone-library');

    await sheet.getByTestId('furniture-search').fill('stol');
    await sheet.getByTestId('furniture-item-stol').tap();
    await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(before.size + 1);
    const chair = (await activeVariant(page)).furniture.find((f) => !before.has(f.id));
    if (!chair) throw new Error('no chair');
    expect(chair.catalogId).toBe('stol');
    await expect(sheet, 'the sheet closes after a placement').toHaveCount(0);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'furniture', id: chair.id });
    await expect(page.getByTestId('mini-bar')).toBeVisible();
    await dismissToasts(page);

    // Zoom in on it with two fingers, then drag it 1 m east with one.
    await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
    await pinch(cdp, await planToClient(page, chair.position), 20, 60);
    await expect.poll(() => planScale(page)).toBeGreaterThan(25);
    await touchDrag(cdp, await planToClient(page, chair.position), await planToClient(page, [chair.position[0] + 1, chair.position[1]]), 16);
    await expect.poll(async () => (await activeVariant(page)).furniture.find((f) => f.id === chair.id)?.position[0] ?? 0).toBeGreaterThan(chair.position[0] + 0.3);
    // About 1 m: a snap (to a wall or another item's edge) takes back at most half the drag.
    const moved = (await activeVariant(page)).furniture.find((f) => f.id === chair.id);
    const dx = (moved?.position[0] ?? 0) - chair.position[0];
    expect(dx, `moved ${dx.toFixed(2)} m`).toBeGreaterThanOrEqual(0.5);
    expect(dx, `moved ${dx.toFixed(2)} m`).toBeLessThanOrEqual(1.25);
    expect(await selection(page)).toMatchObject({ kind: 'furniture', id: chair.id });
  });

  test('the proposals menu: make a proposal and rename it', async ({ page }) => {
    await loadAndWaitReady(page);
    await page.getByTestId('proposals-menu').tap();
    await expect(page.getByTestId('proposals-list')).toBeVisible();
    await expect(page.getByTestId('proposal-item-forslag-d')).toContainText('Forslag D');
    page.once('dialog', (d) => void d.accept('Pappas idé'));
    await page.getByTestId('menu-new-proposal').tap();
    await expect.poll(async () => (await projectOnScreen(page)).variants.map((v) => v.name)).toEqual(['Forslag D', 'Pappas idé']);
    const id = (await activeVariant(page)).id;
    expect((await activeVariant(page)).locked).toBeUndefined();
    await dismissToasts(page);
    page.once('dialog', (d) => void d.accept('Pappas hytte'));
    await page.getByTestId('rename-proposal').tap();
    await expect.poll(async () => (await activeVariant(page)).name).toBe('Pappas hytte');
    await page.getByTestId('proposals-menu').tap();
    await expect(page.getByTestId(`proposal-item-${id}`)).toContainText('Pappas hytte');
    await expect(page.getByTestId('status-pill')).toHaveAttribute('data-state', 'local');
  });

  test('a Vedskjul tapped 0.4 m from the wing attaches to it; nudged 0.5 m at the starting zoom it moves 0.5 m', async ({ page }) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    expect(await planScale(page), 'the starting zoom').toBeLessThan(16);
    await page.getByTestId('tool-unit').tap();
    await page.getByTestId('unit-vedskjul').tap();
    await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
    // The 2 × 1,5 m shed's south edge 0.4 m north of the wing's north wall (y 6.2): its centre at y 6.2 + 0.4 + 0.75.
    await tapPlan(page, [18, 7.35]);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(5);
    const unit = (await activeVariant(page)).blocks[4];
    const b0 = bbox(unit.polygon.map((q) => q.p));
    expect(b0.y0, 'attached to the wing (placement reaches the whole finger radius)').toBeCloseTo(6.2, 2);
    const junctions = await page.evaluate(
      (id) => (window as HytteWindow).__hytte?.derived?.blocks.find((b) => b.block.id === id)?.junctions.map((j) => j.otherBlockId) ?? [],
      unit.id,
    );
    expect(junctions).toContain('blk-wing');
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: unit.id });
    await dismissToasts(page);

    // A 0.5 m nudge (5.8 px at 11.56 px/m) with a finger on the selected shed moves it 0.5 m along the wall.
    const c: Vec2 = [(b0.x0 + b0.x1) / 2, (b0.y0 + b0.y1) / 2];
    await touchDrag(cdp, await planToClient(page, c), await planToClient(page, [c[0] + 0.5, c[1]]), 8);
    const box = async () => bbox((await activeVariant(page)).blocks.find((b) => b.id === unit.id)?.polygon.map((q) => q.p) ?? []);
    await expect.poll(async () => (await box()).x0).toBeGreaterThan(b0.x0 + 0.3);
    const b1 = await box();
    expect(b1.x0 - b0.x0, `moved ${(b1.x0 - b0.x0).toFixed(2)} m`).toBeCloseTo(0.5, 1);
    expect(b1.y0, 'still against the wing').toBeCloseTo(6.2, 2);
    expect(await selection(page)).toMatchObject({ kind: 'block', id: unit.id });
  });

  test('a tap on the name of «Bod (ny)» selects the room', async ({ page }) => {
    await phoneProposal(page);
    await expect(page.locator('[data-testid=plan-view] [data-room-label-hit="room-bod-ny"]')).toHaveCount(1);
    const at = await roomTapPoint(page, 'room-bod-ny');
    await page.touchscreen.tap(at[0], at[1]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'room', id: 'room-bod-ny' });
  });
});

test.describe('fix round after 2b on an iPhone', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  const BED = 'fu-sov-ny-1';
  const bedState = async (page: Page) => {
    const f = (await activeVariant(page)).furniture.find((x) => x.id === BED);
    return { position: f?.position, rotationDeg: f?.rotationDeg };
  };
  /**
   * Tap the bed (a second tap when the first gives the room under a name: `cycleFurnitureRoom`). Esc first: the mini-bar
   * of what is selected floats by it and may lie over the bed.
   */
  const selectBed = async (page: Page, at: Vec2) => {
    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page)).toBeNull();
    await tapPlan(page, at);
    await expect.poll(async () => (await selection(page))?.kind ?? 'none').not.toBe('none');
    if ((await selection(page))?.id !== BED) await tapPlan(page, at);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'furniture', id: BED });
  };

  test('with the bed selected, taps on the wardrobe, the door and the rug select them; the bed never turns', async ({ page }, testInfo) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    expect(await planScale(page), 'the starting zoom').toBeLessThan(16);
    const bed0 = await bedState(page);
    expect(bed0.rotationDeg).toBe(270);
    const items = await derivedFurniture(page);
    const fp = (id: string) => (items.find((f) => f.id === id)?.footprint ?? []) as Vec2[];
    const door = await page.evaluate(() => {
      const d = (window as HytteWindow).__hytte?.derived;
      for (const w of d?.walls ?? []) {
        const o = w.openings.find((x) => x.id === 'd-sov-ny');
        if (!o) continue;
        const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        const u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
        const at = (s: number, n: number): [number, number] => [w.a[0] + u[0] * s - u[1] * n, w.a[1] + u[1] * s + u[0] * n];
        return [at(o.offset - o.width / 2 + 0.1, -0.05), at(o.offset + o.width / 2 - 0.1, -0.05), at(o.offset + o.width / 2 - 0.1, 0.05), at(o.offset - o.width / 2 + 0.1, 0.05)];
      }
      return [];
    });
    expect(door.length).toBe(4);
    // At the starting zoom the touch handle would cover more than 0.3 m: it is not drawn (the mini-bar has Roter).
    await selectBed(page, [19.9, 4.75]);
    expect(await rotateHandle(page, BED)).toBeNull();
    type Target = [string, Vec2[], string, { kind: string; id: string }];
    const tapTargets = async (targets: Target[]) => {
      for (const [name, area, selector, want] of targets) {
        await selectBed(page, [19.9, 4.75]);
        const at = await pointHitting(page, area, selector);
        expect(at, `a point of ${name} on screen`).not.toBeNull();
        await page.touchscreen.tap(at![0], at![1]);
        await expect.poll(() => selection(page), name).toMatchObject(want);
        expect(await bedState(page), `the bed after the tap on ${name}`).toEqual(bed0);
      }
    };
    // The review's taps at the starting zoom (each turned the bed before): the wardrobe, the armchair, the door and the
    // rug. Each selects what the plan has there (the wall's touch band over the 0.6 m wardrobe, the room's name over the
    // armchair, …), never the bed again, and the bed does not turn.
    for (const [name, at] of [
      ['the wardrobe', [16.36, 4.925]],
      ['the armchair', [17.35, 5.69]],
      ['the door', [17.3, 3.4]],
      ['the rug', [17.8, 4.2]],
    ] as [string, Vec2][]) {
      await selectBed(page, [19.9, 4.75]);
      await tapPlan(page, at);
      await expect.poll(async () => (await selection(page))?.id ?? 'none', name).not.toBe(BED);
      expect(await bedState(page), `the bed after the tap on ${name}`).toEqual(bed0);
    }

    // Zoomed in (about 40 px/m) the handle is drawn, at most 0.3 m in radius. Taps on the wardrobe, the door and the
    // rug's edge select them; a tap on the handle where it stands on the rug (or the room's name) selects what is under
    // it (the room), not a turn of the bed.
    await pinch(cdp, await planToClient(page, [18.6, 4.75]), 20, 70);
    await expect.poll(() => planScale(page)).toBeGreaterThan(34);
    const s = await planScale(page);
    await selectBed(page, [19.9, 4.75]);
    expect(await rotateHandle(page, BED), 'the handle is drawn when zoomed in').not.toBeNull();
    await tapTargets([
      ['the wardrobe', fp('fu-sov-ny-4'), '[data-furniture-id="fu-sov-ny-4"]', { kind: 'furniture', id: 'fu-sov-ny-4' }],
      ['the door', door, '[data-sel-kind="opening"][data-sel-id="d-sov-ny"]', { kind: 'opening', id: 'd-sov-ny' }],
      ['the rug', fp('fu-sov-ny-5'), '[data-furniture-id="fu-sov-ny-5"]', { kind: 'furniture', id: 'fu-sov-ny-5' }],
    ]);
    await selectBed(page, [19.9, 4.75]);
    const h = await rotateHandle(page, BED);
    expect(h, 'the handle is drawn when zoomed in').not.toBeNull();
    // Its radius (the box less its 2 px stroke) is at most 0.3 m.
    expect(h!.r - 1).toBeLessThanOrEqual(0.3 * s + 0.5);
    // It stands on the rug (or on the room's name over it): both are what the tap is for.
    expect(['rug', 'room name']).toContain(await underHandle(page, h!.at, fp('fu-sov-ny-5')));
    await dismissToasts(page);
    await shoot(page, testInfo, 'phone-rotate-handle');
    await page.touchscreen.tap(h!.at[0], h!.at[1]);
    await expect.poll(async () => (await selection(page))?.id).not.toBe(BED);
    expect(['room-sov-ny', 'fu-sov-ny-5']).toContain((await selection(page))?.id);
    expect(await bedState(page)).toEqual(bed0);
  });

  test('a pinch with one finger on the rotate handle zooms and moves nothing; a lone tap on it still turns', async ({ page }) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    // Room names off (Vis → Navn på rom), and close in on the bed's foot until its handle stands on the floor between the
    // foot and the rug (0.24 m wide): there the handle keeps the press (on the rug or a name it hands it to the plan).
    const labels = page.getByTestId('toggle-labels');
    if (!(await labels.isVisible())) await page.locator('details.panel', { has: labels }).locator('summary').tap();
    await labels.uncheck();
    await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
    await pinch(cdp, await planToClient(page, [18.6, 4.75]), 12, 120);
    await expect.poll(() => planScale(page)).toBeGreaterThan(90);
    await selectBed(page, [19.0, 4.75]);
    const bed0 = await bedState(page);
    const rug = ((await derivedFurniture(page)).find((f) => f.id === 'fu-sov-ny-5')?.footprint ?? []) as Vec2[];

    const twoFingers = async (handleFirst: boolean) => {
      const h = await rotateHandle(page, BED);
      expect(h, 'the handle is drawn').not.toBeNull();
      expect(await underHandle(page, h!.at, rug), 'under the handle').toBe('floor');
      const a = h!.at;
      const b = await planToClient(page, [18.85, 4.75]);
      expect(b[0] - a[0], 'the bed finger is east of the handle').toBeGreaterThan(h!.r + 4);
      const s0 = await planScale(page);
      const A = (dx: number) => ({ x: a[0] - dx, y: a[1], id: 1 });
      const B = (dx: number) => ({ x: b[0] + dx, y: b[1], id: 2 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: handleFirst ? [A(0)] : [B(0)] });
      await page.waitForTimeout(40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [A(0), B(0)] });
      for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [A(4 * i), B(4 * i)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => planScale(page), `zoomed (${handleFirst ? 'handle' : 'bed'} finger first)`).toBeGreaterThan(s0 * 1.2);
      await page.waitForTimeout(300);
      expect(await bedState(page), `the bed after the pinch (${handleFirst ? 'handle' : 'bed'} finger first)`).toEqual(bed0);
      await expect(page.locator('[data-testid=plan-view] [data-rotate-preview]')).toHaveCount(0);
    };
    await twoFingers(true);
    // Back out a little so the next pinch has room to zoom in, then the other order.
    await pinch(cdp, await planToClient(page, [18.6, 4.75]), 80, 40);
    await expect.poll(async () => (await selection(page))?.id).toBe(BED);
    await twoFingers(false);

    // A lone tap on the handle still turns the bed 90° (one step).
    const h = await rotateHandle(page, BED);
    expect(await underHandle(page, h!.at, rug)).toBe('floor');
    await page.touchscreen.tap(h!.at[0], h!.at[1]);
    await expect.poll(async () => (await bedState(page)).rotationDeg).not.toBe(270);
    expect([0, 180]).toContain((await bedState(page)).rotationDeg);
  });

  test('with nothing selected, library taps land in a room on screen, also after Slett, three times', async ({ page }) => {
    await phoneProposal(page);
    expect(await selection(page)).toBeNull();
    const placed: string[] = [];
    for (const id of ['stol', 'kommode', 'seng-90']) {
      const before = new Set((await activeVariant(page)).furniture.map((f) => f.id));
      await page.getByTestId('tool-furniture').tap();
      const sheet = page.getByTestId('furniture-library-sheet');
      await expect(sheet).toBeVisible();
      await sheet.getByTestId('furniture-search').fill(id === 'seng-90' ? 'seng' : id);
      await sheet.getByTestId(`furniture-item-${id}`).tap();
      await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(before.size + 1);
      const item = (await activeVariant(page)).furniture.find((f) => !before.has(f.id));
      if (!item) throw new Error(`no ${id}`);
      await expect(sheet).toHaveCount(0);
      const d = (await derivedFurniture(page)).find((f) => f.id === item.id);
      expect(d?.roomId, `${id} at ${item.position.map((v) => v.toFixed(2)).join(', ')} is in a room`).toBeTruthy();
      await expect.poll(async () => onPlan(page, await planToClient(page, item.position)), `${id} is on screen`).toBe(true);
      placed.push(`${id} → ${d?.roomId}`);
      await dismissToasts(page);
      await page.getByTestId('mini-delete').tap();
      await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(before.size);
      await expect.poll(() => selection(page)).toBeNull();
    }
    expect(placed.length).toBe(3);
  });

  test('Nytt bygg → Vedskjul tapped in the middle of the north deck stays within 0.3 m of the tap', async ({ page }) => {
    await phoneProposal(page);
    expect(await planScale(page), 'the starting zoom').toBeLessThan(16);
    await page.getByTestId('tool-unit').tap();
    await page.getByTestId('unit-vedskjul').tap();
    await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
    await tapPlan(page, [14, 9.35]);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(5);
    const b = bbox((await activeVariant(page)).blocks[4].polygon.map((q) => q.p));
    const c: Vec2 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const off = Math.hypot(c[0] - 14, c[1] - 9.35);
    expect(off, `the shed's middle at ${c.map((v) => v.toFixed(2)).join(', ')}`).toBeLessThanOrEqual(0.3);
  });

  test('a selected door has end handles outside its jambs at the starting zoom; a drag stores whole cm', async ({ page }) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    expect(await planScale(page), 'the starting zoom').toBeLessThan(16);
    await tapPlan(page, [7.01, 6.2]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'opening', id: 'door-mellom-vf' });
    const start = page.locator('[data-testid=plan-view] [data-handle="oe:start"]');
    const end = page.locator('[data-testid=plan-view] [data-handle="oe:end"]');
    await expect(start).toHaveCount(1);
    await expect(end).toHaveCount(1);
    // The door runs x 6.555–7.465 on the north wall (y 6.2); its handles stand outside those jambs.
    const centre = async (l: typeof start): Promise<Vec2> => {
      const bb = await l.boundingBox();
      if (!bb) throw new Error('no handle box');
      return [bb.x + bb.width / 2, bb.y + bb.height / 2];
    };
    const [jw, je] = [await planToClient(page, [6.555, 6.2]), await planToClient(page, [7.465, 6.2])];
    const hs = await centre(start);
    const he = await centre(end);
    const xs = [hs[0], he[0]].sort((p, q) => p - q);
    expect(xs[0], 'the west handle is west of the west jamb').toBeLessThan(jw[0]);
    expect(xs[1], 'the east handle is east of the east jamb').toBeGreaterThan(je[0]);
    // Drag the west one 0.5 m east (5.8 px): the door gets narrower, in whole centimetres, and its east jamb stays.
    const west = hs[0] < he[0] ? hs : he;
    const s = await planScale(page);
    const door0 = (await activeVariant(page)).openings.find((o) => o.id === 'door-mellom-vf');
    await touchDrag(cdp, west, [west[0] + 0.5 * s, west[1]], 10);
    await expect.poll(async () => (await activeVariant(page)).openings.find((o) => o.id === 'door-mellom-vf')?.width ?? 0).toBeLessThan((door0?.width ?? 0) - 0.1);
    const w = (await activeVariant(page)).openings.find((o) => o.id === 'door-mellom-vf')?.width ?? 0;
    expect(Math.abs(w * 100 - Math.round(w * 100)), `width ${w} in whole cm`).toBeLessThan(1e-9);
    const east = await page.evaluate(() => {
      const d = (window as HytteWindow).__hytte?.derived;
      for (const wall of d?.walls ?? []) {
        const o = wall.openings.find((x) => x.id === 'door-mellom-vf');
        if (!o) continue;
        const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
        const ux = (wall.b[0] - wall.a[0]) / L;
        return Math.max(wall.a[0] + ux * (o.offset - o.width / 2), wall.a[0] + ux * (o.offset + o.width / 2));
      }
      return NaN;
    });
    expect(east, 'the east jamb stays').toBeCloseTo(7.465, 2);
  });
});

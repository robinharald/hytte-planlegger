/**
 * Editing on a phone (docs/phase2-plan.md §1 rule 4, §3.1; the 'iphone' project in playwright.config.ts: iPhone 13
 * viewport and touch, on Chromium). Dad plays with ideas on his iPhone:
 *  - open the app and make "Nytt forslag";
 *  - a one-finger drag across the plan pans it and moves nothing; two fingers zoom;
 *  - tap a new wall (w-gang-n) and drag it with one finger: it moves;
 *  - the mini-bar's Egenskaper opens the properties bottom sheet; type a number (the wall's Tykkelse);
 *  - Dør/vindu → Dør, tap on a wall: a door is placed and the tool goes back to Velg (the door selected).
 * Fix round after 2a, all at the starting zoom (about 11.6 px/m):
 *  - taps on 8 rooms' label points select the room (at least 7 of 8; before, walls and doors won most taps); since
 *    2b on the drawn name, else on the floor beside the furniture, 9 rooms with «Bod (ny)» (at least 8 of 9);
 *  - a selected door dragged 1.5 m moves and keeps its width (before, the end handles covered it and it shrank);
 *  - a freshly placed Vedskjul dragged by its body moves and keeps its size;
 *  - the Egenskaper sheet for a wall leaves the wall in view above the sheet (the plan pans);
 *  - the tool row shows all six tools on the 390 px screen.
 * Second fix round after 2a, at the starting zoom:
 *  - taps 4 px to either side of three walls and a door select them (the touch band is at least 10 px, data-hit-band);
 *  - the Vedskjul dragged 2 m west moves 2 ± 0.25 m and 1 m north moves about 1 m (snapping no longer adds metres
 *    or pulls it back);
 *  - a tap on a placed unit selects the unit, a second tap its room (whose mini-bar has "Roter 90°" and "Velg
 *    bygningsdelen");
 *  - the delete toast sits below the tool row and the hint line, also with the tool row scrolled to the top.
 * Final fix round (the first-time flow and the door's end handles, at the starting zoom):
 *  - move a door, then Nytt bygg → Vedskjul: the mini-bar is gone, and a tap where its Slett stood places the shed
 *    (before: it deleted the door);
 *  - with d-sov-ny selected, taps near it on o-stue-gang, w-gang-n, Gang and the bed select what they select with
 *    nothing selected (before: the 1.2 m end-handle circles kept the door selected);
 *  - with door-mellom-vf selected, a one-finger drag started 1.4 m from it pans (before: it widened the door);
 *  - the whole first-time flow at the starting zoom, from the first-run card: «+ Nytt forslag», the door moved, Nytt
 *    bygg → Vedskjul tapped where the door's Slett stood (the shed, no warning, the door kept), Soverom (ny fløy)
 *    zoomed in and furnished from the library with nothing selected (Kommode in that room, free), Dupliser (the copy
 *    free), Send — and the link opened on another device brings the proposal with all of it.
 * Screenshots: phone-edit.png (the dragged wall selected, handles and the mini-bar), phone-sheet.png (the sheet),
 * phone-tools.png (the tool row), phone-toast.png (the delete toast below the tool row), phone-first-flow.png (the
 * duplicated chest of drawers in Soverom (ny fløy), Egenskaper open).
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { join } from 'node:path';
import type { Vec2 } from '../src/model/types';
import {
  SCREENSHOT_DIR,
  activeVariant,
  assertNoGenericWarnings,
  collectPageErrors,
  dismissToasts,
  type HytteWindow,
  loadAndWaitReady,
  planScale,
  planToClient,
  planTransform,
  projectOnScreen,
  roomTapPoint,
  selection,
  shoot,
  skipFirstRun,
  tapPlan,
  touchDrag,
  touchDragPlan,
  touchSession,
} from './helpers';

const rootTransform = planTransform;

function bbox(poly: Vec2[]): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(...poly.map((p) => p[0])),
    y0: Math.min(...poly.map((p) => p[1])),
    x1: Math.max(...poly.map((p) => p[0])),
    y1: Math.max(...poly.map((p) => p[1])),
  };
}

/** "+ Nytt forslag" (the name prompt accepted as it is), toasts closed, the plan scrolled into view; the starting zoom. */
async function phoneProposal(page: Page): Promise<void> {
  await loadAndWaitReady(page);
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('new-proposal').tap();
  await expect.poll(async () => (await projectOnScreen(page)).variants.length).toBe(2);
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'true');
  await dismissToasts(page);
  await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
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

/** Two-finger pinch around a client point: the fingers move from ±d0 to ±d1 px apart horizontally. */
async function pinch(cdp: CDPSession, at: Vec2, d0: number, d1: number, steps = 10): Promise<void> {
  const pts = (d: number) => [
    { x: at[0] - d, y: at[1], id: 1 },
    { x: at[0] + d, y: at[1], id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('editing on an iPhone', () => {
  test('pan, drag a wall, change a number in the sheet, tap-place a door', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
    await loadAndWaitReady(page);
    const cdp = await touchSession(page);

    // "+ Nytt forslag" (the name prompt is accepted as it is).
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('new-proposal').tap();
    await expect.poll(async () => (await projectOnScreen(page)).variants.length).toBe(2);
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'true');
    const plan = page.getByTestId('plan-view');
    await plan.scrollIntoViewIfNeeded();

    // One finger on empty paper pans the plan and changes nothing.
    const before = JSON.stringify(await activeVariant(page));
    const t0 = await rootTransform(page);
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan not on screen');
    const empty = await planToClient(page, [3, -4]);
    await touchDrag(cdp, empty, [empty[0] + 60, empty[1] - 30]);
    await expect.poll(() => rootTransform(page)).not.toBe(t0);
    expect(JSON.stringify(await activeVariant(page)), 'a pan moves nothing').toBe(before);
    expect(await selection(page)).toBeNull();

    // Two fingers zoom in around the new wing.
    const s0 = await planScale(page);
    await pinch(cdp, await planToClient(page, [17.8, 3.4]), 30, 90);
    await expect.poll(() => planScale(page)).toBeGreaterThan(s0 * 1.8);
    expect(JSON.stringify(await activeVariant(page)), 'a pinch moves nothing').toBe(before);

    // Tap the new wall between Gang and Soverom (ny fløy), then drag it 1.6 m north with one finger (to y 5.0; line
    // snapping reaches at most 0.25 m and never pulls a wall back to its own starting line, snap.ts).
    const wallAt = await planToClient(page, [18.4, 3.4]);
    const planBox = await plan.boundingBox();
    expect(planBox && wallAt[0] > planBox.x + 10 && wallAt[0] < planBox.x + planBox.width - 10, 'the wall is on screen').toBe(true);
    await tapPlan(page, [18.4, 3.4]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'wall', id: 'w-gang-n' });
    await touchDragPlan(page, cdp, [18.4, 3.4], [18.4, 5.0], 16);
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n')?.a[1]).toBeCloseTo(5.0, 1);
    expect(await selection(page)).toMatchObject({ kind: 'wall', id: 'w-gang-n' });
    await expect(page.getByTestId('mini-bar')).toBeVisible();
    await page.waitForTimeout(300);
    await shoot(page, testInfo, 'phone-edit');

    // Egenskaper as a bottom sheet: type the wall's thickness. (Chromium's touch emulation sometimes drops the click
    // of a tap that follows a pinch and a drag closely; tap again then.)
    const sheet = page.getByTestId('properties-sheet');
    await expect(async () => {
      if ((await sheet.count()) === 0) await page.getByTestId('mini-properties').tap();
      await expect(sheet).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    const thickness = sheet.getByTestId('wall-thickness').locator('input');
    await thickness.tap();
    await thickness.fill('0,15');
    await thickness.press('Enter');
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n')?.thickness).toBeCloseTo(0.15, 3);
    await shoot(page, testInfo, 'phone-sheet');
    await sheet.getByRole('button', { name: 'Lukk' }).tap();
    await expect(sheet).toHaveCount(0);

    // Dør/vindu → Dør, tap on the wall between the stue and the pantry (w-wing-w, south of the passage): a door is placed
    // and the tool returns to Velg.
    const openings0 = (await activeVariant(page)).openings.length;
    await page.getByTestId('tool-opening').tap();
    await page.getByTestId('opening-type-door').tap();
    await expect(plan).toHaveAttribute('data-plan-tool', 'opening');
    await tapPlan(page, [16, 1.0]);
    await expect.poll(async () => (await activeVariant(page)).openings.length).toBe(openings0 + 1);
    const door = (await activeVariant(page)).openings.at(-1);
    expect(door).toMatchObject({ type: 'door', status: 'new', host: { kind: 'wall', wallId: 'w-wing-w' } });
    await expect(plan).toHaveAttribute('data-plan-tool', 'select');
    expect(await selection(page)).toMatchObject({ kind: 'opening', id: door?.id });

    await assertNoGenericWarnings(page);
    const notes = await page.evaluate(() => (window as HytteWindow).__hytte?.derived?.warnings.map((w) => w.kind) ?? []);
    expect(notes.filter((k) => k === 'generic')).toEqual([]);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

test.describe('editing on an iPhone at the starting zoom (fix round after 2a)', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('taps on rooms select them: on the name where one is drawn, else on the floor beside the furniture', async ({ page }) => {
    await phoneProposal(page);
    const names = ['Stue', 'Kjøkken', 'Spiseplass', 'Soverom (ny fløy)', 'Hovedbad', 'Soverom 1', 'Soverom 2', 'Vindfang', 'Bod (ny)'];
    const rooms = await page.evaluate(
      (wanted) =>
        ((window as HytteWindow).__hytte?.derived?.rooms ?? [])
          .filter((r) => r.room && wanted.includes(r.room.name))
          .map((r) => ({ id: r.id, name: r.room?.name ?? '' })),
      names,
    );
    expect(rooms.map((r) => r.name).sort()).toEqual([...names].sort());
    const scale = await planScale(page);
    expect(scale, 'the starting zoom on the phone').toBeLessThan(16);
    let ok = 0;
    const misses: string[] = [];
    for (const r of rooms) {
      await page.keyboard.press('Escape');
      await expect.poll(() => selection(page)).toBeNull();
      // Since 2b the seed is furnished: where no name is drawn, a tap on the bed selects the bed, so tap the floor.
      const at = await roomTapPoint(page, r.id);
      expect(await onPlan(page, at), `${r.name}'s tap point is on screen`).toBe(true);
      await page.touchscreen.tap(at[0], at[1]);
      await expect.poll(() => selection(page)).not.toBeNull();
      const s = await selection(page);
      if (s?.kind === 'room' && s.id === r.id) ok++;
      else misses.push(`${r.name} → ${s?.kind}:${s?.id}`);
    }
    expect(ok, `rooms selected by a tap (misses: ${misses.join('; ') || 'none'})`).toBeGreaterThanOrEqual(8);
    // «Bod (ny)» (0,83 m deep, its name 5,5 px from w-bod-ved) is selected by a tap on its name (the second review).
    expect(misses.filter((m) => m.startsWith('Bod (ny)'))).toEqual([]);
  });

  test('a selected door dragged 1.5 m moves and keeps its width', async ({ page }) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    const door = async () => (await activeVariant(page)).openings.find((o) => o.id === 'door-mellom-vf');
    const d0 = await door();
    expect(d0).toMatchObject({ status: 'existing' });
    await tapPlan(page, [7.01, 6.2]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'opening', id: 'door-mellom-vf' });
    // 1.5 m west along the north wall of the old cabin (the edge runs east → west: the offset grows).
    await touchDragPlan(page, cdp, [7.01, 6.2], [5.51, 6.2], 16);
    await expect.poll(async () => (await door())?.status).toBe('new');
    const d1 = await door();
    expect(d1?.width, 'the width is unchanged').toBeCloseTo(d0?.width ?? NaN, 3);
    expect((d1?.offset ?? 0) - (d0?.offset ?? 0), 'it moved about 1.5 m').toBeGreaterThan(1.2);
    expect(await selection(page)).toMatchObject({ kind: 'opening', id: 'door-mellom-vf' });
  });

  test('a freshly placed Vedskjul dragged by its body keeps its size and follows the finger', async ({ page }) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    await page.getByTestId('tool-unit').tap();
    await page.getByTestId('unit-vedskjul').tap();
    await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
    await tapPlan(page, [14, 11.3]);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(5);
    const unit = (await activeVariant(page)).blocks[4];
    const b0 = bbox(unit.polygon.map((q) => q.p));
    expect(b0.x1 - b0.x0).toBeCloseTo(2, 3);
    expect(b0.y1 - b0.y0).toBeCloseTo(1.5, 3);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: unit.id });
    await dismissToasts(page);

    const c0: Vec2 = [(b0.x0 + b0.x1) / 2, (b0.y0 + b0.y1) / 2];
    await touchDragPlan(page, cdp, c0, [c0[0] - 2, c0[1]], 16);
    const box = async () => bbox((await activeVariant(page)).blocks.find((b) => b.id === unit.id)?.polygon.map((q) => q.p) ?? []);
    await expect.poll(async () => (await box()).x0).toBeLessThan(b0.x0 - 1);
    const b1 = await box();
    expect(b1.x1 - b1.x0, 'the width is unchanged').toBeCloseTo(2, 3);
    expect(b1.y1 - b1.y0, 'the depth is unchanged').toBeCloseTo(1.5, 3);
    // 2 m west moves it 2 m, give or take a snap of at most 0.25 m (before: 4 m, onto the bod wing).
    expect(Math.abs(b1.x0 - b0.x0 + 2), `moved ${(b1.x0 - b0.x0).toFixed(2)} m for a 2 m drag`).toBeLessThanOrEqual(0.25);
    expect(b1.y0, 'no sideways jump').toBeCloseTo(b0.y0, 1);

    // 1 m north, away from the deck edge it stood on: about 1 m (before: snapped all the way back).
    const c1: Vec2 = [(b1.x0 + b1.x1) / 2, (b1.y0 + b1.y1) / 2];
    await touchDragPlan(page, cdp, c1, [c1[0], c1[1] + 1], 16);
    await expect.poll(async () => (await box()).y0).toBeGreaterThan(b1.y0 + 0.5);
    const b2 = await box();
    expect(Math.abs(b2.y0 - b1.y0 - 1), `moved ${(b2.y0 - b1.y0).toFixed(2)} m for a 1 m drag`).toBeLessThanOrEqual(0.25);
    expect(b2.x0, 'no sideways jump').toBeCloseTo(b1.x0, 1);
  });

  test('the Egenskaper sheet for a wall leaves the wall in view above it', async ({ page }) => {
    await phoneProposal(page);
    await tapPlan(page, [18.4, 3.4]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'wall', id: 'w-gang-n' });
    await page.getByTestId('mini-properties').tap();
    const sheet = page.getByTestId('properties-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-stop', 'basic');
    const wall = (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n');
    if (!wall) throw new Error('w-gang-n missing');
    const vp = page.viewportSize();
    // The plan pans (and the page scrolls) so the whole wall sits on screen above the sheet.
    await expect
      .poll(async () => {
        const top = (await sheet.boundingBox())?.y ?? 0;
        const ends = [await planToClient(page, wall.a), await planToClient(page, wall.b)];
        const ys = ends.map((e) => e[1]);
        const xs = ends.map((e) => e[0]);
        return Math.max(...ys) < top - 4 && Math.min(...ys) > 0 && Math.min(...xs) >= 0 && Math.max(...xs) <= (vp?.width ?? 390);
      })
      .toBe(true);
    // The basic fields are there (Tykkelse), the rest behind "Vis mer".
    await expect(sheet.getByTestId('wall-thickness')).toBeVisible();
  });

  test('the tool row shows all six tools', async ({ page }, testInfo) => {
    await phoneProposal(page);
    await page.evaluate(() => document.querySelector('.toolbar-wrap')?.scrollIntoView({ block: 'start' }));
    const vp = page.viewportSize();
    for (const t of ['select', 'wall', 'opening', 'unit', 'furniture', 'measure']) {
      const tool = page.getByTestId(`tool-${t}`);
      await expect(tool).toBeVisible();
      const box = await tool.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= (vp?.width ?? 390) + 0.5, `tool-${t} is fully on screen`).toBe(true);
      const label = tool.locator('.tool-name');
      await expect(label).toBeVisible();
      const fits = await label.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, `tool-${t}'s label is not clipped`).toBe(true);
    }
    await shoot(page, testInfo, 'phone-tools');
  });

  test('taps 4 px beside three walls and a door select them', async ({ page }) => {
    await phoneProposal(page);
    const plan = page.getByTestId('plan-view');
    const scale = Number(await plan.getAttribute('data-scale'));
    const band = Number(await plan.getAttribute('data-hit-band'));
    expect(scale, 'the starting zoom on the phone').toBeLessThan(16);
    expect(band, 'the touch band reaches 4 px to either side').toBeGreaterThanOrEqual(8);
    // Centre and direction of each target: three stored walls, and the door on the old cabin's north wall.
    const targets = await page.evaluate(() => {
      const d = (window as HytteWindow).__hytte?.derived;
      if (!d) throw new Error('derived missing');
      const out: { kind: string; id: string; c: [number, number]; u: [number, number] }[] = [];
      const dir = (a: [number, number], b: [number, number]): [number, number] => {
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      };
      for (const id of ['w-gang-n', 'w-104-103', 'dv-pass-n']) {
        const w = d.walls.find((x) => x.id === id);
        if (!w) throw new Error(`${id} missing`);
        out.push({ kind: 'wall', id, c: [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], u: dir(w.a, w.b) });
      }
      for (const w of d.walls) {
        const o = w.openings.find((x) => x.id === 'door-mellom-vf');
        if (!o) continue;
        const u = dir(w.a, w.b);
        out.push({ kind: 'opening', id: o.id, c: [w.a[0] + u[0] * o.offset, w.a[1] + u[1] * o.offset], u });
      }
      return out;
    });
    expect(targets).toHaveLength(4);
    const misses: string[] = [];
    for (const t of targets) {
      // 4 screen px to either side, across the line.
      const c = await planToClient(page, t.c);
      const e = await planToClient(page, [t.c[0] + t.u[0], t.c[1] + t.u[1]]);
      const l = Math.hypot(e[0] - c[0], e[1] - c[1]);
      const n: Vec2 = [-(e[1] - c[1]) / l, (e[0] - c[0]) / l];
      for (const sgn of [-1, 1]) {
        await page.keyboard.press('Escape');
        await expect.poll(() => selection(page)).toBeNull();
        const at: Vec2 = [c[0] + n[0] * 4 * sgn, c[1] + n[1] * 4 * sgn];
        expect(await onPlan(page, at), `${t.id} is on screen`).toBe(true);
        await page.touchscreen.tap(at[0], at[1]);
        await expect.poll(() => selection(page)).not.toBeNull();
        const s = await selection(page);
        if (s?.kind !== t.kind || s.id !== t.id) misses.push(`${t.id} ${sgn > 0 ? '+' : '−'}4 px → ${s?.kind}:${s?.id}`);
      }
    }
    expect(misses).toEqual([]);
  });

  test('a tap on a placed unit selects the unit, a second tap its room', async ({ page }) => {
    await phoneProposal(page);
    await page.getByTestId('tool-unit').tap();
    await page.getByTestId('unit-vedskjul').tap();
    await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
    await tapPlan(page, [14, 11.3]);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(5);
    const unit = (await activeVariant(page)).blocks[4];
    const b = bbox(unit.polygon.map((q) => q.p));
    const c: Vec2 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    await dismissToasts(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page)).toBeNull();

    // First tap: the unit (it can be dragged and turned right away).
    await tapPlan(page, c);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: unit.id });
    await expect(page.getByTestId('mini-rotate')).toBeVisible();
    // Second tap: the room inside it, whose mini-bar still offers "Roter 90°" and "Velg bygningsdelen".
    await tapPlan(page, c);
    await expect.poll(async () => (await selection(page))?.kind).toBe('room');
    const roomId = (await selection(page))?.id;
    const label = await page.evaluate((id) => (window as HytteWindow).__hytte?.derived?.rooms.find((r) => r.id === id)?.labelPoint, roomId);
    expect(label && label[0] > b.x0 && label[0] < b.x1 && label[1] > b.y0 && label[1] < b.y1, 'the room is the unit\'s').toBe(true);
    await expect(page.getByTestId('mini-rotate')).toBeVisible();
    await expect(page.getByTestId('mini-select-block')).toBeVisible();
    await page.getByTestId('mini-select-block').tap();
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: unit.id });
  });

  test('the delete toast sits below the tool row and the hint line', async ({ page }, testInfo) => {
    await phoneProposal(page);
    await tapPlan(page, [18.4, 3.4]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'wall', id: 'w-gang-n' });
    await page.getByTestId('mini-delete').tap();
    const toast = page.getByTestId('toast').filter({ hasText: 'Slettet' });
    await expect(toast).toBeVisible();
    type Box = { x: number; y: number; width: number; height: number };
    const overlaps = (a: Box, o: Box) => a.x < o.x + o.width && o.x < a.x + a.width && a.y < o.y + o.height && o.y < a.y + a.height;
    const clear = async () => {
      const t = await toast.boundingBox();
      const tools = await page.getByTestId('toolbar').boundingBox();
      const hint = await page.getByTestId('hint-line').boundingBox();
      if (!t || !tools || !hint) return 'missing';
      if (overlaps(t, tools)) return `covers the tool row (toast ${t.y.toFixed(0)}–${(t.y + t.height).toFixed(0)}, tools ${tools.y.toFixed(0)}–${(tools.y + tools.height).toFixed(0)})`;
      if (overlaps(t, hint)) return `covers the hint line (toast ${t.y.toFixed(0)}, hint ${hint.y.toFixed(0)}–${(hint.y + hint.height).toFixed(0)})`;
      return 'clear';
    };
    await expect.poll(clear).toBe('clear');
    // With the tool row scrolled to the top of the screen (as when the sheet opens) the toast sits below the hint line.
    await page.evaluate(() => document.querySelector('.toolbar-wrap')?.scrollIntoView({ block: 'start' }));
    await expect
      .poll(async () => {
        const t = await toast.boundingBox();
        const hint = await page.getByTestId('hint-line').boundingBox();
        return !!t && !!hint && t.y >= hint.y + hint.height - 0.5;
      })
      .toBe(true);
    await expect.poll(clear).toBe('clear');
    // The toast stays on screen in the shot (shoot() would close it).
    const file = join(SCREENSHOT_DIR, 'phone-toast.png');
    await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
    await testInfo.attach('phone-toast', { path: file, contentType: 'image/png' });
  });
});

test.describe('editing on an iPhone (final fix round)', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  const door = async (page: Page, id: string) => (await activeVariant(page)).openings.find((o) => o.id === id);
  /** Chromium's touch emulation swallows the first tap after a touch drag: a harmless tap on the hint line first. */
  const afterDrag = async (page: Page) => {
    await page.getByTestId('hint-line').tap();
    await page.waitForTimeout(100);
  };

  test('move a door, then Nytt bygg → Vedskjul: the tap where the door\'s mini-bar stood places the shed, the door stays', async ({ page }) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    await tapPlan(page, [7.01, 6.2]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'opening', id: 'door-mellom-vf' });
    // The first-time flow: the door moved 0.6 m west along the north wall.
    const d0 = await door(page, 'door-mellom-vf');
    await touchDragPlan(page, cdp, [7.01, 6.2], [6.41, 6.2], 10);
    await expect.poll(async () => (await door(page, 'door-mellom-vf'))?.offset ?? 0).toBeGreaterThan((d0?.offset ?? 0) + 0.3);
    const d1 = await door(page, 'door-mellom-vf');
    await afterDrag(page);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'opening', id: 'door-mellom-vf' });
    // Its mini-bar (with Slett) floats over the north deck.
    await expect(page.getByTestId('mini-delete')).toBeVisible();
    const slett = await page.getByTestId('mini-delete').boundingBox();
    if (!slett) throw new Error('no Slett');
    const at: Vec2 = [slett.x + slett.width / 2, slett.y + slett.height / 2];
    expect(await onPlan(page, at), 'Slett lies over the plan').toBe(true);

    // Nytt bygg → Vedskjul: the selection stays, the bar goes.
    await page.getByTestId('tool-unit').tap();
    await page.getByTestId('unit-vedskjul').tap();
    await expect(page.getByTestId('mini-bar')).toHaveCount(0);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'opening', id: 'door-mellom-vf' });
    // The tap where Slett was places the shed; the door is still there, where it was moved.
    await page.touchscreen.tap(at[0], at[1]);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(5);
    const d2 = await door(page, 'door-mellom-vf');
    expect(d2, 'the door still exists').toBeDefined();
    expect(d2?.offset).toBeCloseTo(d1?.offset ?? NaN, 6);
    expect(d2?.width).toBeCloseTo(d0?.width ?? NaN, 6);
    expect((await page.locator('[data-testid=toast]').allTextContents()).join(' ')).not.toContain('Slettet');
  });

  test('a selected door at the starting zoom has no end handles: taps near it select the window, wall and room there', async ({ page }) => {
    await phoneProposal(page);
    expect(await planScale(page), 'the starting zoom').toBeLessThan(16);
    // Around d-sov-ny (17.3, 3.4) on w-gang-n: the opening o-stue-gang (16, 2.8), the wall 1.6 m east of the door,
    // Gang's floor and the bed in Soverom (ny fløy). Before, the door's 1.2 m end-handle circles (centred 1.6 m from
    // the door's middle) caught them all.
    const points: [string, Vec2][] = [
      ['o-stue-gang', [16.0, 2.8]],
      ['w-gang-n east of the door', [18.9, 3.4]],
      ['Gang', [18.6, 2.8]],
      ['the bed in Soverom (ny fløy)', [19.3, 4.0]],
    ];
    const selectDoor = async () => {
      await page.keyboard.press('Escape');
      await expect.poll(() => selection(page)).toBeNull();
      await tapPlan(page, [17.3, 3.4]);
      await expect.poll(() => selection(page)).toMatchObject({ kind: 'opening', id: 'd-sov-ny' });
      await expect(page.locator('[data-testid=plan-view] [data-handle^="oe:"]')).toHaveCount(0);
    };
    const kinds = new Set<string>();
    for (const [name, p] of points) {
      // What the tap selects with nothing selected …
      await page.keyboard.press('Escape');
      await expect.poll(() => selection(page)).toBeNull();
      await tapPlan(page, p);
      await expect.poll(() => selection(page), name).not.toBeNull();
      const want = await selection(page);
      expect(want?.id, `${name} is not the door`).not.toBe('d-sov-ny');
      kinds.add(want?.kind ?? '');
      // … it selects with the door selected too.
      await selectDoor();
      await tapPlan(page, p);
      await expect.poll(async () => (await selection(page))?.id, name).toBe(want?.id);
    }
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['opening', 'room', 'wall']));
  });

  test('with a door selected at the starting zoom, a pan started 1.4 m from it pans and leaves the door alone', async ({ page }) => {
    await phoneProposal(page);
    const cdp = await touchSession(page);
    await tapPlan(page, [7.01, 6.2]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'opening', id: 'door-mellom-vf' });
    const d0 = await door(page, 'door-mellom-vf');
    const t0 = await rootTransform(page);
    // The review's drag: from 1.4 m east and 0.6 m north of the door's middle (in Mellombygg), 1.5 m east.
    await touchDragPlan(page, cdp, [8.41, 6.8], [9.91, 6.8], 12);
    await expect.poll(() => rootTransform(page)).not.toBe(t0);
    const d1 = await door(page, 'door-mellom-vf');
    expect(d1?.width, 'the door keeps its width').toBeCloseTo(d0?.width ?? NaN, 6);
    expect(d1?.offset, 'and its place').toBeCloseTo(d0?.offset ?? NaN, 6);
    expect(d1?.status).toBe('existing');
  });
});

test.describe('the first-time flow on an iPhone (final fix round)', () => {
  test('open, «+ Nytt forslag», move a door, a shed where its mini-bar was, furnish a bedroom from the library, Dupliser, Send', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    // Open the app as a new family member: the first-run card (and then the home-screen card) come first.
    await loadAndWaitReady(page);
    await expect(page.getByTestId('first-run')).toBeVisible();
    await page.getByTestId('first-run-ok').tap();
    await expect(page.getByTestId('first-run')).toHaveCount(0);
    const install = page.getByTestId('install-card');
    await page.waitForTimeout(300);
    if ((await install.count()) > 0) {
      await page.getByTestId('install-ok').tap();
      await expect(install).toHaveCount(0);
    }
    await phoneProposal(page);
    const cdp = await touchSession(page);
    expect(await planScale(page), 'the starting zoom').toBeLessThan(16);
    const v0 = await activeVariant(page);
    const door = async (id: string) => (await activeVariant(page)).openings.find((o) => o.id === id);
    const afterDrag = async () => {
      // Chromium's touch emulation swallows the first tap after a touch drag: a harmless tap on the hint line first.
      await page.getByTestId('hint-line').tap();
      await page.waitForTimeout(100);
    };

    // 1. The door between Mellombygg and Vindfang 0.6 m west.
    await tapPlan(page, [7.01, 6.2]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'opening', id: 'door-mellom-vf' });
    const d0 = await door('door-mellom-vf');
    await touchDragPlan(page, cdp, [7.01, 6.2], [6.41, 6.2], 10);
    await expect.poll(async () => (await door('door-mellom-vf'))?.offset ?? 0).toBeGreaterThan((d0?.offset ?? 0) + 0.3);
    const d1 = await door('door-mellom-vf');
    await afterDrag();
    await expect(page.getByTestId('mini-delete')).toBeVisible();
    const slett = await page.getByTestId('mini-delete').boundingBox();
    if (!slett) throw new Error('no Slett');
    const at: Vec2 = [slett.x + slett.width / 2, slett.y + slett.height / 2];

    // 2. Nytt bygg → Vedskjul, tapped on the deck right where the door's Slett stood: the shed, and the door stays.
    await page.getByTestId('tool-unit').tap();
    await page.getByTestId('unit-vedskjul').tap();
    await expect(page.getByTestId('mini-bar')).toHaveCount(0);
    await page.touchscreen.tap(at[0], at[1]);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(v0.blocks.length + 1);
    const shed = (await activeVariant(page)).blocks[v0.blocks.length];
    expect(shed).toMatchObject({ template: 'vedskjul' });
    expect((await door('door-mellom-vf'))?.offset).toBeCloseTo(d1?.offset ?? NaN, 6);
    expect((await page.locator('[data-testid=toast]').allTextContents()).join(' ')).not.toContain('Slettet');
    const placedWarnings = await page.evaluate(() => ((window as HytteWindow).__hytte?.derived?.warnings ?? []).map((w) => w.kind));
    expect(placedWarnings, 'the shed brings no warning').toEqual([]);
    await dismissToasts(page);

    // 3. Zoom into Soverom (ny fløy) with two fingers, bring it to the middle, nothing selected, Møbler → Kommode.
    const mid: Vec2 = [18.35, 4.75];
    await pinch(cdp, await planToClient(page, mid), 20, 70);
    await expect.poll(() => planScale(page)).toBeGreaterThan(30);
    const box = await page.getByTestId('plan-view').boundingBox();
    const vp = page.viewportSize();
    if (!box || !vp) throw new Error('no plan box');
    const top = Math.max(box.y, 0);
    const bottom = Math.min(box.y + box.height, vp.height);
    await touchDrag(cdp, await planToClient(page, mid), [box.x + box.width / 2, (top + bottom) / 2], 12);
    await afterDrag();
    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page)).toBeNull();
    const n0 = (await activeVariant(page)).furniture.length;
    await page.getByTestId('tool-furniture').tap();
    const library = page.getByTestId('furniture-library-sheet');
    await expect(library).toBeVisible();
    await expect(library.getByTestId('furniture-intro')).toContainText('Trykk på et rom først');
    await library.getByTestId('furniture-search').fill('kommode');
    await library.getByTestId('furniture-item-kommode').tap();
    await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(n0 + 1);
    await expect(library).toHaveCount(0);
    const kommode = (await activeVariant(page)).furniture[n0];
    const derivedOf = async (id: string) => (await page.evaluate(() => (window as HytteWindow).__hytte?.derived?.furniture ?? [])).find((f) => f.id === id);
    expect((await derivedOf(kommode.id))?.roomId, 'the kommode is in the room on screen').toBe('room-sov-ny');
    expect((await derivedOf(kommode.id))?.collisions).toEqual([]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'furniture', id: kommode.id });

    // 4. Egenskaper → Dupliser: the copy stands free beside it (or there is no room and nothing is added).
    const sheet = page.getByTestId('properties-sheet');
    await expect(async () => {
      if ((await sheet.count()) === 0) await page.getByTestId('mini-properties').tap();
      await expect(sheet).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await sheet.getByTestId('furniture-duplicate').tap();
    await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(n0 + 2);
    const copy = (await activeVariant(page)).furniture[n0 + 1];
    expect(copy.catalogId).toBe('kommode');
    const dc = await derivedOf(copy.id);
    expect(dc?.collisions, 'the copy collides with nothing').toEqual([]);
    expect(dc?.blocksDoors, 'and blocks no door').toEqual([]);
    expect(dc?.roomId, 'and stands in a room').toBeTruthy();
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'furniture', id: copy.id });
    await shoot(page, testInfo, 'phone-first-flow');
    await sheet.getByRole('button', { name: 'Lukk' }).tap();
    await expect(sheet).toHaveCount(0);

    // 5. Send: the link carries the whole proposal (door, shed, both chests of drawers).
    await page.getByTestId('open-share').tap();
    const link = await page.getByTestId('share-local-link').inputValue();
    expect(link).toMatch(/#d=/);
    // Opened on another device (a fresh browser), the link adds the proposal with all of it.
    const fresh = await page.context().browser()!.newContext();
    try {
      const other = await fresh.newPage();
      await other.goto(link);
      await other.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: 60_000, polling: 250 });
      await expect.poll(async () => (await projectOnScreen(other)).variants.length).toBe(2);
      const got = await activeVariant(other);
      expect(got.locked).not.toBe(true);
      expect(got.blocks.filter((b) => b.template === 'vedskjul')).toHaveLength(1);
      expect(got.openings.find((o) => o.id === 'door-mellom-vf')?.offset).toBeCloseTo(d1?.offset ?? NaN, 6);
      const kommoder = (v: { furniture: { catalogId: string }[] }) => v.furniture.filter((f) => f.catalogId === 'kommode').length;
      expect(kommoder(got)).toBe(kommoder(v0) + 2);
    } finally {
      await fresh.close();
    }
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

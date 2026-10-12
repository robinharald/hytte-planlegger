/**
 * Editing on a phone (docs/phase2-plan.md §1 rule 4, §3.1; the 'iphone' project in playwright.config.ts: iPhone 13
 * viewport and touch, on Chromium). Dad plays with ideas on his iPhone:
 *  - open the app and make "Nytt forslag";
 *  - a one-finger drag across the plan pans it and moves nothing; two fingers zoom;
 *  - tap a new wall (w-gang-n) and drag it with one finger: it moves;
 *  - the mini-bar's Egenskaper opens the properties bottom sheet; type a number (the wall's Tykkelse);
 *  - Dør/vindu → Dør, tap on a wall: a door is placed and the tool goes back to Velg (the door selected).
 * Fix round after 2a, all at the starting zoom (about 11.6 px/m):
 *  - taps on 8 rooms' label points select the room (at least 7 of 8; before, walls and doors won most taps);
 *  - a selected door dragged 1.5 m moves and keeps its width (before, the end handles covered it and it shrank);
 *  - a freshly placed Vedskjul dragged by its body moves and keeps its size;
 *  - the Egenskaper sheet for a wall leaves the wall in view above the sheet (the plan pans);
 *  - the tool row shows all six tools on the 390 px screen.
 * Screenshots: phone-edit.png (the dragged wall selected, handles and the mini-bar), phone-sheet.png (the sheet),
 * phone-tools.png (the tool row).
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { Vec2 } from '../src/model/types';
import {
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

    // Egenskaper as a bottom sheet: type the wall's thickness.
    await page.getByTestId('mini-properties').tap();
    const sheet = page.getByTestId('properties-sheet');
    await expect(sheet).toBeVisible();
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

  test('taps on room label points select the rooms', async ({ page }) => {
    await phoneProposal(page);
    const names = ['Stue', 'Kjøkken', 'Spiseplass', 'Soverom (ny fløy)', 'Hovedbad', 'Soverom 1', 'Soverom 2', 'Vindfang'];
    const rooms = await page.evaluate(
      (wanted) =>
        ((window as HytteWindow).__hytte?.derived?.rooms ?? [])
          .filter((r) => r.room && wanted.includes(r.room.name))
          .map((r) => ({ id: r.id, name: r.room?.name ?? '', p: r.labelPoint })),
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
      const at = await planToClient(page, r.p);
      expect(await onPlan(page, at), `${r.name}'s label point is on screen`).toBe(true);
      await page.touchscreen.tap(at[0], at[1]);
      await expect.poll(() => selection(page)).not.toBeNull();
      const s = await selection(page);
      if (s?.kind === 'room' && s.id === r.id) ok++;
      else misses.push(`${r.name} → ${s?.kind}:${s?.id}`);
    }
    expect(ok, `rooms selected by a tap on their label (misses: ${misses.join('; ') || 'none'})`).toBeGreaterThanOrEqual(7);
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

  test('a freshly placed Vedskjul dragged by its body keeps its size', async ({ page }) => {
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
    await expect.poll(async () => (await box()).x0).toBeLessThan(b0.x0 - 1.5);
    const b1 = await box();
    expect(b1.x1 - b1.x0, 'the width is unchanged').toBeCloseTo(2, 3);
    expect(b1.y1 - b1.y0, 'the depth is unchanged').toBeCloseTo(1.5, 3);
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
});

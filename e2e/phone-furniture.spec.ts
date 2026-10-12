/**
 * Phase 2b on a phone (the 'iphone' project: iPhone 13 viewport and touch on Chromium), dad's iPhone:
 *  - Møbler opens the library as a bottom sheet; a tap on "Stol" places a chair, closes the sheet and selects the
 *    chair; a finger drags it 1 m;
 *  - the proposals menu: "+ Nytt forslag" in the menu makes a proposal, "Gi nytt navn" renames it;
 *  - Nytt bygg → Vedskjul tapped 0.4 m from the wing's north wall attaches to it (the placement reaches the whole
 *    pointer radius again); the selected shed nudged 0.5 m with a finger at the starting zoom moves 0.5 m;
 *  - a tap on «Bod (ny)»'s name selects the room (the second review: the wall's band won).
 * Screenshot: phone-library.png (the library sheet).
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

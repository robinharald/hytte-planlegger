/**
 * «Gå rundt» ended with Esc, then a camera angle (fix round 3 after phase 3, desktop 1400×900): Esc leaves the camera
 * where the walker stood and no camera angle is shown pressed; a tap on «Oversikt» — the angle that was chosen before
 * the walk — brings the camera back to the overview (before: it stayed pressed and the tap did nothing), with the
 * orbit's field of view. The camera is read through `window.__hytteCamera()` (view3d/Scene.tsx, tests only).
 */
import { expect, test, type Page } from '@playwright/test';
import { assertNoGenericWarnings, collectPageErrors, type HytteWindow, loadAndWaitReady, SETTLE_MS, skipFirstRun } from './helpers';

interface CameraProbe {
  position: number[];
  target: number[];
  fov: number;
}

async function camera(page: Page): Promise<CameraProbe | null> {
  return page.evaluate(() => (globalThis as { __hytteCamera?: () => CameraProbe }).__hytteCamera?.() ?? null);
}

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function walkProbe(page: Page) {
  return page.evaluate(() => (window as HytteWindow).__hytte?.walk ?? null);
}

test.describe('«Gå rundt», Esc, then a camera angle (desktop)', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('after Esc no angle is pressed; «Oversikt» brings the camera back to the overview', async ({ page }) => {
    await loadAndWaitReady(page);
    await page.getByTestId('view-tab-3d').click();
    await expect(page.getByTestId('view-3d').locator('canvas')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(SETTLE_MS);
    const oversikt = page.getByTestId('preset-oversikt');
    await expect(oversikt).toHaveAttribute('aria-pressed', 'true');
    const overview = (await camera(page))!;
    expect(overview, 'the camera probe').not.toBeNull();

    await page.getByTestId('preset-walk').click();
    await expect.poll(async () => (await walkProbe(page)) !== null).toBe(true);
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect.poll(() => walkProbe(page)).toBeNull();
    await page.waitForTimeout(SETTLE_MS);

    // The walker's view is kept, with the walk's wider field of view; no angle is shown as the view.
    const kept = (await camera(page))!;
    expect(distance(kept.position, overview.position), 'the camera stayed where the walker stood').toBeGreaterThan(5);
    expect(kept.fov).toBeGreaterThan(overview.fov);
    await expect(page.locator('[data-testid^="preset-"][aria-pressed="true"]')).toHaveCount(0);

    // «Oversikt»: back to the overview, pressed, with the orbit's field of view.
    await oversikt.click();
    await expect(oversikt).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => distance((await camera(page))!.position, overview.position), { timeout: 10_000 }).toBeLessThan(0.05);
    const back = (await camera(page))!;
    expect(distance(back.target, overview.target)).toBeLessThan(0.05);
    expect(back.fov).toBe(overview.fov);
  });
});

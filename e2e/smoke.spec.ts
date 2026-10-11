/**
 * Smoke test: the app loads, derives Forslag D, renders the plan and the 3D view, and the headline UI is there.
 *
 * Screenshots are written to e2e/screenshots/*.png (committed, so a diff shows what changed visually):
 *   plan.png, 3d-ute-oversikt.png, 3d-ute-framsiden.png, 3d-inne-stua.png, plan-hems.png, phone.png
 *
 * Preconditions: Chromium installed (`npx playwright install chromium`); the dev server is started by
 * playwright.config.ts or reused. The UI exposes `window.__hytte = { ready, project, derived }` and the
 * data-testids listed in docs/architecture.md ("Test hooks the UI must provide").
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DerivedVariant } from '../src/model/derived';
import type { Project } from '../src/model/types';

/** Shape of the test hook the UI keeps on window. */
interface HytteHook {
  ready: boolean;
  project: Project;
  derived: DerivedVariant;
}
type HytteWindow = Window & { __hytte?: Partial<HytteHook> };

const SCREENSHOT_DIR = fileURLToPath(new URL('./screenshots/', import.meta.url));
const READY_TIMEOUT_MS = 60_000;
/** Camera transitions take ~900 ms; give SwiftShader some slack on top. */
const SETTLE_MS = 1_500;
/** The SVG plan is synchronous, but webfonts and labels may still be settling. */
const PLAN_SETTLE_MS = 500;

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

/** Collects uncaught exceptions thrown by the page; a smoke test should see none. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Loads '/', waits until the UI reports ready (first 3D frame rendered) and checks the derive pipeline is real. */
async function loadAndWaitReady(page: Page): Promise<void> {
  await page.goto('/');
  try {
    await page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, {
      timeout: READY_TIMEOUT_MS,
      polling: 250,
    });
  } catch (err) {
    throw new Error(
      `window.__hytte.ready did not become true within ${READY_TIMEOUT_MS / 1000} s. ` +
        'The UI must set window.__hytte = { ready, project, derived } and flip ready after the first 3D frame ' +
        '(View3D onReady). Is the 3D view mounted at start-up?',
      { cause: err },
    );
  }
  await page.evaluate(() => document.fonts.ready);
  await assertDeriveIsNotStub(page);
}

/** A 'generic' warning is only produced by the derive stub; the real pipeline never emits it. */
async function assertDeriveIsNotStub(page: Page): Promise<void> {
  const generic = await page.evaluate(() =>
    ((window as HytteWindow).__hytte?.derived?.warnings ?? []).flatMap((w) => (w.kind === 'generic' ? [w.message] : [])),
  );
  expect(
    generic,
    `derived.warnings contains a 'generic' warning (${generic.join('; ')}): src/geometry/derive.ts is still the stub. ` +
      'Integrate the real deriveVariant before running the e2e smoke test.',
  ).toEqual([]);
}

/** Viewport screenshot into e2e/screenshots/<name>.png, also attached to the report. */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

async function showPlan(page: Page, storey: 'ground' | 'loft'): Promise<void> {
  await page.getByTestId('view-tab-plan').click();
  await page.getByTestId(`plan-storey-${storey}`).click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await page.waitForTimeout(PLAN_SETTLE_MS);
}

async function show3d(page: Page, mode: 'ute' | 'inne', preset: string): Promise<void> {
  await page.getByTestId('view-tab-3d').click();
  await expect(page.getByTestId('view-3d').locator('canvas')).toBeVisible();
  await page.getByTestId(`mode-${mode}`).click();
  await page.getByTestId(`preset-${preset}`).click();
  await page.waitForTimeout(SETTLE_MS);
}

test.describe('desktop 1400×900', () => {
  test('plan, 3D views, room schedule and area totals', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await loadAndWaitReady(page);

    // Headline UI: the new wing's rooms are in the schedule and the area panel shows BYA.
    const schedule = page.getByTestId('room-schedule');
    await expect(schedule, 'room schedule should list Hovedbad').toContainText('Hovedbad');
    await expect(schedule, 'room schedule should list Badstue').toContainText('Badstue');
    await expect(page.getByTestId('area-totals'), 'area totals should show BYA').toContainText('BYA');

    await showPlan(page, 'ground');
    await shoot(page, testInfo, 'plan');

    await show3d(page, 'ute', 'oversikt');
    await shoot(page, testInfo, '3d-ute-oversikt');

    await page.getByTestId('preset-framsiden').click();
    await page.waitForTimeout(SETTLE_MS);
    await shoot(page, testInfo, '3d-ute-framsiden');

    await show3d(page, 'inne', 'inne-stua');
    await shoot(page, testInfo, '3d-inne-stua');

    await showPlan(page, 'loft');
    await shoot(page, testInfo, 'plan-hems');

    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

test.describe('phone 375×812', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('loads and renders in a phone viewport', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await loadAndWaitReady(page);
    await page.waitForTimeout(SETTLE_MS);
    await shoot(page, testInfo, 'phone');
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

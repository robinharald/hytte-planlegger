/**
 * Shared helpers of the Playwright specs (e2e/*.spec.ts): loading the app, the `window.__hytte` test hook, plan
 * coordinates → screen coordinates, mouse and touch gestures on the plan, and the committed screenshots.
 *
 * Plan points are converted with the plan's root group (`[data-plan-root]`, the flipped `matrix(s 0 0 -s tx ty)`):
 * its screen CTM maps a plan point (metres) to client pixels, so a test can click "the wing's east wall at y 4.8"
 * whatever the zoom and layout.
 */
import { expect, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DerivedVariant } from '../src/model/derived';
import type { Project, Variant, Vec2 } from '../src/model/types';

/** Shape of the test hook the UI keeps on window (src/ui/hooks.ts `useTestHook`). */
export interface HytteHook {
  ready: boolean;
  project: Project;
  derived: DerivedVariant;
  selection: { kind: string; id: string; levelId?: string } | null;
}
export type HytteWindow = Window & { __hytte?: Partial<HytteHook> };

export const SCREENSHOT_DIR = fileURLToPath(new URL('./screenshots/', import.meta.url));
export const READY_TIMEOUT_MS = 60_000;
/** Camera transitions take ~900 ms; give SwiftShader some slack on top. */
export const SETTLE_MS = 1_500;
/** The SVG plan is synchronous, but webfonts and labels may still be settling. */
export const PLAN_SETTLE_MS = 500;
/** localStorage key of the first-run card ("Skjønner" hides it for good, src/ui/FirstRunCard.tsx). */
export const FIRST_RUN_KEY = 'hytte-planlegger:first-run-seen';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

/** Collects uncaught exceptions thrown by the page; a test should see none. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Hide the first-run card (it covers the bottom of the stage) unless a test wants to see it. */
export async function skipFirstRun(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      if (!localStorage.getItem(key)) localStorage.setItem(key, '1');
    } catch {
      /* storage blocked: the card shows, nothing else changes */
    }
  }, FIRST_RUN_KEY);
}

/** Loads '/', waits until the UI reports ready and checks that the derive pipeline produced no 'generic' warning. */
export async function loadAndWaitReady(page: Page): Promise<void> {
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
        '(View3D onReady), or right away when only the plan is shown.',
      { cause: err },
    );
  }
  await page.evaluate(() => document.fonts.ready);
  await assertNoGenericWarnings(page);
}

/** 'generic' warnings come from a failed derive or a geometry fallback; no state of the app may produce one. */
export async function assertNoGenericWarnings(page: Page): Promise<void> {
  const generic = await page.evaluate(() =>
    ((window as HytteWindow).__hytte?.derived?.warnings ?? []).flatMap((w) => (w.kind === 'generic' ? [w.message] : [])),
  );
  expect(generic, `derived.warnings contains a 'generic' warning (${generic.join('; ')})`).toEqual([]);
}

/** Close every toast on screen (they would cover the legend in a screenshot). */
export async function dismissToasts(page: Page): Promise<void> {
  const close = page.locator('[data-testid=toast] .toast-close');
  for (let n = await close.count(); n > 0; n = await close.count()) await close.first().click();
}

/** Viewport screenshot into e2e/screenshots/<name>.png (toasts closed first), also attached to the report. */
export async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await dismissToasts(page);
  const file = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

// ---------------------------------------------------------------------------
// State through window.__hytte
// ---------------------------------------------------------------------------

/** The active variant (a JSON copy). */
export async function activeVariant(page: Page): Promise<Variant> {
  return page.evaluate(() => {
    const p = (window as HytteWindow).__hytte?.project;
    if (!p) throw new Error('window.__hytte.project is missing');
    return p.variants.find((v) => v.id === p.activeVariantId) ?? p.variants[0];
  });
}

export async function projectOnScreen(page: Page): Promise<Project> {
  return page.evaluate(() => {
    const p = (window as HytteWindow).__hytte?.project;
    if (!p) throw new Error('window.__hytte.project is missing');
    return p;
  });
}

export async function selection(page: Page): Promise<HytteHook['selection']> {
  return page.evaluate(() => (window as HytteWindow).__hytte?.selection ?? null);
}

/** Derived rooms as { id, name, area, levelId }. */
export async function derivedRooms(page: Page): Promise<{ id: string; name: string | null; area: number; levelId: string }[]> {
  return page.evaluate(() =>
    ((window as HytteWindow).__hytte?.derived?.rooms ?? []).map((r) => ({ id: r.id, name: r.room?.name ?? null, area: r.area, levelId: r.levelId })),
  );
}

/**
 * "+ Nytt forslag" in the top bar: accepts the name prompt with its default ("Mitt forslag") and waits until the new,
 * unlocked proposal is active.
 */
export async function createNewProposal(page: Page): Promise<void> {
  const before = (await projectOnScreen(page)).variants.length;
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('new-proposal').click();
  await expect.poll(async () => (await projectOnScreen(page)).variants.length).toBe(before + 1);
  const v = await activeVariant(page);
  expect(v.locked, 'the new proposal is not locked').not.toBe(true);
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'true');
}

// ---------------------------------------------------------------------------
// Plan coordinates and gestures
// ---------------------------------------------------------------------------

/** Client (viewport CSS px) position of a plan point. */
export async function planToClient(page: Page, p: Vec2): Promise<Vec2> {
  return page.evaluate(([x, y]) => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid=plan-view]');
    const root = svg?.querySelector<SVGGElement>('[data-plan-root]');
    const m = root?.getScreenCTM();
    if (!svg || !m) throw new Error('the plan is not on screen');
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const r = pt.matrixTransform(m);
    return [r.x, r.y] as [number, number];
  }, p);
}

/** Plan scale (px per metre) on screen. */
export async function planScale(page: Page): Promise<number> {
  const a = await planToClient(page, [0, 0]);
  const b = await planToClient(page, [1, 0]);
  return b[0] - a[0];
}

export async function clickPlan(page: Page, p: Vec2): Promise<void> {
  const [x, y] = await planToClient(page, p);
  await page.mouse.click(x, y);
}

/** Mouse drag on the plan from one plan point to another, in small steps (past the 5 px threshold). */
export async function dragPlan(page: Page, from: Vec2, to: Vec2, steps = 12): Promise<void> {
  const [x0, y0] = await planToClient(page, from);
  const [x1, y1] = await planToClient(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
  await page.mouse.up();
}

/** Select an element by tapping it, and wait until the store has the expected selection. */
export async function selectAt(page: Page, p: Vec2, expected: { kind: string; id?: string | RegExp }): Promise<void> {
  await clickPlan(page, p);
  await expect
    .poll(async () => {
      const s = await selection(page);
      if (!s || s.kind !== expected.kind) return `${s?.kind ?? 'none'}:${s?.id ?? ''}`;
      if (expected.id === undefined) return 'ok';
      const ok = typeof expected.id === 'string' ? s.id === expected.id : expected.id.test(s.id);
      return ok ? 'ok' : `${s.kind}:${s.id}`;
    })
    .toBe('ok');
}

// ---------------------------------------------------------------------------
// Touch (Chromium DevTools protocol: real touch events, which the page sees as pointerType 'touch')
// ---------------------------------------------------------------------------

export async function touchSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

/** One-finger drag from one client point to another. */
export async function touchDrag(cdp: CDPSession, from: Vec2, to: Vec2, steps = 12): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export async function touchDragPlan(page: Page, cdp: CDPSession, from: Vec2, to: Vec2, steps = 12): Promise<void> {
  await touchDrag(cdp, await planToClient(page, from), await planToClient(page, to), steps);
}

export async function tapPlan(page: Page, p: Vec2): Promise<void> {
  const [x, y] = await planToClient(page, p);
  await page.touchscreen.tap(x, y);
}

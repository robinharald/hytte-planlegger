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
/** … and of the home-screen card shown in its place afterwards (src/ui/InstallCard.tsx; iPhone and installable browsers). */
export const INSTALL_CARD_KEY = 'hytte-planlegger:install-card-seen';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

/** Collects uncaught exceptions thrown by the page; a test should see none. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Hide the first-run card and the home-screen card (they cover the bottom of the stage) unless a test wants them. */
export async function skipFirstRun(page: Page): Promise<void> {
  await page.addInitScript((keys) => {
    try {
      for (const key of keys) if (!localStorage.getItem(key)) localStorage.setItem(key, '1');
    } catch {
      /* storage blocked: the cards show, nothing else changes */
    }
  }, [FIRST_RUN_KEY, INSTALL_CARD_KEY]);
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

/** The plan root's transform attribute (changes on every pan or zoom). */
export async function planTransform(page: Page): Promise<string | null> {
  return page.locator('[data-testid=plan-view] [data-plan-root]').getAttribute('transform');
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

// ---------------------------------------------------------------------------
// Rooms and furniture
// ---------------------------------------------------------------------------

/**
 * Where a tap selects a room (client px): the middle of its drawn name when the plan shows one — on touch names lie
 * above the furniture; with a mouse only where no (solid) item lies under the name's middle — else the point of its
 * floor nearest its label point that is clear of furniture (by 0.25 m) and of the room's outline (by 0.35 m): a tap on
 * a bed selects the bed.
 */
export async function roomTapPoint(page: Page, roomId: string): Promise<Vec2> {
  const hit = page.locator(`[data-testid=plan-view] [data-room-label-hit="${roomId}"]`).first();
  let name: Vec2 | null = null;
  if ((await hit.count()) > 0) {
    const b = await hit.boundingBox();
    if (b && b.width > 0 && b.height > 0) name = [b.x + b.width / 2, b.y + b.height / 2];
  }
  if (name) {
    const at = name;
    const free = await page.evaluate(([x, y]) => {
      if (matchMedia('(pointer: coarse)').matches) return true;
      const el = document.elementFromPoint(x, y);
      return !el?.closest('[data-furniture-id]');
    }, at);
    if (free) return at;
  }
  const p = await page.evaluate((id) => {
    type P = [number, number];
    const d = (window as HytteWindow).__hytte?.derived;
    const room = d?.rooms.find((r) => r.id === id);
    if (!d || !room) throw new Error(`room ${id} missing`);
    const inside = (q: P, r: P[]) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if (r[i][1] > q[1] !== r[j][1] > q[1] && q[0] < ((r[j][0] - r[i][0]) * (q[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      }
      return c;
    };
    const distSeg = (q: P, s: P, e: P) => {
      const dx = e[0] - s[0];
      const dy = e[1] - s[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - s[0]) * dx + (q[1] - s[1]) * dy) / l2));
      return Math.hypot(q[0] - s[0] - t * dx, q[1] - s[1] - t * dy);
    };
    const edge = (q: P, r: P[]) => Math.min(...r.map((s, i) => distSeg(q, s, r[(i + 1) % r.length])));
    // Every item drawn on the room's storey (Plan 1 shows the lower and the main level).
    const storeyOf = (levelId: string) => d.levels.find((l) => l.id === levelId)?.storeyId;
    const items = d.furniture.filter((f) => storeyOf(f.levelId) === storeyOf(room.levelId)).map((f) => f.footprint as P[]);
    const xs = room.polygon.map((q) => q[0]);
    const ys = room.polygon.map((q) => q[1]);
    let best: P | null = null;
    let bestD = Infinity;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.05) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.05) {
        const q: P = [x, y];
        if (!inside(q, room.polygon as P[]) || edge(q, room.polygon as P[]) < 0.35) continue;
        if (items.some((f) => inside(q, f) || edge(q, f) < 0.25)) continue;
        const dl = Math.hypot(x - room.labelPoint[0], y - room.labelPoint[1]);
        if (dl < bestD) {
          bestD = dl;
          best = q;
        }
      }
    }
    return best;
  }, roomId);
  if (p) return planToClient(page, p);
  if (name) return name;
  throw new Error(`no free floor in ${roomId}`);
}

/**
 * Select a room by a click where nothing else lies over it (`roomTapPoint`); where only furniture is left to click (a
 * bed filling the room), the second click on the selected item gives the room under it. Waits for the selection.
 */
export async function selectRoom(page: Page, roomId: string): Promise<void> {
  const at = await roomTapPoint(page, roomId);
  await page.mouse.click(at[0], at[1]);
  await expect.poll(async () => (await selection(page))?.kind ?? 'none').not.toBe('none');
  if ((await selection(page))?.kind === 'furniture') await page.mouse.click(at[0], at[1]);
  await expect.poll(async () => (await selection(page))?.id).toBe(roomId);
}

/** The derived furniture items of the active proposal (a JSON copy). */
export async function derivedFurniture(page: Page): Promise<DerivedVariant['furniture']> {
  return page.evaluate(() => (window as HytteWindow).__hytte?.derived?.furniture ?? []);
}

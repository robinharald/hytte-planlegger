/**
 * Phase 2b on a desktop (docs/phase2-plan.md §3.2, §4, §7 "furnish the bathroom with clearance zones"), each test from
 * a fresh "Nytt forslag" copy of the furnished Forslag D:
 *  (A) Hovedbad selected, Møbler → the library → "Toalett": it is placed against a free wall of Hovedbad, selected,
 *      with its clearance zone drawn; dragged into the swing of the door from Gang it gives the door-blocked warning
 *      naming the toilet; Roter 90°, Dupliser (the copy is selected) and Slett in Egenskaper;
 *  (B) the bed in Soverom (ny fløy) dragged away from the wall and back to 0.1 m from it: it snaps back to the wall;
 *  (C) the main house's south wall moved 0.3 m in, the glass bump's east wall 0.5 m out, then "Ta tilbake" on every
 *      ghost: the seed again, furniture included (the second review's junction-ghost finding);
 *  (D) a click on the middle of win-106-s selects the window, not the ghost of the old door under it.
 * Fix round after 2b:
 *  (E) a wall drag (w-gang-n) draws the wall's moving outline at the pointer on every frame, also on frames where the
 *      model (the heavy update) still has the wall where it was: the per-frame preview, not only the updates;
 *  (F) Ctrl+D on the armchair fu-stue-5 puts the copy beside it in Stue, with no collision and no warning;
 *  (G) main south 0.3 m in and glass east 0.5 m out, then «Ta tilbake» on the main wall's ghost first and the others one
 *      by one: after every single restore no ghost lies over a live wall of today, and the end is the seed;
 *  (H) a dining chair pushed 0.3 m in under the table edge (Shift+↑ three times) is tucked in: no collision, no warning.
 * Screenshots: plan-furnished.png (the new wing furnished, clearances on), 3d-inne-furnished.png (Inne, Ovenfra),
 * plan-drag-preview.png (a wall mid-drag: the dashed base outline and the solid moving one at the pointer).
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Variant, Vec2 } from '../src/model/types';
import {
  activeVariant,
  assertNoGenericWarnings,
  collectPageErrors,
  createNewProposal,
  derivedFurniture,
  derivedRooms,
  dismissToasts,
  dragPlan,
  type HytteWindow,
  loadAndWaitReady,
  planScale,
  planToClient,
  roomTapPoint,
  selectAt,
  SCREENSHOT_DIR,
  selection,
  SETTLE_MS,
  shoot,
  skipFirstRun,
} from './helpers';

function bbox(poly: Vec2[]): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(...poly.map((p) => p[0])),
    y0: Math.min(...poly.map((p) => p[1])),
    x1: Math.max(...poly.map((p) => p[0])),
    y1: Math.max(...poly.map((p) => p[1])),
  };
}

async function freshProposal(page: Page): Promise<void> {
  await loadAndWaitReady(page);
  await createNewProposal(page);
}

async function zoomAt(page: Page, p: Vec2, steps: number): Promise<void> {
  const [x, y] = await planToClient(page, p);
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(300);
}

async function warnings(page: Page): Promise<{ kind: string; openingId?: string; by?: string; furnitureId?: string }[]> {
  return page.evaluate(() => ((window as HytteWindow).__hytte?.derived?.warnings ?? []) as { kind: string }[]);
}

/**
 * The point of a wall or ghost line farthest from every other line, opening and ghost of Plan 1 (editing.spec.ts), among
 * those inside `view` (the plan's visible box in plan metres) when given.
 */
async function clearPointOn(page: Page, id: string, view?: { x0: number; y0: number; x1: number; y1: number }): Promise<Vec2> {
  return page.evaluate(({ id, view }) => {
    type P = [number, number];
    const d = (window as HytteWindow).__hytte?.derived;
    if (!d) throw new Error('derived missing');
    const own = d.walls.find((x) => x.id === id) ?? d.ghosts.find((g) => g.id === id);
    if (!own) throw new Error(`${id} is not drawn`);
    const segs: [P, P][] = [];
    for (const w of d.walls) {
      if (!w.storeyIds.includes('ground')) continue;
      if (w.id !== id) segs.push([w.a, w.b]);
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const u: P = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      for (const o of w.openings) {
        const s0 = o.offset - o.width / 2;
        const s1 = o.offset + o.width / 2;
        segs.push([
          [w.a[0] + u[0] * s0, w.a[1] + u[1] * s0],
          [w.a[0] + u[0] * s1, w.a[1] + u[1] * s1],
        ]);
      }
    }
    for (const g of d.ghosts) if (g.id !== id) segs.push([g.a, g.b]);
    const distSeg = (p: P, [s, e]: [P, P]) => {
      const dx = e[0] - s[0];
      const dy = e[1] - s[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l2));
      return Math.hypot(p[0] - s[0] - t * dx, p[1] - s[1] - t * dy);
    };
    const [a, b] = [own.a, own.b];
    let best: P = a;
    let bestD = -1;
    for (let i = 1; i < 120; i++) {
      const t = i / 120;
      const p: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (view && !(p[0] > view.x0 && p[0] < view.x1 && p[1] > view.y0 && p[1] < view.y1)) continue;
      const m = Math.min(...segs.map((s) => distSeg(p, s)));
      if (m > bestD) {
        bestD = m;
        best = p;
      }
    }
    return best;
  }, { id, view });
}

/** The part of the plan on screen, in plan metres, shrunk by `marginPx`. */
async function visiblePlan(page: Page, marginPx = 40): Promise<{ x0: number; y0: number; x1: number; y1: number }> {
  return page.evaluate((m) => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid=plan-view]');
    const ctm = svg?.querySelector<SVGGElement>('[data-plan-root]')?.getScreenCTM()?.inverse();
    if (!svg || !ctm) throw new Error('the plan is not on screen');
    const r = svg.getBoundingClientRect();
    const toPlan = (x: number, y: number) => {
      const pt = svg.createSVGPoint();
      pt.x = x;
      pt.y = y;
      const q = pt.matrixTransform(ctm);
      return [q.x, q.y];
    };
    const [ax, ay] = toPlan(r.left + m, r.top + m);
    const [bx, by] = toPlan(r.right - m, r.bottom - m);
    return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
  }, marginPx);
}

/** The edge ghosts that lie on their live edge's line over a live piece of today's wall (the plan would draw «Fjernet» there). */
async function ghostsOverLiveWalls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type P = [number, number];
    const h = (window as HytteWindow).__hytte;
    const p = h?.project;
    const d = h?.derived;
    if (!p || !d) throw new Error('window.__hytte is missing');
    const v = p.variants.find((x) => x.id === p.activeVariantId) ?? p.variants[0];
    const out: string[] = [];
    for (const g of v.ghosts ?? []) {
      const m = /^(.*)\/([^/]+)\/ghost(?:\/\d+)?$/.exec(g.id);
      const block = m ? v.blocks.find((b) => b.id === m[1]) : undefined;
      const i = block && m ? block.polygon.findIndex((x) => x.id === m[2]) : -1;
      if (!block || !m || i < 0) continue;
      const a = block.polygon[i].p as P;
      const b = block.polygon[(i + 1) % block.polygon.length].p as P;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u: P = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const off = (q: P) => Math.abs((q[0] - a[0]) * u[1] - (q[1] - a[1]) * u[0]);
      if (off(g.a as P) > 1e-6 || off(g.b as P) > 1e-6) continue;
      const along = (q: P) => (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1];
      const s0 = Math.min(along(g.a as P), along(g.b as P));
      const s1 = Math.max(along(g.a as P), along(g.b as P));
      for (const w of d.walls) {
        const src = w.source as { kind: string; blockId?: string; edgeId?: string; s0?: number; s1?: number };
        if (w.isGhost || w.isNew || src.kind !== 'blockEdge' || src.blockId !== block.id || src.edgeId !== m[2]) continue;
        if (Math.min(s1, src.s1 ?? 0) - Math.max(s0, src.s0 ?? 0) > 1e-3) out.push(`${g.id} [${s0}, ${s1}] over ${w.id}`);
      }
    }
    return out;
  });
}

/**
 * One drawn frame of a drag (after two animation frames): the overlay's outlines in plan metres — the moving one
 * (`data-edit-moving`) and the others (the base) — as their y ranges, and where the model has the wall `wallId` now.
 */
async function dragFrame(page: Page, wallId: string): Promise<{ moving: [number, number][]; base: [number, number][]; storedY: number | null }> {
  return page.evaluate(async (id) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const svg = document.querySelector<SVGSVGElement>('[data-testid=plan-view]');
    const inv = svg?.querySelector<SVGGElement>('[data-plan-root]')?.getScreenCTM()?.inverse();
    if (!svg || !inv) throw new Error('the plan is not on screen');
    const yRange = (el: SVGGraphicsElement): [number, number] => {
      const m = el.getScreenCTM();
      const nums = (el.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const ys: number[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const pt = svg.createSVGPoint();
        pt.x = nums[i];
        pt.y = nums[i + 1];
        const c = m ? pt.matrixTransform(m) : pt;
        ys.push(c.matrixTransform(inv).y);
      }
      return [Math.min(...ys), Math.max(...ys)];
    };
    const ghosts = [...svg.querySelectorAll<SVGPathElement>('[data-edit-ghost]')];
    const p = (window as HytteWindow).__hytte?.project;
    const v = p?.variants.find((x) => x.id === p.activeVariantId);
    const w = v?.walls.find((x) => x.id === id);
    return {
      moving: ghosts.filter((g) => g.hasAttribute('data-edit-moving')).map(yRange),
      base: ghosts.filter((g) => !g.hasAttribute('data-edit-moving')).map(yRange),
      storedY: w ? (w.a[1] + w.b[1]) / 2 : null,
    };
  }, wallId);
}

test.describe('furniture and the second review on a desktop (1400×900)', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('(A) a toilet tapped into Hovedbad, dragged into the door swing, turned, duplicated and deleted', async ({ page }, testInfo) => {
    await freshProposal(page);
    expect(await warnings(page), 'the furnished seed has no warnings').toEqual([]);
    const before = new Set((await activeVariant(page)).furniture.map((f) => f.id));

    // Hovedbad selected (a tap on its floor), then Møbler: the library replaces the left column.
    await selectAt(page, [19.65, 0.15], { kind: 'room', id: 'room-hovedbad' });
    await page.getByTestId('tool-furniture').click();
    const library = page.getByTestId('furniture-library');
    await expect(library).toBeVisible();
    await expect(page.getByTestId('hint-line')).toContainText('Trykk på et møbel i listen');
    await page.getByTestId('furniture-search').fill('toalett');
    await page.getByTestId('furniture-item-toalett').click();

    // Placed in Hovedbad against a free wall, selected, the room's level; no warning.
    await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(before.size + 1);
    const wc = (await activeVariant(page)).furniture.find((f) => !before.has(f.id));
    if (!wc) throw new Error('no new item');
    expect(wc).toMatchObject({ catalogId: 'toalett', levelId: 'main', isNew: true, sizeVariant: 'gulv' });
    const placed = (await derivedFurniture(page)).find((f) => f.id === wc.id);
    expect(placed?.roomId).toBe('room-hovedbad');
    expect(placed?.collisions).toEqual([]);
    expect(await selection(page)).toMatchObject({ kind: 'furniture', id: wc.id });
    expect(await warnings(page)).toEqual([]);
    // Its clearance zone is drawn while it is selected (and for every item with «Plassbehov for møbler»).
    await expect(page.locator(`[data-testid=plan-view] [data-clearance-of="${wc.id}"]`).first()).toBeAttached();
    await expect(page.getByTestId('properties-title')).toHaveText('Toalett');

    // Dragged into the swing of the door from Gang (d-bad2, x 19.1–19.9 on y 2.2): door-blocked, naming the toilet.
    await dismissToasts(page);
    await dragPlan(page, wc.position, [19.5, 1.65], 16);
    await expect.poll(async () => (await warnings(page)).filter((w) => w.kind === 'door-blocked').map((w) => [w.openingId, w.by])).toEqual([['d-bad2', wc.id]]);
    await expect(page.getByTestId('warnings')).toContainText('blokkeres av «Toalett»');
    await expect(page.locator(`[data-testid=plan-view] [data-furniture-id="${wc.id}"][data-furniture-colliding]`)).toBeAttached();

    // Roter 90° in Egenskaper.
    const rot0 = (await activeVariant(page)).furniture.find((f) => f.id === wc.id)?.rotationDeg ?? 0;
    await page.getByTestId('furniture-rotate').click();
    await expect.poll(async () => (await activeVariant(page)).furniture.find((f) => f.id === wc.id)?.rotationDeg).toBe((rot0 + 90) % 360);

    // Dupliser: a copy beside it, selected.
    await page.getByTestId('furniture-duplicate').click();
    await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(before.size + 2);
    const copy = (await activeVariant(page)).furniture.find((f) => !before.has(f.id) && f.id !== wc.id);
    expect(copy?.catalogId).toBe('toalett');
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'furniture', id: copy?.id });

    // Slett (the copy, then the toilet itself): back to the seed's furniture, no warning left.
    await page.getByTestId('furniture-delete').click();
    await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(before.size + 1);
    await expect(page.getByTestId('toast').filter({ hasText: 'Slettet' })).toBeVisible();
    await selectAt(page, (await activeVariant(page)).furniture.find((f) => f.id === wc.id)?.position ?? [0, 0], { kind: 'furniture', id: wc.id });
    await page.getByTestId('furniture-delete').click();
    await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(before.size);
    expect(await warnings(page)).toEqual([]);

    // The new wing furnished, every item's clearance drawn.
    await page.getByTestId('library-close').click();
    await page.getByTestId('toggle-clearances').check();
    await page.keyboard.press('Escape');
    await zoomAt(page, [18.4, 2], 4);
    await dismissToasts(page);
    await shoot(page, testInfo, 'plan-furnished');
    await page.getByTestId('toggle-clearances').uncheck();
  });

  test('(B) the bed in Soverom (ny fløy) moved away from the wall and back snaps back to it', async ({ page }) => {
    await freshProposal(page);
    const bed0 = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-sov-ny-1');
    if (!bed0) throw new Error('fu-sov-ny-1 missing');
    // Head against the wing's east wall (inner face x 20.64): its back edge, local +y, faces east (rotationDeg 270).
    expect(bed0).toMatchObject({ catalogId: 'seng-180', rotationDeg: 270 });
    const back = async () => bbox((await derivedFurniture(page)).find((f) => f.id === 'fu-sov-ny-1')?.footprint ?? []).x1;
    expect(await back()).toBeCloseTo(20.64, 2);

    await selectAt(page, bed0.position, { kind: 'furniture', id: 'fu-sov-ny-1' });
    await dragPlan(page, bed0.position, [bed0.position[0] - 0.8, bed0.position[1]], 16);
    await expect.poll(back).toBeLessThan(20.3);
    const away = await back();
    // Back towards the wall, letting go 0.1 m short of it: the bed snaps back to the wall face.
    const at = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-sov-ny-1')?.position ?? bed0.position;
    const short = 20.64 - 0.1 - away;
    await dragPlan(page, at, [at[0] + short, at[1]], 16);
    await expect.poll(back).toBeCloseTo(20.64, 2);
    const bed1 = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-sov-ny-1');
    expect(bed1?.position[1], 'no sideways jump').toBeCloseTo(bed0.position[1], 1);
    expect(bed1?.rotationDeg).toBe(270);
    expect((await warnings(page)).filter((w) => w.kind.startsWith('furniture') || w.kind === 'door-blocked')).toEqual([]);
  });

  test('(C) main south wall 0.3 m in, glass east wall 0.5 m out, then "Ta tilbake" on every ghost: the seed again', async ({ page }) => {
    await freshProposal(page);
    const v0 = await activeVariant(page);
    // The main house's south wall (the piece along Stue, at a point clear of its doors and windows), 0.3 m north.
    const pieceId = await page.evaluate(
      () =>
        (window as HytteWindow).__hytte?.derived?.walls.find(
          (w) => w.source.kind === 'blockEdge' && w.source.blockId === 'blk-main' && w.source.edgeId === 'v-main-sw' && w.levelIds.includes('main') && Math.min(w.a[0], w.b[0]) >= 9 - 1e-6,
        )?.id ?? '',
    );
    expect(pieceId).not.toBe('');
    const south = await clearPointOn(page, pieceId);
    await selectAt(page, south, { kind: 'wall', id: /^blk-main\/v-main-sw\// });
    await dragPlan(page, south, [south[0], south[1] + 0.3], 12);
    await expect.poll(async () => bbox((await activeVariant(page)).blocks.find((b) => b.id === 'blk-main')?.polygon.map((q) => q.p) ?? []).y0).toBeCloseTo(0.3, 2);
    // The glass bump's east wall (its edge handle in the middle, (9, −1)), 0.5 m east.
    await page.keyboard.press('Escape');
    const lese = await roomTapPoint(page, 'room-leseskrok');
    await page.mouse.click(lese[0], lese[1]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'room', id: 'room-leseskrok' });
    await page.getByRole('button', { name: 'Velg bygningsdelen' }).click();
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: 'blk-glass' });
    const glassX1 = async () => bbox((await activeVariant(page)).blocks.find((b) => b.id === 'blk-glass')?.polygon.map((q) => q.p) ?? []).x1;
    await dragPlan(page, [9, -1], [9.5, -1]);
    await expect.poll(glassX1).toBeCloseTo(9.5, 2);
    const ghosts0 = (await activeVariant(page)).ghosts ?? [];
    expect(ghosts0.length).toBeGreaterThan(1);

    await page.keyboard.press('Escape');
    await zoomAt(page, [9.5, -0.5], 3);
    const view = await visiblePlan(page);
    const restored: string[] = [];
    for (let n = 0; n < 8; n++) {
      const g = (await activeVariant(page)).ghosts?.[0];
      if (!g) break;
      const at = await clearPointOn(page, g.id, view);
      await page.keyboard.press('Escape');
      await selectAt(page, at, { kind: 'ghost', id: g.id });
      await page.getByTestId('ghost-restore').click();
      await expect.poll(async () => (await activeVariant(page)).ghosts?.some((x) => x.id === g.id) ?? false).toBe(false);
      restored.push(g.id);
    }
    const v1 = await activeVariant(page);
    const J = (x: unknown) => JSON.stringify(x);
    const same = (k: keyof Variant) => J(v1[k]) === J(v0[k]);
    expect(
      { blocks: same('blocks'), walls: same('walls'), openings: same('openings'), furniture: same('furniture'), ghosts: v1.ghosts },
      `after "Ta tilbake" on ${restored.join(', ')}`,
    ).toEqual({ blocks: true, walls: true, openings: true, furniture: true, ghosts: undefined });
    expect((await derivedRooms(page)).filter((r) => r.name === null)).toEqual([]);
  });

  test('(D) a click on the middle of win-106-s selects the window (the old door under it stays a ghost)', async ({ page }) => {
    await freshProposal(page);
    // win-106-s (1.1 m) sits where door-106-old (0.91 m, a ghost with «Vis hva som er nytt») was, centre (3.68, 0).
    await selectAt(page, [3.68, 0], { kind: 'opening', id: 'win-106-s' });
    // A second click on the selected window gives the ghost under it, a third the window again.
    await page.mouse.click(...(await planToClient(page, [3.68, 0])));
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'ghost', id: 'door-106-old' });
    await page.mouse.click(...(await planToClient(page, [3.68, 0])));
    await expect.poll(async () => (await selection(page))?.id).toBe('win-106-s');
  });

  test('(E) a wall drag draws the moving outline at the pointer on every frame, ahead of the model update', async ({ page }, testInfo) => {
    await freshProposal(page);
    await zoomAt(page, [18.5, 3.9], 3);
    await selectAt(page, [19.5, 3.4], { kind: 'wall', id: 'w-gang-n' });
    await dismissToasts(page);
    const s = await planScale(page);
    const [x0, y0] = await planToClient(page, [19.5, 3.4]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    // Past the 5 px drag threshold, then 0.1 m north per frame (plan +y is up on screen).
    const frames: { y: number; moving: [number, number][]; base: [number, number][]; storedY: number | null }[] = [];
    let shot = false;
    // Then one jump of 0.6 m, which the outline follows on the next frame while the update waits its turn.
    const ys = [...Array.from({ length: 14 }, (_, i) => 3.4 + 0.35 + 0.1 * i), 3.4 + 0.35 + 1.3 + 0.6];
    for (const y of ys) {
      await page.mouse.move(x0, y0 - (y - 3.4) * s);
      const f = await dragFrame(page, 'w-gang-n');
      frames.push({ y, ...f });
      const ahead = f.moving.length === 1 && f.storedY !== null && Math.abs((f.moving[0][0] + f.moving[0][1]) / 2 - f.storedY) > 0.2;
      if (ahead && !shot) {
        // A frame where the outline is well ahead of the drawn wall (no clicks: `shoot` would close toasts with the
        // mouse and end the drag).
        shot = true;
        const file = join(SCREENSHOT_DIR, 'plan-drag-preview.png');
        await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
        await testInfo.attach('plan-drag-preview', { path: file, contentType: 'image/png' });
      }
    }
    await page.mouse.up();
    const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
    for (const f of frames) {
      // Two outlines on every frame: the base where the wall was at pointer-down, the moving one at the pointer (on the
      // grid or a snap target: never farther than the snap reach, 0.25 m, plus a pixel).
      expect(f.base.length, `frame at y ${f.y.toFixed(2)}`).toBe(1);
      expect(f.moving.length, `frame at y ${f.y.toFixed(2)}`).toBe(1);
      expect(mid(f.base[0]), 'the base outline stays put').toBeCloseTo(3.4, 1);
      expect(Math.abs(mid(f.moving[0]) - f.y), `moving outline at ${mid(f.moving[0]).toFixed(2)}, pointer at ${f.y.toFixed(2)}`).toBeLessThanOrEqual(0.25 + 1 / s);
    }
    // On some frames the model still had the wall behind the pointer: only the preview drew it there.
    const ahead = frames.filter((f) => f.storedY !== null && Math.abs(mid(f.moving[0]) - f.storedY) > 0.05);
    testInfo.annotations.push({ type: 'outline ahead of the model', description: `${ahead.length} of ${frames.length} frames` });
    expect(ahead.length, `frames where the outline was ahead of the model: ${ahead.length} of ${frames.length}`).toBeGreaterThan(0);
    // Let go: the wall lands where the outline was.
    const last = frames[frames.length - 1];
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n')?.a[1] ?? 0).toBeCloseTo(mid(last.moving[0]), 1);
    await expect(page.locator('[data-testid=plan-view] [data-edit-ghost]')).toHaveCount(0);
  });

  test('(F) Ctrl+D on the armchair in Stue: the copy stands beside it, with no collision and no warning', async ({ page }) => {
    await freshProposal(page);
    const before = new Set((await activeVariant(page)).furniture.map((f) => f.id));
    const orig = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-stue-5');
    if (!orig) throw new Error('fu-stue-5 missing');
    await selectAt(page, orig.position, { kind: 'furniture', id: 'fu-stue-5' });
    await page.keyboard.press('Control+d');
    await expect.poll(async () => (await activeVariant(page)).furniture.length).toBe(before.size + 1);
    const copy = (await activeVariant(page)).furniture.find((f) => !before.has(f.id));
    if (!copy) throw new Error('no copy');
    expect(copy.catalogId).toBe('lenestol');
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'furniture', id: copy.id });
    const d = (await derivedFurniture(page)).find((f) => f.id === copy.id);
    expect(d?.roomId).toBe('room-stue');
    expect(d?.collisions).toEqual([]);
    const dist = Math.hypot(copy.position[0] - orig.position[0], copy.position[1] - orig.position[1]);
    expect(dist, `the copy ${dist.toFixed(2)} m from the original`).toBeGreaterThanOrEqual(0.7 - 1e-6);
    expect(dist).toBeLessThanOrEqual(1.2);
    expect(await warnings(page)).toEqual([]);
    await expect(page.getByTestId('toast').filter({ hasText: 'advarsel' })).toHaveCount(0);
    await expect(page.locator('[data-testid=plan-view] [data-furniture-colliding]')).toHaveCount(0);
  });

  test('(G) main south 0.3 m in, glass east 0.5 m out, then each «Ta tilbake» alone: no ghost over a live wall of today', async ({ page }) => {
    await freshProposal(page);
    const v0 = await activeVariant(page);
    const pieceId = await page.evaluate(
      () =>
        (window as HytteWindow).__hytte?.derived?.walls.find(
          (w) => w.source.kind === 'blockEdge' && w.source.blockId === 'blk-main' && w.source.edgeId === 'v-main-sw' && w.levelIds.includes('main') && Math.min(w.a[0], w.b[0]) >= 9 - 1e-6,
        )?.id ?? '',
    );
    const south = await clearPointOn(page, pieceId);
    await selectAt(page, south, { kind: 'wall', id: /^blk-main\/v-main-sw\// });
    await dragPlan(page, south, [south[0], south[1] + 0.3], 12);
    await expect.poll(async () => bbox((await activeVariant(page)).blocks.find((b) => b.id === 'blk-main')?.polygon.map((q) => q.p) ?? []).y0).toBeCloseTo(0.3, 2);
    await page.keyboard.press('Escape');
    const lese = await roomTapPoint(page, 'room-leseskrok');
    await page.mouse.click(lese[0], lese[1]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'room', id: 'room-leseskrok' });
    await page.getByRole('button', { name: 'Velg bygningsdelen' }).click();
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: 'blk-glass' });
    await dragPlan(page, [9, -1], [9.5, -1]);
    await expect.poll(async () => bbox((await activeVariant(page)).blocks.find((b) => b.id === 'blk-glass')?.polygon.map((q) => q.p) ?? []).x1).toBeCloseTo(9.5, 2);
    expect(await ghostsOverLiveWalls(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await zoomAt(page, [9.5, -0.5], 3);
    const view = await visiblePlan(page);
    // The main wall's own ghost first (the review's order), then whichever is left, one at a time.
    const order: string[] = [];
    for (let n = 0; n < 8; n++) {
      const gs = (await activeVariant(page)).ghosts ?? [];
      const g = order.length === 0 ? (gs.find((x) => x.id === 'blk-main/v-main-sw/ghost') ?? gs[0]) : gs[0];
      if (!g) break;
      const at = await clearPointOn(page, g.id, view);
      await page.keyboard.press('Escape');
      await selectAt(page, at, { kind: 'ghost', id: g.id });
      await page.getByTestId('ghost-restore').click();
      await expect.poll(async () => (await activeVariant(page)).ghosts?.some((x) => x.id === g.id) ?? false).toBe(false);
      order.push(g.id);
      expect(await ghostsOverLiveWalls(page), `after «Ta tilbake» on ${order.join(', ')}`).toEqual([]);
      if (order.length === 1) {
        // The main wall's other ghost keeps only the stretch the glass still holds open: [9, 0]–[9.5, 0].
        const left = ((await activeVariant(page)).ghosts ?? []).filter((x) => x.id.startsWith('blk-main/'));
        expect(left.map((x) => [x.a, x.b])).toEqual([
          [
            [9, 0],
            [9.5, 0],
          ],
        ]);
      }
    }
    expect(order[0]).toBe('blk-main/v-main-sw/ghost');
    const v1 = await activeVariant(page);
    const J = (x: unknown) => JSON.stringify(x);
    expect({ blocks: J(v1.blocks) === J(v0.blocks), walls: J(v1.walls) === J(v0.walls), openings: J(v1.openings) === J(v0.openings), ghosts: v1.ghosts }).toEqual({
      blocks: true,
      walls: true,
      openings: true,
      ghosts: undefined,
    });
    expect((await derivedRooms(page)).filter((r) => r.name === null)).toEqual([]);
  });

  test('(H) a dining chair pushed in under the table edge is tucked in: no collision, no warning', async ({ page }) => {
    await freshProposal(page);
    // fu-spiseplass-3 (0.45 m) south of the table fu-spiseplass-1 (y 4.45–5.45), 0.125 m clear of its edge.
    const chair0 = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-spiseplass-3');
    expect(chair0?.position).toEqual([14.2, 4.1]);
    await selectAt(page, [14.2, 4.1], { kind: 'furniture', id: 'fu-spiseplass-3' });
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(async () => (await activeVariant(page)).furniture.find((f) => f.id === 'fu-spiseplass-3')?.position[1] ?? 0).toBeCloseTo(4.4, 3);
    // The seat now reaches 0.175 m in under the table; its centre is still outside the table's edge.
    const seat = bbox((await derivedFurniture(page)).find((f) => f.id === 'fu-spiseplass-3')?.footprint ?? []);
    expect(seat.y1).toBeGreaterThan(4.45 + 0.1);
    const d = await derivedFurniture(page);
    expect(d.find((f) => f.id === 'fu-spiseplass-3')?.collisions).toEqual([]);
    expect(d.find((f) => f.id === 'fu-spiseplass-1')?.collisions).toEqual([]);
    expect(await warnings(page)).toEqual([]);
    await expect(page.locator('[data-testid=plan-view] [data-furniture-colliding]')).toHaveCount(0);
  });

  test('3D: the furnished cabin, Inne, from above', async ({ page }, testInfo) => {
    await loadAndWaitReady(page);
    await page.getByTestId('view-tab-3d').click();
    await expect(page.getByTestId('view-3d').locator('canvas')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('mode-inne').click();
    await page.getByTestId('preset-ovenfra').click();
    await page.waitForTimeout(SETTLE_MS * 2);
    // Names off and closer in, so the furniture shows.
    await page.getByTestId('toggle-labels').uncheck();
    const canvas = await page.getByTestId('view-3d').locator('canvas').boundingBox();
    if (!canvas) throw new Error('no canvas');
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(SETTLE_MS);
    await shoot(page, testInfo, '3d-inne-furnished');
    await page.getByTestId('toggle-labels').check();
    await page.getByTestId('view-tab-plan').click();
  });
});

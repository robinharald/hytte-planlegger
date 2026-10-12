/**
 * Default snapping of the plan's placement tools (docs/phase2-plan.md §3.3) when the edit API brings no
 * `snapPoint`: geometry/snap.ts on a `SnapContext` built once per (derived model, storey) and cached.
 *  - Vegg / Mål (and anything else): `snap(ctx, p, { radius, fine: Alt, from })` — wall endpoints and midpoints,
 *    block axis vertices / edges, deck edges, extensions and perpendiculars, ortho guides and a length chip from the
 *    first point, else the 0.10 m grid (0.01 m with Alt);
 *  - Nytt bygg: the template footprint centred on p moved by `snapPolygon` (axis to axis against block axis edges
 *    and deck edges; directions without a snap put the footprint's vertex 0 on the grid).
 * Pure apart from the cache (a WeakMap on the derived model). Unit-tested in planSnap.test.ts.
 */
import type { DerivedVariant } from '../model/derived';
import type { Id, Vec2 } from '../model/types';
import { buildSnapContext, snap, snapPolygon } from '../geometry/snap';
import type { SnapContext, SnapResult } from '../geometry/snap';
import { unitFootprint } from './editModel';
import type { PlanSnapOptions } from './editTypes';

const contexts = new WeakMap<DerivedVariant, Map<Id, SnapContext>>();

/** The snap targets of one storey, built once per derived model. */
export function snapContextFor(derived: DerivedVariant, storeyId: Id): SnapContext {
  let byStorey = contexts.get(derived);
  if (!byStorey) {
    byStorey = new Map();
    contexts.set(derived, byStorey);
  }
  let ctx = byStorey.get(storeyId);
  if (!ctx) {
    ctx = buildSnapContext(derived, { storeyId });
    byStorey.set(storeyId, ctx);
  }
  return ctx;
}

/** Snap a placement tool's pointer position (see the header). */
export function defaultSnapPoint(derived: DerivedVariant, p: Vec2, opts: PlanSnapOptions): SnapResult {
  const ctx = snapContextFor(derived, opts.storeyId);
  const radius = opts.modifiers.snapRadiusM;
  const fine = opts.modifiers.alt;
  if (opts.purpose === 'unit' && opts.templateId) {
    const r = snapPolygon(ctx, unitFootprint(opts.templateId, p, opts.rotation90 ?? 0), { radius, fine });
    const point: Vec2 = [p[0] + r.delta[0], p[1] + r.delta[1]];
    return { point, kind: r.indicators.length > 0 ? 'line' : 'grid', indicators: r.indicators, chips: [] };
  }
  return snap(ctx, p, { radius, fine, from: opts.from });
}

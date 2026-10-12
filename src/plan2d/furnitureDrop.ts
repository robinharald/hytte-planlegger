/**
 * The plan's side of the furniture library hand-off (docs/phase2-plan.md §3.2: library items are tapped to place or
 * dragged in; §3.1: no HTML5 drag-and-drop). DOM events only, so the library needs no reference to the plan:
 *
 *  - FURNITURE_DRAG_EVENT, while a library item is dragged: dispatched on the element under the pointer (it bubbles to
 *    the document). A plan whose box holds that element shows where the item would land and calls preventDefault(),
 *    so `dispatchFurnitureDrag` returns true over the plan; every other plan hides its preview. `catalogId: null`
 *    (sent to the document) ends the drag: every plan hides its preview.
 *  - FURNITURE_DROP_EVENT (view3d/dropEvent.ts, shared with the 3D view): the release. The plan under the pointer turns
 *    the point into a plan point, calls its `onDropFurniture(catalogId, planPoint)` and preventDefault().
 *  - PLAN_CENTRE_EVENT, sent to the document by the library's tap: a SHOWN plan writes the plan point at the middle of
 *    its view, its storey and its zoom into the event's detail (`requestPlanCentre`), for "else the visible plan
 *    centre".
 */
import type { Vec2 } from '../model/types';
import { FURNITURE_DROP_EVENT, dispatchFurnitureDrop, furnitureDropDetail } from '../view3d/dropEvent';

export { FURNITURE_DROP_EVENT, dispatchFurnitureDrop, furnitureDropDetail };

export const FURNITURE_DRAG_EVENT = 'hytte:furniture-drag';
export const PLAN_CENTRE_EVENT = 'hytte:plan-centre';

export interface FurnitureDragDetail {
  /** The dragged catalogue id; null = the drag ended or was cancelled. */
  catalogId: string | null;
  clientX: number;
  clientY: number;
}

export interface PlanCentreDetail {
  centre: Vec2 | null;
  storeyId: string | null;
  /** px per metre. */
  scale: number | null;
}

/** The detail of a drag event, or null when it is not a well-formed one. */
export function furnitureDragDetail(e: Event): FurnitureDragDetail | null {
  const d = (e as CustomEvent<unknown>).detail as Partial<FurnitureDragDetail> | null | undefined;
  if (!d || typeof d !== 'object') return null;
  if (d.catalogId !== null && (typeof d.catalogId !== 'string' || d.catalogId === '')) return null;
  if (typeof d.clientX !== 'number' || typeof d.clientY !== 'number') return null;
  return { catalogId: d.catalogId, clientX: d.clientX, clientY: d.clientY };
}

/**
 * A library drag moved to (clientX, clientY) (`catalogId` null: it ended). Returns true when a plan is under the
 * pointer and shows the preview.
 */
export function dispatchFurnitureDrag(catalogId: string | null, clientX: number, clientY: number, doc: Document = document): boolean {
  const detail: FurnitureDragDetail = { catalogId, clientX, clientY };
  const target: EventTarget = catalogId !== null && typeof doc.elementFromPoint === 'function' ? (doc.elementFromPoint(clientX, clientY) ?? doc) : doc;
  const event = new CustomEvent<FurnitureDragDetail>(FURNITURE_DRAG_EVENT, { bubbles: true, cancelable: true, detail });
  return !target.dispatchEvent(event);
}

/** Ask the shown plan for the plan point at the middle of its view (null when no plan answers). */
export function requestPlanCentre(doc: Document = document): PlanCentreDetail | null {
  const detail: PlanCentreDetail = { centre: null, storeyId: null, scale: null };
  doc.dispatchEvent(new CustomEvent<PlanCentreDetail>(PLAN_CENTRE_EVENT, { detail }));
  return detail.centre ? detail : null;
}

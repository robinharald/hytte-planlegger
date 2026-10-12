/**
 * Furniture drop protocol between the furniture library (phase 2b) and the views (docs/phase2-plan.md §3.2: "in 3D a
 * library item dropped on the view lands on the floor at the hit point").
 *
 * The phase-2 gestures use pointer events only (no HTML5 drag-and-drop, §3.1: it does not work with touch on iOS),
 * so the library tracks its own drag and, on release, calls `dispatchFurnitureDrop(clientX, clientY, catalogId)`. That
 * dispatches a bubbling, cancelable `FURNITURE_DROP_EVENT` CustomEvent on the element under the pointer; a view that
 * accepts the drop calls `preventDefault()` (the 3D view does so when its ray hits a floor, a deck or the terrain and
 * it has an `onDropFurniture` handler), so the call returns whether some view took the item.
 *
 * Kept free of three.js so the library can import it without pulling the lazily loaded 3D view into the main bundle.
 */

export const FURNITURE_DROP_EVENT = 'hytte:furniture-drop';

export interface FurnitureDropDetail {
  catalogId: string;
  /** Pointer position at the release, CSS px in the viewport (like PointerEvent.clientX / clientY). */
  clientX: number;
  clientY: number;
}

/** The detail of a furniture drop event, or null when the event is not a well-formed one. */
export function furnitureDropDetail(e: Event): FurnitureDropDetail | null {
  const d = (e as CustomEvent<unknown>).detail as Partial<FurnitureDropDetail> | null | undefined;
  if (!d || typeof d !== 'object') return null;
  if (typeof d.catalogId !== 'string' || d.catalogId === '') return null;
  if (typeof d.clientX !== 'number' || typeof d.clientY !== 'number' || !Number.isFinite(d.clientX) || !Number.isFinite(d.clientY)) return null;
  return { catalogId: d.catalogId, clientX: d.clientX, clientY: d.clientY };
}

/**
 * Drops a library item at a viewport point: dispatches FURNITURE_DROP_EVENT on the element there. Returns true when
 * a view accepted the drop (called preventDefault).
 */
export function dispatchFurnitureDrop(clientX: number, clientY: number, catalogId: string, doc: Document = document): boolean {
  const target = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(clientX, clientY) : null;
  if (!target) return false;
  const detail: FurnitureDropDetail = { catalogId, clientX, clientY };
  const event = new CustomEvent<FurnitureDropDetail>(FURNITURE_DROP_EVENT, { bubbles: true, cancelable: true, detail });
  return !target.dispatchEvent(event);
}

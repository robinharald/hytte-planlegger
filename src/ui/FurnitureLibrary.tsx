/**
 * The furniture library (docs/phase2-plan.md §3.2): the content of the Møbler column (LibraryPanel.tsx, desktop and
 * tablet) and of the Møbler bottom sheet on phones (LibrarySheet, `variant="sheet"`).
 *
 *  - A search box ("Søk etter møbler"; words, any order, Norwegian letters optional: furnitureLibraryModel.ts) and the
 *    catalogue's categories as an accordion with their Norwegian names and item counts. One category is open at a
 *    time; the first one open fits the selected room ("Bad / WC" for a bathroom), else the first. While searching,
 *    every category with a match is open.
 *  - Each item shows its small plan symbol (the plan's own, FurnitureIcon), its name and its default size ("90 × 200
 *    cm").
 *  - TAP (click, Enter / Space) places it: in the selected room, else in the middle of the visible plan, pushed to
 *    the nearest free wall, selected (furniturePlacer.ts). DRAG (pointer events, libraryDrag.ts: a mouse drag, or a
 *    long press on touch) carries it over the plan, which shows where it will land; the release drops it there (the
 *    plan's / 3D view's `onDropFurniture`, plan2d/furnitureDrop.ts). Esc cancels a drag.
 *  - On phones (`variant="sheet"`) the sheet closes after a placement (back to Velg), so the new item shows with its
 *    mini-bar; the plan keeps the selection above the sheet while it is open (BottomSheet → `viewportInsets`).
 *  - A polite live region says what was placed ("Seng 150 er satt inn i Soverom 1.").
 *
 * Test ids: `furniture-search`, `furniture-category-<id>`, `furniture-item-<catalogId>`, `furniture-drag-chip`.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FurnitureCategory } from '../furniture/catalog';
import { FurnitureIcon } from '../plan2d/layers/FurnitureSymbol';
import { dispatchFurnitureDrag, dispatchFurnitureDrop } from '../plan2d/furnitureDrop';
import { appStore } from '../state/appStore';
import { deriveForState } from '../state/useDerived';
import { setTool } from './editorBridge';
import { roomForSelection } from './furniturePlacer';
import { useFurniturePlacer } from './useFurniturePlacer';
import type { PlaceHow, Placed } from './furniturePlacer';
import { categoryForRoomType, filterLibrary, groupByCategory, libraryEntries } from './furnitureLibraryModel';
import type { LibraryEntry } from './furnitureLibraryModel';
import { nb } from '../i18n/nb';
import { createLibraryDrag } from './libraryDrag';
import type { DragPointer, LibraryDrag } from './libraryDrag';
import './furnitureLibrary.css';

const S = nb.library;

const nextFrame = (cb: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number));
const cancelFrame = (id: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));

export interface FurnitureLibraryProps {
  /** 'sheet': the phone's bottom sheet (closes after a placement). Default 'panel'. */
  variant?: 'panel' | 'sheet';
  /** Placement (default: the app's `useFurniturePlacer()`); tests pass their own. */
  place?: (catalogId: string, how: PlaceHow) => Placed | null;
  /** The category open at first (default: from the selected room, else the first). */
  initialCategory?: FurnitureCategory | null;
}

/** The category that fits the selected room (read once when the library opens). */
function categoryOfSelection(): FurnitureCategory | null {
  try {
    const s = appStore.getState();
    const room = roomForSelection(deriveForState(s), s.ui.selection, s.ui.planStorey);
    return categoryForRoomType(room?.room?.type);
  } catch {
    return null;
  }
}

interface DragView {
  id: string;
  x: number;
  y: number;
  overPlan: boolean;
}

function toPointer(e: ReactPointerEvent): DragPointer {
  return { pointerId: e.pointerId, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY, button: e.button };
}

export function FurnitureLibrary(props: FurnitureLibraryProps) {
  const appPlace = useFurniturePlacer();
  const place = props.place ?? appPlace;
  const sheet = props.variant === 'sheet';
  const entries = libraryEntries();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<FurnitureCategory | null>(() => (props.initialCategory !== undefined ? props.initialCategory : (categoryOfSelection() ?? entries[0]?.category ?? null)));
  const [status, setStatus] = useState('');
  const [drag, setDrag] = useState<DragView | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const shown = useMemo(() => filterLibrary(entries, query), [entries, query]);
  const groups = useMemo(() => groupByCategory(shown), [shown]);
  const searching = query.trim() !== '';

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const afterPlace = (entry: LibraryEntry, roomName: string | null) => {
    setStatus(roomName ? S.placedIn(entry.name, roomName) : S.placed(entry.name));
    if (sheet) setTool('select');
  };

  // What the drag's callbacks (event time) need from the latest render.
  const latest = useRef({ place, byId, afterPlace });
  useEffect(() => {
    latest.current = { place, byId, afterPlace };
  });

  // The drag controller (libraryDrag.ts), made once; its moves reach the plan once per frame.
  const ctl = useRef<LibraryDrag | null>(null);
  useEffect(() => {
    let frameId: number | null = null;
    let next: DragView | null = null;
    const stopFrame = () => {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      next = null;
    };
    const drag = createLibraryDrag({
      armed: (id) => setArmedId(id),
      start: (id, x, y) => {
        setArmedId(null);
        setDrag({ id, x, y, overPlan: false });
      },
      move: (id, x, y) => {
        next = { id, x, y, overPlan: false };
        if (frameId !== null) return;
        frameId = nextFrame(() => {
          frameId = null;
          const n = next;
          next = null;
          if (!n) return;
          const overPlan = dispatchFurnitureDrag(n.id, n.x, n.y);
          setDrag({ ...n, overPlan });
        });
      },
      drop: (id, x, y) => {
        stopFrame();
        setDrag(null);
        setArmedId(null);
        dispatchFurnitureDrag(null, x, y);
        const ok = dispatchFurnitureDrop(x, y, id);
        const entry = latest.current.byId.get(id);
        if (ok && entry) latest.current.afterPlace(entry, null);
      },
      cancel: () => {
        stopFrame();
        setDrag(null);
        setArmedId(null);
        dispatchFurnitureDrag(null, 0, 0);
      },
    });
    ctl.current = drag;
    // Touch: once a long press armed a drag, the finger must not scroll the list or the page.
    const el = listRef.current;
    const onTouchMove = (e: TouchEvent) => {
      if (drag.holding() && e.cancelable) e.preventDefault();
    };
    el?.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el?.removeEventListener('touchmove', onTouchMove);
      drag.cancel();
      stopFrame();
      ctl.current = null;
    };
  }, []);

  // Esc cancels a drag (and nothing else: the app's Esc then does not close the library).
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      ctl.current?.cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragging]);

  const pick = (entry: LibraryEntry) => {
    const r = latest.current.place(entry.id, { kind: 'tap' });
    if (r) afterPlace(entry, r.room?.room?.name ?? null);
  };

  const itemHandlers = (entry: LibraryEntry) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      ctl.current?.down(entry.id, toPointer(e));
      if (e.pointerType !== 'touch') {
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // jsdom, or the pointer is already gone
        }
      }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (ctl.current?.move(toPointer(e))) e.preventDefault();
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
      ctl.current?.up(toPointer(e));
    },
    onPointerCancel: () => ctl.current?.cancel(),
    onLostPointerCapture: () => {
      if (ctl.current?.dragging()) ctl.current.cancel();
    },
    onClick: () => {
      if (ctl.current?.takeClick() ?? true) pick(entry);
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape' && ctl.current?.dragging()) {
        e.preventDefault();
        ctl.current.cancel();
      }
    },
    onContextMenu: (e: { preventDefault(): void }) => {
      // A long press on touch opens no context menu.
      if (ctl.current?.holding()) e.preventDefault();
    },
  });

  const dragged = drag ? byId.get(drag.id) : undefined;

  return (
    <div className="flib" data-variant={sheet ? 'sheet' : 'panel'} data-dragging={drag ? 'true' : undefined}>
      <div className="flib-search">
        <label className="sr-only" htmlFor={`${uid}-q`}>
          {S.searchLabel}
        </label>
        <input
          id={`${uid}-q`}
          type="search"
          className="text-input flib-search-input"
          placeholder={S.searchPlaceholder}
          value={query}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
          data-testid="furniture-search"
        />
        {query && (
          <button type="button" className="btn btn-ghost btn-small flib-search-clear" onClick={() => setQuery('')} aria-label={S.searchClear} title={S.searchClear}>
            ×
          </button>
        )}
      </div>
      <p className="flib-intro muted">{sheet ? S.introTouch : S.intro}</p>
      <div className="flib-list" ref={listRef}>
        {groups.length === 0 && <p className="flib-empty muted">{S.noMatch(query.trim())}</p>}
        {groups.map((g) => {
          const expanded = searching || open === g.id;
          const panelId = `${uid}-${g.id}`;
          return (
            <section key={g.id} className="flib-cat" data-testid={`furniture-category-${g.id}`} data-open={expanded || undefined}>
              <h3 className="flib-cat-head">
                <button type="button" className="flib-cat-btn" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen((cur) => (cur === g.id && !searching ? null : g.id))} disabled={searching}>
                  <span className="flib-cat-name">{g.name}</span>
                  <span className="flib-cat-count">{S.count(g.items.length)}</span>
                  <span className="flib-chevron" aria-hidden="true" />
                </button>
              </h3>
              {expanded && (
                <ul className="flib-items" id={panelId}>
                  {g.items.map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        className="flib-item"
                        data-testid={`furniture-item-${it.id}`}
                        data-armed={armedId === it.id || undefined}
                        title={S.itemTitle(it.name, it.sizeText)}
                        {...itemHandlers(it)}
                      >
                        <FurnitureIcon catalogId={it.id} w={it.size.w} d={it.size.d} size={36} />
                        <span className="flib-item-text">
                          <span className="flib-item-name">{it.name}</span>
                          <span className="flib-item-size">{it.sizeText}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {drag &&
        dragged &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="flib-drag" data-testid="furniture-drag-chip" data-over-plan={drag.overPlan || undefined} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            <FurnitureIcon catalogId={dragged.id} w={dragged.size.w} d={dragged.size.d} size={32} />
            <span>{dragged.name}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * Furniture of the current storey (docs/phase2-plan.md §4 "2D symbols", §3.1 handles). Each item is its catalogue
 * symbol (furnitureSymbols.ts, FurnitureSymbol.tsx) turned by `rotationDeg` about its position, in the item colour's
 * light fill; selectable as { kind: 'furniture', id, levelId } through its footprint only (the first `path` of the
 * item's group, which also carries the selection / collision stroke; the symbol itself takes no pointer events).
 *
 *  - Selected: accent outline and a light accent wash on top of the symbol, and the catalogue name (when it fits).
 *    The name is otherwise only written on items without a catalogue entry (plain boxes) — symbols speak for
 *    themselves; appliances write their short code ("VM", "TT", "KJ", "VV") when the item is big enough on screen.
 *  - Collisions (furnitureLayerModel.ts `collidingFurnitureIds`: overlaps, in a wall, in a door's swing): red outline.
 *  - Clearance zones (`DerivedFurniture.clearances`) as faint hatching: every item's when `showClearances`
 *    (ui.showClearances, «Plassbehov for møbler» in Vis), and always the selected item's.
 *  - `ghost`: where a library item dragged over the plan would land (the plan's drop preview), drawn as the symbol in
 *    accent ink over a dashed outline (red when the spot is not free).
 *
 * The plan draws this layer ABOVE the room-label hit areas and BELOW the walls and openings (PlanView.tsx), so a tap
 * on a sofa under a room's name selects the sofa, and a tap on the wall it stands against still selects the wall.
 * Flat items (rugs: catalogue mount 'flat') are an exception (integration): until selected they take taps only on a
 * FLAT_EDGE_HIT_PX band along their outline, so a tap inside a rug selects the room under it.
 *
 * `FurnitureRotateHandle` (drawn by the plan on top of everything for the selected item while editing): a white
 * circle with an accent border on a short stem outside the middle of one of the item's edges. A tap turns the item
 * 90° (`onRotate(id, 90)`, like «Roter 90°»); a drag turns the item so that the handle's side faces the pointer in 15°
 * steps (1° with Alt), previewed as a dashed outline with the angle, and applied once on release (`onRotate(id,
 * degrees)`: one undo step).
 *  - Which edge (final fix round, `handleSide`): the first of front, back, left and right whose handle covers no other
 *    item (`items`) and no wall (`walls`) and whose stem crosses no wall (so an item backed onto a wall never gets its
 *    handle in the next room), else one that covers only a rug, else one that only grazes another item, the least
 *    overlap first. A dining chair at the table gets it on its back, away from the table. On touch an edge facing up
 *    on the screen is never used (sixth review: the phone's mini-bar floats just above the selection and covered
 *    three quarters of the handle there, so a tap on it hit Roter or Egenskaper). Last fix round: a side that meets a
 *    wall (circle or stem) or whose handle middle stands on a solid item is never used; with no side left the handle
 *    is not drawn (before: the front, through a wall or onto the table) — «Roter 90°» in the mini-bar and Egenskaper
 *    remains.
 *  - Hit area: the drawn circle only, and a press on it ALWAYS turns the item (final fix round; before, a press where
 *    the handle stood on another item, a rug, a wall or a room's name went through to the plan, so the handle did
 *    nothing for most seed items). On touch (`coarse`) its radius is at most ROTATE_HANDLE_MAX_M in plan metres;
 *    below the zoom where a touch handle of ROTATE_HANDLE_MIN_TOUCH_PX would cover more than that, it is not drawn
 *    (the mini-bar's «Roter» remains) — `rotateHandleRadiusPx`.
 *  - A press is still reported to the plan's gesture tracker (usePanZoom.ts `holdPointer`), which neither pans nor
 *    taps with it; a second finger turns the gesture into a pinch and the handle drops its press (no turn).
 */
import { memo, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DerivedFurniture, DerivedWall } from '../../model/derived';
import type { Vec2 } from '../../model/types';
import type { PlanSelection } from '../editTypes';
import { domId, polygonPath } from '../svg';
import { distancePointSegment, pointInPolygon, segmentIntersection } from '../../geometry/polygon';
import { isSelected, selAttrs } from '../selection';
import { holdPointer } from '../usePanZoom';
import { ACCENT, COLORS, FONT_PX, NSS, PAPER, STROKE } from '../style';
import { FurnitureSymbol } from './FurnitureSymbol';
import { COLLISION, ROTATE_STEM_PX, ROTATE_STEP_DEG, ROTATE_STEP_FINE_DEG, codeFits, labelFits, rotationToward, toPlan } from './furnitureLayerModel';
import { hasSymbol, symbolFor } from './furnitureSymbols';
import { ScreenText } from './ScreenText';

/** A library item dragged over the plan (see the header). */
export interface FurnitureGhost {
  catalogId: string;
  position: Vec2;
  rotationDeg: number;
  size: { w: number; d: number };
  footprint: Vec2[];
  free: boolean;
}

export interface FurnitureLayerProps {
  items: DerivedFurniture[];
  selection: PlanSelection | null;
  scale: number;
  showClearances: boolean;
  /** Items drawn with the red collision outline; default: those with their own collisions or blocked doors. */
  colliding?: readonly string[];
  ghost?: FurnitureGhost | null;
}

const EMPTY: readonly string[] = [];

function centreOf(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

const n4 = (v: number) => Math.round(v * 1e4) / 1e4;
const placeTransform = (p: Vec2, deg: number) => `translate(${n4(p[0])} ${n4(p[1])})${deg ? ` rotate(${n4(deg)})` : ''}`;

function itemName(f: DerivedFurniture): string {
  return f.catalog?.name ?? f.item.catalogId;
}

/**
 * Width (screen px) of the band along a flat item's outline that selects it (rugs: catalogue mount 'flat'). The middle
 * of a rug belongs to the room under it, so a room covered by a rug can still be tapped; once selected, the whole rug
 * takes taps and drags.
 */
export const FLAT_EDGE_HIT_PX = 12;

const FurnitureItemView = memo(function FurnitureItemView({ f, selected, colliding, scale }: { f: DerivedFurniture; selected: boolean; colliding: boolean; scale: number }) {
  const outline = polygonPath(f.footprint);
  const edgeOnly = f.catalog?.mount === 'flat' && !selected;
  const size = f.item.size ?? { w: 1, d: 1, h: 1 };
  const known = hasSymbol(f.item.catalogId);
  const name = itemName(f);
  const stroke = selected ? ACCENT : colliding ? COLLISION : 'none';
  const showName = (selected || !known || !f.catalog) && labelFits(name, f.bbox, scale);
  const code = symbolFor(f.item.catalogId).code;
  const showCode = !showName && code !== undefined && codeFits(code, size, scale);
  const c = centreOf(f.footprint);
  return (
    <g data-furniture-id={f.id} data-furniture-catalog={f.item.catalogId} data-furniture-colliding={colliding || undefined} {...selAttrs('furniture', f.id, f.levelId)}>
      {/* Hit area and the selection / collision stroke (first path: what a tap lands on); a rug only by its edge. */}
      {edgeOnly ? (
        <path d={outline} fill="none" stroke={PAPER} strokeOpacity={0} strokeWidth={FLAT_EDGE_HIT_PX} pointerEvents="stroke" strokeLinejoin="round" data-furniture-hit="edge" {...NSS} />
      ) : (
        <path d={outline} fill={PAPER} fillOpacity={0} stroke={stroke} strokeWidth={selected ? STROKE.selected : STROKE.medium} pointerEvents="fill" strokeLinejoin="round" {...NSS} />
      )}
      <g transform={placeTransform(f.item.position, f.item.rotationDeg)} data-furniture-symbol={f.item.catalogId} pointerEvents="none">
        <FurnitureSymbol catalogId={f.item.catalogId} w={size.w} d={size.d} colour={f.item.colour} />
      </g>
      {(selected || colliding) && (
        <path
          d={outline}
          fill={selected ? ACCENT : 'none'}
          fillOpacity={selected ? 0.1 : undefined}
          stroke={stroke}
          strokeWidth={selected ? STROKE.selected : STROKE.medium}
          strokeLinejoin="round"
          pointerEvents="none"
          data-furniture-outline={selected ? 'selected' : 'collision'}
          {...NSS}
        />
      )}
      {showName && (
        <ScreenText x={c[0]} y={c[1]} scale={scale} data-furniture-label={f.id}>
          <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT_PX.small} fill={selected ? COLORS.labelName : COLORS.labelMuted} stroke={PAPER} strokeWidth={2.5} paintOrder="stroke" strokeLinejoin="round">
            {name}
          </text>
        </ScreenText>
      )}
      {showCode && (
        <ScreenText x={c[0]} y={c[1]} scale={scale} data-furniture-code={f.id}>
          <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT_PX.small - 1} fontWeight={600} fill={COLORS.labelMuted}>
            {code}
          </text>
        </ScreenText>
      )}
    </g>
  );
});

function GhostView({ ghost }: { ghost: FurnitureGhost }) {
  const ink = ghost.free ? ACCENT : COLLISION;
  return (
    <g data-furniture-ghost={ghost.catalogId} data-furniture-ghost-free={ghost.free ? 'true' : 'false'} pointerEvents="none" opacity={0.85}>
      <path d={polygonPath(ghost.footprint)} fill={ink} fillOpacity={0.08} stroke={ink} strokeWidth={1.5} strokeDasharray="5 3" {...NSS} />
      <g transform={placeTransform(ghost.position, ghost.rotationDeg)}>
        <FurnitureSymbol catalogId={ghost.catalogId} w={ghost.size.w} d={ghost.size.d} ink={ink} />
      </g>
    </g>
  );
}

export const FurnitureLayer = memo(function FurnitureLayer({ items, selection, scale, showClearances, colliding, ghost }: FurnitureLayerProps) {
  const hatchId = domId('furn-clear', useId());
  const red = colliding ?? EMPTY;
  if (items.length === 0 && !ghost) return null;
  const isRed = (f: DerivedFurniture) => (colliding ? red.includes(f.id) : f.collisions.length > 0 || f.blocksDoors.length > 0);
  const zoned = showClearances ? items : items.filter((f) => isSelected(selection, 'furniture', f.id));
  // Rugs under everything else (a coffee table stands on the rug, whatever the order of the list).
  const drawn = items.some((f) => f.catalog?.mount === 'flat') ? [...items.filter((f) => f.catalog?.mount === 'flat'), ...items.filter((f) => f.catalog?.mount !== 'flat')] : items;
  return (
    <g data-layer="furniture">
      {zoned.some((f) => f.clearances.length > 0) && (
        <>
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width={0.12} height={0.12} patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={0.12} stroke={ACCENT} strokeWidth={0.012} />
            </pattern>
          </defs>
          <g data-layer="clearances" pointerEvents="none">
            {zoned.flatMap((f) =>
              f.clearances.map((c, i) => (
                <path key={`${f.id}/${i}`} d={polygonPath(c)} fill={`url(#${hatchId})`} fillOpacity={0.4} stroke={ACCENT} strokeOpacity={0.3} strokeWidth={STROKE.hair} strokeDasharray="3 3" data-clearance-of={f.id} {...NSS} />
              )),
            )}
          </g>
        </>
      )}
      {drawn.map((f) => (f.footprint.length < 3 ? null : <FurnitureItemView key={f.id} f={f} selected={isSelected(selection, 'furniture', f.id)} colliding={isRed(f)} scale={scale} />))}
      {ghost && <GhostView ghost={ghost} />}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Rotate handle
// ---------------------------------------------------------------------------

export interface FurnitureRotateHandleProps {
  item: DerivedFurniture;
  scale: number;
  /** Handle radius (px): 7, 14 on a coarse pointer. */
  handleR: number;
  /** A coarse (touch) pointer: the radius is capped in plan metres, and the handle hidden when too small (see the header). */
  coarse?: boolean;
  /** The storey's items: the handle stands on a side clear of them (see the header). */
  items?: readonly DerivedFurniture[];
  /** The storey's walls (ghosts are ignored): the handle stands on a side clear of them too. */
  walls?: readonly DerivedWall[];
  /** Viewport point → plan point (PlanView's clientToPlan); null outside the plan. */
  clientToPlan: (clientX: number, clientY: number) => Vec2 | null;
  onRotate: (furnitureId: string, degrees: number) => void;
  title?: string;
}

interface RotateGesture {
  pointerId: number;
  x: number;
  y: number;
  touch: boolean;
  moved: boolean;
}

/** Pixels before a press on the rotate handle becomes a drag (mouse / touch). */
const ROTATE_DRAG_PX = 4;
const ROTATE_DRAG_TOUCH_PX = 8;

/** Largest radius (plan metres) of the rotate handle on touch. */
export const ROTATE_HANDLE_MAX_M = 0.3;
/** Smallest radius (px) of a touch rotate handle; below it the handle is not drawn. */
export const ROTATE_HANDLE_MIN_TOUCH_PX = 10;

/**
 * Radius (px) of the rotate handle at `scale` px/m: `handleR` with a fine pointer; on touch at most
 * ROTATE_HANDLE_MAX_M, and null (not drawn) when that is less than ROTATE_HANDLE_MIN_TOUCH_PX.
 */
function rotateHandleRadiusPx(handleR: number, scale: number, coarse: boolean): number | null {
  if (!coarse) return handleR;
  const s = scale > 0 ? scale : 1;
  const r = Math.min(handleR, ROTATE_HANDLE_MAX_M * s);
  return r >= ROTATE_HANDLE_MIN_TOUCH_PX ? r : null;
}

/**
 * The edges a rotate handle can stand on, in the item's own frame (front = local −y): the outward normal, and the turn
 * (degrees) from the front to that side, so a drag turns the handle's side towards the pointer.
 */
const HANDLE_SIDES: readonly { n: Vec2; fromFrontDeg: number }[] = [
  { n: [0, -1], fromFrontDeg: 0 },
  { n: [0, 1], fromFrontDeg: 180 },
  { n: [-1, 0], fromFrontDeg: -90 },
  { n: [1, 0], fromFrontDeg: 90 },
];

type HandleGeo = { position: Vec2; rotationDeg: number; size: { w: number; d: number } };

/** The handle on side `n` (see HANDLE_SIDES) at `scale` px/m with radius `handleR` px: stem start, centre, radius (m). */
function sideHandle(item: HandleGeo, n: Vec2, scale: number, handleR: number): { edge: Vec2; centre: Vec2; r: number } {
  const s = scale > 0 ? scale : 1;
  const half = n[0] !== 0 ? item.size.w / 2 : item.size.d / 2;
  const out = half + (handleR + ROTATE_STEM_PX) / s;
  return { edge: toPlan(item, [n[0] * half, n[1] * half]), centre: toPlan(item, [n[0] * out, n[1] * out]), r: handleR / s };
}

/** Does a circle (plan metres) touch a polygon (inside it, or within `r` of an edge)? */
function circleMeets(c: Vec2, r: number, poly: readonly Vec2[]): boolean {
  if (poly.length < 3) return false;
  if (pointInPolygon(c, poly as Vec2[])) return true;
  return poly.some((q, i) => distancePointSegment(c, q, poly[(i + 1) % poly.length]) < r);
}

/**
 * Does the stem from the item's edge `a` to the handle's centre `b` run into or through `poly` (a wall between the item
 * and its handle: an item backed onto a wall would otherwise get its handle in the next room)?
 */
function stemCrosses(a: Vec2, b: Vec2, poly: readonly Vec2[]): boolean {
  if (poly.length < 3) return false;
  if (pointInPolygon(b, poly as Vec2[])) return true;
  return poly.some((q, i) => segmentIntersection(a, b, q, poly[(i + 1) % poly.length]) !== null);
}

/** How deep (m) a circle reaches into a polygon: its radius past the nearest edge (more when its middle is inside). */
function circleDepth(c: Vec2, r: number, poly: readonly Vec2[]): number {
  const d = Math.min(...poly.map((q, i) => distancePointSegment(c, q, poly[(i + 1) % poly.length])));
  return Math.max(0, pointInPolygon(c, poly as Vec2[]) ? r + d : r - d);
}

/**
 * Which side the rotate handle of `item` stands on (see the header), or null when it is not drawn: the first of
 * front, back, left, right whose circle (with its 2 px border) meets no other item and no live wall, and whose stem
 * crosses no live wall (integration: a kommode backed onto Soverom's wall got its handle in Gang); else one that meets
 * only flat items (rugs); else one that only grazes a solid item (its middle off it). Among sides of the same kind
 * the least overlap wins. Last fix round: a side whose circle or stem meets a live wall, or whose middle stands on a
 * solid item, is never used, and when that leaves no side the handle is hidden (before: the front, through a wall or
 * on the table; «Roter 90°» in the mini-bar and Egenskaper remains). Sixth review: on touch (`coarse`) a side facing
 * up on the screen is never used either (the mini-bar above the selection covers it).
 */
function handleSide(item: DerivedFurniture, scale: number, handleR: number, items: readonly DerivedFurniture[] = [], walls: readonly DerivedWall[] = [], coarse = false): { n: Vec2; fromFrontDeg: number } | null {
  const size = item.item.size ?? { w: 1, d: 1, h: 1 };
  const geo: HandleGeo = { position: item.item.position, rotationDeg: item.item.rotationDeg, size };
  const s = scale > 0 ? scale : 1;
  const others = items.filter((f) => f.id !== item.id && f.footprint.length >= 3);
  const solid = walls.filter((w) => !w.isGhost && w.footprint.length >= 3);
  let best: { n: Vec2; fromFrontDeg: number } | null = null;
  let bestScore = Infinity;
  for (const side of HANDLE_SIDES) {
    const h = sideHandle(geo, side.n, s, handleR);
    const r = h.r + 1 / s;
    if (solid.some((w) => circleMeets(h.centre, r, w.footprint) || stemCrosses(h.edge, h.centre, w.footprint))) continue;
    // Facing up on the screen (plan +y): on touch the mini-bar above the selection covers it.
    if (coarse && h.centre[1] - h.edge[1] > 0.5 * Math.hypot(h.centre[0] - h.edge[0], h.centre[1] - h.edge[1])) continue;
    let kind = 0;
    let depth = 0;
    let onSolid = false;
    for (const f of others) {
      if (!circleMeets(h.centre, r, f.footprint)) continue;
      const flat = f.catalog?.mount === 'flat';
      if (!flat && pointInPolygon(h.centre, f.footprint as Vec2[])) {
        onSolid = true;
        break;
      }
      kind = Math.max(kind, flat ? 1 : 2);
      depth += circleDepth(h.centre, r, f.footprint);
    }
    if (onSolid) continue;
    // The least overlap first within a kind (the added fraction stays below the gap to the next kind).
    const score = kind + (0.49 * depth) / (depth + r);
    if (score < bestScore) {
      best = side;
      bestScore = score;
    }
    if (score === 0) break;
  }
  return best;
}

function rectOf(it: { position: Vec2; rotationDeg: number; size: { w: number; d: number } }): Vec2[] {
  const { w, d } = it.size;
  return (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as Vec2[]
  ).map((q) => toPlan(it, q));
}

export function FurnitureRotateHandle({ item, scale, handleR: baseR, coarse = false, items, walls, clientToPlan, onRotate, title }: FurnitureRotateHandleProps) {
  const gesture = useRef<RotateGesture | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const size = item.item.size ?? { w: 1, d: 1, h: 1 };
  const geo = { position: item.item.position, rotationDeg: item.item.rotationDeg, size };
  const handleR = rotateHandleRadiusPx(baseR, scale, coarse) ?? 0;
  // Null: every side is blocked (a wall, or the middle on a solid item), and the handle is not drawn.
  const side = useMemo(() => handleSide(item, scale, handleR, items, walls, coarse), [item, scale, handleR, items, walls, coarse]);
  const h = sideHandle(geo, (side ?? HANDLE_SIDES[0]).n, scale, handleR);
  const s = scale > 0 ? scale : 1;
  // A drag turns the handle's side (the front, or the side it stands on) towards the pointer.
  const turnToward = (p: Vec2, step: number) => rotationToward({ position: geo.position, rotationDeg: geo.rotationDeg + (side?.fromFrontDeg ?? 0) }, p, step);

  const end = () => {
    gesture.current = null;
    setPreview(null);
  };
  const stepOf = (e: { altKey: boolean }) => (e.altKey ? ROTATE_STEP_FINE_DEG : ROTATE_STEP_DEG);
  const onPointerDown = (e: ReactPointerEvent<SVGGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press on the drawn circle always turns the item, whatever lies under it.
    e.preventDefault();
    const pointerId = e.pointerId;
    gesture.current = { pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', moved: false };
    // The plan counts the pointer (a second finger makes a pinch, which drops this press) but neither pans nor taps.
    holdPointer(e.nativeEvent, () => {
      if (gesture.current?.pointerId === pointerId) end();
    });
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // jsdom, or the pointer is already gone
    }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGGElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < (g.touch ? ROTATE_DRAG_TOUCH_PX : ROTATE_DRAG_PX)) return;
    g.moved = true;
    const p = clientToPlan(e.clientX, e.clientY);
    if (p) setPreview(turnToward(p, stepOf(e)));
  };
  const onPointerUp = (e: ReactPointerEvent<SVGGElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    let turn = 90;
    if (g.moved) {
      const p = clientToPlan(e.clientX, e.clientY);
      turn = p ? turnToward(p, stepOf(e)) : (preview ?? 0);
    }
    end();
    if (turn !== 0) onRotate(item.id, turn);
  };
  const onCancel = (e: ReactPointerEvent<SVGGElement>) => {
    if (!gesture.current || gesture.current.pointerId !== e.pointerId) return;
    end();
  };

  if (handleR <= 0 || !side) return null;

  const turned = preview !== null && preview !== 0 ? { ...geo, rotationDeg: geo.rotationDeg + preview } : null;
  const arcR = handleR * 0.55;
  // A small circular arrow (screen px, y down) inside the handle.
  const arrow = `M${n4(arcR)} 0A${n4(arcR)} ${n4(arcR)} 0 1 1 0 ${n4(-arcR)}M-2.5 ${n4(-arcR - 2.5)}L0 ${n4(-arcR)}L-2.5 ${n4(-arcR + 2.5)}`;
  const label = preview !== null ? `${Math.round((((geo.rotationDeg + preview) % 360) + 360) % 360)}°` : null;
  return (
    <g data-layer="furniture-rotate" data-rotate-of={item.id} data-rotate-side={side.fromFrontDeg}>
      {turned && <path d={polygonPath(rectOf(turned))} fill={ACCENT} fillOpacity={0.08} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="5 3" pointerEvents="none" data-rotate-preview={preview ?? 0} {...NSS} />}
      <line x1={n4(h.edge[0])} y1={n4(h.edge[1])} x2={n4(h.centre[0])} y2={n4(h.centre[1])} stroke={ACCENT} strokeWidth={1.5} pointerEvents="none" {...NSS} />
      <g
        data-furniture-rotate={item.id}
        style={{ cursor: preview !== null ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
      >
        {/* The hit area is the drawn circle (its 2 px border included), nothing more. */}
        <circle cx={n4(h.centre[0])} cy={n4(h.centre[1])} r={n4(h.r)} fill="#ffffff" stroke={ACCENT} strokeWidth={2} pointerEvents="all" data-rotate-hit={item.id} {...NSS}>
          {title && <title>{title}</title>}
        </circle>
        <ScreenText x={h.centre[0]} y={h.centre[1]} scale={s}>
          <path d={arrow} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
        </ScreenText>
      </g>
      {label && (
        <ScreenText x={h.centre[0]} y={h.centre[1]} scale={s} data-rotate-label={label}>
          <text x={handleR + 6} y={0} dominantBaseline="central" fontSize={FONT_PX.detail} fill={ACCENT} stroke={PAPER} strokeWidth={3} paintOrder="stroke">
            {label}
          </text>
        </ScreenText>
      )}
    </g>
  );
}

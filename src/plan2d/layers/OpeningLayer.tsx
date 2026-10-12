/**
 * Opening symbols: windows as a thin triple line across the wall (both faces + glass plane) with jambs; doors as
 * jambs + open leaf + swing arc from DerivedOpening.swing (arc drawn as an SVG path), double doors with a second
 * leaf and arc from DerivedOpening.swing2 (hinged at the other jamb); sliding doors as two
 * offset leaves; frameless openings as a gap with thin jamb lines; removed openings as a dashed footprint over
 * the (uncut) wall ("Fjernet" ghosts, only while "highlight new" is on). Every drawn opening has an invisible
 * footprint hit area for selection, plus a corridor between its jambs `corridorPx` wide on screen (12 px, 24 px on a
 * coarse pointer; docs/phase2-plan.md §3.1) drawn as a path so the symbol's line count stays as it was. A removed
 * opening is selected as { kind: 'ghost', id: opening id } (outlined dashed in the accent colour).
 *
 * Hit order (editor polish, phase 2b): a new opening often sits where an old one was ("Fjernet" ghost under it), so
 * the layer draws, bottom → top, the live openings' corridors, then the ghosts (symbol, footprint and corridor), then
 * the live openings (symbol and footprint). A click on a live opening's drawn body selects it; the ghost wins only
 * outside that body (beside the wall, or past the live opening's jambs), where before it covered the live opening's
 * middle; past the ghost's own extent the live opening's corridor still selects the live opening.
 */
import { memo } from 'react';
import type { DerivedOpening, DerivedWall } from '../../model/derived';
import type { Vec2 } from '../../model/types';
import type { PlanSelection } from '../editTypes';
import { REMOVED_FILL_OPACITY } from '../drawing';
import { faceLine, jambLine, openingFrame, polygonPath, slidingLines, swingArcPath, windowLines } from '../svg';
import { isSelected, selAttrs } from '../selection';
import { ACCENT, COLORS, NSS, STROKE } from '../style';
import type { PlacedOpening } from '../storeyData';

export interface OpeningLayerProps {
  /** Openings of the current storey with their host walls (storeyData.ts). */
  openings: PlacedOpening[];
  highlightNew: boolean;
  selection: PlanSelection | null;
  /** Width (screen px) of the hit corridor between the jambs (default 12). */
  corridorPx?: number;
}

function Seg({ s, stroke, width }: { s: [Vec2, Vec2]; stroke: string; width: number }) {
  return <line x1={s[0][0]} y1={s[0][1]} x2={s[1][0]} y2={s[1][1]} stroke={stroke} strokeWidth={width} strokeLinecap="butt" {...NSS} />;
}

function WindowSymbol({ wall, o, ink }: { wall: DerivedWall; o: DerivedOpening; ink: string }) {
  const [left, right, glass, j0, j1] = windowLines(openingFrame(wall, o), o.glassPlane);
  return (
    <>
      <Seg s={left} stroke={ink} width={STROKE.hair} />
      <Seg s={right} stroke={ink} width={STROKE.hair} />
      <Seg s={glass} stroke={COLORS.glass} width={STROKE.thin} />
      <Seg s={j0} stroke={ink} width={STROKE.thin} />
      <Seg s={j1} stroke={ink} width={STROKE.thin} />
    </>
  );
}

function SlidingSymbol({ wall, o, ink }: { wall: DerivedWall; o: DerivedOpening; ink: string }) {
  const [a, b, j0, j1] = slidingLines(openingFrame(wall, o), o.glassPlane);
  const leaf = o.leaf === 'glass' ? COLORS.glass : ink;
  return (
    <>
      <Seg s={a} stroke={leaf} width={STROKE.medium} />
      <Seg s={b} stroke={leaf} width={STROKE.medium} />
      <Seg s={j0} stroke={ink} width={STROKE.thin} />
      <Seg s={j1} stroke={ink} width={STROKE.thin} />
    </>
  );
}

type Swing = NonNullable<DerivedOpening['swing']>;

/** One door leaf in its open position plus its swing arc. */
function Leaf({ sw, leaf, ink, doorId, n }: { sw: Swing; leaf: string; ink: string; doorId: string; n: 1 | 2 }) {
  const arc = swingArcPath(sw);
  return (
    <>
      <Seg s={[sw.hinge, sw.open]} stroke={leaf} width={STROKE.medium} />
      {arc && <path d={arc} fill="none" stroke={ink} strokeWidth={STROKE.hair} data-door-arc={doorId} data-door-leaf={n} {...NSS} />}
    </>
  );
}

function DoorSymbol({ wall, o, ink }: { wall: DerivedWall; o: DerivedOpening; ink: string }) {
  const f = openingFrame(wall, o);
  const leaf = o.leaf === 'glass' ? COLORS.glass : ink;
  const sw = o.swing;
  return (
    <>
      <Seg s={jambLine(f, 'start')} stroke={ink} width={STROKE.thin} />
      <Seg s={jambLine(f, 'end')} stroke={ink} width={STROKE.thin} />
      {sw ? (
        <>
          <Leaf sw={sw} leaf={leaf} ink={ink} doorId={o.id} n={1} />
          {o.swing2 && <Leaf sw={o.swing2} leaf={leaf} ink={ink} doorId={o.id} n={2} />}
        </>
      ) : (
        // No swing data: closed leaf in the glass plane.
        <Seg s={faceLine(f, o.glassPlane)} stroke={leaf} width={STROKE.medium} />
      )}
    </>
  );
}

function FramelessSymbol({ wall, o, ink }: { wall: DerivedWall; o: DerivedOpening; ink: string }) {
  const f = openingFrame(wall, o);
  return (
    <>
      <Seg s={jambLine(f, 'start')} stroke={ink} width={STROKE.hair} />
      <Seg s={jambLine(f, 'end')} stroke={ink} width={STROKE.hair} />
    </>
  );
}

function OpeningSymbol(props: { wall: DerivedWall; o: DerivedOpening; ink: string }) {
  switch (props.o.type) {
    case 'window':
      return <WindowSymbol {...props} />;
    case 'slidingDoor':
      return <SlidingSymbol {...props} />;
    case 'opening':
      return <FramelessSymbol {...props} />;
    default:
      return <DoorSymbol {...props} />;
  }
}

interface OpeningItemProps {
  wall: DerivedWall;
  o: DerivedOpening;
  highlightNew: boolean;
  /** Selected (as the opening, or as its ghost when removed). */
  selected: boolean;
  corridorPx: number;
  /** Draw the corridor inside the item (ghosts); live openings get theirs from `OpeningCorridor`, below the ghosts. */
  withCorridor: boolean;
}

/** The invisible hit corridor between an opening's jambs, `corridorPx` wide on screen. */
function corridorPath(wall: DerivedWall, o: DerivedOpening): string {
  const f = openingFrame(wall, o);
  return `M${f.start[0]} ${f.start[1]}L${f.end[0]} ${f.end[1]}`;
}

/** A live opening's corridor, drawn below the ghosts (memoised per item like `OpeningItem`). */
const OpeningCorridor = memo(function OpeningCorridor({ wall, o, corridorPx }: { wall: DerivedWall; o: DerivedOpening; corridorPx: number }) {
  return (
    <path
      d={corridorPath(wall, o)}
      fill="none"
      stroke="transparent"
      strokeWidth={corridorPx}
      pointerEvents="stroke"
      data-opening-corridor={o.id}
      {...selAttrs('opening', o.id, o.opening.levelId ?? wall.levelId)}
      {...NSS}
    />
  );
});

/** One opening: its symbol (or ghost), hit footprint and (ghosts) corridor. Memoised per item, so a drag that moves
 * one door re-renders only that door (the layer's data keeps unchanged openings' identities, stable.ts). */
const OpeningItem = memo(function OpeningItem({ wall, o, highlightNew, selected: sel, corridorPx, withCorridor }: OpeningItemProps) {
  const removed = o.status === 'removed';
  const ink = o.isNew && highlightNew ? COLORS.openingNew : COLORS.opening;
  const hit = o.footprint.length >= 3 ? polygonPath(o.footprint) : '';
  const attrs = removed ? selAttrs('ghost', o.id) : selAttrs('opening', o.id, o.opening.levelId ?? wall.levelId);
  return (
    <g data-opening-id={o.id} data-opening-type={o.type} data-opening-status={o.status} {...attrs}>
      <g pointerEvents="none">
        {removed
          ? hit && <path d={hit} fill={COLORS.wallRemoved} fillOpacity={REMOVED_FILL_OPACITY} stroke={COLORS.wallRemoved} strokeWidth={STROKE.wall} strokeDasharray="3 2" {...NSS} />
          : <OpeningSymbol wall={wall} o={o} ink={ink} />}
      </g>
      {hit && (
        <path
          d={hit}
          fill={sel && !removed ? ACCENT : 'none'}
          fillOpacity={sel && !removed ? 0.3 : undefined}
          stroke={sel ? ACCENT : 'none'}
          strokeWidth={STROKE.selected}
          strokeDasharray={sel && removed ? '3 3' : undefined}
          pointerEvents="fill"
          {...NSS}
        />
      )}
      {withCorridor && (
        <path d={corridorPath(wall, o)} fill="none" stroke="transparent" strokeWidth={corridorPx} pointerEvents="stroke" data-opening-corridor={o.id} {...NSS} />
      )}
    </g>
  );
});

export const OpeningLayer = memo(function OpeningLayer({ openings, highlightNew, selection, corridorPx = 12 }: OpeningLayerProps) {
  const live = openings.filter(({ opening: o }) => o.status !== 'removed');
  const ghosts = highlightNew ? openings.filter(({ opening: o }) => o.status === 'removed') : [];
  return (
    <g data-layer="openings">
      <g data-layer="opening-corridors">
        {live.map(({ wall, opening: o }) => (
          <OpeningCorridor key={o.id} wall={wall} o={o} corridorPx={corridorPx} />
        ))}
      </g>
      {ghosts.map(({ wall, opening: o }) => (
        <OpeningItem key={o.id} wall={wall} o={o} highlightNew={highlightNew} selected={isSelected(selection, 'ghost', o.id)} corridorPx={corridorPx} withCorridor />
      ))}
      {live.map(({ wall, opening: o }) => (
        <OpeningItem key={o.id} wall={wall} o={o} highlightNew={highlightNew} selected={isSelected(selection, 'opening', o.id)} corridorPx={corridorPx} withCorridor={false} />
      ))}
    </g>
  );
});

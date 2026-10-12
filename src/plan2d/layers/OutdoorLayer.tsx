/**
 * Decks (wood tint, board hatch when zoomed in), hot tubs and site trees. Selectable unless `selectable` is
 * false (storeys other than the main floor draw them faint, see storeyData.ts). A deck is drawn as its `pieces` (the
 * stored outline trimmed by the buildings, holes where a unit stands on it; even-odd fill).
 */
import { memo, useId } from 'react';
import type { DerivedDeck, DerivedHotTub } from '../../model/derived';
import type { Tree } from '../../model/types';
import type { PlanSelection } from '../editTypes';
import { domId, multiPolygonPath } from '../svg';
import { isSelected, selAttrs } from '../selection';
import type { SelKind } from '../selection';
import { ACCENT, COLORS, NSS, STROKE } from '../style';

export interface OutdoorLayerProps {
  decks: DerivedDeck[];
  hotTubs: DerivedHotTub[];
  trees: { tree: Tree; baseZ: number }[];
  selection: PlanSelection | null;
  /** Draw deck boards (only worth it when zoomed in). */
  hatch: boolean;
  selectable: boolean;
}

/** Deck board width (m) for the hatch. */
const BOARD = 0.145;

export const OutdoorLayer = memo(function OutdoorLayer({ decks, hotTubs, trees, selection, hatch, selectable }: OutdoorLayerProps) {
  const uid = useId();
  const patX = domId('deck-x', uid);
  const patY = domId('deck-y', uid);
  const sel = (kind: SelKind, id: string) => (selectable ? selAttrs(kind, id) : {});
  return (
    <g data-layer="outdoor">
      {hatch && (
        <defs>
          <pattern id={patX} patternUnits="userSpaceOnUse" width={1} height={BOARD}>
            <line x1={0} y1={0} x2={1} y2={0} stroke={COLORS.deckHatch} strokeWidth={0.012} />
          </pattern>
          <pattern id={patY} patternUnits="userSpaceOnUse" width={BOARD} height={1}>
            <line x1={0} y1={0} x2={0} y2={1} stroke={COLORS.deckHatch} strokeWidth={0.012} />
          </pattern>
        </defs>
      )}
      {trees.map(({ tree }) => {
        const on = isSelected(selection, 'tree', tree.id);
        const r = Math.max(0.8, tree.height * 0.3);
        return (
          <g key={tree.id} data-tree-id={tree.id} {...sel('tree', tree.id)}>
            <circle
              cx={tree.position[0]}
              cy={tree.position[1]}
              r={r}
              fill="none"
              stroke={on ? ACCENT : COLORS.tree}
              strokeWidth={on ? STROKE.selected : STROKE.hair}
              strokeDasharray="3 3"
              pointerEvents={selectable ? 'fill' : 'none'}
              {...NSS}
            />
            <circle cx={tree.position[0]} cy={tree.position[1]} r={0.12} fill={COLORS.tree} pointerEvents="none" />
          </g>
        );
      })}
      {decks.map((d) => {
        // A selected vertex or edge of the deck keeps the deck outlined (its handles show which one).
        const on = isSelected(selection, 'deck', d.id) || (!!selection && (selection.kind === 'deckVertex' || selection.kind === 'deckEdge') && d.vertexIds.includes(selection.id));
        const path = multiPolygonPath(d.pieces);
        return (
          <g key={d.id} data-deck-id={d.id} {...sel('deck', d.id)}>
            <path
              d={path}
              fill={COLORS.deck}
              fillRule="evenodd"
              stroke={on ? ACCENT : COLORS.deckStroke}
              strokeWidth={on ? STROKE.selected : STROKE.thin}
              pointerEvents={selectable ? 'fill' : 'none'}
              {...NSS}
            />
            {hatch && <path d={path} fill={`url(#${d.boardDirection === 'x' ? patX : patY})`} fillRule="evenodd" pointerEvents="none" />}
          </g>
        );
      })}
      {hotTubs.map((t) => {
        const on = isSelected(selection, 'hotTub', t.id);
        const r = t.diameter / 2;
        return (
          <g key={t.id} data-hot-tub-id={t.id} {...sel('hotTub', t.id)}>
            <circle
              cx={t.centre[0]}
              cy={t.centre[1]}
              r={r}
              fill={COLORS.hotTub}
              stroke={on ? ACCENT : COLORS.hotTubStroke}
              strokeWidth={on ? STROKE.selected : STROKE.thin}
              pointerEvents={selectable ? 'fill' : 'none'}
              {...NSS}
            />
            <circle cx={t.centre[0]} cy={t.centre[1]} r={r * 0.82} fill="none" stroke={COLORS.hotTubStroke} strokeWidth={STROKE.hair} pointerEvents="none" {...NSS} />
          </g>
        );
      })}
    </g>
  );
});

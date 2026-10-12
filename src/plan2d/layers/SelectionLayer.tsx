/**
 * Accent outline of a selected room or block, drawn above the walls so it is never hidden by the wall fill
 * (the hit areas sit below the walls). Walls, openings, structure and outdoor elements outline themselves.
 */
import { memo } from 'react';
import type { DerivedBlock, DerivedRoom } from '../../model/derived';
import type { PlanSelection } from '../editTypes';
import { polygonPath } from '../svg';
import { isRoomSelected } from '../selection';
import { ACCENT, NSS, STROKE } from '../style';

export const SelectionLayer = memo(function SelectionLayer({ rooms, blocks, selection }: { rooms: DerivedRoom[]; blocks: DerivedBlock[]; selection: PlanSelection | null }) {
  if (!selection) return null;
  const room = selection.kind === 'room' ? rooms.find((r) => isRoomSelected(selection, r)) : undefined;
  const block = selection.kind === 'block' ? blocks.find((b) => b.block.id === selection.id) : undefined;
  const d = room ? polygonPath(room.polygon, room.holes) : block ? polygonPath(block.outer) : '';
  if (!d) return null;
  return (
    <g data-layer="selection" pointerEvents="none">
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={STROKE.selected} strokeLinejoin="round" data-selection-outline={selection.kind} {...NSS} />
    </g>
  );
});

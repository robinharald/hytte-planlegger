/** Invisible hit areas for the block outlines (a tap inside a block but outside any room selects the block). */
import { memo } from 'react';
import type { DerivedBlock } from '../../model/derived';
import { polygonPath } from '../svg';
import { selAttrs } from '../selection';

export const BlockLayer = memo(function BlockLayer({ blocks }: { blocks: DerivedBlock[] }) {
  return (
    <g data-layer="blocks">
      {blocks.map((b) => (
        <path key={b.block.id} d={polygonPath(b.outer)} fill="none" pointerEvents="fill" {...selAttrs('block', b.block.id)} />
      ))}
    </g>
  );
});

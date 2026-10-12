/**
 * Selection resolution for the Egenskaper panel, the mini-bar and the keyboard: `state/selection.ts`
 * `resolveSelection` (which knows the phase-2 kinds 'deckVertex' | 'deckEdge' | 'steps' | 'ghost') plus two UI
 * conventions:
 *  - a 'wall' or 'opening' selection of a ghost (status 'removed') resolves as 'ghost', so the panel offers
 *    "Ta tilbake" whichever way the ghost was picked;
 *  - 'railing' (`${deckId}/railing`) resolves to its deck when the deck has no railing (3D picks steps as the
 *    railing too), so the panel can still show the deck's railing settings.
 */
import type { DerivedVariant } from '../model/derived';
import { resolveSelection } from '../state/selection';
import type { ResolvedSelection, Selection } from '../state/selection';

export type UiResolved = ResolvedSelection;
export type { GhostTarget } from '../state/selection';

export function resolveUiSelection(derived: DerivedVariant, sel: Selection | null): UiResolved | null {
  if (!sel) return null;
  const r = resolveSelection(derived, sel);
  if (r?.kind === 'wall' && r.wall.isGhost) return { kind: 'ghost', ghost: { type: 'wall', id: r.wall.id, wall: r.wall } };
  if (r?.kind === 'opening' && r.opening.isGhost) {
    return { kind: 'ghost', ghost: { type: 'opening', id: r.opening.id, opening: r.opening, wall: r.wall } };
  }
  if (r || sel.kind !== 'railing') return r;
  const deckId = sel.id.endsWith('/railing') ? sel.id.slice(0, -'/railing'.length) : sel.id;
  const deck = derived.outdoor.decks.find((d) => d.id === deckId);
  return deck ? { kind: 'deck', deck } : null;
}

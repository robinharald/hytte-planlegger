/**
 * Small pure helpers for the area figures (headline and Arealer panel).
 *
 * `AreaSummary.bya` splits existing/new over buildings AND decks together, so its `new` includes the deck. The
 * building-only split (outer walls, what the brief asks for) is recovered from the decks' status: with all decks
 * new (Forslag D) the existing share is all building; with all decks existing the new share is. Mixed decks cannot
 * be separated from the summary, so no split is shown then.
 */
import type { AreaSummary, DerivedDeck } from '../model/derived';

export interface BuildingSplit {
  existing: number;
  new: number;
}

export function buildingSplit(bya: AreaSummary['bya'], decks: readonly Pick<DerivedDeck, 'isNew'>[]): BuildingSplit | null {
  const clamp = (v: number) => Math.max(0, v);
  if (decks.every((d) => d.isNew)) return { existing: clamp(bya.existing), new: clamp(bya.buildings - bya.existing) };
  if (decks.every((d) => !d.isNew)) return { existing: clamp(bya.buildings - bya.new), new: clamp(bya.new) };
  return null;
}

/**
 * Derived model access for components: `useDerived()` = deriveVariant(activeVariant, site, terrain asset).
 *
 * `deriveVariant` memoises on object identities itself; `deriveForState` adds a one-entry cache on top so the
 * selector returns the same object for an unchanged (variant, site) even with a non-memoised derive, which
 * keeps zustand's snapshot stable. A throwing derive does not take the app down: the error is logged and an
 * empty model with a 'generic' warning is returned (the e2e smoke test fails on 'generic' warnings).
 */
import { useMemo } from 'react';
import { deriveVariant } from '../geometry/derive';
import { nb } from '../i18n/nb';
import type { DerivedVariant } from '../model/derived';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { Site, TerrainAsset, Variant } from '../model/types';
import { useAppStore } from './appStore';
import { resolveSelection } from './selection';
import type { ResolvedSelection } from './selection';
import { selectActiveVariant } from './store';
import type { AppState } from './store';

/** The bundled terrain heightmap (src/model/seed/terrain-merkesvatnet.json). */
export const terrainAsset: TerrainAsset = terrainJson as TerrainAsset;

/** The terrain asset the site refers to, or null when it is not bundled. */
export function terrainFor(site: Site): TerrainAsset | null {
  return site.terrainId === terrainAsset.id ? terrainAsset : null;
}

/** A valid, empty derived model (used when derivation throws). */
export function emptyDerived(variant: Variant, message: string): DerivedVariant {
  const storeyIds = [...new Set(variant.levels.map((l) => l.storeyId))];
  return {
    variantId: variant.id,
    levels: variant.levels,
    storeys: storeyIds.map((id) => ({ id, name: id, levelIds: variant.levels.filter((l) => l.storeyId === id).map((l) => l.id) })),
    blocks: [],
    walls: [],
    wallUnion: [],
    rooms: [],
    floors: [],
    roofs: [],
    outdoor: { decks: [], railings: [], hotTubs: [] },
    structure: [],
    furniture: [],
    foundations: [],
    dimensions: [],
    site: { trees: [] },
    groundWorks: [],
    bounds: { min: [0, 0], max: [10, 10] },
    areas: {
      bya: { total: 0, existing: 0, new: 0, buildings: 0, decks: 0, perBlock: [] },
      bra: { total: 0, existing: 0, new: 0, perLevel: [] },
      axis: { total: 0, existing: 0, new: 0 },
      rooms: [],
    },
    warnings: [{ kind: 'generic', message }],
  };
}

let cache: { variant: Variant; site: Site; derived: DerivedVariant } | null = null;

export function deriveForState(state: Pick<AppState, 'project'>): DerivedVariant {
  const variant = selectActiveVariant(state);
  const site = state.project.site;
  if (cache && cache.variant === variant && cache.site === site) return cache.derived;
  let derived: DerivedVariant;
  try {
    derived = deriveVariant(variant, site, terrainFor(site));
  } catch (e) {
    console.error('deriveVariant failed', e);
    derived = emptyDerived(variant, nb.warnings.deriveFailed(e instanceof Error ? e.message : String(e)));
  }
  cache = { variant, site, derived };
  return derived;
}

export function useDerived(): DerivedVariant {
  return useAppStore(deriveForState);
}

export function useActiveVariant(): Variant {
  return useAppStore(selectActiveVariant);
}

/** The current selection resolved against the derived model; null when nothing (or something gone) is selected. */
export function useResolvedSelection(): ResolvedSelection | null {
  const derived = useDerived();
  const selection = useAppStore((s) => s.ui.selection);
  return useMemo(() => resolveSelection(derived, selection), [derived, selection]);
}

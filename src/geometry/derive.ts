import type { Site, TerrainAsset, Variant } from '../model/types';
import type { DerivedVariant } from '../model/derived';

/**
 * Derive everything the renderers need from a stored variant.
 * STUB — replaced during integration (see docs/architecture.md, "Derivation pipeline").
 */
export function deriveVariant(variant: Variant, _site: Site, _terrain: TerrainAsset | null): DerivedVariant {
  const storeyIds = [...new Set(variant.levels.map((l) => l.storeyId))];
  return {
    variantId: variant.id,
    levels: variant.levels,
    storeys: storeyIds.map((id) => ({
      id,
      name: id,
      levelIds: variant.levels.filter((l) => l.storeyId === id).map((l) => l.id),
    })),
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
    bounds: { min: [0, 0], max: [1, 1] },
    areas: {
      bya: { total: 0, existing: 0, new: 0, buildings: 0, decks: 0, perBlock: [] },
      bra: { total: 0, existing: 0, new: 0, perLevel: [] },
      axis: { total: 0, existing: 0, new: 0 },
      rooms: [],
    },
    warnings: [{ kind: 'generic', message: 'deriveVariant is a stub' }],
  };
}

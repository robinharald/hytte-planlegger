/**
 * Model warnings for the Advarsler panel: Norwegian text (i18n/nb.ts warningText) with readable names, and the
 * element a warning points at so a click can select it.
 */
import type { DerivedVariant, ModelWarning } from '../model/derived';
import type { Variant } from '../model/types';
import { nb, warningText } from '../i18n/nb';
import type { NameLookup } from '../i18n/nb';
import type { Selection } from '../state/selection';
import { formatM2 } from './format';

export function makeNameLookup(derived: DerivedVariant, variant: Variant): NameLookup {
  return (kind, id) => {
    switch (kind) {
      case 'level':
        return derived.levels.find((l) => l.id === id)?.name ?? id;
      case 'room':
        return variant.rooms.find((r) => r.id === id)?.name ?? id;
      case 'block':
        return variant.blocks.find((b) => b.id === id)?.name ?? id;
      case 'opening': {
        const o = variant.openings.find((x) => x.id === id);
        return o ? `${nb.openingTypes[o.type]} ${id}` : id;
      }
      case 'wall': {
        const w = variant.walls.find((x) => x.id === id);
        return w ? `${nb.wallKinds[w.kind]} ${id}` : id;
      }
      default:
        return id;
    }
  };
}

/** The element a warning is about, if it can be selected. */
export function warningTarget(w: ModelWarning): Selection | null {
  switch (w.kind) {
    case 'room-unnamed':
      return { kind: 'room', id: w.faceId, levelId: w.levelId };
    case 'room-small':
      return { kind: 'room', id: w.roomId };
    case 'opening-outside-host':
    case 'opening-above-roof':
    case 'opening-on-removed-edge':
    case 'door-blocked':
      return { kind: 'opening', id: w.openingId };
    case 'opening-overlap':
      return w.openingIds.length ? { kind: 'opening', id: w.openingIds[0] } : null;
    case 'wall-dangling':
      return { kind: 'wall', id: w.wallId };
    case 'block-overlap':
      return { kind: 'block', id: w.blockIds[0] };
    case 'block-self-intersecting':
    case 'parts-overlap':
    case 'roof-no-meet':
      return { kind: 'block', id: w.blockId };
    default:
      return null;
  }
}

export interface WarningItem {
  key: string;
  text: string;
  target: Selection | null;
}

export function warningItems(derived: DerivedVariant, variant: Variant): WarningItem[] {
  const names = makeNameLookup(derived, variant);
  return derived.warnings.map((w, i) => ({
    key: `${w.kind}-${i}`,
    text: warningText(w, names, formatM2),
    target: warningTarget(w),
  }));
}

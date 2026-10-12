/**
 * Model warnings for the Advarsler panel: Norwegian text (i18n/nb.ts warningText) with readable names, and the
 * element a warning points at so a click can select it.
 *
 * Walls and openings are named for a family member by type and place, never by id (`nb.warnings.names`): "vinduet i
 * veggen mellom Gang og Soverom (ny fløy)", "døra i ytterveggen mot nord i Kjøkken". The place comes from the derived
 * model: the named rooms a wall bounds (else the room around its middle), and for an exterior wall the compass
 * direction it faces (true north with the site, else plan +y).
 */
import type { DerivedOpening, DerivedVariant, DerivedWall, ModelWarning } from '../model/derived';
import type { Id, Site, Variant, Vec2 } from '../model/types';
import { bearingOfPlanDir } from '../geometry/geo';
import { pointInPolygon } from '../geometry/polygon';
import { nb, warningText } from '../i18n/nb';
import type { NameLookup } from '../i18n/nb';
import type { Selection } from '../state/selection';
import { formatM2 } from './format';

const N = nb.warnings.names;

/** Compass word of a plan direction ("nord", "nordøst", …): true north with the site, else plan +y. */
export function compassWord(dir: Vec2, site?: Pick<Site, 'planNorthBearing'>): string {
  const deg = site ? bearingOfPlanDir(site as Site, dir) : ((Math.atan2(dir[0], dir[1]) * 180) / Math.PI + 360) % 360;
  return N.directions[Math.round(deg / 45) % 8];
}

/** Place words for walls and openings of one derived model. */
export function makePlaceNamer(derived: DerivedVariant, site?: Pick<Site, 'planNorthBearing'>) {
  const wallsById = new Map(derived.walls.map((w) => [w.id, w]));
  const openingHost = new Map<Id, { wall: DerivedWall; opening: DerivedOpening }>();
  for (const w of derived.walls) for (const o of w.openings) if (!openingHost.has(o.id)) openingHost.set(o.id, { wall: w, opening: o });

  const named = (r: DerivedVariant['rooms'][number]) => r.room?.name?.trim() || '';

  /** The named room at a plan point on one of the wall's levels ('' when none). */
  const roomAt = (p: Vec2, levelIds: readonly Id[]): string => {
    const r = derived.rooms.find(
      (x) => named(x) && (levelIds.length === 0 || levelIds.includes(x.levelId)) && pointInPolygon(p, x.facePolygon.length >= 3 ? x.facePolygon : x.polygon),
    );
    return r ? named(r) : '';
  };

  /**
   * "veggen mellom Gang og Bad", "ytterveggen mot nord i Kjøkken", "romdeleren i Stue", "en vegg": the rooms just
   * beside the wall at `t` (0 … 1 along a → b; an opening's centre, else the middle), one step past each face.
   */
  const wallPhrase = (w: DerivedWall, t = 0.5, outward?: Vec2): string => {
    const d: Vec2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
    const len = Math.hypot(d[0], d[1]) || 1;
    const n: Vec2 = [-d[1] / len, d[0] / len]; // left normal (the inside of an exterior piece)
    const p: Vec2 = [w.a[0] + d[0] * t, w.a[1] + d[1] * t];
    const left = roomAt([p[0] + n[0] * (w.faceLeft + 0.05), p[1] + n[1] * (w.faceLeft + 0.05)], w.levelIds);
    const right = roomAt([p[0] - n[0] * (w.faceRight + 0.05), p[1] - n[1] * (w.faceRight + 0.05)], w.levelIds);
    const rooms = [...new Set([left, right].filter((x) => x))].sort((a, b) => a.localeCompare(b, 'nb'));
    const base = w.isDivider ? N.divider : N.wall;
    // A wall with rooms on both sides reads as an ordinary wall, also an exterior piece two buildings share.
    if (rooms.length === 2) return `${base} ${N.between(rooms[0], rooms[1])}`;
    if (w.isExterior) {
      const towards = N.towards(compassWord(outward ?? [-n[0], -n[1]], site));
      return rooms.length === 1 ? `${N.exterior} ${towards} ${N.inRoom(rooms[0])}` : `${N.exterior} ${towards}`;
    }
    return rooms.length === 1 ? `${base} ${N.inRoom(rooms[0])}` : N.looseWall;
  };

  const wall = (id: Id): string => {
    const w = wallsById.get(id);
    return w ? wallPhrase(w) : N.looseWall;
  };

  const openingType = (id: Id, variant?: Variant): string => {
    const type = openingHost.get(id)?.opening.type ?? variant?.openings.find((o) => o.id === id)?.type;
    return type ? N.opening[type] : N.unknownOpening;
  };

  const openingPlace = (id: Id, variant?: Variant): string => {
    const hosted = openingHost.get(id);
    if (hosted) {
      const len = Math.hypot(hosted.wall.b[0] - hosted.wall.a[0], hosted.wall.b[1] - hosted.wall.a[1]) || 1;
      const t = Math.min(1, Math.max(0, hosted.opening.offset / len));
      return N.inRoom(wallPhrase(hosted.wall, t, hosted.opening.outward));
    }
    let host: DerivedWall | undefined;
    if (variant) {
      const o = variant.openings.find((x) => x.id === id);
      if (o?.host.kind === 'wall') host = wallsById.get(o.host.wallId);
      else if (o?.host.kind === 'blockEdge') {
        const h = o.host;
        host = derived.walls.find((w) => w.source.kind === 'blockEdge' && w.source.blockId === h.blockId && w.source.edgeId === h.edgeId);
      }
    }
    return host ? N.inRoom(wallPhrase(host)) : '';
  };

  return { wall, openingType, openingPlace };
}

export function makeNameLookup(derived: DerivedVariant, variant: Variant, site?: Pick<Site, 'planNorthBearing'>): NameLookup {
  const place = makePlaceNamer(derived, site);
  return (kind, id) => {
    switch (kind) {
      case 'level':
        return derived.levels.find((l) => l.id === id)?.name ?? id;
      case 'room':
        return variant.rooms.find((r) => r.id === id)?.name ?? id;
      case 'block':
        return variant.blocks.find((b) => b.id === id)?.name ?? id;
      case 'opening': {
        const p = place.openingPlace(id, variant);
        return p ? `${place.openingType(id, variant)} ${p}` : place.openingType(id, variant);
      }
      case 'openingType':
        return place.openingType(id, variant);
      case 'openingPlace':
        return place.openingPlace(id, variant);
      case 'wall':
        return place.wall(id);
      case 'furniture': {
        const f = derived.furniture.find((x) => x.id === id);
        return f ? (f.catalog?.name ?? f.item.catalogId) : id;
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
    case 'deck-steps-blocked':
      return { kind: 'steps', id: w.stepsId };
    case 'furniture-overlap':
      return { kind: 'furniture', id: w.furnitureIds[0] };
    case 'furniture-in-wall':
    case 'furniture-outside':
    case 'furniture-unknown':
    case 'furniture-needs-wet-room':
      return { kind: 'furniture', id: w.furnitureId };
    default:
      return null;
  }
}

/**
 * Identity of a warning across edits: its kind and the elements it is about (numbers such as areas and heights left
 * out, so a warning that only changes its figures is not "new").
 */
export function warningKey(w: ModelWarning): string {
  const parts = Object.entries(w)
    .filter(([, v]) => typeof v !== 'number')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : String(v)}`);
  return parts.sort().join('|');
}

export interface WarningItem {
  key: string;
  text: string;
  target: Selection | null;
}

export function warningItems(derived: DerivedVariant, variant: Variant, site?: Pick<Site, 'planNorthBearing'>): WarningItem[] {
  const names = makeNameLookup(derived, variant, site);
  return derived.warnings.map((w, i) => ({
    key: `${w.kind}-${i}`,
    text: warningText(w, names, formatM2),
    target: warningTarget(w),
  }));
}

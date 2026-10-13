/**
 * Model warnings for the Advarsler panel: Norwegian text (i18n/nb.ts warningText) with readable names, and the
 * element a warning points at so a click can select it.
 *
 * Walls and openings are named for a family member by type and place, never by id (`nb.warnings.names`): "vinduet i
 * veggen mellom Gang og Soverom (ny fløy)", "døra i ytterveggen mot nord i Kjøkken". The place comes from the derived
 * model: the named rooms a wall bounds (else the room around its middle, else the building part it stands in), and
 * for an exterior wall the compass direction it faces (true north with the site, else plan +y).
 *
 * The other place words the warning texts need (i18n/nb.ts `NameLookup`):
 *  - an opening on a stretch of block edge that is gone (`opening-on-removed-edge`): its place from the block's own
 *    edge, and the building part now standing against that stretch;
 *  - the end of a roof that does not meet its neighbour (`roof-no-meet`): the compass direction of that end;
 *  - blocked deck steps (`deck-steps-blocked`): the direction they face and the building part in their way;
 *  - what a furniture item stands in when it is not a wall (`furniture-in-wall`): "i trappa", "i pipa", "i en
 *    stolpe", "i badestampen"; and a door blocked by a furniture item names the item («Seng 150»).
 *
 * Loose walls (editor polish, phase 2b): the 'wall' name of a wall with only ONE named room around it says where in
 * that room it stands ("veggen nord i Stue", "midt i Stue": the part of the room's box its middle is in); a wall in no
 * named room keeps "i «Ny tverrfløy»" inside a building part, and outside the buildings it is "nord på terrassen" on a
 * deck, else "sør for «Bod-fløy»" (the nearest building part). Loose walls with the same text become one line in the
 * Advarsler panel (`warningItems`, `count`): "3 vegger nord i Stue henger løs og danner ikke noe rom." (other kinds
 * keep a line each). The place words are in `nb.warnings.names`. Openings keep their place words ("vinduet i veggen i
 * Stue").
 */
import type { DerivedOpening, DerivedVariant, DerivedWall, ModelWarning } from '../model/derived';
import type { Block, Id, Roof, Site, Variant, Vec2 } from '../model/types';
import { bearingOfPlanDir } from '../geometry/geo';
import { pointInPolygon } from '../geometry/polygon';
import { nb, warningText } from '../i18n/nb';
import type { NameLookup } from '../i18n/nb';
import type { Selection } from '../state/selection';
import { formatM2 } from './format';

const N = nb.warnings.names;
const L = N;

/** Compass word of a plan direction ("nord", "nordøst", …): true north with the site, else plan +y. */
export function compassWord(dir: Vec2, site?: Pick<Site, 'planNorthBearing'>): string {
  const deg = site ? bearingOfPlanDir(site as Site, dir) : ((Math.atan2(dir[0], dir[1]) * 180) / Math.PI + 360) % 360;
  return N.directions[Math.round(deg / 45) % 8];
}

/** The block whose axis polygon contains `p` (the first in `blocks` order, never `except`), if any. */
function blockAt(blocks: readonly Block[], p: Vec2, except?: Id): Block | undefined {
  return blocks.find((b) => b.id !== except && b.polygon.length >= 3 && pointInPolygon(p, b.polygon.map((v) => v.p)));
}

/** Plan axis a roof's ridge runs along (as geometry/roof.ts `axisOf`); its `start` end is at the low coordinate. */
function ridgeAxis(roof: Roof): 'x' | 'y' | null {
  if (roof.type === 'mono') {
    const s = roof.slopeTo ?? 'S';
    return s === 'N' || s === 'S' ? 'x' : 'y';
  }
  return roof.type === 'gable' ? (roof.ridgeAxis ?? 'x') : null;
}

/** How far outside an edge (m) to look for the building part standing against it. */
const OUTSIDE_PROBE = 0.1;

/** A point within this fraction of a box's half-size from its centre is in its middle ("midt i Stue"). */
const MIDDLE_FRACTION = 1 / 3;

/** Axis-aligned box of a polygon (null when empty). */
function boxOf(poly: readonly Vec2[]): { c: Vec2; h: Vec2 } | null {
  if (poly.length === 0) return null;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { c: [(x0 + x1) / 2, (y0 + y1) / 2], h: [(x1 - x0) / 2, (y1 - y0) / 2] };
}

/**
 * Which part of an area (a room, a deck) the point `p` is in: the compass word of its offset from the area's box
 * centre measured in half-sizes ("nord" for the northern part of a long room too), or null in the middle.
 */
export function partOf(poly: readonly Vec2[], p: Vec2, site?: Pick<Site, 'planNorthBearing'>): string | null {
  const b = boxOf(poly);
  if (!b) return null;
  const n: Vec2 = [(p[0] - b.c[0]) / Math.max(b.h[0], 1e-6), (p[1] - b.c[1]) / Math.max(b.h[1], 1e-6)];
  return Math.hypot(n[0], n[1]) < MIDDLE_FRACTION ? null : compassWord(n, site);
}

/** Place words for walls and openings of one derived model. */
export function makePlaceNamer(derived: DerivedVariant, site?: Pick<Site, 'planNorthBearing'>) {
  const wallsById = new Map(derived.walls.map((w) => [w.id, w]));
  const openingHost = new Map<Id, { wall: DerivedWall; opening: DerivedOpening }>();
  for (const w of derived.walls) for (const o of w.openings) if (!openingHost.has(o.id)) openingHost.set(o.id, { wall: w, opening: o });

  const named = (r: DerivedVariant['rooms'][number]) => r.room?.name?.trim() || '';
  const outline = (r: DerivedVariant['rooms'][number]) => (r.facePolygon.length >= 3 ? r.facePolygon : r.polygon);

  /** The named room at a plan point on one of the given levels (any level when empty). */
  const namedRoomAt = (p: Vec2, levelIds: readonly Id[]) =>
    derived.rooms.find((x) => named(x) && (levelIds.length === 0 || levelIds.includes(x.levelId)) && pointInPolygon(p, outline(x)));

  /** The named room at a plan point on one of the wall's levels ('' when none). */
  const roomAt = (p: Vec2, levelIds: readonly Id[]): string => {
    const r = namedRoomAt(p, levelIds);
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
    if (rooms.length === 1) return `${base} ${N.inRoom(rooms[0])}`;
    // No named room: the building part it stands in, if any.
    const block = derived.blocks.find((b) => pointInPolygon(p, b.axis));
    return block ? `${base} ${N.inBlock(block.block.name)}` : N.looseWall;
  };

  /**
   * A wall's noun and place for the 'wall' name (see the header): "veggen" + "mellom Gang og Bad" / "nord i Stue" /
   * "i «Ny tverrfløy»" / "nord på terrassen" / "sør for «Bod-fløy»", "ytterveggen" + "mot nord i Kjøkken". Null when
   * nothing places it (no building part at all).
   */
  const wallParts = (w: DerivedWall): { noun: string; place: string } | null => {
    const d: Vec2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
    const len = Math.hypot(d[0], d[1]) || 1;
    const n: Vec2 = [-d[1] / len, d[0] / len];
    const p: Vec2 = [w.a[0] + d[0] / 2, w.a[1] + d[1] / 2];
    const left = namedRoomAt([p[0] + n[0] * (w.faceLeft + 0.05), p[1] + n[1] * (w.faceLeft + 0.05)], w.levelIds);
    const right = namedRoomAt([p[0] - n[0] * (w.faceRight + 0.05), p[1] - n[1] * (w.faceRight + 0.05)], w.levelIds);
    const rooms = [...new Set([left, right].filter((x) => x !== undefined).map(named))].sort((a, b) => a.localeCompare(b, 'nb'));
    const noun = w.isDivider ? N.divider : N.wall;
    if (rooms.length === 2) return { noun, place: N.between(rooms[0], rooms[1]) };
    if (w.isExterior) {
      const towards = N.towards(compassWord([-n[0], -n[1]], site));
      return { noun: N.exterior, place: rooms.length === 1 ? `${towards} ${N.inRoom(rooms[0])}` : towards };
    }
    const room = left ?? right;
    if (room) return { noun, place: L.inRoomPart(partOf(outline(room), p, site), named(room)) };
    const block = derived.blocks.find((b) => pointInPolygon(p, b.axis));
    if (block) return { noun, place: N.inBlock(block.block.name) };
    const deck = derived.outdoor.decks.find((dk) => dk.polygon.length >= 3 && pointInPolygon(p, dk.polygon));
    if (deck) return { noun, place: L.onDeck(partOf(deck.polygon, p, site)) };
    let nearest: { name: string; c: Vec2; dist: number } | null = null;
    for (const b of derived.blocks) {
      const box = boxOf(b.axis);
      if (!box || b.axis.length < 3) continue;
      const dist = Math.min(...b.axis.map((q, i) => distanceToSegment(p, q, b.axis[(i + 1) % b.axis.length])));
      if (!nearest || dist < nearest.dist) nearest = { name: b.block.name, c: box.c, dist };
    }
    return nearest ? { noun, place: L.nearBlock(compassWord([p[0] - nearest.c[0], p[1] - nearest.c[1]], site), nearest.name) } : null;
  };

  const wall = (id: Id): string => {
    const w = wallsById.get(id);
    const parts = w ? wallParts(w) : null;
    return parts ? `${parts.noun} ${parts.place}` : N.looseWall;
  };

  /** `wallParts` by id (null for an unknown wall or one nothing places). */
  const wallPartsOf = (id: Id) => {
    const w = wallsById.get(id);
    return w ? wallParts(w) : null;
  };

  const openingType = (id: Id, variant?: Variant): string => {
    const type = openingHost.get(id)?.opening.type ?? variant?.openings.find((o) => o.id === id)?.type;
    return type ? N.opening[type] : N.unknownOpening;
  };

  /**
   * An opening on a block edge that is on no wall piece (its stretch of the edge is gone: another building part stands
   * against it). From the block's own geometry at the opening's centre: "ytterveggen mot øst i Soverom (ny fløy)", and
   * the building part just outside that point ('' when none).
   */
  const onBlockEdge = (id: Id, variant: Variant): { place: string; coveredBy: string } | null => {
    const o = variant.openings.find((x) => x.id === id);
    if (o?.host.kind !== 'blockEdge') return null;
    const h = o.host;
    const block = variant.blocks.find((b) => b.id === h.blockId);
    const i = block ? block.polygon.findIndex((v) => v.id === h.edgeId) : -1;
    if (!block || i < 0) return null;
    const a = block.polygon[i].p;
    const b = block.polygon[(i + 1) % block.polygon.length].p;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) return null;
    const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const nIn: Vec2 = [-u[1], u[0]]; // CCW polygon: the inside is on the left
    const s = Math.min(len, Math.max(0, o.offset));
    const p: Vec2 = [a[0] + u[0] * s, a[1] + u[1] * s];
    const depth = block.wall.thickness - block.wall.outerOffset + 0.05;
    const inside: Vec2 = [p[0] + nIn[0] * depth, p[1] + nIn[1] * depth];
    const zone = block.floorZones.find((z) => z.kind === 'replace' && pointInPolygon(inside, z.polygon));
    const level = o.levelId ?? zone?.levelId ?? block.levelId;
    const room = roomAt(inside, [level]) || roomAt(inside, []);
    const towards = N.towards(compassWord([-nIn[0], -nIn[1]], site));
    const outside: Vec2 = [p[0] - nIn[0] * OUTSIDE_PROBE, p[1] - nIn[1] * OUTSIDE_PROBE];
    return {
      place: room ? `${N.exterior} ${towards} ${N.inRoom(room)}` : `${N.exterior} ${towards}`,
      coveredBy: blockAt(variant.blocks, outside, block.id)?.name ?? '',
    };
  };

  const openingPlace = (id: Id, variant?: Variant): string => {
    const hosted = openingHost.get(id);
    if (hosted) {
      const len = Math.hypot(hosted.wall.b[0] - hosted.wall.a[0], hosted.wall.b[1] - hosted.wall.a[1]) || 1;
      const t = Math.min(1, Math.max(0, hosted.opening.offset / len));
      return N.inRoom(wallPhrase(hosted.wall, t, hosted.opening.outward));
    }
    const o = variant?.openings.find((x) => x.id === id);
    if (variant && o?.host.kind === 'blockEdge') {
      const edge = onBlockEdge(id, variant);
      return edge ? N.inRoom(edge.place) : '';
    }
    const host = o?.host.kind === 'wall' ? wallsById.get(o.host.wallId) : undefined;
    return host ? N.inRoom(wallPhrase(host)) : '';
  };

  /** The building part standing against an opening's stretch of block edge ('' when none, or when it is on a wall). */
  const openingCoveredBy = (id: Id, variant: Variant): string => (openingHost.has(id) ? '' : (onBlockEdge(id, variant)?.coveredBy ?? ''));

  /** "nord", …: the direction of a roof's `start` (low coordinate) or `end` end along its ridge ('' when unknown). */
  const roofEnd = (blockId: Id, end: 'start' | 'end', variant: Variant): string => {
    const block = variant.blocks.find((b) => b.id === blockId);
    const axis = block ? ridgeAxis(block.roof) : null;
    if (!axis) return '';
    const sign = end === 'start' ? -1 : 1;
    return compassWord(axis === 'x' ? [sign, 0] : [0, sign], site);
  };

  /** Deck steps: the direction they face ('' when unknown) and the building part in their way ('' when none). */
  const steps = (id: Id, variant: Variant): { towards: string; blockedBy: string } => {
    const st = derived.outdoor.steps.find((x) => x.id === id);
    if (!st) return { towards: '', blockedBy: '' };
    const probe = (d: number): Vec2 => [st.at[0] + st.outward[0] * d, st.at[1] + st.outward[1] * d];
    const block = blockAt(variant.blocks, probe(OUTSIDE_PROBE)) ?? blockAt(variant.blocks, probe(-OUTSIDE_PROBE)) ?? blockAt(variant.blocks, st.at);
    return { towards: compassWord(st.outward, site), blockedBy: block?.name ?? '' };
  };

  return { wall, wallParts: wallPartsOf, openingType, openingPlace, openingCoveredBy, roofEnd, steps };
}

/** Distance from p to the segment a–b. */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const l2 = d[0] * d[0] + d[1] * d[1];
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + d[0] * t), p[1] - (a[1] + d[1] * t));
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
      case 'openingCoveredBy':
        return place.openingCoveredBy(id, variant);
      case 'roofEnd': {
        // `${blockId}:start` or `${blockId}:end`
        const at = id.lastIndexOf(':');
        const end = id.slice(at + 1);
        return at > 0 && (end === 'start' || end === 'end') ? place.roofEnd(id.slice(0, at), end, variant) : '';
      }
      case 'stepsTowards':
        return place.steps(id, variant).towards;
      case 'stepsBlockedBy':
        return place.steps(id, variant).blockedBy;
      case 'wall':
        return place.wall(id);
      case 'furniture': {
        const f = derived.furniture.find((x) => x.id === id);
        return f ? (f.catalog?.name ?? f.item.catalogId) : id;
      }
      case 'obstacle': {
        // What a furniture item stands in other than a wall: structure (stairs, chimney, posts) or a hot tub.
        const s = derived.structure.find((x) => x.id === id);
        if (s) return N.obstacles[s.kind] ?? '';
        return derived.outdoor.hotTubs.some((h) => h.id === id) ? (N.obstacles.hotTub ?? '') : '';
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
    case 'drain-far':
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
  /** The first warning's element (a merged line points at the first of its warnings). */
  target: Selection | null;
  /** How many warnings the line stands for (identical texts are merged into one line); 1 for most. */
  count: number;
}

/**
 * The Advarsler panel's lines: one per warning, except that loose walls (`wall-dangling`) with the same text become one
 * line with a count, at the first one's place: "3 vegger nord i Stue henger løs og danner ikke noe rom." ("… (2 steder)"
 * when the wall has no noun to put in the plural). Other kinds keep a line each: two windows on one covered wall are
 * still two windows to move.
 */
export function warningItems(derived: DerivedVariant, variant: Variant, site?: Pick<Site, 'planNorthBearing'>): WarningItem[] {
  const names = makeNameLookup(derived, variant, site);
  const place = makePlaceNamer(derived, site);
  const items: WarningItem[] = [];
  /** The line of each loose-wall text so far, and the first wall it names. */
  const loose = new Map<string, { item: WarningItem; wallId: Id }>();
  for (const [i, w] of derived.warnings.entries()) {
    const text = warningText(w, names, formatM2);
    const same = w.kind === 'wall-dangling' ? loose.get(text) : undefined;
    if (same) {
      same.item.count++;
      continue;
    }
    const item: WarningItem = { key: `${w.kind}-${i}`, text, target: warningTarget(w), count: 1 };
    items.push(item);
    if (w.kind === 'wall-dangling') loose.set(text, { item, wallId: w.wallId });
  }
  for (const { item, wallId } of loose.values()) {
    if (item.count === 1) continue;
    const parts = place.wallParts(wallId);
    const nouns = parts ? L.plural[parts.noun] : undefined;
    item.text = parts && nouns ? L.looseWalls(item.count, nouns, parts.place) : `${item.text} ${L.repeated(item.count)}`;
  }
  return items;
}

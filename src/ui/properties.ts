/**
 * Read-only description of a selection: a title and label/value rows, all strings already Norwegian and
 * formatted. Heights are absolute (relative to the main floor). Pure. Phase 2: the Egenskaper editors
 * (PropertiesEditor.tsx) use it for the header of every kind and for the rows of kinds without an editor
 * (structure); `levelName` / `wallTitle` are shared with the editors.
 */
import { area as polygonArea } from '../geometry/polygon';
import type { DerivedBlock, DerivedStructure, DerivedVariant, DerivedWall } from '../model/derived';
import type { Id, Vec2, WallKind } from '../model/types';
import { nb } from '../i18n/nb';
import type { ResolvedSelection } from '../state/selection';
import { formatDegrees, formatDims, formatLength, formatM, formatM2, formatPoint } from './format';
import { SPLIT_MIN_AREA } from './schedule';

export interface SelectionDescription {
  kindLabel: string;
  title: string;
  rows: [string, string][];
  /** Set for rooms with a Room record (the panel offers "Gi nytt navn"). */
  roomId?: Id;
}

const F = nb.properties.fields;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function yesNo(v: boolean): string {
  return v ? F.yes : F.no;
}

function statusOf(isNew: boolean): string {
  return isNew ? nb.status.new : nb.status.existing;
}

export function levelName(derived: DerivedVariant, levelId: Id | undefined): string {
  if (!levelId) return '–';
  return derived.levels.find((l) => l.id === levelId)?.name ?? levelId;
}

function blockName(derived: DerivedVariant, blockId: Id | undefined): string {
  if (!blockId) return '–';
  return derived.blocks.find((b) => b.block.id === blockId)?.block.name ?? blockId;
}

/**
 * "Yttervegg (Hovedhus)" / "Innervegg" / "Tidligere yttervegg" / "Romdeler". `storedKinds` maps stored wall ids to
 * their `WallKind` (the derived wall does not carry it).
 */
export function wallTitle(derived: DerivedVariant, wall: DerivedWall, storedKinds?: ReadonlyMap<Id, WallKind>): string {
  if (wall.source.kind === 'blockEdge') return `${nb.wallKinds.exterior} (${blockName(derived, wall.source.blockId)})`;
  if (wall.isDivider) return nb.wallKinds.divider;
  return nb.wallKinds[storedKinds?.get(wall.source.wallId) ?? 'interior'];
}

function heightRows(baseZ: number, topZ: number): [string, string][] {
  return [
    [F.baseZ, formatLength(baseZ)],
    [F.topZ, formatLength(topZ)],
  ];
}

function describeBlock(derived: DerivedVariant, b: DerivedBlock): [string, string][] {
  const roof = b.block.roof;
  return [
    [F.status, statusOf(b.block.isNew)],
    [F.level, levelName(derived, b.block.levelId)],
    [F.footprint, formatDims(b.axisDims.w, b.axisDims.h)],
    [F.roof, `${nb.roofTypes[roof.type] ?? roof.type}, ${(nb.roofMaterials[roof.material] ?? roof.material).toLowerCase()}`],
    [F.pitch, formatDegrees(b.pitchDeg)],
    [F.eave, formatLength(b.eaveZ)],
    [F.ridge, formatLength(b.ridgeZ)],
  ];
}

function describeStructure(s: DerivedStructure): [string, string][] {
  const rows: [string, string][] = [[F.status, statusOf(s.isNew)]];
  switch (s.kind) {
    case 'post':
      rows.push([F.width, formatLength(s.size)], [F.position, formatPoint(s.position)], ...heightRows(s.bottomZ, s.topZ));
      break;
    case 'beam':
      rows.push([F.length, formatM(dist(s.a, s.b))], [F.width, formatLength(s.width)], ...heightRows(s.bottomZ, s.topZ));
      break;
    case 'chimney':
      rows.push([F.footprint, formatDims(s.max[0] - s.min[0], s.max[1] - s.min[1])], ...heightRows(s.bottomZ, s.topZ));
      break;
    case 'stair':
      rows.push([F.from, formatLength(s.fromZ)], [F.to, formatLength(s.toZ)], [F.risers, String(s.treads.length)]);
      break;
  }
  return rows;
}

export function describeSelection(
  resolved: ResolvedSelection,
  derived: DerivedVariant,
  storedWallKinds: ReadonlyMap<Id, WallKind> = new Map(),
): SelectionDescription {
  const kindLabel = nb.selectionKinds[resolved.kind] ?? resolved.kind;
  switch (resolved.kind) {
    case 'room': {
      const r = resolved.room;
      const name = r.room?.name?.trim() || nb.schedule.unnamed;
      const rows: [string, string][] = [];
      if (r.room) rows.push([F.type, nb.roomTypes[r.room.type]]);
      rows.push([F.level, levelName(derived, r.levelId)]);
      if (r.blockId) rows.push([F.block, blockName(derived, r.blockId)]);
      rows.push([F.dims, formatDims(r.dims.w, r.dims.h, r.dims.approx)], [F.area, formatM2(r.area)]);
      if (r.areaExisting >= SPLIT_MIN_AREA && r.areaNew >= SPLIT_MIN_AREA) {
        rows.push([F.areaExisting, formatM2(r.areaExisting)], [F.areaNew, formatM2(r.areaNew)]);
      } else {
        rows.push([F.status, statusOf(r.isNew)]);
      }
      rows.push([F.floor, nb.floorMaterials[r.floorMaterial] ?? r.floorMaterial]);
      if (r.room?.note) rows.push([F.note, r.room.note]);
      return { kindLabel, title: name, rows, roomId: r.room?.id };
    }
    case 'wall': {
      const w = resolved.wall;
      const title = wallTitle(derived, w, storedWallKinds);
      const rows: [string, string][] = [
        [F.status, nb.status[w.status]],
        [F.level, levelName(derived, w.levelId)],
        [F.length, formatM(dist(w.a, w.b))],
      ];
      if (!w.isDivider) rows.push([F.thickness, formatLength(w.thickness)], ...heightRows(w.baseZ, w.topZ));
      rows.push([F.openings, String(w.openings.length)]);
      return { kindLabel, title, rows };
    }
    case 'opening': {
      const o = resolved.opening;
      const level = o.opening.levelId ?? resolved.wall.levelId;
      const rows: [string, string][] = [
        [F.status, nb.status[o.status]],
        [F.width, formatDims(o.width, o.headZ - o.sillZ)],
        [F.sill, formatLength(o.opening.sill)],
        [F.level, levelName(derived, level)],
        [F.host, wallTitle(derived, resolved.wall, storedWallKinds)],
      ];
      return { kindLabel, title: nb.openingTypes[o.type], rows };
    }
    case 'block':
      return { kindLabel, title: resolved.block.block.name, rows: describeBlock(derived, resolved.block) };
    case 'blockEdge': {
      const { block, edge } = resolved;
      return {
        kindLabel,
        title: `${nb.wallKinds.exterior} (${block.block.name})`,
        rows: [
          [F.block, block.block.name],
          [F.length, formatM(edge.length)],
          [F.from, formatPoint(edge.a)],
          [F.to, formatPoint(edge.b)],
        ],
      };
    }
    case 'blockVertex':
      return {
        kindLabel,
        title: `${F.vertex} (${resolved.block.block.name})`,
        rows: [[F.position, formatPoint(resolved.vertex.p)]],
      };
    case 'deck': {
      const d = resolved.deck;
      return {
        kindLabel,
        title: kindLabel,
        rows: [
          [F.status, statusOf(d.isNew)],
          [F.area, formatM2(polygonArea(d.polygon))],
          [F.deckTop, formatLength(d.topZ)],
        ],
      };
    }
    case 'railing': {
      const r = resolved.railing;
      return {
        kindLabel,
        title: kindLabel,
        rows: [
          [F.status, statusOf(r.isNew)],
          [F.style, nb.properties.railingStyles[r.style] ?? r.style],
          [F.height, formatLength(r.height)],
          [F.posts, String(r.posts.length)],
          [F.steps, String(derived.outdoor.steps.filter((st) => st.deckId === r.deckId && !st.blocked).length)],
        ],
      };
    }
    case 'hotTub': {
      const h = resolved.hotTub;
      return { kindLabel, title: kindLabel, rows: [[F.status, statusOf(h.isNew)], [F.diameter, formatLength(h.diameter)]] };
    }
    case 'structure': {
      const s = resolved.structure;
      return { kindLabel, title: nb.structureKinds[s.kind] ?? s.kind, rows: describeStructure(s) };
    }
    case 'furniture': {
      const f = resolved.furniture;
      return {
        kindLabel,
        title: kindLabel,
        rows: [
          [F.catalog, f.item.catalogId],
          [F.level, levelName(derived, f.levelId)],
          [F.position, formatPoint(f.item.position)],
          [F.isNew, yesNo(f.isNew)],
        ],
      };
    }
    case 'tree':
      return {
        kindLabel,
        title: kindLabel,
        rows: [
          [F.height, formatM(resolved.tree.height)],
          [F.position, formatPoint(resolved.tree.position)],
        ],
      };
    case 'deckVertex':
      return { kindLabel, title: kindLabel, rows: [[F.position, formatPoint(resolved.p)]] };
    case 'deckEdge':
      return { kindLabel, title: kindLabel, rows: [[F.length, formatM(dist(resolved.a, resolved.b))]] };
    case 'steps': {
      const s = resolved.steps;
      return { kindLabel, title: kindLabel, rows: [[F.width, formatLength(s.width)], [F.risers, String(s.risers)]] };
    }
    case 'ghost': {
      const g = resolved.ghost;
      const what = g.type === 'opening' ? nb.openingTypes[g.opening.type] : g.type === 'wall' ? nb.selectionKinds.wall : nb.wallKinds.exterior;
      return { kindLabel, title: what, rows: [[F.status, nb.status.removed]] };
    }
  }
}

/**
 * Room schedule rows (Romskjema) built from the derived model: one group per level (ascending elevation, levels
 * without rooms omitted), rows sorted by name (unnamed faces last, largest first). Stair voids (type 'apning')
 * are listed but excluded from the sums, like BRA. A room "spans both" when its existing AND new shares are
 * each at least SPLIT_MIN_AREA; the schedule then shows both as a small tag.
 */
import type { DerivedRoom, DerivedVariant } from '../model/derived';
import type { Id, Level } from '../model/types';
import { nb } from '../i18n/nb';
import type { Selection } from '../state/selection';
import { formatDims } from './format';

export const SPLIT_MIN_AREA = 0.05;

export interface ScheduleRow {
  id: Id;
  levelId: Id;
  storeyId: Id;
  name: string;
  unnamed: boolean;
  typeName: string | null;
  isVoid: boolean;
  /** Dominant part. */
  part: 'existing' | 'new';
  /** Both shares are significant. */
  mixed: boolean;
  dims: string;
  area: number;
  areaExisting: number;
  areaNew: number;
  selection: Selection;
}

export interface ScheduleGroup {
  levelId: Id;
  levelName: string;
  rows: ScheduleRow[];
  total: number;
}

export interface Schedule {
  groups: ScheduleGroup[];
  total: number;
  count: number;
}

function toRow(r: DerivedRoom): ScheduleRow {
  const name = r.room?.name?.trim() ?? '';
  const isVoid = r.room?.type === 'apning';
  return {
    id: r.id,
    levelId: r.levelId,
    storeyId: r.storeyId,
    name: name || nb.schedule.unnamed,
    unnamed: !name,
    typeName: r.room ? nb.roomTypes[r.room.type] : null,
    isVoid,
    part: r.areaNew > r.areaExisting ? 'new' : 'existing',
    mixed: r.areaExisting >= SPLIT_MIN_AREA && r.areaNew >= SPLIT_MIN_AREA,
    dims: formatDims(r.dims.w, r.dims.h, r.dims.approx),
    area: r.area,
    areaExisting: r.areaExisting,
    areaNew: r.areaNew,
    selection: { kind: 'room', id: r.id, levelId: r.levelId },
  };
}

const collator = new Intl.Collator('nb', { numeric: true, sensitivity: 'base' });

function compareRows(a: ScheduleRow, b: ScheduleRow): number {
  if (a.unnamed !== b.unnamed) return a.unnamed ? 1 : -1;
  if (a.unnamed) return b.area - a.area;
  return collator.compare(a.name, b.name);
}

function sumArea(rows: ScheduleRow[]): number {
  return rows.reduce((s, r) => (r.isVoid ? s : s + r.area), 0);
}

export function buildSchedule(derived: DerivedVariant): Schedule {
  const levels = [...derived.levels].sort((a, b) => a.elevation - b.elevation);
  const known = new Set(levels.map((l) => l.id));
  const byLevel = new Map<Id, ScheduleRow[]>();
  for (const r of derived.rooms) {
    const list = byLevel.get(r.levelId) ?? [];
    list.push(toRow(r));
    byLevel.set(r.levelId, list);
  }
  const order = [...levels.map((l) => ({ id: l.id, name: l.name })), ...[...byLevel.keys()].filter((id) => !known.has(id)).map((id) => ({ id, name: id }))];
  const groups: ScheduleGroup[] = [];
  for (const level of order) {
    const rows = byLevel.get(level.id);
    if (!rows?.length) continue;
    rows.sort(compareRows);
    groups.push({ levelId: level.id, levelName: level.name, rows, total: sumArea(rows) });
  }
  return {
    groups,
    total: groups.reduce((s, g) => s + g.total, 0),
    count: groups.reduce((s, g) => s + g.rows.length, 0),
  };
}

/** Plan storey tab showing a storey id ('loft' → Hems, everything else → Plan 1). */
export function planStoreyOf(storeyId: Id): 'ground' | 'loft' {
  return storeyId === 'loft' ? 'loft' : 'ground';
}

/** "Underetasje (soverom)" → "Underetasje" for narrow columns and the headline. */
export function shortLevelName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '') || name;
}

/** BRA per level, lowest level first. */
export function sortByLevelElevation<T extends { levelId: Id }>(items: readonly T[], levels: readonly Level[]): T[] {
  const z = (id: Id) => levels.find((l) => l.id === id)?.elevation ?? 0;
  return [...items].sort((a, b) => z(a.levelId) - z(b.levelId));
}

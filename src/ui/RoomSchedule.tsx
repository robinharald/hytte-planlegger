/**
 * Romskjema: Rom · Etasje · Del · Mål · Areal, grouped by level with level sums. Clicking a row (or Enter/Space
 * on it) selects the room and switches the plan to the room's storey. A room spanning existing and new parts
 * shows both shares as small tags.
 */
import { Fragment, useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import { nb } from '../i18n/nb';
import { appStore, useAppStore } from '../state/appStore';
import { useDerived } from '../state/useDerived';
import { Panel } from './common';
import { formatM2, formatNumber } from './format';
import { buildSchedule, planStoreyOf, shortLevelName } from './schedule';
import type { ScheduleRow } from './schedule';

function choose(row: ScheduleRow): void {
  appStore.getState().setUi({ selection: row.selection, planStorey: planStoreyOf(row.storeyId), activeStoreyId: row.storeyId });
}

function PartCell({ row }: { row: ScheduleRow }) {
  if (row.mixed) {
    return (
      <span className="num">
        <span className="tag">
          {nb.schedule.existingTag} {formatNumber(row.areaExisting)}
        </span>{' '}
        <span className="tag tag-new">
          {nb.schedule.newTag} {formatNumber(row.areaNew)}
        </span>
      </span>
    );
  }
  return row.part === 'new' ? <span className="tag tag-new">{nb.schedule.newTag}</span> : <span className="tag">{nb.schedule.existingTag}</span>;
}

export function RoomSchedule(props: { defaultOpen?: boolean }) {
  const derived = useDerived();
  const selection = useAppStore((s) => s.ui.selection);
  const schedule = useMemo(() => buildSchedule(derived), [derived]);

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: ScheduleRow) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(row);
    }
  };

  return (
    <Panel title={nb.schedule.heading} badge={schedule.count || undefined} defaultOpen={props.defaultOpen} testId="room-schedule">
      {schedule.count === 0 ? (
        <p className="muted">{nb.schedule.empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{nb.schedule.room}</th>
                <th scope="col">{nb.schedule.level}</th>
                <th scope="col">{nb.schedule.part}</th>
                <th scope="col">{nb.schedule.dims}</th>
                <th scope="col" className="r">
                  {nb.schedule.area}
                </th>
              </tr>
            </thead>
            <tbody>
              {schedule.groups.map((g) => (
                <Fragment key={g.levelId}>
                  <tr className="group">
                    <td colSpan={5}>{g.levelName}</td>
                  </tr>
                  {g.rows.map((row) => {
                    const selected = selection?.kind === 'room' && selection.id === row.id && (selection.levelId ?? row.levelId) === row.levelId;
                    return (
                      <tr
                        key={`${row.levelId}/${row.id}`}
                        className="row"
                        aria-selected={selected}
                        tabIndex={0}
                        onClick={() => choose(row)}
                        onKeyDown={(e) => onKey(e, row)}
                      >
                        <td className={row.unnamed ? 'unnamed' : undefined}>
                          {row.name}
                          {row.isVoid && <span className="muted"> ({row.typeName})</span>}
                        </td>
                        <td>{shortLevelName(g.levelName)}</td>
                        <td>
                          <PartCell row={row} />
                        </td>
                        <td className="num">{row.dims}</td>
                        <td className="r">{row.isVoid ? <span className="muted">({formatM2(row.area)})</span> : formatM2(row.area)}</td>
                      </tr>
                    );
                  })}
                  {schedule.groups.length > 1 && (
                    <tr className="subtotal">
                      <td colSpan={4}>{nb.schedule.levelSum}</td>
                      <td className="r">{formatM2(g.total)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="total">
                <td colSpan={4}>{nb.schedule.sum}</td>
                <td className="r">{formatM2(schedule.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

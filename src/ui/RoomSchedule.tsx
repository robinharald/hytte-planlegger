/**
 * Romskjema: Rom · Bygningsdel · Status · Mål · Areal, grouped by level (a group row per level, so no level column)
 * with level sums. The table has a fixed layout that fits the side column at every width (≥ 290 px): names and
 * dimensions wrap, Areal always stays visible. A room spanning existing and new parts shows both tags in Status and
 * both shares under its area.
 *
 * Clicking a row (or Enter/Space on it) selects the room, switches the plan to the room's storey and scrolls the
 * Egenskaper panel into view (on phones: opens the Egenskaper bottom sheet).
 */
import { Fragment, useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import { nb } from '../i18n/nb';
import { appStore, useAppStore } from '../state/appStore';
import { useDerived } from '../state/useDerived';
import { Panel } from './common';
import { revealProperties } from './reveal';
import { formatM2, formatNumber } from './format';
import { buildSchedule, planStoreyOf } from './schedule';
import type { ScheduleRow } from './schedule';

const S = nb.schedule;

function choose(row: ScheduleRow): void {
  appStore.getState().setUi({ selection: row.selection, planStorey: planStoreyOf(row.storeyId), activeStoreyId: row.storeyId });
  revealProperties();
}

function StatusCell({ row }: { row: ScheduleRow }) {
  if (row.mixed) {
    return (
      <span className="tags" title={S.split(formatM2(row.areaExisting), formatM2(row.areaNew))}>
        <span className="tag">{S.existingTag}</span>
        <span className="tag tag-new">{S.newTag}</span>
      </span>
    );
  }
  return row.part === 'new' ? <span className="tag tag-new">{S.newTag}</span> : <span className="tag">{S.existingTag}</span>;
}

function AreaCell({ row }: { row: ScheduleRow }) {
  const area = row.isVoid ? <span className="muted">({formatM2(row.area)})</span> : formatM2(row.area);
  if (!row.mixed) return area;
  return (
    <>
      {area}
      <span className="area-split">
        {formatNumber(row.areaExisting)} + {formatNumber(row.areaNew)}
      </span>
    </>
  );
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
    <Panel title={S.heading} badge={schedule.count || undefined} defaultOpen={props.defaultOpen} testId="room-schedule">
      {schedule.count === 0 ? (
        <p className="muted">{S.empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="table schedule">
            <colgroup>
              <col className="c-room" />
              <col className="c-block" />
              <col className="c-status" />
              <col className="c-dims" />
              <col className="c-area" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{S.room}</th>
                <th scope="col">{S.block}</th>
                <th scope="col" title={S.statusTitle}>
                  {S.status}
                </th>
                <th scope="col" title={S.dimsTitle}>
                  {S.dims}
                </th>
                <th scope="col" className="r" title={S.areaTitle} data-testid="schedule-area-header">
                  {S.area}
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
                        <td className="block">{row.blockName}</td>
                        <td>
                          <StatusCell row={row} />
                        </td>
                        <td className="dims">
                          {row.approx && <span className="approx">{S.approxPrefix} </span>}
                          <span className="num">{row.dimsShort}</span>
                        </td>
                        <td className="r">
                          <AreaCell row={row} />
                        </td>
                      </tr>
                    );
                  })}
                  {schedule.groups.length > 1 && (
                    <tr className="subtotal">
                      <td colSpan={4}>{S.levelSum}</td>
                      <td className="r">{formatM2(g.total)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="total">
                <td colSpan={4}>{S.sum}</td>
                <td className="r">{formatM2(schedule.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

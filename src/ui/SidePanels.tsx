/**
 * Right column: Romskjema, Egenskaper (read-only summary of the selection; rooms can be renamed; right below the
 * schedule and scrolled into view when a row is chosen), Arealer and Advarsler (click a warning to select what it
 * is about). On phones Arealer and Advarsler start collapsed.
 */
import { useMemo } from 'react';
import { nb } from '../i18n/nb';
import type { Id, WallKind } from '../model/types';
import { appStore, useAppStore } from '../state/appStore';
import type { Selection } from '../state/selection';
import { useActiveVariant, useDerived, useResolvedSelection } from '../state/useDerived';
import { AreaTotals } from './AreaTotals';
import { Panel } from './common';
import { PROPERTIES_PANEL_ID } from './reveal';
import { describeSelection } from './properties';
import { RoomSchedule } from './RoomSchedule';
import { planStoreyOf } from './schedule';
import { warningItems } from './warnings';

function PropertiesPanel(props: { defaultOpen: boolean }) {
  const derived = useDerived();
  const variant = useActiveVariant();
  const selection = useAppStore((s) => s.ui.selection);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const resolved = useResolvedSelection();
  const wallKinds = useMemo(() => new Map<Id, WallKind>(variant.walls.map((w) => [w.id, w.kind])), [variant.walls]);
  const desc = resolved ? describeSelection(resolved, derived, wallKinds) : null;

  const rename = (roomId: Id, current: string) => {
    const name = window.prompt(nb.prompts.renameRoom, current);
    if (name !== null) appStore.getState().renameRoom(roomId, name);
  };

  return (
    <Panel title={nb.properties.heading} defaultOpen={props.defaultOpen} id={PROPERTIES_PANEL_ID} testId="properties">
      {!selection && <p className="muted">{nb.properties.none}</p>}
      {selection && !desc && <p className="muted">{nb.properties.dangling}</p>}
      {desc && (
        <>
          <p>
            <span className="tag">{desc.kindLabel}</span> <strong>{desc.title}</strong>
          </p>
          <dl className="kv">
            {desc.rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {selection && (
        <div className="toolgroup">
          {desc?.roomId && !readOnly && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => rename(desc.roomId as Id, desc.title)}
              title={nb.properties.renameTitle}
            >
              {nb.properties.rename}
            </button>
          )}
          <button type="button" className="btn btn-small btn-ghost" onClick={() => appStore.getState().select(null)}>
            {nb.properties.clear}
          </button>
        </div>
      )}
    </Panel>
  );
}

function selectTarget(target: Selection, storeyOfLevel: (levelId?: Id) => Id | undefined): void {
  const storeyId = storeyOfLevel(target.levelId);
  appStore.getState().setUi(storeyId ? { selection: target, planStorey: planStoreyOf(storeyId), activeStoreyId: storeyId } : { selection: target });
}

function WarningsPanel(props: { defaultOpen: boolean }) {
  const derived = useDerived();
  const variant = useActiveVariant();
  const items = useMemo(() => warningItems(derived, variant), [derived, variant]);
  const storeyOfLevel = (levelId?: Id) => (levelId ? derived.levels.find((l) => l.id === levelId)?.storeyId : undefined);

  return (
    <Panel title={nb.warnings.heading} badge={items.length ? nb.warnings.count(items.length) : undefined} defaultOpen={props.defaultOpen}>
      {items.length === 0 ? (
        <p className="muted">{nb.warnings.none}</p>
      ) : (
        <ul className="warnings">
          {items.map((w) => (
            <li key={w.key}>
              {w.target ? (
                <button type="button" title={nb.warnings.showTitle} onClick={() => selectTarget(w.target as Selection, storeyOfLevel)}>
                  {w.text}
                </button>
              ) : (
                w.text
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SidePanels(props: { isPhone: boolean }) {
  const open = !props.isPhone;
  return (
    <aside className="side">
      <RoomSchedule defaultOpen />
      <PropertiesPanel defaultOpen />
      <AreaTotals defaultOpen={open} />
      <WarningsPanel defaultOpen={open} />
    </aside>
  );
}

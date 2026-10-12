/**
 * Right column: Egenskaper on top (docs/phase2-plan.md §6; the editors of PropertiesPanel.tsx, scrolled into view when
 * a schedule row is chosen), then Romskjema, Arealer and Advarsler (click a warning to select what it is about).
 * On phones there is no Egenskaper panel here (it is a bottom sheet) and Arealer and Advarsler start collapsed.
 */
import { useMemo } from 'react';
import { nb } from '../i18n/nb';
import type { Id } from '../model/types';
import { appStore, useAppStore } from '../state/appStore';
import type { Selection } from '../state/selection';
import { useActiveVariant, useDerived } from '../state/useDerived';
import { AreaTotals } from './AreaTotals';
import { Panel } from './common';
import { PropertiesPanel } from './PropertiesPanel';
import { RoomSchedule } from './RoomSchedule';
import { WARNINGS_PANEL_ID } from './reveal';
import { planStoreyOf } from './schedule';
import { warningItems } from './warnings';

function selectTarget(target: Selection, storeyOfLevel: (levelId?: Id) => Id | undefined): void {
  const storeyId = storeyOfLevel(target.levelId);
  appStore.getState().setUi(storeyId ? { selection: target, planStorey: planStoreyOf(storeyId), activeStoreyId: storeyId } : { selection: target });
}

function WarningsPanel(props: { defaultOpen: boolean }) {
  const derived = useDerived();
  const variant = useActiveVariant();
  const site = useAppStore((s) => s.project.site);
  const items = useMemo(() => warningItems(derived, variant, site), [derived, variant, site]);
  const storeyOfLevel = (levelId?: Id) => (levelId ? derived.levels.find((l) => l.id === levelId)?.storeyId : undefined);

  return (
    <Panel
      title={nb.warnings.heading}
      badge={items.length ? nb.warnings.count(items.length) : undefined}
      defaultOpen={props.defaultOpen}
      id={WARNINGS_PANEL_ID}
      testId="warnings"
    >
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
      {!props.isPhone && <PropertiesPanel defaultOpen />}
      <RoomSchedule defaultOpen />
      <AreaTotals defaultOpen={open} />
      <WarningsPanel defaultOpen={open} />
    </aside>
  );
}

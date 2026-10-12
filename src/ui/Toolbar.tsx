/**
 * Toolbar (docs/phase2-plan.md §3.2): Velg · Vegg · Dør/vindu · Nytt bygg · Møbler · Mål, with Angre / Gjør om at the
 * right end; under it the chooser of the active placement tool (Dør/vindu: opening type; Nytt bygg: unit template
 * and a quarter turn).
 *
 *  - Picking the active tool again goes back to Velg. Placement tools (Dør/vindu, Nytt bygg) return to Velg by
 *    themselves after one placement (the plan's job); Vegg stays until Esc or Velg.
 *  - The locked base proposal: the editing tools (Vegg, Dør/vindu, Nytt bygg, Møbler) are greyed (`aria-disabled`,
 *    still clickable) and a click shows the refusal toast with "Nytt forslag"; Velg and Mål work.
 *  - Picking Vegg, Dør/vindu, Nytt bygg or Mål while only the 3D view is shown switches to the plan (they work in
 *    the plan); Møbler keeps the view (items can be dropped in 3D).
 *  - Hidden while read-only (shared link), like every edit control.
 *  - Phones: all six tools fit the row (CSS grid of six equal columns, the icon above a short label that may take two
 *    lines; "Dør/vindu" may break after the slash), so none is hidden off screen and Velg is always in view; Angre /
 *    Gjør om stay visible as icons.
 *  - A warning count badge (the active proposal's warnings) before Angre; it opens Advarsler.
 */
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { nb } from '../i18n/nb';
import type { OpeningType } from '../model/types';
import { appStore, useAppStore } from '../state/appStore';
import { useDerived } from '../state/useDerived';
import { IconDoor, IconHouse, IconRedo, IconRotate, IconRuler, IconSelect, IconSofa, IconUndo, IconWall, IconWarning } from './common';
import {
  EDITING_TOOLS,
  pickTool,
  setToolOptions,
  TOOL_KINDS,
  TOOL_OPENING_TYPES,
  UNIT_TEMPLATE_IDS,
  useActiveVariantLocked,
  useTool,
  useToolOptions,
} from './editorBridge';
import type { ToolKind } from './editorBridge';
import { revealWarnings } from './reveal';

const T = nb.tools;

/** A tool name that may wrap after a slash ("Dør/vindu" → "Dør/" "vindu" on a narrow phone row). */
function breakable(name: string): ReactNode {
  const parts = name.split('/');
  return parts.map((p, i) => (
    <Fragment key={i}>
      {p}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));
}

/** The active proposal's warning count; opens Advarsler. Not shown without warnings. */
function WarningsBadge() {
  const count = useDerived().warnings.length;
  if (count === 0) return null;
  const label = T.warnings(count);
  return (
    <button type="button" className="tool tool-warnings" onClick={revealWarnings} title={T.warningsTitle} aria-label={label} data-testid="toolbar-warnings">
      <IconWarning />
      <span className="tool-count">{count}</span>
    </button>
  );
}

const ICONS: Record<ToolKind, () => ReactNode> = {
  select: IconSelect,
  wall: IconWall,
  opening: IconDoor,
  unit: IconHouse,
  furniture: IconSofa,
  measure: IconRuler,
};

function OpeningChooser(props: { value: OpeningType | undefined }) {
  return (
    <div className="tool-options" role="group" aria-label={T.openingType} data-testid="tool-options-opening">
      <span className="tool-options-label">{T.openingType}</span>
      {TOOL_OPENING_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          className="chip"
          aria-pressed={props.value === t}
          data-testid={`opening-type-${t}`}
          onClick={() => setToolOptions({ openingType: t })}
        >
          {nb.openingTypes[t]}
        </button>
      ))}
    </div>
  );
}

function UnitChooser(props: { value: string | undefined; rotation: number }) {
  return (
    <div className="tool-options" role="group" aria-label={T.unitTemplate} data-testid="tool-options-unit">
      <span className="tool-options-label">{T.unitTemplate}</span>
      {UNIT_TEMPLATE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className="chip"
          aria-pressed={props.value === id}
          data-testid={`unit-${id}`}
          onClick={() => setToolOptions({ unitTemplate: id })}
        >
          {T.units[id].name}
          <small>{T.units[id].size}</small>
        </button>
      ))}
      <button
        type="button"
        className="chip"
        title={T.rotateUnitTitle}
        data-testid="unit-rotate"
        onClick={() => setToolOptions({ unitRotation90: (props.rotation + 1) % 4 })}
      >
        <IconRotate /> {T.rotateUnit}
      </button>
    </div>
  );
}

export function Toolbar() {
  const tool = useTool();
  const options = useToolOptions();
  const locked = useActiveVariantLocked();
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  if (readOnly) return null;

  return (
    <div className="toolbar-wrap" data-locked={locked || undefined}>
      <div className="toolbar" role="toolbar" aria-label={T.label} data-testid="toolbar">
        <div className="toolbar-tools">
          {TOOL_KINDS.map((t) => {
            const Icon = ICONS[t];
            const greyed = locked && EDITING_TOOLS.includes(t);
            return (
              <button
                key={t}
                type="button"
                className="tool"
                data-tool={t}
                aria-pressed={tool === t}
                aria-disabled={greyed || undefined}
                title={greyed ? T.lockedTitle : T.titles[t]}
                data-testid={`tool-${t}`}
                onClick={() => pickTool(t)}
              >
                <Icon />
                <span className="tool-name">{breakable(T.names[t])}</span>
              </button>
            );
          })}
        </div>
        <div className="toolbar-history">
          <WarningsBadge />
          <button
            type="button"
            className="tool"
            onClick={() => appStore.getState().undo()}
            disabled={!canUndo}
            title={T.undoTitle}
            aria-label={T.undo}
            data-testid="undo"
          >
            <IconUndo />
            <span>{T.undo}</span>
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => appStore.getState().redo()}
            disabled={!canRedo}
            title={T.redoTitle}
            aria-label={T.redo}
            data-testid="redo"
          >
            <IconRedo />
            <span>{T.redo}</span>
          </button>
        </div>
      </div>
      {tool === 'opening' && <OpeningChooser value={options.openingType} />}
      {tool === 'unit' && <UnitChooser value={options.unitTemplate} rotation={options.unitRotation90 ?? 0} />}
    </div>
  );
}

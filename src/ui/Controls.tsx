/**
 * Left column: view tabs (Plan / 3D / Begge), storey tabs (Plan 1 / Hems — shown with the plan and for 3D
 * "Inne"), 3D mode + cut height + camera presets (shown with the 3D view), toggles and the sun study.
 * The storey tabs set both `planStorey` and `activeStoreyId` (the seed's storey ids are 'ground' and 'loft').
 * Picking a view tab marks the view as the user's choice (remembered in the UI prefs). Every control has a tooltip.
 */
import type { ReactNode } from 'react';
import { nb } from '../i18n/nb';
import { appStore, useAppStore } from '../state/appStore';
import { CAMERA_PRESET_KEYS, CUT_HEIGHT_MAX, CUT_HEIGHT_MIN, presetUi } from '../state/store';
import type { ActiveView, PlanStorey, UiState } from '../state/store';
import { Panel } from './common';
import { formatDegrees, formatLength, minutesToTime, timeToMinutes } from './format';
import { useSun } from './hooks';

const setUi = (patch: Partial<UiState>) => appStore.getState().setUi(patch);
const T = nb.toggles.titles;

function Seg<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string; title?: string; testId: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={props.value === o.value}
          data-testid={o.testId}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}

function Toggle(props: { label: ReactNode; title: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label title={props.title}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} data-testid={props.testId} />
      <span>{props.label}</span>
    </label>
  );
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function SunControls() {
  const sun = useAppStore((s) => s.ui.sun);
  const info = useSun();
  const setSun = (patch: Partial<UiState['sun']>) => setUi({ sun: { ...sun, ...patch } });
  const year = sun.date.slice(0, 4) || '2026';
  return (
    <div className="panel-body">
      <div className="field-row">
        <label className="field">
          <span>{nb.sun.date}</span>
          <input
            type="date"
            value={sun.date}
            onChange={(e) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setSun({ date: e.target.value });
            }}
          />
        </label>
        <label className="field">
          <span>{nb.sun.time}</span>
          <input
            type="time"
            step={300}
            value={minutesToTime(sun.minutes)}
            onChange={(e) => {
              const m = timeToMinutes(e.target.value);
              if (m !== null) setSun({ minutes: m });
            }}
          />
        </label>
      </div>
      <label className="field">
        <span>
          {nb.sun.timeSlider} <span className="range-value">{minutesToTime(sun.minutes)}</span>
        </span>
        <input type="range" min={0} max={24 * 60 - 5} step={5} value={sun.minutes} onChange={(e) => setSun({ minutes: Number(e.target.value) })} />
      </label>
      <div className="toolgroup">
        <button type="button" className="btn btn-small" onClick={() => setSun({ date: `${year}-06-21` })}>
          {nb.sun.midsummer}
        </button>
        <button type="button" className="btn btn-small" onClick={() => setSun({ date: localToday() })}>
          {nb.sun.today}
        </button>
      </div>
      <p className="note">
        {info.isUp
          ? `${nb.sun.altitude} ${formatDegrees(info.altitudeDeg)} · ${nb.sun.bearing} ${formatDegrees(info.bearingDeg)}`
          : nb.sun.belowHorizon}
        <br />
        {nb.sun.timezoneNote}
      </p>
    </div>
  );
}

export function Controls(props: { isPhone: boolean }) {
  const ui = useAppStore((s) => s.ui);
  const showPlan = ui.activeView !== '3d';
  const show3d = ui.activeView !== 'plan';
  const setStorey = (p: PlanStorey) => setUi({ planStorey: p, activeStoreyId: p });
  const open = !props.isPhone;

  return (
    <aside className="controls">
      <Panel title={nb.views.heading} defaultOpen>
        <Seg<ActiveView>
          label={nb.views.heading}
          value={ui.activeView}
          onChange={(v) => setUi({ activeView: v, activeViewChosen: true })}
          options={[
            { value: 'plan', label: nb.views.plan, title: nb.views.planTitle, testId: 'view-tab-plan' },
            { value: '3d', label: nb.views.threeD, title: nb.views.threeDTitle, testId: 'view-tab-3d' },
            { value: 'split', label: nb.views.split, title: nb.views.splitTitle, testId: 'view-tab-split' },
          ]}
        />
        {(showPlan || (show3d && ui.mode3d === 'inne')) && (
          <Seg<PlanStorey>
            label={nb.views.storey}
            value={ui.planStorey}
            onChange={setStorey}
            options={[
              { value: 'ground', label: nb.views.ground, title: nb.views.groundTitle, testId: 'plan-storey-ground' },
              { value: 'loft', label: nb.views.loft, title: nb.views.loftTitle, testId: 'plan-storey-loft' },
            ]}
          />
        )}
      </Panel>

      {show3d && (
        <Panel title={nb.mode3d.heading} defaultOpen>
          <Seg
            label={nb.mode3d.heading}
            value={ui.mode3d}
            onChange={(v) => setUi({ mode3d: v })}
            options={[
              { value: 'ute', label: nb.mode3d.ute, title: nb.mode3d.uteTitle, testId: 'mode-ute' },
              { value: 'inne', label: nb.mode3d.inne, hint: nb.mode3d.inneHint, title: nb.mode3d.inneTitle, testId: 'mode-inne' },
            ]}
          />
          {ui.mode3d === 'inne' && (
            <label className="field">
              <span>
                {nb.mode3d.cutHeight} ({nb.mode3d.cutHeightHint}) <span className="range-value">{formatLength(ui.cutHeight)}</span>
              </span>
              <input
                type="range"
                min={CUT_HEIGHT_MIN}
                max={CUT_HEIGHT_MAX}
                step={0.05}
                value={ui.cutHeight}
                onChange={(e) => setUi({ cutHeight: Number(e.target.value) })}
                data-testid="cut-height"
              />
            </label>
          )}
          <div className="presets" role="group" aria-label={nb.mode3d.presets}>
            {CAMERA_PRESET_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={ui.preset === key}
                data-testid={`preset-${key}`}
                title={nb.mode3d.presetTitles[key]}
                onClick={() => setUi(presetUi(key, ui))}
              >
                {nb.mode3d.presetNames[key]}
              </button>
            ))}
          </div>
        </Panel>
      )}

      <Panel title={nb.toggles.heading} defaultOpen={open}>
        <div className="toggles">
          <Toggle
            label={nb.toggles.labels}
            title={T.labels}
            checked={ui.showLabels}
            onChange={(v) => setUi({ showLabels: v })}
            testId="toggle-labels"
          />
          {showPlan && (
            <Toggle label={nb.toggles.dims} title={T.dims} checked={ui.showDims} onChange={(v) => setUi({ showDims: v })} testId="toggle-dims" />
          )}
          {showPlan && (
            <Toggle label={nb.toggles.grid} title={T.grid} checked={ui.showGrid} onChange={(v) => setUi({ showGrid: v })} testId="toggle-grid" />
          )}
          {showPlan && (
            <Toggle
              label={nb.toggles.roofPlan}
              title={T.roofPlan}
              checked={ui.showRoofPlan}
              onChange={(v) => setUi({ showRoofPlan: v })}
              testId="toggle-roof-plan"
            />
          )}
          <Toggle
            label={
              <>
                <span className="swatch-new" /> {nb.toggles.new}
              </>
            }
            title={T.new}
            checked={ui.highlightNew}
            onChange={(v) => setUi({ highlightNew: v })}
            testId="toggle-new"
          />
          {show3d && (
            <Toggle label={nb.toggles.trees} title={T.trees} checked={ui.showTrees} onChange={(v) => setUi({ showTrees: v })} testId="toggle-trees" />
          )}
          {show3d && (
            <Toggle
              label={nb.toggles.terrain}
              title={T.terrain}
              checked={ui.showTerrain}
              onChange={(v) => setUi({ showTerrain: v })}
              testId="toggle-terrain"
            />
          )}
        </div>
      </Panel>

      {show3d && (
        <Panel title={nb.sun.heading} defaultOpen={open}>
          <SunControls />
        </Panel>
      )}
    </aside>
  );
}

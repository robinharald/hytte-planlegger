/**
 * Left column: view tabs (Plan / 3D / Begge), storey tabs (Plan 1 / Hems — shown with the plan and for 3D
 * "Inne"), 3D mode + camera presets (shown with the 3D view), toggles and the sun study. The interior mode's wall
 * cut height is not a control: it follows the preset (`cutHeightFor`).
 * The storey tabs set both `planStorey` and `activeStoreyId` (the seed's storey ids are 'ground' and 'loft').
 * Picking a view tab marks the view as the user's choice (remembered in the UI prefs). Every control has a tooltip.
 * "Vis hva som er nytt" colours the plan (on by default); the 3D view has its own "Vis hva som er nytt i 3D" (off by
 * default, natural colours), each shown with its view.
 * The 3D panel ends with «Gå rundt» (a preset-like chip that starts / ends the walk mode, view3d/walkState.ts); a
 * camera preset or the Plan tab ends a walk. «Sol og skygge»: day presets (Midtsommer, Jevndøgn, Midtvinter, I dag;
 * view3d/sunPanel.ts), the date (and on a PC the time), the time slider with the day's daylight band and sunrise /
 * sunset ticks at the cabin («Sola er oppe hele døgnet» / «Sola er under horisonten» when it does not cross the
 * horizon), the sun's height and direction now, and the «Skygger» switch. Compact on a phone (one row of day
 * presets, no separate time field). Strings: `nb.walk`, `nb.sun`.
 * Phase 3 also adds «Avløp og sluk» to Vis (with the plan; ui/PlumbingToggle.tsx) and the «IFC-modell» panel after Vis
 * (ui/IfcPanel.tsx, closed until opened).
 */
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { nb } from '../i18n/nb';
import { appStore, useAppStore } from '../state/appStore';
import { CAMERA_PRESET_KEYS } from '../state/store';
import type { ActiveView, PlanStorey, UiState } from '../state/store';
import { Panel } from './common';
import { IfcPanel } from './IfcPanel';
import { PlumbingToggle } from './PlumbingToggle';
import { formatDegrees, minutesToTime, timeToMinutes } from './format';
import { useSun } from './hooks';
import { activeSunPreset, daylightStops, SLIDER_MAX, SUN_PRESET_KEYS, sunDay, sunPresetPatch, sunTicks } from '../view3d/sunPanel';
import type { SunPresetKey } from '../view3d/sunPanel';
import { requestPreset, setShadows, stopWalk, toggleWalk, useView3dLocal } from '../view3d/walkState';

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

const SUN_PRESET_LABELS: Record<SunPresetKey, { label: string; title: string }> = {
  midsummer: { label: nb.sun.midsummer, title: nb.sun.midsummerTitle },
  equinox: { label: nb.sun.equinox, title: nb.sun.equinoxTitle },
  midwinter: { label: nb.sun.midwinter, title: nb.sun.midwinterTitle },
  today: { label: nb.sun.today, title: nb.sun.todayTitle },
};

/** The daylight band under the time slider: inset by half a slider thumb (8 px) so it lines up with the thumb. */
const BAND_STYLE: CSSProperties = { position: 'relative', height: 6, margin: '-2px 8px 0', borderRadius: 3, background: 'var(--line)', overflow: 'hidden' };
const DAYLIGHT = '#e8b33a';
const TICK_ROW_STYLE: CSSProperties = { position: 'relative', height: 15, margin: '0 8px', fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' };

function SunControls(props: { compact: boolean }) {
  const sun = useAppStore((s) => s.ui.sun);
  const site = useAppStore((s) => s.project.site);
  const shadows = useView3dLocal((s) => s.shadows);
  const info = useSun();
  const setSun = (patch: Partial<UiState['sun']>) => setUi({ sun: { ...sun, ...patch } });
  const day = useMemo(() => sunDay(site, sun.date), [site, sun.date]);
  /** The date «I dag» set (it stays pressed while that date is chosen). */
  const [today, setToday] = useState<string | null>(null);
  const active = activeSunPreset(sun.date, today);
  const stops = daylightStops(day);
  const dayText = day.alwaysUp
    ? nb.sun.alwaysUp
    : day.alwaysDown
      ? nb.sun.alwaysDown
      : day.events.map((e) => `${e.kind === 'rise' ? nb.sun.sunrise : nb.sun.sunset} ${minutesToTime(e.minutes)}`).join(' · ');
  const ticks = sunTicks(day);
  const presetStyle: CSSProperties = props.compact
    ? { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4 }
    : { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' };
  const presetButtonStyle: CSSProperties | undefined = props.compact ? { fontSize: 12.5, padding: '6px 2px', textAlign: 'center' } : undefined;
  return (
    <div className="panel-body" data-compact={props.compact || undefined}>
      <div className="presets" role="group" aria-label={nb.sun.presets} style={presetStyle}>
        {SUN_PRESET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={active === key}
            data-testid={`sun-preset-${key}`}
            title={SUN_PRESET_LABELS[key].title}
            style={presetButtonStyle}
            onClick={() => {
              const patch = sunPresetPatch(key, sun, site, new Date());
              if (key === 'today') setToday(patch.date);
              setSun(patch);
            }}
          >
            {SUN_PRESET_LABELS[key].label}
          </button>
        ))}
      </div>
      <div className="field-row" style={props.compact ? { gridTemplateColumns: '1fr' } : undefined}>
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
        {!props.compact && (
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
        )}
      </div>
      <div className="field">
        <label htmlFor="sun-time-slider" style={{ color: 'var(--muted)' }}>
          {nb.sun.timeSlider} <span className="range-value">{minutesToTime(sun.minutes)}</span>
        </label>
        <input
          id="sun-time-slider"
          type="range"
          min={0}
          max={SLIDER_MAX}
          step={5}
          value={sun.minutes}
          onChange={(e) => setSun({ minutes: Number(e.target.value) })}
          data-testid="sun-time"
          list={day.events.length > 0 ? 'sun-time-ticks' : undefined}
        />
        {day.events.length > 0 && (
          <datalist id="sun-time-ticks">
            {day.events.map((e) => (
              <option key={`${e.kind}-${e.minutes}`} value={Math.min(SLIDER_MAX, Math.round(e.minutes / 5) * 5)} label={e.kind === 'rise' ? nb.sun.sunrise : nb.sun.sunset} />
            ))}
          </datalist>
        )}
        <div style={BAND_STYLE} role="img" aria-label={`${nb.sun.daylight}: ${dayText}`} data-testid="sun-daylight">
          {stops.map(([a, b]) => (
            <span key={a} style={{ position: 'absolute', top: 0, bottom: 0, left: `${a * 100}%`, width: `${(b - a) * 100}%`, background: DAYLIGHT }} />
          ))}
        </div>
        {ticks.length > 0 && (
          <div style={TICK_ROW_STYLE} aria-hidden="true">
            {ticks.map((t) => (
              <span
                key={`${t.kind}-${t.minutes}`}
                data-testid={`sun-tick-${t.kind}`}
                style={{ position: 'absolute', top: 0, left: `${t.f * 100}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap', borderLeft: t.label ? undefined : '1px solid var(--muted)', height: t.label ? undefined : 6 }}
              >
                {t.label ? `${t.kind === 'rise' ? '↑' : '↓'}${minutesToTime(t.minutes)}` : null}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="note" data-testid="sun-day">
        {dayText}
        {!day.alwaysDown && (
          <>
            <br />
            {info.isUp ? `${nb.sun.altitude} ${formatDegrees(info.altitudeDeg)} · ${nb.sun.bearing} ${formatDegrees(info.bearingDeg)}` : nb.sun.belowHorizon}
          </>
        )}
        <br />
        {nb.sun.timezoneNote}
      </p>
      <div className="toggles">
        <Toggle label={nb.sun.shadows} title={nb.sun.shadowsTitle} checked={shadows} onChange={setShadows} testId="toggle-shadows" />
      </div>
    </div>
  );
}

export function Controls(props: { isPhone: boolean }) {
  const ui = useAppStore((s) => s.ui);
  const showPlan = ui.activeView !== '3d';
  const show3d = ui.activeView !== 'plan';
  const setStorey = (p: PlanStorey) => setUi({ planStorey: p, activeStoreyId: p });
  const open = !props.isPhone;
  const walking = useView3dLocal((s) => s.walk !== null);
  /** A walk ended with Esc left the camera where the walker stood: no preset is shown pressed. */
  const viewKept = useView3dLocal((s) => s.viewKept);

  return (
    <aside className="controls">
      <Panel title={nb.views.heading} defaultOpen>
        <Seg<ActiveView>
          label={nb.views.heading}
          value={ui.activeView}
          onChange={(v) => {
            if (v === 'plan') stopWalk();
            setUi({ activeView: v, activeViewChosen: true });
          }}
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
          <div className="presets" role="group" aria-label={nb.mode3d.presets}>
            {CAMERA_PRESET_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={!walking && !viewKept && ui.preset === key}
                data-testid={`preset-${key}`}
                title={nb.mode3d.presetTitles[key]}
                onClick={() => {
                  // Every tap goes to the preset, also the one already chosen (after Esc kept a walk's view, or
                  // after orbiting away): walkState `requestPreset`.
                  stopWalk({ toPreset: true });
                  setUi({ preset: key });
                  requestPreset();
                }}
              >
                {nb.mode3d.presetNames[key]}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={walking}
              data-testid="preset-walk"
              title={walking ? nb.walk.exitTitle : nb.walk.startTitle}
              style={{ gridColumn: '1 / -1' }}
              onClick={toggleWalk}
            >
              {walking ? nb.walk.exit : nb.walk.start}
            </button>
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
          {showPlan && (
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
          )}
          {showPlan && (
            <Toggle
              label={nb.toggles.clearances}
              title={T.clearances}
              checked={ui.showClearances}
              onChange={(v) => setUi({ showClearances: v })}
              testId="toggle-clearances"
            />
          )}
          {showPlan && <PlumbingToggle />}
          {show3d && (
            <Toggle
              label={
                <>
                  <span className="swatch-new" /> {nb.toggles.new3d}
                </>
              }
              title={T.new3d}
              checked={ui.highlightNew3d}
              onChange={(v) => setUi({ highlightNew3d: v })}
              testId="toggle-new-3d"
            />
          )}
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

      <IfcPanel defaultOpen={false} />

      {show3d && (
        <Panel title={nb.sun.heading} defaultOpen={open}>
          <SunControls compact={props.isPhone} />
        </Panel>
      )}
    </aside>
  );
}

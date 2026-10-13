/**
 * The body of «IFC-modell» (ui/IfcPanel.tsx loads this module when the panel is first opened; brief §4 «optional
 * layer», src/ifc): loads the architect's IFC file
 * from this device and controls the overlay — «Last inn IFC-fil», «Vis i planen», «Vis i 3D» (with the groups Vegger,
 * dører og vinduer / Tak / Dekker), Synlighet, «Juster plassering» (1 cm steps, ±10 cm, «Nullstill»), «Bytt fil» and
 * «Fjern». The file never leaves the device; the parsed model is cached in IndexedDB (src/ifc/cache.ts), so it comes
 * back after a reload. The picker has no `accept` filter: iOS greys out files whose type it does not know (.ifc); the
 * loader checks the file's STEP header instead.
 *
 * Mounted after the «Vis» panel in Controls.tsx (closed until opened). Strings: `nb.ifc`.
 */
import { useRef } from 'react';
import { nb } from '../i18n/nb';
import type { ChangeEvent, ReactNode } from 'react';
import { ifcOverlay, OPACITY_MAX, OPACITY_MIN, useIfcOverlay } from '../ifc/store';
import { NUDGE_MAX } from '../ifc/transform';

const S = nb.ifc;

function Toggle(props: { label: ReactNode; title?: string; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label title={props.title}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} data-testid={props.testId} />
      <span>{props.label}</span>
    </label>
  );
}

const EPS = 1e-9;

export function IfcPanelBody() {
  const status = useIfcOverlay((s) => s.status);
  const error = useIfcOverlay((s) => s.error);
  const model = useIfcOverlay((s) => s.model);
  const prefs = useIfcOverlay((s) => s.prefs);
  const input = useRef<HTMLInputElement>(null);

  const busy = status === 'loading' || status === 'restoring';
  const pick = () => input.current?.click();
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void ifcOverlay.loadFile(file);
  };
  const { dx, dy } = prefs.nudge;

  return (
    <>
      <input ref={input} type="file" hidden onChange={onFile} data-testid="ifc-file-input" />
      {!model && <p className="note">{S.intro}</p>}
      {busy && (
        <p className="note" role="status" data-testid="ifc-status">
          {status === 'loading' ? S.loading : S.restoring}
        </p>
      )}
      {error && (
        <p className="note" role="alert" style={{ color: 'var(--danger)' }} data-testid="ifc-error">
          {error}
        </p>
      )}
      {!model ? (
        <div className="toolgroup">
          <button type="button" className="btn btn-primary" onClick={pick} disabled={busy} title={S.loadTitle} data-testid="ifc-load">
            {S.load}
          </button>
        </div>
      ) : (
        <>
          <p className="note" style={{ overflowWrap: 'anywhere' }} data-testid="ifc-file">
            {S.fileInfo(model.fileName, model.fileSize)}
          </p>
          <div className="toggles">
            <Toggle label={S.showPlan} title={S.showPlanTitle} checked={prefs.showPlan} onChange={(v) => ifcOverlay.setPrefs({ showPlan: v })} testId="ifc-show-plan" />
            <Toggle label={S.show3d} title={S.show3dTitle} checked={prefs.show3d} onChange={(v) => ifcOverlay.setPrefs({ show3d: v })} testId="ifc-show-3d" />
            {prefs.show3d && (
              <div className="toggles" style={{ paddingLeft: 24 }}>
                <Toggle label={S.walls3d} checked={prefs.walls3d} onChange={(v) => ifcOverlay.setPrefs({ walls3d: v })} testId="ifc-walls-3d" />
                <Toggle label={S.roof3d} checked={prefs.roof3d} onChange={(v) => ifcOverlay.setPrefs({ roof3d: v })} testId="ifc-roof-3d" />
                <Toggle label={S.slabs3d} checked={prefs.slabs3d} onChange={(v) => ifcOverlay.setPrefs({ slabs3d: v })} testId="ifc-slabs-3d" />
              </div>
            )}
          </div>
          <label className="field">
            <span>
              {S.opacity} <span className="range-value">{S.percent(prefs.opacity)}</span>
            </span>
            <input
              type="range"
              min={OPACITY_MIN}
              max={OPACITY_MAX}
              step={0.05}
              value={prefs.opacity}
              onChange={(e) => ifcOverlay.setPrefs({ opacity: Number(e.target.value) })}
              data-testid="ifc-opacity"
            />
          </label>
          <div className="field" title={S.nudgeTitle}>
            <span>
              {S.nudge}{' '}
              <span className="range-value" data-testid="ifc-nudge-value">
                {S.nudgeOffset(dx, dy)}
              </span>
            </span>
            <div className="toolgroup" role="group" aria-label={S.nudge}>
              <button type="button" className="btn" aria-label={S.nudgeLeft} title={S.nudgeLeft} disabled={dx <= -NUDGE_MAX + EPS} onClick={() => ifcOverlay.nudge(-1, 0)} data-testid="ifc-nudge-left">
                ←
              </button>
              <button type="button" className="btn" aria-label={S.nudgeRight} title={S.nudgeRight} disabled={dx >= NUDGE_MAX - EPS} onClick={() => ifcOverlay.nudge(1, 0)} data-testid="ifc-nudge-right">
                →
              </button>
              <button type="button" className="btn" aria-label={S.nudgeUp} title={S.nudgeUp} disabled={dy >= NUDGE_MAX - EPS} onClick={() => ifcOverlay.nudge(0, 1)} data-testid="ifc-nudge-up">
                ↑
              </button>
              <button type="button" className="btn" aria-label={S.nudgeDown} title={S.nudgeDown} disabled={dy <= -NUDGE_MAX + EPS} onClick={() => ifcOverlay.nudge(0, -1)} data-testid="ifc-nudge-down">
                ↓
              </button>
              <button type="button" className="btn btn-ghost" title={S.nudgeResetTitle} disabled={dx === 0 && dy === 0} onClick={() => ifcOverlay.resetNudge()} data-testid="ifc-nudge-reset">
                {S.nudgeReset}
              </button>
            </div>
          </div>
          <div className="toolgroup">
            <button type="button" className="btn" onClick={pick} disabled={busy} title={S.replaceTitle} data-testid="ifc-replace">
              {S.replace}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void ifcOverlay.remove()} title={S.removeTitle} data-testid="ifc-remove">
              {S.remove}
            </button>
          </div>
        </>
      )}
    </>
  );
}

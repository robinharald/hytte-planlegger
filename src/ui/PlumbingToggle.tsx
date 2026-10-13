/**
 * The Vis toggle «Avløp og sluk» (the original brief §5) and, while it is on, the drainage helper's lines under it
 * (ui/plumbingInfo.ts `plumbingInfoLines`): «WC og Hovedbad: toalettene står rygg mot rygg på veggen ved x 18,6 –
 * det er fint.», a line per fixture that is too far (a tap selects it in the plan), today's drains, a note on the
 * stacks, and «Legg til avløpsstamme» in a proposal that can be edited (a new stack on the shown storey, by the
 * fixtures that are too far). Mounted in the Vis list (Controls.tsx, with the plan).
 * The toggle is a per-device preference (state/plumbingActions.ts `setPlumbingVisible`).
 */
import { isLocked } from '../geometry/edit';
import { appStore, useAppStore } from '../state/appStore';
import { addDrainStack, setPlumbingVisible, usePlumbingAnalysis, usePlumbingVisible } from '../state/plumbingActions';
import { selectActiveVariant } from '../state/store';
import { nb } from '../i18n/nb';
import { plumbingInfoLines } from './plumbingInfo';
import type { PlumbingInfoLine } from './plumbingInfo';
import { planStoreyOf } from './schedule';

const S = nb.plumbing;

function selectFixture(line: PlumbingInfoLine, storeyId: string | undefined): void {
  if (!line.furnitureId) return;
  const selection = { kind: 'furniture' as const, id: line.furnitureId, levelId: line.levelId };
  appStore.getState().setUi(storeyId ? { selection, planStorey: planStoreyOf(storeyId), activeStoreyId: storeyId } : { selection });
}

function PlumbingInfo() {
  const analysis = usePlumbingAnalysis();
  const editable = useAppStore((s) => !s.ui.readOnly && !isLocked(selectActiveVariant(s)));
  const planStorey = useAppStore((s) => s.ui.planStorey);
  const lines = plumbingInfoLines(analysis, { editable });
  const storeyOf = (id?: string) => analysis.fixtures.find((f) => f.id === id)?.storeyId;
  const far = lines.filter((l) => l.tone === 'far');
  const rest = lines.filter((l) => l.tone !== 'far');
  return (
    <div className="plumbing-info" data-testid="plumbing-info" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 24 }}>
      {far.length > 0 && (
        <ul className="warnings" data-testid="plumbing-far">
          {far.map((l) => (
            <li key={l.key}>
              <button type="button" onClick={() => selectFixture(l, storeyOf(l.furnitureId))}>
                {l.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {rest.map((l) => (
        <p key={l.key} className="note" data-tone={l.tone} style={{ margin: 0, color: l.tone === 'ok' ? 'var(--fg)' : undefined }}>
          {l.text}
        </p>
      ))}
      {editable && (
        <div className="toolgroup">
          <button type="button" className="btn btn-small" title={S.addStackTitle} data-testid="plumbing-add-stack" onClick={() => void addDrainStack(appStore, planStorey)}>
            {S.addStack}
          </button>
        </div>
      )}
    </div>
  );
}

export function PlumbingToggle() {
  const visible = usePlumbingVisible();
  return (
    <>
      <label title={S.toggleTitle}>
        <input type="checkbox" checked={visible} onChange={(e) => setPlumbingVisible(e.target.checked)} data-testid="toggle-plumbing" />
        <span>{S.toggle}</span>
      </label>
      {visible && <PlumbingInfo />}
    </>
  );
}

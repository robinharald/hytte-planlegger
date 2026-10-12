/**
 * Hint line under the toolbar (docs/phase2-plan.md §3.2): the plan's tool-specific text while a tool is in progress
 * (`ui.hint`, e.g. "Klikk der den skal slutte (Esc avbryter)"), else the active tool's default text. On the locked
 * base proposal with Velg active it says so and offers "Nytt forslag" (rule 1: "Nytt forslag" primary). Hidden
 * while read-only (shared link).
 */
import { nb } from '../i18n/nb';
import { useAppStore } from '../state/appStore';
import { createNewProposal, useActiveVariantLocked, useHint, useTool } from './editorBridge';
import { hintFor } from './hints';

export function HintLine() {
  const tool = useTool();
  const hint = useHint();
  const locked = useActiveVariantLocked();
  const readOnly = useAppStore((s) => s.ui.readOnly);
  if (readOnly) return null;
  const showLocked = locked && tool === 'select' && !hint;
  return (
    <div className="hint-line" role="status" aria-live="polite" aria-label={nb.hints.label} data-testid="hint-line" data-locked={showLocked || undefined}>
      <span className="hint-text">{showLocked ? nb.hints.locked : (hint ?? hintFor(tool))}</span>
      {showLocked && (
        <button type="button" className="btn btn-primary btn-small" onClick={() => createNewProposal()} title={nb.proposals.newProposalTitle} data-testid="hint-new-proposal">
          {nb.proposals.newProposal}
        </button>
      )}
    </div>
  );
}

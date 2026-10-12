/**
 * First-run card (docs/phase2-plan.md §5): three short bullets the first time the app is opened in this browser,
 * over the bottom of the stage; "Skjønner" hides it for good, and so does making a proposal (firstRun.ts). Not shown
 * for a shared (read-only) view. The toasts keep clear of it while it is open (Toasts.tsx).
 *
 * The third bullet is true for the running mode (state/appStore.ts `familyMode`): shared — "Alt lagres automatisk i
 * familiens delte plass …"; local only — "Alt lagres automatisk på denne enheten. Trykk «Send forslaget» for å dele …".
 * Once the card is closed, the same place shows the home-screen card (InstallCard.tsx) where it applies.
 */
import { nb } from '../i18n/nb';
import { familyMode, useAppStore } from '../state/appStore';
import { dismissFirstRun, FIRST_RUN_KEY, useFirstRunOpen } from './firstRun';
import { InstallCard } from './InstallCard';

export { FIRST_RUN_KEY };

export function FirstRunCard() {
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const open = useFirstRunOpen();
  if (readOnly) return null;
  if (!open) return <InstallCard />;
  const f = nb.firstRun;
  return (
    <section className="first-run" aria-label={f.label} data-testid="first-run">
      <h2>{f.heading}</h2>
      <ul>
        {[...f.items, f.saved[familyMode]].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="first-run-actions">
        <button type="button" className="btn btn-primary btn-small" data-testid="first-run-ok" onClick={dismissFirstRun}>
          {f.ok}
        </button>
      </div>
    </section>
  );
}

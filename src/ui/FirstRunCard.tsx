/**
 * First-run card (docs/phase2-plan.md §5): three short bullets the first time the app is opened in this browser,
 * over the bottom of the stage; "Skjønner" hides it for good (`hytte-planlegger:first-run-seen` in localStorage;
 * without storage it simply shows again next time). Not shown for a shared (read-only) link.
 */
import { useState } from 'react';
import { nb } from '../i18n/nb';
import { storage, useAppStore } from '../state/appStore';
import { readRaw, writeRaw } from '../state/persistence';

export const FIRST_RUN_KEY = 'hytte-planlegger:first-run-seen';

export function FirstRunCard() {
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const [open, setOpen] = useState(() => readRaw(storage, FIRST_RUN_KEY) === null);
  if (!open || readOnly) return null;
  const f = nb.firstRun;
  return (
    <section className="first-run" aria-label={f.label} data-testid="first-run">
      <h2>{f.heading}</h2>
      <ul>
        {f.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="first-run-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          data-testid="first-run-ok"
          onClick={() => {
            writeRaw(storage, FIRST_RUN_KEY, new Date().toISOString());
            setOpen(false);
          }}
        >
          {f.ok}
        </button>
      </div>
    </section>
  );
}

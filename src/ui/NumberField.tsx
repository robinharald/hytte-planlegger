/**
 * Number field of the Egenskaper editors (docs/phase2-plan.md §3.7): accepts "2,4" / "2,40" / "2.40", shows the unit
 * ("m" by default) and two decimals, `inputmode="decimal"`, −/+ buttons (10 cm by default), values above `max`
 * (30 m by default) or below `min` are rejected with a short message and the old value comes back.
 *
 * Commit rules: Enter, Tab and blur commit (only when the value changed in the field's precision); Esc restores the
 * model value and is swallowed (preventDefault), so the app's Esc does not also clear the selection. While typing,
 * the field shows the draft; any other time it shows the model value, so a refused or no-op action simply shows
 * the old value again.
 *
 * `locked` (the base proposal): the field is read-only; typing in it or pressing −/+ calls `onLocked` (the
 * "Nytt forslag" toast). `readOnly` without `locked`: plain read-only value (e.g. "Endres under bygningsdelen").
 */
import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { nb } from '../i18n/nb';
import { acceptNumber, differs, formatField, MAX_LENGTH, stepValue } from './numberInput';
import type { NumberRule } from './numberInput';

export interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  /** Unit shown after the number. Default 'm'. */
  unit?: string;
  decimals?: number;
  min?: number;
  max?: number;
  /** Step of the −/+ buttons (default 0.1 = 10 cm) and its label ("10 cm"). */
  step?: number;
  stepLabel?: string;
  /** No −/+ buttons. */
  noStepper?: boolean;
  readOnly?: boolean;
  locked?: boolean;
  onLocked?: () => void;
  note?: ReactNode;
  title?: string;
  testId?: string;
}

/** Limits in the error message: "30", "0,8". */
function formatLimit(v: number): string {
  return formatField(v, Number.isInteger(v) ? 0 : Math.round(v * 10) === v * 10 ? 1 : 2);
}

/** Keys that try to change a locked field's text. */
function isEditingKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete';
}

export function NumberField(props: NumberFieldProps) {
  const id = useId();
  const decimals = props.decimals ?? 2;
  const rule: NumberRule = { min: props.min ?? 0, max: props.max ?? MAX_LENGTH, decimals };
  const unit = props.unit ?? 'm';
  const step = props.step ?? 0.1;
  const stepLabel = props.stepLabel ?? '10 cm';
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const frozen = props.readOnly || props.locked;

  const commitValue = (v: number) => {
    if (differs(v, props.value, decimals)) props.onCommit(v);
  };

  const commitDraft = () => {
    if (draft === null) return;
    const v = acceptNumber(draft, rule);
    setDraft(null);
    if (v === null) {
      setError(true);
      return;
    }
    setError(false);
    commitValue(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (props.locked) {
      if (isEditingKey(e)) {
        e.preventDefault();
        props.onLocked?.();
      }
      return;
    }
    if (props.readOnly) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Tab') {
      commitDraft();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(null);
      setError(false);
    }
  };

  const stepBy = (delta: number) => {
    if (props.locked) {
      props.onLocked?.();
      return;
    }
    setError(false);
    setDraft(null);
    commitValue(stepValue(props.value, delta, rule));
  };

  const shown = draft ?? formatField(props.value, decimals);

  return (
    <div className="nf" data-testid={props.testId} data-locked={props.locked || undefined}>
      <label className="nf-label" htmlFor={id} title={props.title}>
        {props.label}
      </label>
      <div className="nf-row">
        {!props.readOnly && !props.noStepper && (
          <button
            type="button"
            className="nf-step"
            aria-label={nb.numberField.decrease(stepLabel)}
            title={nb.numberField.decrease(stepLabel)}
            onClick={() => stepBy(-step)}
          >
            −
          </button>
        )}
        <span className="nf-box">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            spellCheck={false}
            className="nf-input"
            value={shown}
            readOnly={frozen}
            aria-invalid={error || undefined}
            onFocus={(e) => {
              if (frozen) return;
              setDraft(formatField(props.value, decimals));
              e.currentTarget.select();
            }}
            onChange={(e) => {
              if (frozen) return;
              setDraft(e.target.value);
              setError(false);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (!frozen) commitDraft();
            }}
          />
          <span className="nf-unit" aria-hidden="true">
            {unit}
          </span>
        </span>
        {!props.readOnly && !props.noStepper && (
          <button
            type="button"
            className="nf-step"
            aria-label={nb.numberField.increase(stepLabel)}
            title={nb.numberField.increase(stepLabel)}
            onClick={() => stepBy(step)}
          >
            +
          </button>
        )}
      </div>
      {error && (
        <p className="nf-error" role="alert">
          {nb.numberField.invalid(`${formatLimit(rule.min)} ${unit}`, `${formatLimit(rule.max)} ${unit}`)}
        </p>
      )}
      {props.note && <p className="note">{props.note}</p>}
    </div>
  );
}

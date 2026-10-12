/**
 * Building blocks of the Egenskaper editors: the editor environment (context), text / select / check fields that
 * follow the NumberField commit rules (Enter / blur commit, Esc restores and is swallowed), action buttons, the
 * "Mer" section and read-only rows.
 *
 * Locked base proposal: fields are read-only and every attempt to change something (typing, picking, ticking,
 * pressing an action button) calls `env.onLocked()` (the refusal toast with "Nytt forslag") instead of an action.
 * Read-only (shared link): fields are read-only, action buttons are not shown.
 */
import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { nb } from '../../i18n/nb';
import { useEditorEnv, useRun } from './env';

/** Keys that try to change a locked field's text. */
function isEditingKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter';
}

export function TextField(props: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** Empty text is not committed (names). */
  required?: boolean;
  testId?: string;
}) {
  const env = useEditorEnv();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const frozen = env.locked || env.readOnly;

  const commit = () => {
    if (draft === null) return;
    const text = props.multiline ? draft : draft.trim();
    setDraft(null);
    if (props.required && !text) return;
    if (text !== props.value) props.onCommit(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (frozen) {
      if (env.locked && isEditingKey(e)) {
        e.preventDefault();
        env.onLocked();
      }
      return;
    }
    if (e.key === 'Enter' && (!props.multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(null);
    }
  };

  const common = {
    id,
    value: draft ?? props.value,
    placeholder: props.placeholder,
    readOnly: frozen,
    className: 'text-input',
    onChange: (e: { target: { value: string } }) => {
      if (!frozen) setDraft(e.target.value);
    },
    onKeyDown,
    onBlur: commit,
  };

  return (
    <div className="ef" data-testid={props.testId}>
      <label className="nf-label" htmlFor={id}>
        {props.label}
      </label>
      {props.multiline ? <textarea rows={3} {...common} /> : <input type="text" autoComplete="off" {...common} />}
    </div>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  testId?: string;
}) {
  const env = useEditorEnv();
  const id = useId();
  const frozen = env.locked || env.readOnly;
  const refuse = (e: { preventDefault: () => void }) => {
    if (!frozen) return;
    e.preventDefault();
    if (env.locked) env.onLocked();
  };
  return (
    <div className="ef" data-testid={props.testId}>
      <label className="nf-label" htmlFor={id}>
        {props.label}
      </label>
      <select
        id={id}
        className="text-input"
        value={props.value}
        aria-readonly={frozen || undefined}
        onMouseDown={refuse}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') refuse(e);
        }}
        onChange={(e) => {
          if (frozen) {
            if (env.locked) env.onLocked();
            return;
          }
          props.onChange(e.target.value as T);
        }}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckField(props: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string; testId?: string; disabled?: boolean }) {
  const env = useEditorEnv();
  const frozen = env.locked || env.readOnly;
  return (
    <label className="check ef-check" title={props.title}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        data-testid={props.testId}
        onClick={(e) => {
          if (!frozen) return;
          e.preventDefault();
          if (env.locked) env.onLocked();
        }}
        onChange={(e) => {
          if (!frozen) props.onChange(e.target.checked);
        }}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** Small segmented choice (e.g. "Flytt: venstre / høyre vegg"). */
export function Choice<T extends string>(props: { label: string; value: T; options: SelectOption<T>[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="choice" role="group" aria-label={props.label} data-testid={props.testId}>
      <span className="choice-label">{props.label}</span>
      <div className="seg seg-small">
        {props.options.map((o) => (
          <button key={o.value} type="button" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ActionSpec {
  key: string;
  label: string;
  title?: string;
  onClick: () => void;
  danger?: boolean;
  primary?: boolean;
  testId?: string;
  /** Runs even on the locked base proposal (navigation, e.g. "Velg bygningsdelen"). */
  safe?: boolean;
}

/** Action buttons of an editor. Hidden while read-only; on the locked base proposal they show the refusal toast. */
export function Actions(props: { actions: (ActionSpec | null | false)[] }) {
  const env = useEditorEnv();
  const run = useRun();
  const list = props.actions.filter((a): a is ActionSpec => !!a);
  if (list.length === 0) return null;
  const shown = env.readOnly ? list.filter((a) => a.safe) : list;
  if (shown.length === 0) return null;
  return (
    <div className="toolgroup editor-actions">
      {shown.map((a) => (
        <button
          key={a.key}
          type="button"
          className={`btn btn-small${a.danger ? ' btn-danger' : ''}${a.primary ? ' btn-primary' : ''}`}
          title={a.title}
          data-testid={a.testId}
          aria-disabled={(env.locked && !a.safe) || undefined}
          onClick={() => (a.safe ? a.onClick() : run(a.onClick))}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** The "Mer" part of an editor (docs/phase2-plan.md §3.7 basic | Mer). */
export function More(props: { children: ReactNode; testId?: string }) {
  return (
    <details className="more" data-testid={props.testId}>
      <summary>{nb.edit.more}</summary>
      <div className="more-body">{props.children}</div>
    </details>
  );
}

/** Read-only label / value rows. */
export function InfoRows(props: { rows: ([string, ReactNode] | null | false)[] }) {
  const rows = props.rows.filter((r): r is [string, ReactNode] => !!r);
  if (rows.length === 0) return null;
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Fields side by side where the column is wide enough. */
export function FieldGrid(props: { children: ReactNode }) {
  return <div className="editor-grid">{props.children}</div>;
}

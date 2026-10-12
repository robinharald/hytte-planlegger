/**
 * The environment of the Egenskaper editors (derived model, stored variant, edit actions, lock state, callbacks),
 * provided once by PropertiesEditor so the per-kind editors need no prop drilling.
 */
import { createContext, useContext } from 'react';
import type { DerivedVariant } from '../../model/derived';
import type { Variant } from '../../model/types';
import type { Selection } from '../../state/selection';
import type { ToolKind, UiEditActions } from '../editorBridge';
import type { PanelHighlight } from '../overlay';
import type { UiResolved } from '../uiSelection';

export interface EditorEnv {
  derived: DerivedVariant;
  variant: Variant;
  actions: UiEditActions;
  /** The base proposal: nothing can be changed (attempts call onLocked). */
  locked: boolean;
  /** Shared link: nothing can be changed, no action buttons. */
  readOnly: boolean;
  onLocked: () => void;
  onHighlight: (h: PanelHighlight | null) => void;
  onSelect: (sel: Selection | null) => void;
  onTool: (tool: ToolKind) => void;
  /** Delete what is selected (commands.ts deleteResolved: toast «Slettet. [Angre]», selection handling). */
  onDelete: (resolved: UiResolved) => void;
}

export const EditorEnvContext = createContext<EditorEnv | null>(null);

export function useEditorEnv(): EditorEnv {
  const env = useContext(EditorEnvContext);
  if (!env) throw new Error('EditorEnvContext missing');
  return env;
}

/** Run an edit unless locked / read-only (locked → the refusal toast). */
export function useRun(): (fn: () => void) => void {
  const env = useEditorEnv();
  return (fn) => {
    if (env.readOnly) return;
    if (env.locked) {
      env.onLocked();
      return;
    }
    fn();
  };
}


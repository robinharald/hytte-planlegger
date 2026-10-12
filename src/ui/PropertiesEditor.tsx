/**
 * Egenskaper (docs/phase2-plan.md §3.7): a header (kind, name, status text "Hytta i dag" / "Nytt" / "Fjernet"),
 * then the editor of the selected kind with its basic fields, action buttons and a "Mer" section.
 *
 * Prop-driven (only two informational toasts reach the store) so it renders with the real seed in tests and in both
 * the side column and the phone bottom sheet; `PropertiesPanel` connects it to the app.
 *
 *  - Nothing selected: a hint and the proposal's notes ("Merknader til forslaget" → `setVariantNotes`).
 *  - The locked base proposal: a notice with a primary "Nytt forslag" button; the editors show the values read-only
 *    and every attempt to change them calls `onLocked` (the refusal toast).
 *  - Read-only (shared link): values only, no action buttons.
 *  - Kinds without an editor (structure) show the read-only rows of `describeSelection`.
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { nb } from '../i18n/nb';
import type { DerivedVariant } from '../model/derived';
import type { ElementStatus, Variant } from '../model/types';
import type { Selection } from '../state/selection';
import type { ToolKind, UiEditActions } from './editorBridge';
import { BlockEditor, BlockVertexEditor } from './editors/BlockEditor';
import { EditorEnvContext } from './editors/env';
import type { EditorEnv } from './editors/env';
import { InfoRows, TextField } from './editors/fields';
import { FurnitureProps } from './properties/FurnitureProps';
import { GhostEditor } from './editors/GhostEditor';
import { furnitureName, ghostKindLabel } from './editors/helpers';
import { OpeningEditor } from './editors/OpeningEditor';
import { DeckEdgeEditor, DeckEditor, DeckVertexEditor, HotTubEditor, RailingEditor, StepsEditor, TreeEditor } from './editors/OutdoorEditors';
import { RoomEditor } from './editors/RoomEditor';
import { ExteriorWallEditor, StoredWallEditor } from './editors/WallEditor';
import { IconClose } from './common';
import type { PanelHighlight } from './overlay';
import { describeSelection, wallTitle } from './properties';
import { resolveUiSelection } from './uiSelection';
import type { UiResolved } from './uiSelection';
import { SPLIT_MIN_AREA } from './schedule';

export interface PropertiesEditorProps {
  derived: DerivedVariant;
  variant: Variant;
  selection: Selection | null;
  actions: UiEditActions;
  locked: boolean;
  readOnly: boolean;
  onLocked: () => void;
  onNewProposal: () => void;
  onHighlight: (h: PanelHighlight | null) => void;
  onSelect: (sel: Selection | null) => void;
  onTool: (tool: ToolKind) => void;
  onDelete: (resolved: UiResolved) => void;
  /** No × (clear the selection) in the header: the phone sheet has its own close button. */
  hideClear?: boolean;
}

type StatusTone = 'existing' | 'new' | 'removed' | 'mixed';

function statusOf(r: UiResolved): StatusTone | null {
  const flag = (isNew: boolean): StatusTone => (isNew ? 'new' : 'existing');
  const st = (s: ElementStatus): StatusTone => s;
  switch (r.kind) {
    case 'room':
      return r.room.areaExisting >= SPLIT_MIN_AREA && r.room.areaNew >= SPLIT_MIN_AREA ? 'mixed' : flag(r.room.isNew);
    case 'wall':
      return st(r.wall.status);
    case 'opening':
      return st(r.opening.status);
    case 'block':
    case 'blockEdge':
    case 'blockVertex':
      return flag(r.block.block.isNew);
    case 'deck':
    case 'deckEdge':
    case 'deckVertex':
      return flag(r.deck.isNew);
    case 'railing':
      return flag(r.railing.isNew);
    case 'steps':
      return r.deck ? flag(r.deck.isNew) : null;
    case 'hotTub':
      return flag(r.hotTub.isNew);
    case 'structure':
      return flag(r.structure.isNew);
    case 'furniture':
      return flag(r.furniture.isNew);
    case 'ghost':
      return 'removed';
    default:
      return null;
  }
}

function statusText(t: StatusTone): string {
  return t === 'mixed' ? `${nb.status.existing} + ${nb.status.new.toLowerCase()}` : nb.status[t];
}

function titleOf(r: UiResolved, derived: DerivedVariant, variant: Variant): string {
  switch (r.kind) {
    case 'room':
      return r.room.room?.name?.trim() || nb.edit.room.unnamed;
    case 'wall':
      return wallTitle(derived, r.wall, new Map(variant.walls.map((w) => [w.id, w.kind])));
    case 'furniture':
      return furnitureName(r.furniture);
    case 'ghost':
      return ghostKindLabel(r.ghost);
    default:
      return describeSelection(r, derived).title;
  }
}

function EditorBody(props: { r: UiResolved; derived: DerivedVariant }) {
  const { r, derived } = props;
  switch (r.kind) {
    case 'room':
      return <RoomEditor room={r.room} />;
    case 'wall': {
      const w = r.wall;
      if (w.source.kind === 'wall') return <StoredWallEditor wall={w} />;
      const src = w.source;
      const block = derived.blocks.find((b) => b.block.id === src.blockId) ?? null;
      return <ExteriorWallEditor block={block} length={Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])} thickness={block?.block.wall.thickness ?? w.thickness} />;
    }
    case 'blockEdge':
      return <ExteriorWallEditor block={r.block} length={r.edge.length} thickness={r.block.block.wall.thickness} />;
    case 'opening':
      return <OpeningEditor opening={r.opening} wall={r.wall} />;
    case 'block':
      return <BlockEditor block={r.block} />;
    case 'blockVertex':
      return <BlockVertexEditor block={r.block} vertex={r.vertex} />;
    case 'deck':
      return <DeckEditor deck={r.deck} />;
    case 'deckVertex':
      return <DeckVertexEditor deck={r.deck} vertexId={r.vertexId} p={r.p} />;
    case 'deckEdge':
      return <DeckEdgeEditor deck={r.deck} edgeId={r.edgeId} a={r.a} b={r.b} />;
    case 'railing':
      return <RailingEditor deckId={r.railing.deckId} />;
    case 'steps':
      return <StepsEditor steps={r.steps} deck={r.deck} />;
    case 'hotTub':
      return <HotTubEditor hotTub={r.hotTub} />;
    case 'tree':
      return <TreeEditor tree={r.tree} baseZ={r.baseZ} />;
    case 'furniture':
      return <FurnitureProps furniture={r.furniture} />;
    case 'ghost':
      return <GhostEditor ghost={r.ghost} />;
    case 'structure': {
      const d = describeSelection(r, derived);
      return (
        <>
          <InfoRows rows={d.rows} />
          <p className="note">{nb.edit.structureNote}</p>
        </>
      );
    }
    default:
      return null;
  }
}

/** A stable key per selected element, so editor state (drafts, the size-field side) resets on a new selection. */
function keyOf(r: UiResolved, sel: Selection): string {
  return `${r.kind}:${sel.id}:${sel.levelId ?? ''}`;
}

export function PropertiesEditor(props: PropertiesEditorProps) {
  const { derived, variant, selection } = props;
  const resolved = useMemo(() => resolveUiSelection(derived, selection), [derived, selection]);
  const env: EditorEnv = useMemo(
    () => ({
      derived,
      variant,
      actions: props.actions,
      locked: props.locked,
      readOnly: props.readOnly,
      onLocked: props.onLocked,
      onHighlight: props.onHighlight,
      onSelect: props.onSelect,
      onTool: props.onTool,
      onDelete: props.onDelete,
    }),
    [derived, variant, props.actions, props.locked, props.readOnly, props.onLocked, props.onHighlight, props.onSelect, props.onTool, props.onDelete],
  );

  let body: ReactNode;
  if (!selection) {
    body = (
      <>
        <p className="muted">{nb.properties.none}</p>
        <TextField
          label={nb.edit.noneNotes}
          value={variant.notes ?? ''}
          placeholder={nb.edit.noneNotesPlaceholder}
          multiline
          onCommit={(notes) => {
            if (props.locked) props.onLocked();
            else if (!props.readOnly) props.actions.setVariantNotes(notes);
          }}
          testId="variant-notes"
        />
      </>
    );
  } else if (!resolved) {
    body = <p className="muted">{nb.properties.dangling}</p>;
  } else {
    const status = statusOf(resolved);
    body = (
      <div className="editor" key={keyOf(resolved, selection)} data-kind={resolved.kind}>
        <div className="editor-head">
          <div className="editor-title">
            <span className="tag">{nb.selectionKinds[resolved.kind] ?? resolved.kind}</span>{' '}
            <strong data-testid="properties-title">{titleOf(resolved, derived, variant)}</strong>{' '}
            {status && (
              <span className={`tag status-tag status-${status}`} data-testid="properties-status">
                {statusText(status)}
              </span>
            )}
          </div>
          {!props.hideClear && (
            <button type="button" className="btn btn-ghost btn-small icon-btn" onClick={() => props.onSelect(null)} title={nb.edit.clearTitle} aria-label={nb.properties.clear}>
              <IconClose />
            </button>
          )}
        </div>
        <EditorBody r={resolved} derived={derived} />
      </div>
    );
  }

  return (
    <EditorEnvContext.Provider value={env}>
      {props.locked && (
        <div className="locked-notice" data-testid="locked-notice">
          <p>{nb.edit.lockedNotice}</p>
          <button type="button" className="btn btn-primary btn-small" onClick={props.onNewProposal} title={nb.proposals.newProposalTitle} data-testid="locked-new-proposal">
            {nb.proposals.newProposal}
          </button>
        </div>
      )}
      {props.readOnly && <p className="note">{nb.edit.readOnlyNote}</p>}
      {body}
    </EditorEnvContext.Provider>
  );
}

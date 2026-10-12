/**
 * Fjernet (a ghost: docs/phase2-plan.md §1 rule 2, §3.7 "Fjernet (ghost): [Ta tilbake]"). A removed wall or opening of
 * today's cabin, or the old place of a moved block edge. "Ta tilbake" calls `restoreGhost(id)` and selects the restored
 * element (a `…/ghost` id selects the element it was moved from; a deleted element keeps its own id); a block-edge
 * ghost just clears the selection.
 */
import { nb } from '../../i18n/nb';
import type { GhostTarget } from '../uiSelection';
import { restoredSelection } from './helpers';
import { Actions } from './fields';
import { useEditorEnv } from './env';

const E = nb.edit.ghost;
export function GhostEditor(props: { ghost: GhostTarget }) {
  const env = useEditorEnv();
  const { ghost } = props;
  return (
    <>
      <p className="note">{E.text}</p>
      <Actions
        actions={[
          {
            key: 'restore',
            label: E.restore,
            title: E.restoreTitle,
            primary: true,
            testId: 'ghost-restore',
            onClick: () => {
              env.actions.restoreGhost(ghost.id);
              env.onSelect(restoredSelection(ghost));
            },
          },
        ]}
      />
    </>
  );
}

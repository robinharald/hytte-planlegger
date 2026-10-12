/**
 * Vegg (docs/phase2-plan.md §3.7): Lengde, Tykkelse, [Del i to] [Slett] | Høyde (Automatisk / Til taket / Fast
 * høyde), "Usynlig romdeler". The status text is in the panel header.
 *
 *  - Lengde moves end `b` along the wall (a stays): `moveWallEndpoint(id, 'b', a + u · L)`.
 *  - "Usynlig romdeler" on: when the wall hosts openings the user confirms first (they are deleted by the action);
 *    off: back to an interior wall of the variant's default interior thickness.
 *  - Fast høyde: switching to it keeps today's height (topZ − baseZ, rounded to cm).
 *
 * Exterior walls (a block-edge piece selected as 'wall', or a 'blockEdge' selection) are derived from the block:
 * read-only length and thickness, a note that they are moved by dragging, [Velg bygningsdelen] and
 * [Legg til dør/vindu] (switches to the Dør/vindu tool).
 */
import { nb } from '../../i18n/nb';
import type { DerivedBlock, DerivedWall } from '../../model/derived';
import type { Vec2, Wall } from '../../model/types';
import { formatLength, formatM } from '../format';
import { NumberField } from '../NumberField';
import { roundTo } from '../numberInput';
import { levelName } from '../properties';
import { Actions, CheckField, FieldGrid, InfoRows, More, SelectField } from './fields';
import type { SelectOption } from './fields';
import { useEditorEnv, useRun } from './env';

const E = nb.edit.wall;
const F = nb.properties.fields;

const HEIGHT_OPTIONS: SelectOption<Wall['heightMode']>[] = [
  { value: 'auto', label: E.heightAuto },
  { value: 'roof', label: E.heightRoof },
  { value: 'fixed', label: E.heightFixed },
];

function length(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function StoredWallEditor(props: { wall: DerivedWall }) {
  const env = useEditorEnv();
  const run = useRun();
  const { wall } = props;
  const stored = env.variant.walls.find((w) => w.id === wall.id);
  const L = length(wall.a, wall.b);
  const lockedProps = { locked: env.locked || env.readOnly, onLocked: env.onLocked };
  const isDivider = wall.isDivider;

  const setLength = (v: number) => {
    if (L < 1e-9) return;
    const u: Vec2 = [(wall.b[0] - wall.a[0]) / L, (wall.b[1] - wall.a[1]) / L];
    const p: Vec2 = [roundTo(wall.a[0] + u[0] * v, 4), roundTo(wall.a[1] + u[1] * v, 4)];
    run(() => env.actions.moveWallEndpoint(wall.id, 'b', p));
  };
  const setDivider = (on: boolean) =>
    run(() => {
      if (on) {
        const n = wall.openings.filter((o) => !o.isGhost).length;
        if (n > 0 && !window.confirm(nb.prompts.dividerOpenings(n))) return;
        env.actions.setWallProps(wall.id, { kind: 'divider' });
      } else {
        env.actions.setWallProps(wall.id, { kind: 'interior', thickness: env.variant.settings.defaultInteriorThickness });
      }
    });
  const heightMode = stored?.heightMode ?? 'auto';

  return (
    <>
      <FieldGrid>
        <NumberField label={E.length} value={L} min={0.1} onCommit={setLength} testId="wall-length" {...lockedProps} />
        {!isDivider && (
          <NumberField
            label={E.thickness}
            value={wall.thickness}
            min={0.02}
            max={1}
            step={0.01}
            stepLabel="1 cm"
            onCommit={(thickness) => run(() => env.actions.setWallProps(wall.id, { thickness }))}
            testId="wall-thickness"
            {...lockedProps}
          />
        )}
      </FieldGrid>
      <InfoRows
        rows={[
          [F.level, levelName(env.derived, wall.levelId)],
          !isDivider && [E.openings, String(wall.openings.filter((o) => !o.isGhost).length)],
        ]}
      />
      <Actions
        actions={[
          { key: 'split', label: E.split, title: E.splitTitle, testId: 'wall-split', onClick: () => env.actions.splitWall(wall.id, 0.5) },
          { key: 'delete', label: E.delete, danger: true, testId: 'wall-delete', onClick: () => env.onDelete({ kind: 'wall', wall }) },
        ]}
      />
      <More>
        {!isDivider && (
          <FieldGrid>
            <SelectField<Wall['heightMode']>
              label={E.height}
              value={heightMode}
              options={HEIGHT_OPTIONS}
              testId="wall-height-mode"
              onChange={(mode) =>
                run(() =>
                  env.actions.setWallProps(
                    wall.id,
                    mode === 'fixed' ? { heightMode: 'fixed', height: roundTo(stored?.height ?? wall.topZ - wall.baseZ, 2) } : { heightMode: mode },
                  ),
                )
              }
            />
            {heightMode === 'fixed' && (
              <NumberField
                label={E.fixedHeight}
                value={stored?.height ?? wall.topZ - wall.baseZ}
                min={0.3}
                max={10}
                onCommit={(height) => run(() => env.actions.setWallProps(wall.id, { heightMode: 'fixed', height }))}
                testId="wall-height"
                {...lockedProps}
              />
            )}
          </FieldGrid>
        )}
        <CheckField label={E.divider} title={E.dividerTitle} checked={isDivider} onChange={setDivider} testId="wall-divider" />
      </More>
    </>
  );
}

/** An exterior wall: a block-edge piece, or the whole edge of a 'blockEdge' selection. */
export function ExteriorWallEditor(props: { block: DerivedBlock | null; length: number; thickness: number }) {
  const env = useEditorEnv();
  const { block } = props;
  return (
    <>
      <InfoRows
        rows={[
          [E.length, formatM(props.length)],
          [E.thickness, formatLength(props.thickness)],
          block && [F.block, block.block.name],
        ]}
      />
      <p className="note">{E.exteriorNote}</p>
      <Actions
        actions={[
          !!block && {
            key: 'block',
            label: nb.edit.room.selectBlock,
            safe: true,
            onClick: () => env.onSelect({ kind: 'block', id: block.block.id }),
          },
          { key: 'opening', label: E.addOpening, title: E.addOpeningTitle, testId: 'wall-add-opening', onClick: () => env.onTool('opening') },
        ]}
      />
    </>
  );
}

/**
 * Åpning (docs/phase2-plan.md §3.7): Type, Bredde, Høyde, "Høyde over gulv" (windows), Avstand fra hjørne,
 * [Bytt hengselside] [Slå andre veien] [Slett] | Antall fløyer, Karmfarge, Dørblad, Sprosser.
 *
 *  - Høyde is hidden for full-height openings (the open front of a woodshed).
 *  - Avstand fra hjørne (cornerDistance.ts) commits `moveOpening(id, offset)` with the stored offset that puts the
 *    near edge at the typed distance; while it has focus the dimension is published as a temporary dimension.
 *  - The swing buttons show for openings with a swing; "Antall fløyer" for doors and glass doors; "Dørblad" for door
 *    types; "Sprosser" for windows (none, 2 × 1, 2 × 2, 3 × 2, 1 × 2 panes).
 */
import { useEffect, useMemo, useRef } from 'react';
import { nb } from '../../i18n/nb';
import type { DerivedOpening, DerivedWall } from '../../model/derived';
import type { OpeningStyle, OpeningType } from '../../model/types';
import { cornerDistance, offsetForCornerDistance } from '../cornerDistance';
import { formatM } from '../format';
import { NumberField } from '../NumberField';
import { levelName, wallTitle } from '../properties';
import { Actions, FieldGrid, InfoRows, More, SelectField } from './fields';
import type { SelectOption } from './fields';
import { useEditorEnv, useRun } from './env';

const E = nb.edit.opening;

const TYPE_OPTIONS: SelectOption<OpeningType>[] = (Object.keys(nb.openingTypes) as OpeningType[]).map((t) => ({ value: t, label: nb.openingTypes[t] }));
const DOOR_TYPES: readonly OpeningType[] = ['door', 'glassDoor', 'saunaDoor', 'slidingDoor'];
const FRAME_COLOURS: OpeningStyle['frameColour'][] = ['white', 'green', 'wood', 'black'];
const LEAF_COLOURS: NonNullable<OpeningStyle['leaf']>[] = ['white', 'green', 'wood', 'glass'];
const MUNTINS: [number, number][] = [
  [1, 1],
  [2, 1],
  [2, 2],
  [3, 2],
  [1, 2],
];

function muntinKey(m: [number, number] | undefined): string {
  const [c, r] = m ?? [1, 1];
  return `${c}x${r}`;
}

function CornerField(props: { opening: DerivedOpening; wall: DerivedWall }) {
  const env = useEditorEnv();
  const run = useRun();
  const { opening, wall } = props;
  const cd = useMemo(() => cornerDistance(env.derived, opening, wall), [env.derived, opening, wall]);
  const published = useRef(false);
  const onHighlight = env.onHighlight;
  useEffect(
    () => () => {
      if (published.current) onHighlight(null);
    },
    [onHighlight],
  );
  if (!cd) return null;
  return (
    <div
      className="size-field"
      onFocus={() => {
        published.current = true;
        onHighlight({ kind: 'dimension', a: cd.a, b: cd.b, text: formatM(cd.distance) });
      }}
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        published.current = false;
        onHighlight(null);
      }}
    >
      <NumberField
        label={E.corner}
        title={E.cornerTitle}
        value={cd.distance}
        locked={env.locked || env.readOnly}
        onLocked={env.onLocked}
        testId="opening-corner"
        onCommit={(d) => run(() => env.actions.moveOpening(opening.id, offsetForCornerDistance(cd, opening.opening.width, d)))}
      />
    </div>
  );
}

export function OpeningEditor(props: { opening: DerivedOpening; wall: DerivedWall }) {
  const env = useEditorEnv();
  const run = useRun();
  const { opening, wall } = props;
  const o = opening.opening;
  const id = opening.id;
  const lockedProps = { locked: env.locked || env.readOnly, onLocked: env.onLocked };
  const set = (patch: Parameters<typeof env.actions.setOpeningProps>[1]) => run(() => env.actions.setOpeningProps(id, patch));
  const isWindow = o.type === 'window';
  const isDoor = DOOR_TYPES.includes(o.type);
  const style = o.style;
  const storedKinds = useMemo(() => new Map(env.variant.walls.map((w) => [w.id, w.kind])), [env.variant.walls]);

  return (
    <>
      <FieldGrid>
        <SelectField<OpeningType> label={E.type} value={o.type} options={TYPE_OPTIONS} onChange={(type) => set({ type })} testId="opening-type" />
        <NumberField label={E.width} value={o.width} min={0.2} max={8} onCommit={(width) => set({ width })} testId="opening-width" {...lockedProps} />
        {!o.fullHeight && (
          <NumberField label={E.height} value={o.height} min={0.2} max={6} onCommit={(height) => set({ height })} testId="opening-height" {...lockedProps} />
        )}
        {isWindow && <NumberField label={E.sill} value={o.sill} min={0} max={6} onCommit={(sill) => set({ sill })} testId="opening-sill" {...lockedProps} />}
        <CornerField key={id} opening={opening} wall={wall} />
      </FieldGrid>
      <InfoRows
        rows={[
          [E.host, wallTitle(env.derived, wall, storedKinds)],
          [nb.properties.fields.level, levelName(env.derived, opening.levelId)],
          !!o.fullHeight && [E.height, E.fullHeight],
        ]}
      />
      <Actions
        actions={[
          !!o.swing && {
            key: 'hinge',
            label: E.flipHinge,
            testId: 'opening-flip-hinge',
            onClick: () => o.swing && env.actions.setOpeningProps(id, { swing: { ...o.swing, hinge: o.swing.hinge === 'start' ? 'end' : 'start' } }),
          },
          !!o.swing && {
            key: 'side',
            label: E.flipSide,
            testId: 'opening-flip-side',
            onClick: () => o.swing && env.actions.setOpeningProps(id, { swing: { ...o.swing, side: o.swing.side === 'left' ? 'right' : 'left' } }),
          },
          { key: 'delete', label: E.delete, danger: true, testId: 'opening-delete', onClick: () => env.onDelete({ kind: 'opening', opening, wall }) },
        ]}
      />
      <More>
        <FieldGrid>
          {isDoor && !!o.swing && (
            <SelectField<'1' | '2'>
              label={E.leaves}
              value={o.leaves === 2 ? '2' : '1'}
              options={[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
              ]}
              onChange={(v) => set({ leaves: v === '2' ? 2 : 1 })}
              testId="opening-leaves"
            />
          )}
          <SelectField<OpeningStyle['frameColour']>
            label={E.frame}
            value={style.frameColour}
            options={FRAME_COLOURS.map((c) => ({ value: c, label: nb.edit.colours[c] ?? c }))}
            onChange={(frameColour) => set({ style: { ...style, frameColour } })}
            testId="opening-frame"
          />
          {isDoor && (
            <SelectField<NonNullable<OpeningStyle['leaf']>>
              label={E.leaf}
              value={style.leaf ?? opening.leafColour}
              options={LEAF_COLOURS.map((c) => ({ value: c, label: nb.edit.colours[c] ?? c }))}
              onChange={(leaf) => set({ style: { ...style, leaf } })}
              testId="opening-leaf"
            />
          )}
          {isWindow && (
            <SelectField<string>
              label={E.muntins}
              value={muntinKey(style.mullions)}
              options={MUNTINS.map(([c, r]) => ({ value: `${c}x${r}`, label: c === 1 && r === 1 ? E.muntinsNone : E.muntinsGrid(c, r) }))}
              onChange={(v) => {
                const [c, r] = v.split('x').map(Number);
                set({ style: { ...style, mullions: [c, r] } });
              }}
              testId="opening-muntins"
            />
          )}
        </FieldGrid>
      </More>
    </>
  );
}

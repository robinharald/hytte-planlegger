/**
 * Møbel (docs/phase2-plan.md §3.7): Navn, Størrelse, Farge, [Roter 90°] [Dupliser] [Slett]; "Rom: <navn>" read-only.
 * Phase 2a has no catalogue yet: the name is the catalogue entry's name, else the catalogue id; Størrelse is the
 * stored Bredde / Dybde (phase 2b replaces it with the preset choice or stretchable fields); Farge offers a few
 * named colours plus "Standard" (no colour stored).
 */
import { nb } from '../../i18n/nb';
import type { DerivedFurniture } from '../../model/derived';
import { NumberField } from '../NumberField';
import { Actions, FieldGrid, InfoRows, SelectField } from './fields';
import { useEditorEnv, useRun } from './env';
import { furnitureName } from './helpers';

const E = nb.edit.furniture;

export function FurnitureEditor(props: { furniture: DerivedFurniture }) {
  const env = useEditorEnv();
  const run = useRun();
  const { furniture } = props;
  const item = furniture.item;
  const room = furniture.roomId ? env.derived.rooms.find((r) => r.id === furniture.roomId && r.levelId === furniture.levelId) ?? env.derived.rooms.find((r) => r.id === furniture.roomId) : undefined;
  const roomName = room ? room.room?.name ?? nb.schedule.unnamed : null;
  const lockedProps = { locked: env.locked || env.readOnly, onLocked: env.onLocked };
  const colours = Object.keys(E.colours);
  return (
    <>
      <p className="note">{roomName ? E.room(roomName) : E.noRoom}</p>
      <FieldGrid>
        <NumberField
          label={E.width}
          value={item.size.w}
          min={0.05}
          max={10}
          onCommit={(w) => run(() => env.actions.setFurnitureProps(item.id, { size: { ...item.size, w } }))}
          testId="furniture-width"
          {...lockedProps}
        />
        <NumberField
          label={E.depth}
          value={item.size.d}
          min={0.05}
          max={10}
          onCommit={(d) => run(() => env.actions.setFurnitureProps(item.id, { size: { ...item.size, d } }))}
          testId="furniture-depth"
          {...lockedProps}
        />
        <SelectField<string>
          label={E.colour}
          value={item.colour ?? ''}
          options={[{ value: '', label: E.colourDefault }, ...colours.map((c) => ({ value: c, label: E.colours[c] }))]}
          onChange={(c) => run(() => env.actions.setFurnitureProps(item.id, { colour: c || null }))}
          testId="furniture-colour"
        />
      </FieldGrid>
      <InfoRows rows={[[E.name, furnitureName(furniture)]]} />
      <Actions
        actions={[
          { key: 'rotate', label: E.rotate, testId: 'furniture-rotate', onClick: () => env.actions.rotateFurniture(item.id, 90) },
          { key: 'dup', label: E.duplicate, testId: 'furniture-duplicate', onClick: () => env.actions.duplicateFurniture(item.id) },
          { key: 'delete', label: E.delete, danger: true, testId: 'furniture-delete', onClick: () => env.onDelete({ kind: 'furniture', furniture }) },
        ]}
      />
    </>
  );
}

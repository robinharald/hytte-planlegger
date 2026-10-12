/**
 * Møbel in Egenskaper (docs/phase2-plan.md §3.7): Navn, Størrelse (the catalogue's presets, and Bredde / Dybde where the
 * entry stretches), Farge (the entry's swatches, or "Standard"), [Roter 90°] [Dupliser] [Slett], and the room it
 * stands in, read-only ("Rom: Soverom 1").
 *
 *  - Størrelse: a choice when the entry has more than one preset; picking one sets `sizeVariant` and the preset's
 *    size in one step. A size that matches no preset (stretched) shows as "Egen størrelse (… cm)".
 *  - Bredde / Dybde: number fields (comma or point, Enter / Tab / blur, −/+ 10 cm) for the stretchable dimensions,
 *    clamped into the entry's range (furniture/catalog.ts `clampSize`); an item whose catalogue id is unknown gets
 *    both, freely (0.05–10 m), and a note that it shows as a box.
 *  - Farge: "Standard" (no colour stored) or a swatch (`FurnitureItem.colour` = its '#rrggbb'); a colour stored by an
 *    older version (a name) stays selectable under its old label.
 *  - The locked base proposal and read-only links: values only (fields.tsx / NumberField rules).
 * Test ids: furniture-name, furniture-size, furniture-width, furniture-depth, furniture-colour, furniture-room,
 * furniture-rotate, furniture-duplicate, furniture-delete.
 */
import { nb } from '../../i18n/nb';
import { catalogItem, clampSize } from '../../furniture/catalog';
import type { DerivedFurniture } from '../../model/derived';
import { NumberField } from '../NumberField';
import { formatField } from '../numberInput';
import { Actions, FieldGrid, InfoRows, SelectField } from '../editors/fields';
import type { SelectOption } from '../editors/fields';
import { useEditorEnv, useRun } from '../editors/env';
import { sizeTextCm } from '../furnitureLibraryModel';

import { matchingPreset, presetLabel } from './furniturePropsModel';

const E = nb.edit.furniture;
const CUSTOM = '__custom';
/** "0,30–6,00 m". */
const rangeText = (r: [number, number]) => E.range(formatField(r[0], 2), formatField(r[1], 2));

export function FurnitureProps(props: { furniture: DerivedFurniture }) {
  const env = useEditorEnv();
  const run = useRun();
  const { furniture } = props;
  const item = furniture.item;
  const size = item.size ?? { w: 1, d: 1, h: 1 };
  const entry = catalogItem(item.catalogId);
  const room = furniture.roomId ? (env.derived.rooms.find((r) => r.id === furniture.roomId && r.levelId === furniture.levelId) ?? env.derived.rooms.find((r) => r.id === furniture.roomId)) : undefined;
  const roomName = room ? (room.room?.name ?? nb.schedule.unnamed) : null;
  const lockedProps = { locked: env.locked || env.readOnly, onLocked: env.onLocked };
  const setSize = (next: { w: number; d: number; h: number }) => run(() => env.actions.setFurnitureProps(item.id, { size: next }));

  // Størrelse
  const presetKey = entry ? matchingPreset(entry, size, item.sizeVariant) : null;
  const sizeOptions: SelectOption<string>[] = entry ? entry.sizes.map((p) => ({ value: p.key, label: presetLabel(p) })) : [];
  if (entry && !presetKey) sizeOptions.push({ value: CUSTOM, label: `${E.sizeCustom} (${sizeTextCm(size.w, size.d)})` });
  const showSizeChoice = !!entry && sizeOptions.length > 1;

  // Bredde / Dybde
  const stretchW = entry ? entry.stretch?.w : ([0.05, 10] as [number, number]);
  const stretchD = entry ? entry.stretch?.d : ([0.05, 10] as [number, number]);

  // Farge
  const swatches = entry?.colours ?? [];
  const colourOptions: SelectOption<string>[] = [{ value: '', label: E.colourDefault }, ...swatches.map((c) => ({ value: c.hex, label: c.label }))];
  if (item.colour && !swatches.some((c) => c.hex.toLowerCase() === item.colour?.toLowerCase())) {
    const legacy = (nb.edit.furniture.colours as Record<string, string>)[item.colour];
    colourOptions.push({ value: item.colour, label: legacy ?? item.colour });
  }
  const colourValue = swatches.find((c) => c.hex.toLowerCase() === item.colour?.toLowerCase())?.hex ?? item.colour ?? '';

  return (
    <>
      <p className="note" data-testid="furniture-room">
        {roomName ? E.room(roomName) : E.noRoom}
      </p>
      {!entry && <p className="note warn-note">{E.unknown}</p>}
      <InfoRows rows={[[E.name, <span key="name" data-testid="furniture-name">{entry?.name ?? item.catalogId}</span>]]} />
      <FieldGrid>
        {showSizeChoice && (
          <SelectField<string>
            label={E.size}
            value={presetKey ?? CUSTOM}
            options={sizeOptions}
            onChange={(key) => {
              const p = entry?.sizes.find((s) => s.key === key);
              if (!p) return;
              run(() => env.actions.setFurnitureProps(item.id, { sizeVariant: p.key, size: { w: p.w, d: p.d, h: p.h } }));
            }}
            testId="furniture-size"
          />
        )}
        {stretchW && (
          <NumberField
            label={E.width}
            value={size.w}
            min={stretchW[0]}
            max={stretchW[1]}
            onCommit={(w) => setSize(clampSize(entry, { ...size, w }, size))}
            note={entry ? rangeText(stretchW) : undefined}
            testId="furniture-width"
            {...lockedProps}
          />
        )}
        {stretchD && (
          <NumberField
            label={E.depth}
            value={size.d}
            min={stretchD[0]}
            max={stretchD[1]}
            onCommit={(d) => setSize(clampSize(entry, { ...size, d }, size))}
            note={entry ? rangeText(stretchD) : undefined}
            testId="furniture-depth"
            {...lockedProps}
          />
        )}
        {(swatches.length > 0 || item.colour) && (
          <SelectField<string>
            label={E.colour}
            value={colourValue}
            options={colourOptions}
            onChange={(c) => run(() => env.actions.setFurnitureProps(item.id, { colour: c || null }))}
            testId="furniture-colour"
          />
        )}
      </FieldGrid>
      {!showSizeChoice && !stretchW && !stretchD && <InfoRows rows={[[E.size, sizeTextCm(size.w, size.d)]]} />}
      <Actions
        actions={[
          { key: 'rotate', label: E.rotate, title: E.rotateTitle, testId: 'furniture-rotate', onClick: () => env.actions.rotateFurniture(item.id, 90) },
          { key: 'dup', label: E.duplicate, title: E.duplicateTitle, testId: 'furniture-duplicate', onClick: () => env.actions.duplicateFurniture(item.id) },
          { key: 'delete', label: E.delete, title: E.deleteTitle, danger: true, testId: 'furniture-delete', onClick: () => env.onDelete({ kind: 'furniture', furniture }) },
        ]}
      />
    </>
  );
}

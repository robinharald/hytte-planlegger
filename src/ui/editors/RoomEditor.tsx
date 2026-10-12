/**
 * Rom (docs/phase2-plan.md §3.7): Navn, Romtype, Bredde ↔, Dybde ↕ | Gulv, Merknad; [Slett rom].
 * A detected face without a Room record shows "Gi navn" (name + room type → `nameFace`).
 *
 * Size fields (`RoomSizeField`): the value is `DerivedRoom.dims` (inner bounding box). A change calls
 * `resizeRoom(roomId, axis, value, side)` for the side chosen by `roomResizePlan` (stored walls before block edges;
 * both movable → 'max' = north/east, with the switch "Flytt: venstre / høyre vegg" or "nedre / øvre vegg"); only
 * block edges → read-only with "Endres under bygningsdelen" and a button that selects the block. While the field
 * or its switch has focus, the wall that moves is published as a highlight with an arrow (overlay.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { nb } from '../../i18n/nb';
import type { DerivedRoom } from '../../model/derived';
import type { FloorMaterial, RoomType } from '../../model/types';
import type { RoomSide } from '../editorBridge';
import { formatM2 } from '../format';
import { NumberField } from '../NumberField';
import { levelName } from '../properties';
import { candidateOn, roomResizePlan, sideArrow } from '../roomResize';
import type { RoomAxis } from '../roomResize';
import { SPLIT_MIN_AREA } from '../schedule';
import { Actions, Choice, FieldGrid, InfoRows, More, SelectField, TextField } from './fields';
import type { SelectOption } from './fields';
import { useEditorEnv, useRun } from './env';

const E = nb.edit.room;

const ROOM_TYPE_OPTIONS: SelectOption<RoomType>[] = (Object.keys(nb.roomTypes) as RoomType[]).map((t) => ({ value: t, label: nb.roomTypes[t] }));

const FLOOR_MATERIALS: FloorMaterial[] = ['wood', 'tile', 'sauna', 'concrete', 'deck'];

function RoomSizeField(props: { room: DerivedRoom; axis: RoomAxis }) {
  const env = useEditorEnv();
  const run = useRun();
  const { room, axis } = props;
  const plan = useMemo(() => roomResizePlan(env.derived, room, axis), [env.derived, room, axis]);
  const [picked, setPicked] = useState<RoomSide | null>(null);
  const side = picked && plan.movable.includes(picked) ? picked : plan.defaultSide;
  const cand = side ? candidateOn(plan, side) : null;
  const value = axis === 'w' ? room.dims.w : room.dims.h;
  const published = useRef(false);
  const onHighlight = env.onHighlight;

  const highlight = (s: RoomSide | null) => {
    const c = s ? candidateOn(plan, s) : null;
    if (!s || !c) return;
    published.current = true;
    onHighlight({ kind: 'wall', wallId: c.wallId, arrow: sideArrow(axis, s) });
  };
  const clear = () => {
    if (!published.current) return;
    published.current = false;
    onHighlight(null);
  };
  // A field that unmounts while focused (another selection) must not leave its highlight behind.
  useEffect(
    () => () => {
      if (published.current) onHighlight(null);
    },
    [onHighlight],
  );

  const sides: SelectOption<RoomSide>[] =
    axis === 'w'
      ? [
          { value: 'min', label: E.left },
          { value: 'max', label: E.right },
        ]
      : [
          { value: 'min', label: E.lower },
          { value: 'max', label: E.upper },
        ];

  return (
    <div
      className="size-field"
      onFocus={() => highlight(side)}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) clear();
      }}
    >
      <NumberField
        label={axis === 'w' ? E.width : E.depth}
        value={value}
        readOnly={!cand}
        locked={env.locked || env.readOnly}
        onLocked={env.onLocked}
        note={cand ? undefined : E.blockOnly}
        testId={`room-size-${axis}`}
        onCommit={(v) => {
          if (side) run(() => env.actions.resizeRoom(room.id, axis, v, side));
        }}
      />
      {plan.movable.length === 2 && side && (
        <Choice<RoomSide>
          label={E.move}
          value={side}
          options={sides}
          testId={`room-side-${axis}`}
          onChange={(s) => {
            setPicked(s);
            highlight(s);
          }}
        />
      )}
    </div>
  );
}

function UnnamedRoomEditor(props: { room: DerivedRoom }) {
  const env = useEditorEnv();
  const run = useRun();
  const { room } = props;
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomType>('annet');
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    run(() => env.actions.nameFace(room.id, n, { type, levelId: room.levelId }));
  };
  return (
    <>
      <p className="note">{E.unnamedText}</p>
      {!env.readOnly && (
        <form
          className="name-face"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FieldGrid>
            <div className="ef">
              <label className="nf-label" htmlFor={`name-${room.id}`}>
                {E.name}
              </label>
              <input
                id={`name-${room.id}`}
                className="text-input"
                type="text"
                autoComplete="off"
                value={name}
                placeholder={E.namePlaceholder}
                readOnly={env.locked}
                data-testid="name-face-input"
                onKeyDown={(e) => {
                  if (env.locked && e.key.length === 1) {
                    e.preventDefault();
                    env.onLocked();
                  }
                }}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <SelectField<RoomType> label={E.type} value={type} options={ROOM_TYPE_OPTIONS} onChange={setType} />
          </FieldGrid>
          <div className="toolgroup editor-actions">
            <button type="submit" className="btn btn-small btn-primary" data-testid="name-face" aria-disabled={env.locked || undefined}>
              {E.nameIt}
            </button>
          </div>
        </form>
      )}
      <InfoRows
        rows={[
          [nb.properties.fields.area, formatM2(room.area)],
          [nb.properties.fields.level, levelName(env.derived, room.levelId)],
        ]}
      />
    </>
  );
}

export function RoomEditor(props: { room: DerivedRoom }) {
  const env = useEditorEnv();
  const run = useRun();
  const { room } = props;
  const r = room.room;
  if (!r) return <UnnamedRoomEditor room={room} />;
  const block = room.blockId ? env.derived.blocks.find((b) => b.block.id === room.blockId) : undefined;
  const plans = (['w', 'd'] as const).map((axis) => roomResizePlan(env.derived, room, axis));
  const blockOnly = plans.some((p) => p.defaultSide === null);
  const floorOptions: SelectOption<string>[] = [
    { value: '', label: r.floorMaterial ? E.floorTypeDefault : E.floorDefault(nb.floorMaterials[room.floorMaterial] ?? room.floorMaterial) },
    ...FLOOR_MATERIALS.map((m) => ({ value: m, label: nb.floorMaterials[m] ?? m })),
  ];
  const mixed = room.areaExisting >= SPLIT_MIN_AREA && room.areaNew >= SPLIT_MIN_AREA;
  const set = (patch: Parameters<typeof env.actions.setRoomProps>[1]) => run(() => env.actions.setRoomProps(r.id, patch));

  return (
    <>
      <FieldGrid>
        <TextField label={E.name} value={r.name} required onCommit={(name) => set({ name })} testId="room-name" />
        <SelectField<RoomType> label={E.type} value={r.type} options={ROOM_TYPE_OPTIONS} onChange={(type) => set({ type })} testId="room-type" />
        <RoomSizeField key={`${room.id}/w`} room={room} axis="w" />
        <RoomSizeField key={`${room.id}/d`} room={room} axis="d" />
      </FieldGrid>
      {room.dims.approx && <p className="note">{E.approx}</p>}
      <InfoRows
        rows={[
          [nb.properties.fields.area, formatM2(room.area)],
          mixed && [nb.properties.fields.areaExisting, formatM2(room.areaExisting)],
          mixed && [nb.properties.fields.areaNew, formatM2(room.areaNew)],
          [nb.properties.fields.level, levelName(env.derived, room.levelId)],
          !!block && [nb.properties.fields.block, block.block.name],
        ]}
      />
      <Actions
        actions={[
          blockOnly &&
            !!block && {
              key: 'block',
              label: E.selectBlock,
              safe: true,
              onClick: () => env.onSelect({ kind: 'block', id: block.block.id }),
            },
          { key: 'delete', label: E.delete, title: E.deleteTitle, danger: true, testId: 'room-delete', onClick: () => env.onDelete({ kind: 'room', room }) },
        ]}
      />
      <More>
        <SelectField<string>
          label={E.floor}
          value={r.floorMaterial ?? ''}
          options={floorOptions}
          onChange={(v) => set({ floorMaterial: v ? (v as FloorMaterial) : null })}
          testId="room-floor"
        />
        <TextField label={E.note} value={r.note ?? ''} multiline onCommit={(note) => set({ note })} testId="room-note" />
      </More>
    </>
  );
}

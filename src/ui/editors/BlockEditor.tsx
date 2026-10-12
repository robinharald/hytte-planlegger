/**
 * Bygningsdel (docs/phase2-plan.md §3.7): Navn, Bredde ↔, Dybde ↕, Taktype, Takvinkel, Åpen front (template units),
 * [Dupliser] [Slett] | Mønehøyde, Rafthøyde, Utstikk, Veggtykkelse, Himlingshøyde, Taktekking. `drive` is never shown:
 * Takvinkel sends `drive: 'pitch'`, Mønehøyde `drive: 'height'`.
 *
 *  - Bredde / Dybde are the axis-line bounding box; a change moves the block's east / north edge:
 *    `setBlockSize(blockId, 'w' | 'd', value, 'max')` (junction partners and parts follow the editor core's rules).
 *    Blocks with explicit parts list them (§3.4): existing parts "Eksisterende: 12,00 × 6,20 m", new parts "Stue
 *    forlenget: lengde 4,00 m" (the extent that differs from the block's), so it is clear the new part is what grows.
 *    A block without a single east / north edge (not a rectangle) shows the sizes read-only (drag its corners).
 *  - Heights are relative to the block's floor; Mønehøyde is the effective ridge (derived), Rafthøyde the stored eave.
 *  - Utstikk sets both the eave and the gable overhang. Himlingshøyde: a tick for "flat ceiling" plus its height.
 *  - [Slett] and [Dupliser] only for new blocks (today's cabin cannot be deleted as a whole); [Roter 90°] for placed
 *    template units ("Nytt bygg": `rotateBlock`, a quarter turn around the centre).
 */
import { nb } from '../../i18n/nb';
import type { DerivedBlock } from '../../model/derived';
import type { BlockVertex, Roof, RoofType } from '../../model/types';
import { formatDims, formatPoint } from '../format';
import { NumberField } from '../NumberField';
import { levelName } from '../properties';
import { Actions, CheckField, FieldGrid, InfoRows, More, SelectField, TextField } from './fields';
import type { SelectOption } from './fields';
import { useEditorEnv, useRun } from './env';
import { blockSideEdge, partLines } from './helpers';

const E = nb.edit.block;
const F = nb.properties.fields;

const ROOF_TYPES: SelectOption<RoofType>[] = (['gable', 'mono', 'flat'] as const).map((t) => ({ value: t, label: nb.roofTypes[t] }));
const ROOF_MATERIALS: SelectOption<Roof['material']>[] = (['turf', 'metal', 'shingle'] as const).map((m) => ({ value: m, label: nb.roofMaterials[m] }));

export function BlockEditor(props: { block: DerivedBlock }) {
  const env = useEditorEnv();
  const run = useRun();
  const { block } = props;
  const b = block.block;
  const id = b.id;
  const lockedProps = { locked: env.locked || env.readOnly, onLocked: env.onLocked };
  const set = (patch: Parameters<typeof env.actions.setBlockProps>[1]) => run(() => env.actions.setBlockProps(id, patch));
  const elevation = env.derived.levels.find((l) => l.id === b.levelId)?.elevation ?? 0;
  const eastEdge = blockSideEdge(block, 'x');
  const northEdge = blockSideEdge(block, 'y');
  const roof = b.roof;
  const parts = partLines(block);
  const front = b.templateFrontEdgeId;
  const openFront =
    !!front &&
    env.variant.openings.some((o) => o.host.kind === 'blockEdge' && o.host.blockId === id && o.host.edgeId === front && o.fullHeight && o.status !== 'removed');
  const resize = (axis: 'w' | 'd') => (v: number) => run(() => env.actions.setBlockSize(id, axis, v, 'max'));

  return (
    <>
      <FieldGrid>
        <TextField label={E.name} value={b.name} required onCommit={(name) => set({ name })} testId="block-name" />
        <NumberField
          label={E.width}
          value={block.axisDims.w}
          min={0.5}
          readOnly={!eastEdge}
          onCommit={resize('w')}
          testId="block-width"
          {...lockedProps}
        />
        <NumberField
          label={E.depth}
          value={block.axisDims.h}
          min={0.5}
          readOnly={!northEdge}
          onCommit={resize('d')}
          testId="block-depth"
          {...lockedProps}
        />
        <SelectField<RoofType> label={E.roofType} value={roof.type} options={ROOF_TYPES} onChange={(type) => set({ roof: { type } })} testId="block-roof-type" />
        {roof.type !== 'flat' && (
          <NumberField
            label={E.pitch}
            unit="°"
            decimals={1}
            value={block.pitchDeg}
            min={3}
            max={60}
            step={1}
            stepLabel="1°"
            onCommit={(pitchDeg) => set({ roof: { pitchDeg, drive: 'pitch' } })}
            testId="block-pitch"
            {...lockedProps}
          />
        )}
      </FieldGrid>
      {(!eastEdge || !northEdge) && <p className="note">{E.notRectangle}</p>}
      {front && <CheckField label={E.openFront} checked={openFront} onChange={(v) => set({ openFront: v })} testId="block-open-front" />}
      {parts.length > 0 && (
        <div className="part-lines" data-testid="block-parts">
          <span className="nf-label">{E.parts}</span>
          <ul>
            {parts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <InfoRows
        rows={[
          [F.level, levelName(env.derived, b.levelId)],
          [F.footprint, formatDims(block.axisDims.w, block.axisDims.h)],
        ]}
      />
      <Actions
        actions={[
          b.isNew &&
            !!b.template && { key: 'rotate', label: E.rotate, title: E.rotateTitle, testId: 'block-rotate', onClick: () => env.actions.rotateBlock(id, 90) },
          b.isNew && { key: 'dup', label: E.duplicate, testId: 'block-duplicate', onClick: () => env.actions.duplicateBlock(id) },
          b.isNew && { key: 'delete', label: E.delete, danger: true, testId: 'block-delete', onClick: () => env.onDelete({ kind: 'block', block }) },
        ]}
      />
      <More>
        <FieldGrid>
          {roof.type !== 'flat' && (
            <NumberField
              label={E.ridge}
              value={block.ridgeZ - elevation}
              min={0.5}
              max={15}
              onCommit={(ridgeHeight) => set({ roof: { ridgeHeight, drive: 'height' } })}
              testId="block-ridge"
              {...lockedProps}
            />
          )}
          <NumberField label={E.eave} value={b.eaveHeight} min={0.5} max={15} onCommit={(eaveHeight) => set({ eaveHeight })} testId="block-eave" {...lockedProps} />
          <NumberField
            label={E.overhang}
            value={roof.overhangEave}
            min={0}
            max={3}
            onCommit={(v) => set({ roof: { overhangEave: v, overhangGable: v } })}
            testId="block-overhang"
            {...lockedProps}
          />
          <NumberField
            label={E.wallThickness}
            value={b.wall.thickness}
            min={0.05}
            max={1}
            step={0.01}
            stepLabel="1 cm"
            onCommit={(thickness) => set({ wall: { thickness } })}
            testId="block-wall"
            {...lockedProps}
          />
          <SelectField<Roof['material']>
            label={E.roofMaterial}
            value={roof.material}
            options={ROOF_MATERIALS}
            onChange={(material) => set({ roof: { material } })}
            testId="block-roof-material"
          />
        </FieldGrid>
        <CheckField
          label={E.ceilingOn}
          checked={b.ceilingHeight !== undefined}
          onChange={(on) => set({ ceilingHeight: on ? Math.min(2.4, b.eaveHeight) : null })}
          testId="block-ceiling-on"
        />
        {b.ceilingHeight !== undefined && (
          <NumberField
            label={E.ceiling}
            value={b.ceilingHeight}
            min={1.5}
            max={10}
            onCommit={(ceilingHeight) => set({ ceilingHeight })}
            testId="block-ceiling"
            {...lockedProps}
          />
        )}
        <p className="note">{E.heightsNote}</p>
      </More>
    </>
  );
}

export function BlockVertexEditor(props: { block: DerivedBlock; vertex: BlockVertex }) {
  const env = useEditorEnv();
  return (
    <>
      <InfoRows
        rows={[
          [E.position, formatPoint(props.vertex.p)],
          [F.block, props.block.block.name],
        ]}
      />
      <p className="note">{E.vertexNote}</p>
      <Actions
        actions={[{ key: 'block', label: nb.edit.room.selectBlock, safe: true, onClick: () => env.onSelect({ kind: 'block', id: props.block.block.id }) }]}
      />
    </>
  );
}

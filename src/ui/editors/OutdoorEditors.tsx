/**
 * Terrasse, terrassehjørne, terrassekant, rekkverk, trapp, badestamp and tre (docs/phase2-plan.md §3.7: "Terrasse:
 * Høyde, Rekkverk (stil, høyde), per-edge railing on/off (tap the edge), [Legg til trapp] [Fjern hjørne]; Trapp:
 * Bredde, [Slett]. Badestamp: Diameter, [Slett]").
 *
 *  - Rekkverk: Glass / Bord / Uten rekkverk; turning it on keeps the last height (1,05 m by default).
 *  - [Legg til trapp] on the deck: centred on the longest free run (`DerivedDeck.freeRuns`, at least 1 m); on a
 *    terrassekant: on the longest free run of that edge. Nothing free → a toast.
 *  - [Fjern hjørne] on the deck itself asks the user to tap the corner first (a toast); on a terrassehjørne it deletes
 *    the vertex (a deck keeps at least three).
 *  - Per-edge railing: tap the edge in the plan (terrassekant: "Rekkverk langs denne kanten"); the deck's Mer lists
 *    every edge with a free run as well.
 */
import { nb } from '../../i18n/nb';
import { multiPolygonArea } from '../../geometry/polygon';
import type { DerivedDeck, DerivedHotTub, DerivedSteps } from '../../model/derived';
import type { Deck, Id, Tree, Vec2 } from '../../model/types';
import { showToast } from '../editorBridge';
import { formatLength, formatM, formatM2, formatPoint } from '../format';
import { NumberField } from '../NumberField';
import { Actions, CheckField, FieldGrid, InfoRows, More, SelectField } from './fields';
import { useEditorEnv, useRun } from './env';
import { longestFreeRun } from './helpers';

const E = nb.edit.deck;
const F = nb.properties.fields;
const DEFAULT_RAILING_HEIGHT = 1.05;

type RailingChoice = 'glass' | 'boards' | 'none';

function len(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function useStoredDeck(id: Id): Deck | undefined {
  const env = useEditorEnv();
  return env.variant.outdoor.decks.find((d) => d.id === id);
}

/** Rekkverk (stil + høyde) of a deck: shared by the deck and the railing editors. */
function RailingFields(props: { deckId: Id }) {
  const env = useEditorEnv();
  const run = useRun();
  const stored = useStoredDeck(props.deckId);
  const railing = stored?.railing;
  const choice: RailingChoice = railing ? railing.style : 'none';
  const setRailing = (r: Deck['railing'] | null) => run(() => env.actions.setDeckProps(props.deckId, { railing: r }));
  return (
    <>
      <SelectField<RailingChoice>
        label={E.railing}
        value={choice}
        options={[
          { value: 'glass', label: nb.properties.railingStyles.glass },
          { value: 'boards', label: nb.properties.railingStyles.boards },
          { value: 'none', label: E.railingNone },
        ]}
        onChange={(v) => setRailing(v === 'none' ? null : { style: v, height: railing?.height ?? DEFAULT_RAILING_HEIGHT })}
        testId="deck-railing"
      />
      {railing && (
        <NumberField
          label={E.railingHeight}
          value={railing.height}
          min={0.3}
          max={3}
          onCommit={(height) => setRailing({ ...railing, height })}
          locked={env.locked || env.readOnly}
          onLocked={env.onLocked}
          testId="deck-railing-height"
        />
      )}
    </>
  );
}

function addStepsOn(deck: DerivedDeck, edgeId: Id | undefined, addSteps: (edgeId: Id, offset: number) => void): void {
  const run = longestFreeRun(deck, edgeId);
  if (!run) {
    showToast({ text: E.noFreeEdge });
    return;
  }
  addSteps(run.edgeId, (run.s0 + run.s1) / 2);
}

export function DeckEditor(props: { deck: DerivedDeck }) {
  const env = useEditorEnv();
  const run = useRun();
  const { deck } = props;
  const stored = useStoredDeck(deck.id);
  const freeEdges = [...new Set(deck.freeRuns.map((r) => r.edgeId))];
  return (
    <>
      <FieldGrid>
        <NumberField
          label={E.height}
          title={E.heightTitle}
          value={stored?.topHeight ?? deck.topZ}
          min={-5}
          max={10}
          onCommit={(topHeight) => run(() => env.actions.setDeckProps(deck.id, { topHeight }))}
          locked={env.locked || env.readOnly}
          onLocked={env.onLocked}
          testId="deck-height"
        />
        <RailingFields deckId={deck.id} />
      </FieldGrid>
      <p className="note">{E.edgeHint}</p>
      <InfoRows rows={[[E.area, formatM2(multiPolygonArea(deck.pieces))]]} />
      <Actions
        actions={[
          { key: 'steps', label: E.addSteps, title: E.addStepsTitle, testId: 'deck-add-steps', onClick: () => addStepsOn(deck, undefined, env.actions.addSteps) },
          { key: 'corner', label: E.removeCorner, testId: 'deck-remove-corner', onClick: () => void showToast({ text: nb.toasts.pickCorner }) },
        ]}
      />
      {stored?.railing && freeEdges.length > 0 && (
        <More>
          <span className="nf-label">{E.edges}</span>
          <div className="edge-list">
            {freeEdges.map((edgeId) => {
              const i = deck.vertexIds.indexOf(edgeId);
              const n = deck.polygon.length;
              const length = i >= 0 ? len(deck.polygon[i], deck.polygon[(i + 1) % n]) : 0;
              return (
                <CheckField
                  key={edgeId}
                  label={E.edgeName(i + 1, formatM(length))}
                  checked={!stored.noRailingEdges.includes(edgeId)}
                  onChange={() => run(() => env.actions.toggleRailingEdge(edgeId))}
                  testId={`deck-edge-railing-${edgeId}`}
                />
              );
            })}
          </div>
        </More>
      )}
    </>
  );
}

export function DeckVertexEditor(props: { deck: DerivedDeck; vertexId: Id; p: Vec2 }) {
  const env = useEditorEnv();
  const { deck } = props;
  return (
    <>
      <InfoRows rows={[[nb.edit.block.position, formatPoint(props.p)]]} />
      <Actions
        actions={[
          {
            key: 'remove',
            label: E.removeCorner,
            danger: true,
            testId: 'deck-vertex-delete',
            onClick: () => env.onDelete({ kind: 'deckVertex', deck, vertexId: props.vertexId, index: deck.vertexIds.indexOf(props.vertexId), p: props.p }),
          },
          { key: 'deck', label: nb.selectionKinds.deck, safe: true, onClick: () => env.onSelect({ kind: 'deck', id: deck.id }) },
        ]}
      />
      {deck.polygon.length <= 3 && <p className="note">{nb.editor.deckMinVertices}</p>}
    </>
  );
}

export function DeckEdgeEditor(props: { deck: DerivedDeck; edgeId: Id; a: Vec2; b: Vec2 }) {
  const env = useEditorEnv();
  const run = useRun();
  const { deck, edgeId, a, b } = props;
  const stored = useStoredDeck(deck.id);
  const free = deck.freeRuns.some((r) => r.edgeId === edgeId);
  return (
    <>
      <InfoRows rows={[[F.length, formatM(len(a, b))]]} />
      {stored?.railing ? (
        free ? (
          <CheckField
            label={E.edgeRailing}
            checked={!stored.noRailingEdges.includes(edgeId)}
            onChange={() => run(() => env.actions.toggleRailingEdge(edgeId))}
            testId="deck-edge-railing"
          />
        ) : (
          <p className="note">{E.noFreeRun}</p>
        )
      ) : (
        <p className="note">{E.noRailing}</p>
      )}
      <Actions
        actions={[
          { key: 'steps', label: E.addSteps, testId: 'deck-edge-add-steps', onClick: () => addStepsOn(deck, edgeId, env.actions.addSteps) },
          {
            key: 'corner',
            label: E.addCorner,
            title: E.addCornerTitle,
            testId: 'deck-edge-add-corner',
            onClick: () => env.actions.insertDeckVertex(edgeId, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]),
          },
          { key: 'deck', label: nb.selectionKinds.deck, safe: true, onClick: () => env.onSelect({ kind: 'deck', id: deck.id }) },
        ]}
      />
    </>
  );
}

export function RailingEditor(props: { deckId: Id }) {
  return (
    <>
      <FieldGrid>
        <RailingFields deckId={props.deckId} />
      </FieldGrid>
      <p className="note">{E.edgeHint}</p>
    </>
  );
}

export function StepsEditor(props: { steps: DerivedSteps; deck: DerivedDeck | null }) {
  const env = useEditorEnv();
  const run = useRun();
  const { steps } = props;
  const S = nb.edit.steps;
  return (
    <>
      <FieldGrid>
        <NumberField
          label={S.width}
          value={steps.width}
          min={0.5}
          max={6}
          onCommit={(width) => run(() => env.actions.setStepsProps(steps.id, { width }))}
          locked={env.locked || env.readOnly}
          onLocked={env.onLocked}
          testId="steps-width"
        />
      </FieldGrid>
      {steps.blocked && (
        <p className="note warn-note" role="status">
          {S.blocked}
        </p>
      )}
      <InfoRows rows={[[S.risers, String(steps.risers)]]} />
      <Actions actions={[{ key: 'delete', label: S.delete, danger: true, testId: 'steps-delete', onClick: () => env.onDelete({ kind: 'steps', steps, deck: props.deck }) }]} />
    </>
  );
}

export function HotTubEditor(props: { hotTub: DerivedHotTub }) {
  const env = useEditorEnv();
  const run = useRun();
  const { hotTub } = props;
  const H = nb.edit.hotTub;
  return (
    <>
      <FieldGrid>
        <NumberField
          label={H.diameter}
          value={hotTub.diameter}
          min={0.8}
          max={5}
          onCommit={(d) => run(() => env.actions.setHotTubDiameter(hotTub.id, d))}
          locked={env.locked || env.readOnly}
          onLocked={env.onLocked}
          testId="hottub-diameter"
        />
      </FieldGrid>
      <Actions actions={[{ key: 'delete', label: H.delete, danger: true, testId: 'hottub-delete', onClick: () => env.onDelete({ kind: 'hotTub', hotTub }) }]} />
    </>
  );
}

export function TreeEditor(props: { tree: Tree; baseZ: number }) {
  const env = useEditorEnv();
  const T = nb.edit.tree;
  return (
    <>
      <InfoRows
        rows={[
          [T.height, formatLength(props.tree.height, 1)],
          [F.position, formatPoint(props.tree.position)],
        ]}
      />
      <Actions
        actions={[{ key: 'delete', label: T.delete, danger: true, testId: 'tree-delete', onClick: () => env.onDelete({ kind: 'tree', tree: props.tree, baseZ: props.baseZ }) }]}
      />
    </>
  );
}

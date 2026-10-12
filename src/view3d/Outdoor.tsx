/**
 * Outdoor: decks (their `pieces`: 0.15 m board slab + skirt boards down to the terrain), railings (one per deck:
 * posts, cap rail, glass panels or board slats), deck steps (`outdoor.steps`, one mesh per steps: solid treads in the
 * deck-side colour, tinted with their deck; blocked steps are not built) and hot tubs built like the old model's
 * badestamp (open wooden cylinder, water disc 13 cm below the rim, two sage hoops, a step box on the side facing the
 * house). Pickable (selection3d.ts) as deck / railing (`${deckId}/railing`) / steps (also lit by their deck) / hotTub.
 */
import { memo, useMemo } from 'react';
import type { DerivedDeck, DerivedHotTub, DerivedRailing, DerivedSteps, DerivedVariant } from '../model/derived';
import type { Vec2 } from '../model/types';
import { rotationYForPlanDir, toWorldTuple } from './coords';
import { buildDeck, buildRailing, buildSteps } from './geometryBuilders';
import { getMaterials, materialSet } from './materials';
import { pickable, useGeometries, useGeometry } from './sceneUtils';
import { deckPick, hotTubPick, railingPick, stepsPick } from './selection3d';

export interface OutdoorProps {
  outdoor: DerivedVariant['outdoor'];
  /** Centre of the built area (plan), used to turn the hot-tub step towards the house. */
  centre: Vec2;
  highlightNew: boolean;
}

export const Outdoor = memo(function Outdoor({ outdoor, centre, highlightNew }: OutdoorProps) {
  const deckIsNew = useMemo(() => new Map(outdoor.decks.map((d) => [d.id, d.isNew])), [outdoor.decks]);
  return (
    <group name="outdoor">
      {outdoor.decks.map((d) => (
        <DeckMesh key={d.id} deck={d} highlightNew={highlightNew} />
      ))}
      {outdoor.railings.map((r) => (
        <RailingMesh key={r.id} railing={r} highlightNew={highlightNew} />
      ))}
      {outdoor.steps
        .filter((s) => !s.blocked)
        .map((s) => (
          <StepsMesh key={s.id} steps={s} isNew={deckIsNew.get(s.deckId) ?? false} highlightNew={highlightNew} />
        ))}
      {outdoor.hotTubs.map((t) => (
        <HotTub key={t.id} tub={t} centre={centre} highlightNew={highlightNew} />
      ))}
    </group>
  );
});

const DeckMesh = memo(function DeckMesh({ deck, highlightNew }: { deck: DerivedDeck; highlightNew: boolean }) {
  const data = useMemo(() => buildDeck(deck), [deck]);
  const geometry = useGeometry(data);
  const set = materialSet(getMaterials(), deck.isNew, highlightNew);
  const materials = useMemo(() => [set.deck, set.deckSide], [set]);
  const userData = useMemo(() => pickable(deckPick(deck)), [deck]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={materials} castShadow receiveShadow userData={userData} />;
});

const RailingMesh = memo(function RailingMesh({ railing, highlightNew }: { railing: DerivedRailing; highlightNew: boolean }) {
  const datas = useMemo(() => {
    const b = buildRailing(railing);
    return [b.solid, railing.style === 'glass' ? b.glass : null];
  }, [railing]);
  const [solid, glass] = useGeometries(datas);
  const m = getMaterials();
  const set = materialSet(m, railing.isNew, highlightNew);
  const userData = useMemo(() => pickable(railingPick(railing)), [railing]);
  return (
    <group userData={userData}>
      {solid && <mesh geometry={solid} material={set.rail} castShadow receiveShadow />}
      {glass && <mesh geometry={glass} material={m.railGlass} renderOrder={1} />}
    </group>
  );
});

/** One steps (not blocked), tinted like its deck. */
const StepsMesh = memo(function StepsMesh({ steps, isNew, highlightNew }: { steps: DerivedSteps; isNew: boolean; highlightNew: boolean }) {
  const data = useMemo(() => buildSteps(steps), [steps]);
  const geometry = useGeometry(data);
  const set = materialSet(getMaterials(), isNew, highlightNew);
  const userData = useMemo(() => pickable(stepsPick(steps)), [steps]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={set.deckSide} castShadow receiveShadow userData={userData} />;
});

const HotTub = memo(function HotTub({ tub, centre, highlightNew }: { tub: DerivedHotTub; centre: Vec2; highlightNew: boolean }) {
  const m = getMaterials();
  const set = materialSet(m, tub.isNew, highlightNew);
  const r = tub.diameter / 2;
  const h = Math.max(0.2, tub.rimZ - tub.baseZ);
  const k = h / 1.05; // the old model's tub is 1.05 m tall; scale its details with the actual height
  const toHouse: Vec2 = useMemo(() => {
    const dx = centre[0] - tub.centre[0];
    const dy = centre[1] - tub.centre[1];
    const l = Math.hypot(dx, dy);
    return l < 1e-6 ? [0, 1] : [dx / l, dy / l];
  }, [centre, tub.centre]);
  const step: Vec2 = [toHouse[0] * (r + 0.3), toHouse[1] * (r + 0.3)];
  const stepRotation = rotationYForPlanDir([-toHouse[1], toHouse[0]]);
  const userData = useMemo(() => pickable(hotTubPick(tub)), [tub]);
  if (r <= 0) return null;
  return (
    <group position={toWorldTuple(tub.centre[0], tub.centre[1], tub.baseZ)} userData={userData}>
      <mesh position={[0, h / 2, 0]} material={set.tub} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 40, 1, true]} />
      </mesh>
      <mesh position={[0, h - 0.13 * k, 0]} rotation-x={-Math.PI / 2} material={m.tubWater} receiveShadow>
        <circleGeometry args={[Math.max(0.05, r - 0.03), 40]} />
      </mesh>
      {[0.25, 0.8].map((hh) => (
        <mesh key={hh} position={[0, hh * k, 0]} rotation-x={Math.PI / 2} material={set.trim} castShadow>
          <torusGeometry args={[r + 0.01, 0.025, 6, 40]} />
        </mesh>
      ))}
      <mesh position={toWorldTuple(step[0], step[1], 0.225)} rotation-y={stepRotation} material={set.rail} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.45, 0.45]} />
      </mesh>
    </group>
  );
});

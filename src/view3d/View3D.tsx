/**
 * 3D view (architecture.md "3D view" + "Component contracts"): root <div data-testid="view-3d"> holding an R3F
 * <Canvas dpr={[1, 1.5]} frameloop="demand" shadows> with the scene (Scene.tsx).
 *
 * - `flat` (no tone mapping) and sRGB output, like the old model's renderer; PCF shadows (three r186 has no
 *   PCFSoftShadowMap any more — softness comes from the light's filter radius, see SunLight.tsx).
 * - preserveDrawingBuffer so screenshots of a 'demand' canvas are never blank.
 * - The camera starts on the requested preset; later preset changes animate (Scene.tsx CameraRig).
 * - The root needs a sized parent (it fills it); it is its own stacking context so label z-indices stay inside.
 * - `onReady` fires once, after the first frame rendered with the camera on its preset.
 * - Clicks select (Scene.tsx / selection3d.ts: exterior walls as their block edge, stored walls, openings, rooms by
 *   their floor, decks, deck steps, railings, the hot tub, blocks by their roof or foundation, structure, trees,
 *   furniture); orbiting never selects. No dragging in 3D in phase 2a.
 * - `onDropFurniture` (phase 2b): a furniture library item released over the view (dropEvent.ts
 *   `dispatchFurnitureDrop`, received on the root) lands where the pointer's ray meets a visible floor, a deck or the
 *   shown ground (drop.ts); the handler gets the catalogue id, the plan point and the hit (surface, level, z).
 */
import { Canvas } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { DerivedVariant } from '../model/derived';
import type { Id, Site, TerrainAsset, Vec2, Vec3 } from '../model/types';
import type { Selection } from '../state/selection';
import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, presetWorld } from './cameras';
import type { CameraPreset } from './cameras';
import type { DropHit } from './drop';
import { PALETTE } from './materials';
import { Scene } from './Scene';
import { STRINGS } from './strings';

export type { CameraPreset } from './cameras';
export type { DropHit } from './drop';

export interface View3DProps {
  derived: DerivedVariant;
  site: Site;
  terrain: TerrainAsset | null;
  mode: 'ute' | 'inne';
  activeStoreyId: Id;
  /** Wall cut height in interior mode, metres above each level floor (the app passes 1.3, or 2.3 with 'inne-stua'). */
  cutHeight: number;
  showLabels: boolean;
  highlightNew: boolean;
  showTrees: boolean;
  showTerrain: boolean;
  /** Unit vector towards the sun, plan frame. */
  sun: { dir: Vec3; isUp: boolean };
  /** Changing it animates the camera. */
  preset: CameraPreset;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  /** First frame rendered. */
  onReady?: () => void;
  /**
   * A furniture library item dropped on the view (phase 2b): catalogue id, the plan point it lands on, and the hit
   * (surface 'floor' | 'deck' | 'terrain', the floor's levelId, z). Without it the view accepts no drops.
   */
  onDropFurniture?: (catalogId: string, planPoint: Vec2, hit: DropHit) => void;
}

const ROOT_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  isolation: 'isolate',
  touchAction: 'none',
  background: `#${PALETTE.background.toString(16).padStart(6, '0')}`,
};

const HINT_STYLE: CSSProperties = {
  position: 'absolute',
  left: 10,
  bottom: 10,
  fontSize: 12,
  color: '#1d241e',
  background: 'rgba(255,255,255,.8)',
  padding: '4px 8px',
  borderRadius: 4,
  pointerEvents: 'none',
  userSelect: 'none',
  zIndex: 50,
};

function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function View3D(props: View3DProps): JSX.Element {
  const coarse = useMemo(isCoarsePointer, []);
  /** The navigation hint: 3D labels keep clear of it (pinned tags move up above it in narrow panes). */
  const hint = useRef<HTMLDivElement>(null);
  /** The root receives the furniture drop events (they bubble up from the canvas). */
  const root = useRef<HTMLDivElement>(null);
  // Initial camera only; later preset changes are animated by the scene.
  const initialCamera = useMemo(() => {
    const v = presetWorld(props.preset, props.derived.bounds);
    return { fov: CAMERA_FOV, near: CAMERA_NEAR, far: CAMERA_FAR, position: v.position.toArray() as [number, number, number] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={root} data-testid="view-3d" style={ROOT_STYLE} aria-label={STRINGS.canvasLabel} role="region">
      <Canvas dpr={[1, 1.5]} frameloop="demand" shadows="percentage" flat gl={{ antialias: true, preserveDrawingBuffer: true }} camera={initialCamera}>
        <Scene {...props} coarse={coarse} labelReserve={hint} dropRoot={root} />
      </Canvas>
      <div ref={hint} style={HINT_STYLE}>
        {STRINGS.hint}
      </div>
    </div>
  );
}

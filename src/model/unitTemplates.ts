/**
 * Unit templates of the "Nytt bygg" tool (docs/phase2-plan.md §3.2, §3.5 "Unit placement"): Vedskjul 2 × 1,5 with an
 * open front, Bod 2 × 3, Badstue 2,4 × 2,2, Anneks 4 × 3 and Eget bygg 3 × 3. Pure data plus the footprint helper the
 * placement ghost and `placeUnit` share.
 *
 * Conventions (where the plan is silent):
 *  - `w` runs along the template's local x, `d` along its local y. The FRONT is the local south edge (edge 0, from the
 *    local south-west corner to the south-east corner), so it is `w` long: the Vedskjul's open front is its long side.
 *  - `unitFootprint(t, at, rotation90)`: the axis polygon (CCW) centred on `at`, turned by `rotation90` quarter turns
 *    counter-clockwise (0–3, taken modulo 4). Odd quarter turns swap the plan extents. Vertex 0 is always the local
 *    south-west corner, so the front edge is edge 0 whatever the rotation.
 *  - Roofs: gable roofs ridge along the longer side, pitch 28° like the cabin (drive 'pitch'); the Vedskjul has a mono
 *    roof falling to the back (away from the open front); Eget bygg is flat (the only template whose vertices may be
 *    dragged freely, §3.4). Turf like the cabin; overhangs 0.3 m.
 *  - Walls: light sheds (Vedskjul, Bod) 0.12 m with 0.03 m outside the axis line, the sauna 0.2 / 0.05, Anneks and Eget
 *    bygg take the variant's `defaultExteriorWall` (null here).
 *  - Names are the Norwegian names the family sees (block and room names are project data, stored in the variant once
 *    placed); they come from `nb.editor.units`, and the toolbar's chooser (`nb.tools.units`) uses the same words.
 */
import { nb } from '../i18n/nb';
import type { Cardinal, FloorMaterial, OpeningType, RoofType, RoomType, Vec2, WallBuildUp } from './types';

export type UnitTemplateId = 'vedskjul' | 'bod' | 'badstue' | 'anneks' | 'eget';

export interface UnitTemplate {
  id: UnitTemplateId;
  /** Block name, also the chooser label. */
  name: string;
  /** Name of the one room the unit gets. */
  roomName: string;
  roomType: RoomType;
  /** Floor of the room (Vedskjul: deck boards). */
  floorMaterial?: FloorMaterial;
  /** Width along the local x (the front) and depth along the local y (m, axis line). */
  w: number;
  d: number;
  roofType: RoofType;
  pitchDeg: number;
  /** Roof underside at the axis line above the floor (m). */
  eaveHeight: number;
  /** null = the variant's default exterior wall. */
  wall: WallBuildUp | null;
  /** A full-height frameless opening on the front edge (Vedskjul). */
  openFront: boolean;
  /** The door on the deck-facing side (none for the Vedskjul). */
  door: { type: OpeningType; width: number; height: number } | null;
}

export const UNIT_TEMPLATES: readonly UnitTemplate[] = [
  {
    id: 'vedskjul',
    name: nb.editor.units.vedskjul.block,
    roomName: nb.editor.units.vedskjul.room,
    roomType: 'bod',
    floorMaterial: 'deck',
    w: 2,
    d: 1.5,
    roofType: 'mono',
    pitchDeg: 10,
    eaveHeight: 2.0,
    wall: { thickness: 0.12, outerOffset: 0.03 },
    openFront: true,
    door: null,
  },
  {
    id: 'bod',
    name: nb.editor.units.bod.block,
    roomName: nb.editor.units.bod.room,
    roomType: 'bod',
    w: 2,
    d: 3,
    roofType: 'gable',
    pitchDeg: 28,
    eaveHeight: 2.1,
    wall: { thickness: 0.12, outerOffset: 0.03 },
    openFront: false,
    door: { type: 'door', width: 0.9, height: 2.0 },
  },
  {
    id: 'badstue',
    name: nb.editor.units.badstue.block,
    roomName: nb.editor.units.badstue.room,
    roomType: 'badstue',
    w: 2.4,
    d: 2.2,
    roofType: 'gable',
    pitchDeg: 28,
    eaveHeight: 2.2,
    wall: { thickness: 0.2, outerOffset: 0.05 },
    openFront: false,
    door: { type: 'saunaDoor', width: 0.7, height: 1.9 },
  },
  {
    id: 'anneks',
    name: nb.editor.units.anneks.block,
    roomName: nb.editor.units.anneks.room,
    roomType: 'soverom',
    w: 4,
    d: 3,
    roofType: 'gable',
    pitchDeg: 28,
    eaveHeight: 2.22,
    wall: null,
    openFront: false,
    door: { type: 'door', width: 0.9, height: 2.0 },
  },
  {
    id: 'eget',
    name: nb.editor.units.eget.block,
    roomName: nb.editor.units.eget.room,
    roomType: 'annet',
    w: 3,
    d: 3,
    roofType: 'flat',
    pitchDeg: 0,
    eaveHeight: 2.4,
    wall: null,
    openFront: false,
    door: { type: 'door', width: 0.9, height: 2.0 },
  },
];

export function unitTemplate(id: string | undefined): UnitTemplate | undefined {
  return UNIT_TEMPLATES.find((t) => t.id === id);
}

/** Quarter turns normalised to 0–3. */
export function quarterTurns(rotation90: number): 0 | 1 | 2 | 3 {
  const r = ((Math.round(rotation90) % 4) + 4) % 4;
  return r as 0 | 1 | 2 | 3;
}

/** Rotate a local vector by `rotation90` quarter turns counter-clockwise. */
export function rotateQuarter(v: Vec2, rotation90: number): Vec2 {
  switch (quarterTurns(rotation90)) {
    case 0:
      return [v[0], v[1]];
    case 1:
      return [-v[1], v[0]];
    case 2:
      return [-v[0], -v[1]];
    default:
      return [v[1], -v[0]];
  }
}

/** Plan extents (along x, along y) of a template turned by `rotation90`. */
export function unitSize(t: Pick<UnitTemplate, 'w' | 'd'>, rotation90: number): Vec2 {
  return quarterTurns(rotation90) % 2 === 0 ? [t.w, t.d] : [t.d, t.w];
}

/** Axis polygon (CCW) of a template centred on `at`; vertex 0 is the local south-west corner (front = edge 0). */
export function unitFootprint(t: Pick<UnitTemplate, 'w' | 'd'>, at: Vec2, rotation90: number): Vec2[] {
  const hw = t.w / 2;
  const hd = t.d / 2;
  const local: Vec2[] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return local.map((v) => {
    const r = rotateQuarter(v, rotation90);
    return [at[0] + r[0], at[1] + r[1]];
  });
}

/** Plan cardinal of a local direction after `rotation90` quarter turns (local +y = 'N'). */
export function cardinalOf(local: 'N' | 'S' | 'E' | 'W', rotation90: number): Cardinal {
  const order: Cardinal[] = ['E', 'N', 'W', 'S'];
  const i = order.indexOf(local);
  return order[(i + quarterTurns(rotation90)) % 4];
}

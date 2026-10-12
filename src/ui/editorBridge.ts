/**
 * The UI's side of the phase-2 editing contract (docs/phase2-plan.md §3.2, §3.6, §3.7), in ONE file: how the UI
 * reaches the editor core (`state/editActions.ts`, `state/store.ts`).
 *
 * 1. `UiEditActions`: every edit action the toolbar, the Egenskaper editors, the mini-bar and the keyboard call,
 *    with the argument shapes the UI uses. Components get them from `EditActionsContext` (`useUiEditActions()`);
 *    App.tsx provides the editor core's `useEditActions()` there (its bound actions satisfy this interface as they
 *    are). Without a provider every action is a no-op (tests render editors with mocks or nothing).
 *
 * 2. Editor UI state on the app store (store.ts phase-2 additions): `ui.tool`, `ui.toolOptions`, `ui.hint` and the
 *    top-level `toasts` with `showToast` / `dismissToast` (never in the undo history), behind small helpers.
 *
 * 3. The locked base proposal (§1 rule 1): `isVariantLocked`, `showLockedToast` (the refusal text with a
 *    "Nytt forslag" button) and `createNewProposal` (duplicate the active proposal and switch to it).
 *
 * Simplest-correct choices where the plan is silent:
 *  - A toast whose text equals `nb.proposals.locked` always gets the "Nytt forslag" button, so the editor core's own
 *    refusal toast (same text from the plan) gets it too, whatever its other fields.
 *  - "Nytt forslag" from the toast or the hint line needs no name: "Mitt forslag" ("Mitt forslag 2", … when taken).
 *    The top bar's "+ Nytt forslag" asks for a name first. Its toast has no Angre button (the text points at the
 *    toolbar's Angre; a button there would throw the new proposal away), and it closes the first-run card.
 */
import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import { nb } from '../i18n/nb';
import type {
  Deck,
  FloorMaterial,
  FurnitureItem,
  Id,
  Opening,
  OpeningType,
  Project,
  Roof,
  RoomType,
  Vec2,
  Variant,
  Wall,
  WallBuildUp,
  WallKind,
} from '../model/types';
import { appStore, useAppStore } from '../state/appStore';
import type { Selection } from '../state/selection';
import { selectActiveVariant } from '../state/store';
import type { AppState, Toast, Tool, ToolOptions } from '../state/store';
import type { UnitTemplateId } from '../model/unitTemplates';
import { dismissFirstRun } from './firstRun';

// ---------------------------------------------------------------------------
// Tools and editor UI state (store.ts: ui.tool / toolOptions / hint, toasts)
// ---------------------------------------------------------------------------

/** docs/phase2-plan.md §3.2: Velg · Vegg · Dør/vindu · Nytt bygg · Møbler · Mål. */
export const TOOL_KINDS = ['select', 'wall', 'opening', 'unit', 'furniture', 'measure'] as const satisfies readonly Tool[];
export type ToolKind = Tool;

/** Tools that change the proposal (greyed on the locked base proposal). Velg and Mål only look. */
export const EDITING_TOOLS: readonly ToolKind[] = ['wall', 'opening', 'unit', 'furniture'];

/** Unit templates of "Nytt bygg", in chooser order (model/unitTemplates.ts ids). */
export const UNIT_TEMPLATE_IDS = ['vedskjul', 'bod', 'badstue', 'anneks', 'eget'] as const satisfies readonly UnitTemplateId[];

/** Opening types of the Dør/vindu chooser, in order. */
export const TOOL_OPENING_TYPES: readonly OpeningType[] = ['window', 'door', 'glassDoor', 'slidingDoor', 'saunaDoor', 'opening'];

/** Defaults applied when a tool is picked without options (the plan can place right away). */
export const DEFAULT_TOOL_OPTIONS = { openingType: 'window', unitTemplate: 'vedskjul' } as const satisfies ToolOptions;

export type ToastItem = Toast;
export type ToastInput = Omit<Toast, 'id' | 'seq'>;

export const selectTool = (s: AppState): ToolKind => s.ui.tool;
export const selectToolOptions = (s: AppState): ToolOptions => s.ui.toolOptions;
export const selectHint = (s: AppState): string | null => s.ui.hint;
export const selectToasts = (s: AppState): Toast[] => s.toasts;

export function useTool(): ToolKind {
  return useAppStore(selectTool);
}
export function useToolOptions(): ToolOptions {
  return useAppStore(selectToolOptions);
}
export function useHint(): string | null {
  return useAppStore(selectHint);
}
export function useToasts(): Toast[] {
  return useAppStore(selectToasts);
}

/**
 * Switch tools. Picking 'opening' / 'unit' fills in a default type / template (and 0 quarter turns) when none is
 * chosen; any switch clears a tool-specific hint (the plan sets e.g. "Trykk der den skal slutte" while a wall is half drawn).
 */
export function setTool(tool: ToolKind, options?: ToolOptions): void {
  const state = appStore.getState();
  const next: ToolOptions = { ...state.ui.toolOptions, ...options };
  if (tool === 'opening' && !next.openingType) next.openingType = DEFAULT_TOOL_OPTIONS.openingType;
  if (tool === 'unit' && !next.unitTemplate) next.unitTemplate = DEFAULT_TOOL_OPTIONS.unitTemplate;
  // The UI owns the unit's quarter turns (the Drei button and R), so the plan never turns the ghost on its own.
  if (tool === 'unit' && next.unitRotation90 === undefined) next.unitRotation90 = 0;
  state.setUi({ tool, toolOptions: next, hint: null });
}

/** Tools that only work in the plan. */
const PLAN_TOOLS: readonly ToolKind[] = ['wall', 'opening', 'unit', 'measure'];

/**
 * A click on a toolbar tool: the locked base proposal refuses the editing tools (toast); the active tool again goes
 * back to Velg; plan-only tools switch a 3D-only view to the plan.
 */
export function pickTool(tool: ToolKind): void {
  const state = appStore.getState();
  if (state.ui.readOnly) return;
  const locked = state.project.variants.find((v) => v.id === state.project.activeVariantId)?.locked === true;
  if (locked && EDITING_TOOLS.includes(tool)) {
    showLockedToast();
    return;
  }
  if (tool !== 'select' && state.ui.tool === tool) {
    setTool('select');
    return;
  }
  if (PLAN_TOOLS.includes(tool) && state.ui.activeView === '3d') state.setUi({ activeView: 'plan' });
  setTool(tool);
}

export function setToolOptions(options: ToolOptions): void {
  const state = appStore.getState();
  state.setUi({ toolOptions: { ...state.ui.toolOptions, ...options } });
}

/** Show a toast (store.showToast: the same text on screen is refreshed instead). Returns its id. */
export function showToast(input: ToastInput): string {
  return appStore.getState().showToast(input);
}

export function dismissToast(id: string): void {
  appStore.getState().dismissToast(id);
}

/** Does this toast get the "Nytt forslag" button? */
export function toastOffersNewProposal(t: Pick<Toast, 'text' | 'action'>): boolean {
  return t.action === 'newProposal' || t.text === nb.proposals.locked;
}

/** The refusal on the locked base proposal (§1 rule 1). */
export function showLockedToast(): void {
  showToast({ text: nb.proposals.locked, action: 'newProposal' });
}

// ---------------------------------------------------------------------------
// The locked base proposal and "Nytt forslag"
// ---------------------------------------------------------------------------

/** docs/phase2-plan.md §3.4: the only lock is variant-level. */
export function isVariantLocked(variant: Pick<Variant, 'locked'> | null | undefined): boolean {
  return variant?.locked === true;
}

export function useActiveVariantLocked(): boolean {
  return useAppStore((s) => isVariantLocked(selectActiveVariant(s)));
}

/** "Mitt forslag", or "Mitt forslag 2", "Mitt forslag 3", … when the name is taken in `project`. */
export function nextProposalName(project: Pick<Project, 'variants'>): string {
  const names = new Set(project.variants.map((v) => v.name));
  if (!names.has(nb.proposals.defaultName)) return nb.proposals.defaultName;
  for (let n = 2; ; n++) {
    const name = nb.proposals.numberedName(n);
    if (!names.has(name)) return name;
  }
}

/**
 * "Nytt forslag": copy the active proposal (an unlocked copy, `duplicateVariant`) and switch to it; the tool goes
 * back to Velg. `name` defaults to `nextProposalName`. Returns the new variant id (null when nothing was done, e.g.
 * read-only).
 */
export function createNewProposal(name?: string): Id | null {
  const state = appStore.getState();
  const active = selectActiveVariant(state);
  const finalName = name?.trim() || nextProposalName(state.project);
  const id = state.duplicateVariant(active.id, finalName);
  if (id) {
    for (const t of selectToasts(appStore.getState())) if (toastOffersNewProposal(t)) dismissToast(t.id);
    setTool('select');
    showToast({ text: nb.proposals.created(finalName) });
    dismissFirstRun();
  }
  return id;
}

// ---------------------------------------------------------------------------
// Edit actions the UI calls (docs/phase2-plan.md §3.6)
// ---------------------------------------------------------------------------

/** 'min' = the side with the smaller x (Bredde) / y (Dybde): left / lower in the plan; 'max' = right / upper. */
export type RoomSide = 'min' | 'max';

export interface RoomPatch {
  name?: string;
  type?: RoomType;
  /** null = back to the room type's default. */
  floorMaterial?: FloorMaterial | null;
  note?: string;
}

export interface WallPatch {
  thickness?: number;
  heightMode?: Wall['heightMode'];
  height?: number;
  kind?: WallKind;
}

export type OpeningPatch = Partial<Pick<Opening, 'type' | 'width' | 'height' | 'sill' | 'leaves' | 'swing' | 'style' | 'fullHeight'>>;

export interface BlockPatch {
  name?: string;
  /** Pitch (with drive 'pitch') or ridge height (with drive 'height'): the UI passes `drive` with the value it set. */
  roof?: Partial<Roof>;
  eaveHeight?: number;
  wall?: Partial<WallBuildUp>;
  /** null = no flat ceiling (open to the roof). */
  ceilingHeight?: number | null;
  /** Template units: add (true) or remove (false) the full-height opening on `templateFrontEdgeId`. */
  openFront?: boolean;
}

export interface DeckPatch {
  topHeight?: number;
  /** null = no railing. */
  railing?: Deck['railing'] | null;
}

export interface FurniturePatch {
  size?: FurnitureItem['size'];
  colour?: string | null;
  sizeVariant?: string;
}

export interface UiEditActions {
  // Rooms
  /** Give a detected face without a Room record a name (anchor = the face's label point). Returns the new Room's id. */
  nameFace(faceId: Id, name: string, opts: { type: RoomType; levelId: Id }): Id | null | void;
  setRoomProps(roomId: Id, patch: RoomPatch): void;
  /** Set the room's inner width ('w', along x) or depth ('d', along y) by moving the stored wall on `side`. */
  resizeRoom(roomId: Id, axis: 'w' | 'd', value: number, side: RoomSide): void;
  deleteRoom(roomId: Id): void;
  // Walls
  moveWallEndpoint(wallId: Id, end: 'a' | 'b', p: Vec2): void;
  /** t in (0, 1) along a→b. */
  splitWall(wallId: Id, t: number): void;
  deleteWall(wallId: Id): void;
  setWallProps(wallId: Id, patch: WallPatch): void;
  /** "Ta tilbake": a ghost wall / opening id (`…/ghost`, or a stored element with status 'removed') or a `Variant.ghosts` id. */
  restoreGhost(id: Id): void;
  // Openings
  /** `offset` along the STORED host (block edge from its start vertex, or wall from a), to the centre. */
  moveOpening(openingId: Id, offset: number): void;
  setOpeningProps(openingId: Id, patch: OpeningPatch): void;
  deleteOpening(openingId: Id): void;
  // Blocks
  /** Move one block edge by `delta` (plan metres; the UI passes the edge's outward normal × distance). */
  moveBlockEdge(blockId: Id, edgeId: Id, delta: Vec2): void;
  setBlockProps(blockId: Id, patch: BlockPatch): void;
  /** Bredde ('w') / Dybde ('d') of a block's axis box, moving the edge on `side` ('max' = east / north). */
  setBlockSize(blockId: Id, axis: 'w' | 'd', value: number, side: RoomSide): void;
  deleteBlock(blockId: Id): void;
  duplicateBlock(blockId: Id): void;
  /** "Roter 90°" for a placed template unit: a quarter turn around its centre (90 = counter-clockwise), the core's `rotateBlock`. */
  rotateBlock(blockId: Id, degrees: 90 | -90): void;
  // Deck
  setDeckProps(deckId: Id, patch: DeckPatch): void;
  toggleRailingEdge(edgeId: Id): void;
  /** New steps on deck edge `edgeId`, centred `offset` m from the edge start (default width). */
  addSteps(edgeId: Id, offset: number): void;
  /** Not in the plan's list: the Trapp editor's Bredde field. */
  setStepsProps(stepsId: Id, patch: { width?: number }): void;
  deleteSteps(stepsId: Id): void;
  insertDeckVertex(edgeId: Id, p: Vec2): void;
  deleteDeckVertex(vertexId: Id): void;
  // Other
  setHotTubDiameter(hotTubId: Id, diameter: number): void;
  /** Not in the plan's list: the Badestamp editor's [Slett]. */
  deleteHotTub(hotTubId: Id): void;
  deleteTree(treeId: Id): void;
  setVariantNotes(notes: string): void;
  /** Arrow keys: 1 cm, with Shift 10 cm (one undo step per run, transaction 'nudge:<id>'). */
  nudge(selection: Selection, dx: number, dy: number): void;
  // Furniture
  rotateFurniture(furnitureId: Id, degrees: number): void;
  setFurnitureProps(furnitureId: Id, patch: FurniturePatch): void;
  /** The copy's id (the UI selects it), null when refused. */
  duplicateFurniture(furnitureId: Id): Id | null | void;
  deleteFurniture(furnitureId: Id): void;
}

const noop = () => {};

/** Actions that do nothing (no provider: tests of pure rendering, the shell before wiring). */
export const NOOP_EDIT_ACTIONS: UiEditActions = {
  nameFace: noop,
  setRoomProps: noop,
  resizeRoom: noop,
  deleteRoom: noop,
  moveWallEndpoint: noop,
  splitWall: noop,
  deleteWall: noop,
  setWallProps: noop,
  restoreGhost: noop,
  moveOpening: noop,
  setOpeningProps: noop,
  deleteOpening: noop,
  moveBlockEdge: noop,
  setBlockProps: noop,
  setBlockSize: noop,
  deleteBlock: noop,
  duplicateBlock: noop,
  rotateBlock: noop,
  setDeckProps: noop,
  toggleRailingEdge: noop,
  addSteps: noop,
  setStepsProps: noop,
  deleteSteps: noop,
  insertDeckVertex: noop,
  deleteDeckVertex: noop,
  setHotTubDiameter: noop,
  deleteHotTub: noop,
  deleteTree: noop,
  setVariantNotes: noop,
  nudge: noop,
  rotateFurniture: noop,
  setFurnitureProps: noop,
  duplicateFurniture: noop,
  deleteFurniture: noop,
};

/**
 * The editor core's bound actions (`useEditActions()`) as `UiEditActions`: `rotateBlock` is the core's bound
 * `rotateBlock` (fix round after 2a); a core without it gets a typed no-op, so the UI compiles and runs either way.
 */
export function uiEditActionsFrom(core: Omit<UiEditActions, 'rotateBlock'> & Partial<Pick<UiEditActions, 'rotateBlock'>>): UiEditActions {
  const bound = core.rotateBlock;
  const rotateBlock = bound ? (blockId: Id, degrees: 90 | -90) => void bound(blockId, degrees) : noop;
  // «Dupliser» / Ctrl+D selects the copy, so it can be dragged away from the original right away.
  const duplicateFurniture = (furnitureId: Id) => {
    const id = core.duplicateFurniture(furnitureId);
    if (typeof id === 'string') appStore.getState().select({ kind: 'furniture', id });
    return id;
  };
  return { ...core, rotateBlock, duplicateFurniture };
}

export const EditActionsContext = createContext<UiEditActions>(NOOP_EDIT_ACTIONS);

export function EditActionsProvider(props: { actions: UiEditActions; children: ReactNode }) {
  return createElement(EditActionsContext.Provider, { value: props.actions }, props.children);
}

export function useUiEditActions(): UiEditActions {
  return useContext(EditActionsContext);
}


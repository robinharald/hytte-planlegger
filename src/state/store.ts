/**
 * Application store: zustand + immer (drafts) + zundo (undo/redo of `project` only).
 *
 * `createAppStore(initialProject, initialUi?)` is a factory so tests can build a store from a fixture without the
 * seed; the app-wide singleton and the bootstrap (autosave / link / seed) live in `appStore.ts`.
 *
 * History rules
 *  - zundo tracks `{ project }` only (partialize), limit 200, equality by reference: a store update that leaves
 *    `project` identical (every `setUi`) creates no history entry.
 *  - `beginTransaction(label)` / `commitTransaction()` make a drag or slider ONE undo step: tracking is paused
 *    in between and the pre-transaction project is pushed as a single past state on commit (when anything
 *    changed). `cancelTransaction()` restores the pre-transaction project without a history entry.
 *  - `updateVariant(id, recipe, { transaction })` is the lighter alternative for sliders without explicit
 *    begin/commit: consecutive calls with the SAME label collapse into the entry created by the first call;
 *    any other project action ends the group.
 *  - `canUndo` / `canRedo` mirror the temporal store so components can subscribe to them like any field.
 *  - `updatedAt` is fresh after every change of the project, including undo, redo and `setProject` (a restored
 *    version or an imported file brings its old timestamp): autosave and the other-tab check key a saved
 *    document by `id@updatedAt`, so a project must never come back with an old one. Undo/redo stamp it untracked.
 *  - While `ui.readOnly` (shared link) every project action, undo and redo is a no-op; `replaceProject` is the
 *    one unguarded entry point (bootstrap, link, "Lag min egen kopi", "Hent endringene") and clears the history.
 *    Documented exception: `setActiveVariant` still works while read-only, WITHOUT a history entry, so a viewer
 *    of a link shared with "del alle varianter" can look at every variant (autosave is off while read-only, so
 *    nothing is persisted).
 *  - `duplicateVariant` deep-copies the variant and gives ONLY the variant a new id (blocks, walls, rooms keep
 *    their ids — ids are unique per variant). The copy is inserted after the source and becomes active.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { nanoid } from 'nanoid';
import type { Id, Project, Variant } from '../model/types';
import type { CameraPreset } from '../view3d/View3D';
import type { Selection } from './selection';

export const HISTORY_LIMIT = 200;

export type ActiveView = 'plan' | '3d' | 'split';
export type PlanStorey = 'ground' | 'loft';
export type Mode3d = 'ute' | 'inne';
export type Tool = 'select' | 'measure';
export type ProjectSource = 'local' | 'link' | 'version';

/** "Begge" (plan and 3D side by side) is the default only on windows at least this wide; narrower ones open the plan. */
export const SPLIT_MIN_WIDTH = 1600;

/** Default view for a window width when the user has not chosen one (`UiState.activeViewChosen`). */
export function defaultActiveView(windowWidth: number): ActiveView {
  return windowWidth >= SPLIT_MIN_WIDTH ? 'split' : 'plan';
}

export interface UiState {
  activeView: ActiveView;
  /** The user picked `activeView` with the view tabs (only then is it remembered in the UI prefs). */
  activeViewChosen: boolean;
  planStorey: PlanStorey;
  /** Storey whose levels the 3D interior mode shows (storeys above it are hidden). Kept in step with planStorey. */
  activeStoreyId: Id;
  mode3d: Mode3d;
  cutHeight: number;
  /**
   * The cut height the user had before choosing 'inne-stua' raised it to `EYE_LEVEL_CUT`; null when no preset
   * raised it. Choosing another preset restores it (`presetUi`); any other change of `cutHeight` through `setUi`
   * (the slider: the user's own choice) clears it.
   */
  cutHeightBeforePreset: number | null;
  showLabels: boolean;
  showDims: boolean;
  showGrid: boolean;
  showRoofPlan: boolean;
  highlightNew: boolean;
  showTrees: boolean;
  showTerrain: boolean;
  preset: CameraPreset;
  selection: Selection | null;
  tool: Tool;
  /** Sun study: local date (YYYY-MM-DD) and minutes after local midnight at the site (Site.timezone). */
  sun: { date: string; minutes: number };
  readOnly: boolean;
  source: ProjectSource;
}

export const DEFAULT_UI: UiState = {
  activeView: 'plan',
  activeViewChosen: false,
  planStorey: 'ground',
  activeStoreyId: 'ground',
  mode3d: 'ute',
  /** Below the 'inne-stua' eye height (1.55), so the views from above look into the rooms; see `presetUi`. */
  cutHeight: 1.3,
  cutHeightBeforePreset: null,
  showLabels: true,
  showDims: true,
  showGrid: true,
  showRoofPlan: false,
  highlightNew: false,
  showTrees: true,
  showTerrain: true,
  preset: 'oversikt',
  selection: null,
  tool: 'select',
  sun: { date: '2026-06-21', minutes: 900 },
  readOnly: false,
  source: 'local',
};

export const CUT_HEIGHT_MIN = 1.2;
export const CUT_HEIGHT_MAX = 2.6;

/**
 * Cut height the eye-level preset 'inne-stua' needs (eye at 1.55 m): the walls rise above the eye, so the view reads
 * as a room and not as one band of wall tops on the horizon.
 */
export const EYE_LEVEL_CUT = 2.3;

/**
 * UI change for choosing a camera preset: 'inne-stua' also raises a lower cut height to `EYE_LEVEL_CUT` and
 * remembers the one it replaced; any other preset puts that one back (unless the user has set the cut height since,
 * which clears the memory, see `setUi`).
 */
export function presetUi(preset: CameraPreset, ui: Pick<UiState, 'cutHeight' | 'cutHeightBeforePreset'>): Partial<UiState> {
  if (preset === 'inne-stua') {
    return ui.cutHeight < EYE_LEVEL_CUT ? { preset, cutHeight: EYE_LEVEL_CUT, cutHeightBeforePreset: ui.cutHeight } : { preset };
  }
  return ui.cutHeightBeforePreset === null ? { preset } : { preset, cutHeight: ui.cutHeightBeforePreset, cutHeightBeforePreset: null };
}

/** Every camera preset, in button order (the type itself is contracted in view3d/View3D.tsx). */
export const CAMERA_PRESET_KEYS = [
  'oversikt',
  'terrassen',
  'framsiden',
  'baksiden',
  'langsiden',
  'ovenfra',
  'naert-tilbygget',
  'inne-stua',
] as const satisfies readonly CameraPreset[];

export type VariantRecipe = (draft: Variant) => void;

/** The undo/redo stacks (oldest first), e.g. to come back to one's own project after looking at a shared link. */
export interface HistorySnapshot {
  past: Project[];
  future: Project[];
}

export const EMPTY_HISTORY: HistorySnapshot = { past: [], future: [] };

export interface AppState {
  project: Project;
  ui: UiState;
  canUndo: boolean;
  canRedo: boolean;

  // project actions (no-ops while ui.readOnly)
  setProject(project: Project): void;
  updateVariant(id: Id, recipe: VariantRecipe, opts?: { transaction?: string }): void;
  updateActiveVariant(recipe: VariantRecipe, opts?: { transaction?: string }): void;
  /** Returns the new variant id, or null when nothing was done. */
  duplicateVariant(id: Id, name: string): Id | null;
  addVariant(variant: Variant, opts?: { activate?: boolean; seedRevision?: number }): void;
  /** Append several variants (ids not in the project yet) as ONE undo step; `activeId` becomes the active variant. */
  addVariants(variants: Variant[], opts?: { activeId?: Id }): void;
  setActiveVariant(id: Id): void;
  renameVariant(id: Id, name: string): void;
  deleteVariant(id: Id): void;
  renameRoom(roomId: Id, name: string): void;

  beginTransaction(label: string): void;
  commitTransaction(): void;
  cancelTransaction(): void;
  inTransaction(): boolean;

  undo(): void;
  redo(): void;
  clearHistory(): void;
  /** Copy of the undo/redo stacks. */
  history(): HistorySnapshot;

  /**
   * System entry point, not guarded by readOnly: replaces the project (and patches ui) and clears the history, or
   * installs `history` instead (returning to a project whose stacks were kept with `history()`).
   */
  replaceProject(project: Project, ui?: Partial<UiState>, history?: HistorySnapshot): void;

  /** Patch the UI state. A patch with `cutHeight` but without `cutHeightBeforePreset` clears the latter. */
  setUi(patch: Partial<UiState>): void;
  select(selection: Selection | null): void;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Last value handed out by `nextStamp` (ms), module-wide so it also holds across stores. */
let lastStampMs = 0;

/**
 * A fresh ISO timestamp strictly later than every `previous` one: `id@updatedAt` identifies a saved document
 * (persistence.projectKey), so two changes in the same millisecond, or an undo right after an edit, must still
 * get different values.
 */
export function nextStamp(...previous: string[]): string {
  let t = Math.max(Date.now(), lastStampMs + 1);
  for (const p of previous) {
    const ms = Date.parse(p);
    if (Number.isFinite(ms) && ms >= t) t = ms + 1;
  }
  lastStampMs = t;
  return new Date(t).toISOString();
}

/** Default name for a duplicated variant: "Forslag D (kopi)". */
export function copyName(name: string): string {
  return `${name} (kopi)`;
}

export function selectActiveVariant(state: Pick<AppState, 'project'>): Variant {
  const { variants, activeVariantId } = state.project;
  return variants.find((v) => v.id === activeVariantId) ?? variants[0];
}

export function createAppStore(initialProject: Project, initialUi: Partial<UiState> = {}, opts: { historyLimit?: number } = {}) {
  const limit = opts.historyLimit ?? HISTORY_LIMIT;
  let tx: { label: string; start: Project } | null = null;
  let mergeKey: string | null = null;

  const store = create<AppState>()(
    temporal(
      immer((set, get) => {
        const temporalApi = () => store.temporal.getState();
        const readOnly = () => get().ui.readOnly;

        /** Push `start` as one past state (used by commitTransaction). */
        const pushPast = (start: Project) => {
          store.temporal.setState((t) => ({
            pastStates: [...t.pastStates, { project: start }].slice(-limit),
            futureStates: [],
          }));
        };

        /** Run `fn` with history tracking paused (no entry), unless something already paused it. */
        const untracked = (fn: () => void) => {
          const t = temporalApi();
          const pause = t.isTracking;
          if (pause) t.pause();
          try {
            fn();
          } finally {
            if (pause) t.resume();
          }
        };

        const applyRecipe = (id: Id, recipe: VariantRecipe) => {
          set((s) => {
            const v = s.project.variants.find((x) => x.id === id);
            if (!v) return;
            recipe(v);
            s.project.updatedAt = nextStamp(s.project.updatedAt);
          });
        };

        /** After undo/redo: clear the selection and, when the project changed, give it a fresh updatedAt (no entry). */
        const afterTimeTravel = (before: Project) =>
          untracked(() =>
            set((s) => {
              s.ui.selection = null;
              if (get().project !== before) s.project.updatedAt = nextStamp(s.project.updatedAt);
            }),
          );

        return {
          project: initialProject,
          ui: { ...DEFAULT_UI, ...initialUi },
          canUndo: false,
          canRedo: false,

          setProject: (project) => {
            if (readOnly()) return;
            mergeKey = null;
            set((s) => {
              s.project = { ...project, updatedAt: nextStamp(get().project.updatedAt, project.updatedAt) };
              s.ui.selection = null;
            });
          },

          updateVariant: (id, recipe, o) => {
            if (readOnly()) return;
            const key = o?.transaction ?? null;
            const merge = key !== null && key === mergeKey && tx === null;
            if (merge) untracked(() => applyRecipe(id, recipe));
            else applyRecipe(id, recipe);
            mergeKey = key;
          },

          updateActiveVariant: (recipe, o) => {
            get().updateVariant(get().project.activeVariantId, recipe, o);
          },

          duplicateVariant: (id, name) => {
            if (readOnly()) return null;
            const source = get().project.variants.find((v) => v.id === id);
            if (!source) return null;
            mergeKey = null;
            const copy: Variant = structuredClone(source);
            copy.id = nanoid(10);
            copy.name = name.trim() || copyName(source.name);
            copy.createdAt = nowISO();
            copy.basedOnId = id;
            set((s) => {
              const i = s.project.variants.findIndex((v) => v.id === id);
              s.project.variants.splice(i + 1, 0, copy);
              s.project.activeVariantId = copy.id;
              s.project.updatedAt = nextStamp(s.project.updatedAt);
              s.ui.selection = null;
            });
            return copy.id;
          },

          addVariant: (variant, o) => {
            if (readOnly()) return;
            if (get().project.variants.some((v) => v.id === variant.id)) return;
            mergeKey = null;
            set((s) => {
              s.project.variants.push(variant);
              if (o?.activate) {
                s.project.activeVariantId = variant.id;
                s.ui.selection = null;
              }
              if (o?.seedRevision !== undefined) s.project.seedRevision = o.seedRevision;
              s.project.updatedAt = nextStamp(s.project.updatedAt);
            });
          },

          addVariants: (variants, o) => {
            if (readOnly()) return;
            const taken = new Set(get().project.variants.map((v) => v.id));
            const fresh: Variant[] = [];
            for (const v of variants) {
              if (taken.has(v.id)) continue;
              taken.add(v.id);
              fresh.push(v);
            }
            if (fresh.length === 0) return;
            mergeKey = null;
            set((s) => {
              s.project.variants.push(...fresh);
              if (o?.activeId && fresh.some((v) => v.id === o.activeId)) {
                s.project.activeVariantId = o.activeId;
                s.ui.selection = null;
              }
              s.project.updatedAt = nextStamp(s.project.updatedAt);
            });
          },

          setActiveVariant: (id) => {
            const p = get().project;
            if (p.activeVariantId === id || !p.variants.some((v) => v.id === id)) return;
            mergeKey = null;
            const viewOnly = readOnly();
            const apply = () =>
              set((s) => {
                s.project.activeVariantId = id;
                if (!viewOnly) s.project.updatedAt = nextStamp(s.project.updatedAt);
                s.ui.selection = null;
              });
            if (viewOnly) untracked(apply);
            else apply();
          },

          renameVariant: (id, name) => {
            if (readOnly()) return;
            const trimmed = name.trim();
            const v = get().project.variants.find((x) => x.id === id);
            if (!trimmed || !v || v.name === trimmed) return;
            mergeKey = null;
            set((s) => {
              const draft = s.project.variants.find((x) => x.id === id);
              if (draft) draft.name = trimmed;
              s.project.updatedAt = nextStamp(s.project.updatedAt);
            });
          },

          deleteVariant: (id) => {
            if (readOnly()) return;
            const { variants } = get().project;
            const i = variants.findIndex((v) => v.id === id);
            if (variants.length <= 1 || i < 0) return;
            mergeKey = null;
            set((s) => {
              s.project.variants.splice(i, 1);
              if (s.project.activeVariantId === id) {
                s.project.activeVariantId = s.project.variants[Math.max(0, i - 1)].id;
                s.ui.selection = null;
              }
              s.project.updatedAt = nextStamp(s.project.updatedAt);
            });
          },

          renameRoom: (roomId, name) => {
            if (readOnly()) return;
            const trimmed = name.trim();
            const variant = selectActiveVariant(get());
            const room = variant.rooms.find((r) => r.id === roomId);
            if (!trimmed || !room || room.name === trimmed) return;
            mergeKey = null;
            applyRecipe(variant.id, (v) => {
              const r = v.rooms.find((x) => x.id === roomId);
              if (r) r.name = trimmed;
            });
          },

          beginTransaction: (label) => {
            if (readOnly()) return;
            if (tx) get().commitTransaction();
            mergeKey = null;
            tx = { label, start: get().project };
            temporalApi().pause();
          },

          commitTransaction: () => {
            if (!tx) return;
            const { start } = tx;
            tx = null;
            // A later updateVariant with the same label must start its own undo step.
            mergeKey = null;
            temporalApi().resume();
            if (get().project !== start) pushPast(start);
          },

          cancelTransaction: () => {
            if (!tx) return;
            const { start } = tx;
            tx = null;
            mergeKey = null;
            set((s) => {
              s.project = start;
            });
            temporalApi().resume();
          },

          inTransaction: () => tx !== null,

          undo: () => {
            if (readOnly() || tx) return;
            mergeKey = null;
            const before = get().project;
            temporalApi().undo();
            afterTimeTravel(before);
          },

          redo: () => {
            if (readOnly() || tx) return;
            mergeKey = null;
            const before = get().project;
            temporalApi().redo();
            afterTimeTravel(before);
          },

          clearHistory: () => {
            mergeKey = null;
            temporalApi().clear();
          },

          history: (): HistorySnapshot => {
            const t = temporalApi();
            const projects = (states: readonly Partial<{ project: Project }>[]) =>
              states.flatMap((x) => (x.project ? [x.project] : []));
            return { past: projects(t.pastStates), future: projects(t.futureStates) };
          },

          replaceProject: (project, ui, history) => {
            if (tx) {
              tx = null;
              temporalApi().resume();
            }
            mergeKey = null;
            untracked(() =>
              set((s) => {
                s.project = project;
                s.ui = { ...s.ui, ...ui, selection: null };
              }),
            );
            temporalApi().clear();
            if (history && (history.past.length > 0 || history.future.length > 0)) {
              store.temporal.setState({
                pastStates: history.past.slice(-limit).map((p) => ({ project: p })),
                futureStates: history.future.slice(-limit).map((p) => ({ project: p })),
              });
            }
          },

          setUi: (patch) => {
            set((s) => {
              Object.assign(s.ui, patch);
              // A cut height set by anything but a preset is the user's own: forget the one 'inne-stua' replaced.
              if ('cutHeight' in patch && !('cutHeightBeforePreset' in patch)) s.ui.cutHeightBeforePreset = null;
            });
          },

          select: (selection) => {
            set((s) => {
              s.ui.selection = selection;
            });
          },
        };
      }),
      {
        partialize: (s) => ({ project: s.project }),
        limit,
        equality: (a, b) => a.project === b.project,
      },
    ),
  );

  // Mirror history availability into the main store (no history entry: project is unchanged).
  const syncFlags = () => {
    const t = store.temporal.getState();
    const canUndo = t.pastStates.length > 0;
    const canRedo = t.futureStates.length > 0;
    const s = store.getState();
    if (s.canUndo !== canUndo || s.canRedo !== canRedo) store.setState({ canUndo, canRedo });
  };
  store.temporal.subscribe(syncFlags);
  syncFlags();

  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;

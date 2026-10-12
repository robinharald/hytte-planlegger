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
 *    their ids — ids are unique per variant). The copy is inserted after the source and becomes active. The copy is
 *    never `locked` (duplicating the locked base proposal Forslag D is how a family member starts editing).
 *
 * Phase-2 editor additions (docs/phase2-plan.md §3.2, §3.5, §3.6):
 *  - `replaceVariant(id, variant, { transaction })` swaps in a whole variant object computed outside the store
 *    (state/editActions.ts computes `produce(base, …)`, reconciles the rooms and hands the result over). The object
 *    is stored as-is, so the derive memo filled while reconciling is hit again by `useDerived`. Same history rules
 *    as `updateVariant` (merge key, transactions, readOnly); an identical object is a no-op.
 *  - `updateSite(recipe, { transaction })`: site edits, same rules. (The editor no longer edits trees here: they
 *    belong to the proposal, `Variant.trees`, copy-on-write in state/editActions.ts.)
 *  - `transactionBase()`: the project at `beginTransaction` (drags are applied from it), null outside a transaction.
 *  - UI state: `tool` ('select' | 'wall' | 'opening' | 'unit' | 'furniture' | 'measure'), `toolOptions`,
 *    `showClearances`, `hint` (the hint line's tool-specific text, null = the tool's default). None of it is persisted.
 *  - `toasts` (top level, never in the history): `showToast` appends one (at most TOAST_LIMIT, the oldest go first;
 *    the same text already on screen is refreshed instead, `seq` bumped so its timer restarts) and returns its id;
 *    `dismissToast(id)`. `undo: true` = an [Angre] button, `action: 'newProposal'` = a "Nytt forslag" button.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { nanoid } from 'nanoid';
import type { Id, OpeningType, Project, Site, Variant } from '../model/types';
import type { CameraPreset } from '../view3d/View3D';
import type { Selection } from './selection';

export const HISTORY_LIMIT = 200;

export type ActiveView = 'plan' | '3d' | 'split';
export type PlanStorey = 'ground' | 'loft';
export type Mode3d = 'ute' | 'inne';
/** Toolbar tools (docs/phase2-plan.md §3.2): Velg · Vegg · Dør/vindu · Nytt bygg · Møbler · Mål. */
export type Tool = 'select' | 'wall' | 'opening' | 'unit' | 'furniture' | 'measure';

/** Options of the active placement tool. */
export interface ToolOptions {
  /** Dør/vindu: the opening type the next click places. */
  openingType?: OpeningType;
  /** Nytt bygg: unit template id (model/unitTemplates.ts). */
  unitTemplate?: string;
  /** Nytt bygg: quarter turns of the ghost (0–3). */
  unitRotation90?: number;
  /** Møbler: catalogue id of the item to place. */
  furnitureItem?: string;
}

/** A toast (docs/phase2-plan.md §3.5): [Angre] when `undo`, "Nytt forslag" when `action` is 'newProposal'. */
export interface Toast {
  id: string;
  text: string;
  undo?: boolean;
  action?: 'newProposal';
  /** Bumped when the same text is shown again (the UI restarts its timer). */
  seq?: number;
}

/** Most toasts kept at once (the oldest go first). */
export const TOAST_LIMIT = 3;
export type ProjectSource = 'local' | 'link' | 'version';


export interface UiState {
  /** The plan by default on every screen (docs/phase2-plan.md §6: editing happens in the plan) until the user picks one. */
  activeView: ActiveView;
  /** The user picked `activeView` with the view tabs (only then is it remembered in the UI prefs). */
  activeViewChosen: boolean;
  planStorey: PlanStorey;
  /** Storey whose levels the 3D interior mode shows (storeys above it are hidden). Kept in step with planStorey. */
  activeStoreyId: Id;
  /** 'inne' cuts the walls `cutHeightFor(preset)` above each level's floor (not a user setting). */
  mode3d: Mode3d;
  showLabels: boolean;
  showDims: boolean;
  showGrid: boolean;
  showRoofPlan: boolean;
  /** "Vis hva som er nytt": new parts orange, removed ones dashed ("Fjernet" ghosts) and the legend. On by default. */
  highlightNew: boolean;
  /** "Vis hva som er nytt i 3D": the 3D view's own switch; off by default (natural colours). */
  highlightNew3d: boolean;
  showTrees: boolean;
  showTerrain: boolean;
  preset: CameraPreset;
  selection: Selection | null;
  tool: Tool;
  toolOptions: ToolOptions;
  /** Draw furniture clearance zones in the plan. */
  showClearances: boolean;
  /** Tool-specific hint line text (e.g. "Trykk der den skal slutte"); null = the tool's default text. */
  hint: string | null;
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
  showLabels: true,
  showDims: true,
  showGrid: true,
  showRoofPlan: false,
  highlightNew: true,
  highlightNew3d: false,
  showTrees: true,
  showTerrain: true,
  preset: 'oversikt',
  selection: null,
  tool: 'select',
  toolOptions: {},
  showClearances: false,
  hint: null,
  sun: { date: '2026-06-21', minutes: 900 },
  readOnly: false,
  source: 'local',
};

/**
 * Interior mode ('Inne') cuts the walls this high above each level's floor: below the 'inne-stua' eye height (1.55),
 * so the views from above look into the rooms.
 */
export const INTERIOR_CUT = 1.3;

/**
 * Cut height the eye-level preset 'inne-stua' needs (eye at 1.55 m): the walls rise above the eye, so the view reads
 * as a room and not as one band of wall tops on the horizon.
 */
export const EYE_LEVEL_CUT = 2.3;

/**
 * Wall cut height of the interior 3D mode for a camera preset (metres above each level's floor). Internal: the user
 * has no control for it (the slider was removed, Robin found it confusing); 'inne-stua' raises it to eye level.
 */
export function cutHeightFor(preset: CameraPreset): number {
  return preset === 'inne-stua' ? EYE_LEVEL_CUT : INTERIOR_CUT;
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
  /** Toasts on screen (never part of the history). */
  toasts: Toast[];

  // project actions (no-ops while ui.readOnly)
  setProject(project: Project): void;
  updateVariant(id: Id, recipe: VariantRecipe, opts?: { transaction?: string }): void;
  /** Replace a whole variant by an object computed outside the store (see the header); same rules as updateVariant. */
  replaceVariant(id: Id, variant: Variant, opts?: { transaction?: string }): void;
  /** Edit the site; same rules as updateVariant. (Trees are per proposal, `Variant.trees`.) */
  updateSite(recipe: (draft: Site) => void, opts?: { transaction?: string }): void;
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
  /** The project at `beginTransaction` (drags are computed from it), or null outside a transaction. */
  transactionBase(): Project | null;

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

  /** Patch the UI state. */
  setUi(patch: Partial<UiState>): void;
  select(selection: Selection | null): void;
  /** Show a toast (see the header); returns its id. */
  showToast(toast: Omit<Toast, 'id' | 'seq'>): string;
  dismissToast(id: string): void;
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
          toasts: [],

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

          replaceVariant: (id, variant, o) => {
            if (readOnly()) return;
            const current = get().project.variants.find((x) => x.id === id);
            if (!current || current === variant) return;
            const key = o?.transaction ?? null;
            const merge = key !== null && key === mergeKey && tx === null;
            const apply = () =>
              set((s) => {
                const i = s.project.variants.findIndex((x) => x.id === id);
                if (i < 0) return;
                s.project.variants[i] = variant;
                s.project.updatedAt = nextStamp(s.project.updatedAt);
              });
            if (merge) untracked(apply);
            else apply();
            mergeKey = key;
          },

          updateSite: (recipe, o) => {
            if (readOnly()) return;
            const key = o?.transaction ?? null;
            const merge = key !== null && key === mergeKey && tx === null;
            const apply = () =>
              set((s) => {
                recipe(s.project.site);
                s.project.updatedAt = nextStamp(s.project.updatedAt);
              });
            if (merge) untracked(apply);
            else apply();
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
            // A copy of the locked base proposal (Forslag D) is an ordinary, editable proposal.
            delete copy.locked;
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

          transactionBase: () => tx?.start ?? null,

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
            });
          },

          select: (selection) => {
            set((s) => {
              s.ui.selection = selection;
            });
          },

          showToast: (toast) => {
            const same = get().toasts.find((t) => t.text === toast.text);
            if (same) {
              set((s) => {
                const t = s.toasts.find((x) => x.id === same.id);
                if (t) Object.assign(t, toast, { seq: (t.seq ?? 0) + 1 });
              });
              return same.id;
            }
            const id = nanoid(8);
            set((s) => {
              s.toasts.push({ id, ...toast });
              if (s.toasts.length > TOAST_LIMIT) s.toasts.splice(0, s.toasts.length - TOAST_LIMIT);
            });
            return id;
          },

          dismissToast: (id) => {
            if (!get().toasts.some((t) => t.id === id)) return;
            set((s) => {
              s.toasts = s.toasts.filter((t) => t.id !== id);
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

/**
 * State of the IFC overlay, shared by the panel (ui/IfcPanel.tsx), the plan layer (plan2d/layers/IfcLayer.tsx) and the
 * 3D overlay (view3d/IfcOverlay.tsx). Its own small zustand store, outside the project and the app store: the model is
 * this device's only (never undone, autosaved, shared or synced).
 *
 * The preferences (which file, opacity, where it is shown, the nudge) are kept in localStorage
 * ('hytte-planlegger:ifc-overlay'); the parsed model in IndexedDB (cache.ts). `ensureRestored()` (called by each of the
 * three views when it mounts) brings the last model back after a reload without the file.
 */
import { useStore } from 'zustand';
import { nb } from '../i18n/nb';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { clearCachedIfc, ifcCacheKey, readCachedIfc } from './cache';
import type { IfcFileLike, IfcLoadErrorReason } from './loader';
import { IFC_CALIBRATION, NO_NUDGE, NUDGE_STEP, clampNudge, withNudge } from './transform';
import type { IfcNudge, IfcTransform } from './transform';
import type { ParsedIfc } from './types';

export const IFC_PREFS_KEY = 'hytte-planlegger:ifc-overlay';

export interface IfcPrefs {
  /** Cache key (name|size) of the loaded file, or null. */
  key: string | null;
  /** 0.2 … 1: stroke opacity in the plan; the 3D meshes use half of it. */
  opacity: number;
  showPlan: boolean;
  show3d: boolean;
  walls3d: boolean;
  roof3d: boolean;
  slabs3d: boolean;
  nudge: IfcNudge;
}

export type IfcStatus = 'idle' | 'restoring' | 'loading' | 'ready' | 'error';

export interface IfcState {
  status: IfcStatus;
  /** Text for the panel after a failed load (the previous model, if any, stays). */
  error: string | null;
  model: ParsedIfc | null;
  prefs: IfcPrefs;
}

export const OPACITY_MIN = 0.2;
export const OPACITY_MAX = 1;

export const DEFAULT_IFC_PREFS: Readonly<IfcPrefs> = {
  key: null,
  opacity: 0.7,
  showPlan: true,
  show3d: true,
  walls3d: true,
  roof3d: true,
  slabs3d: true,
  nudge: NO_NUDGE,
};

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

export interface IfcStoreDeps {
  load: (file: IfcFileLike) => Promise<ParsedIfc>;
  readCache: (key: string) => Promise<ParsedIfc | null>;
  clearCache: () => Promise<boolean>;
  storage: () => KeyValue | null;
}

const defaultDeps: IfcStoreDeps = {
  // The loader (parse.ts, and through it web-ifc) is a lazy chunk: nothing of it is in the start bundle.
  load: async (file) => (await import('./loader')).loadIfcFile(file),
  readCache: (key) => readCachedIfc(key),
  clearCache: () => clearCachedIfc(),
  storage: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  },
};

function readPrefs(storage: KeyValue | null): IfcPrefs {
  try {
    const raw = storage?.getItem(IFC_PREFS_KEY);
    if (!raw) return { ...DEFAULT_IFC_PREFS };
    const p = JSON.parse(raw) as Partial<IfcPrefs>;
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    const d = DEFAULT_IFC_PREFS;
    return {
      key: typeof p.key === 'string' ? p.key : null,
      opacity: typeof p.opacity === 'number' && Number.isFinite(p.opacity) ? Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, p.opacity)) : d.opacity,
      showPlan: bool(p.showPlan, d.showPlan),
      show3d: bool(p.show3d, d.show3d),
      walls3d: bool(p.walls3d, d.walls3d),
      roof3d: bool(p.roof3d, d.roof3d),
      slabs3d: bool(p.slabs3d, d.slabs3d),
      nudge: p.nudge && typeof p.nudge === 'object' ? clampNudge({ dx: Number(p.nudge.dx) || 0, dy: Number(p.nudge.dy) || 0 }) : NO_NUDGE,
    };
  } catch {
    return { ...DEFAULT_IFC_PREFS };
  }
}

function errorText(e: unknown): string {
  // loader.ts IfcLoadError (by name: the loader module is loaded lazily).
  if (e instanceof Error && e.name === 'IfcLoadError') {
    const reason = (e as Error & { reason?: IfcLoadErrorReason }).reason;
    return reason === 'not-ifc' ? nb.ifc.notIfc : reason === 'empty' ? nb.ifc.empty : nb.ifc.failed;
  }
  return nb.ifc.failed;
}

export interface IfcOverlayStore extends StoreApi<IfcState> {
  /** Reads the last model back from the device cache once (no-op when there is none or it is loaded). */
  ensureRestored(): Promise<void>;
  /** Loads a picked file (cache or web-ifc); shows the overlay in the plan and in 3D. */
  loadFile(file: IfcFileLike): Promise<void>;
  /** Drops the model and its cache from this device. */
  remove(): Promise<void>;
  setPrefs(patch: Partial<Omit<IfcPrefs, 'key' | 'nudge'>>): void;
  /** Moves the overlay by whole steps (NUDGE_STEP) along plan x / y, within ±NUDGE_MAX. */
  nudge(stepsX: number, stepsY: number): void;
  resetNudge(): void;
  /** The transform the views draw with: the calibration plus the nudge. */
  transform(): IfcTransform;
}

export function createIfcOverlayStore(deps: IfcStoreDeps = defaultDeps): IfcOverlayStore {
  const store = createStore<IfcState>()(() => ({ status: 'idle', error: null, model: null, prefs: readPrefs(deps.storage()) }));
  const savePrefs = (prefs: IfcPrefs) => {
    try {
      deps.storage()?.setItem(IFC_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode / quota: the overlay still works for this visit */
    }
  };
  const setPrefs = (patch: Partial<IfcPrefs>) => {
    const prefs = { ...store.getState().prefs, ...patch };
    store.setState({ prefs });
    savePrefs(prefs);
  };
  let restoring: Promise<void> | null = null;
  /** Bumped by every load / remove, so a slow restore or an older load cannot overwrite a newer result. */
  let generation = 0;

  return Object.assign(store, {
    ensureRestored(): Promise<void> {
      const { prefs, model } = store.getState();
      if (restoring || model || !prefs.key) return restoring ?? Promise.resolve();
      const key = prefs.key;
      const gen = generation;
      store.setState({ status: 'restoring' });
      restoring = deps.readCache(key).then(
        (m) => {
          if (gen !== generation) return;
          if (m && ifcCacheKey(m.fileName, m.fileSize) === key) store.setState({ model: m, status: 'ready', error: null });
          else {
            store.setState({ status: 'idle' });
            setPrefs({ key: null });
          }
        },
        () => {
          if (gen === generation) store.setState({ status: 'idle' });
        },
      ).finally(() => {
        restoring = null;
      });
      return restoring;
    },
    async loadFile(file: IfcFileLike): Promise<void> {
      const gen = ++generation;
      store.setState({ status: 'loading', error: null });
      try {
        const model = await deps.load(file);
        if (gen !== generation) return;
        store.setState({ model, status: 'ready', error: null });
        setPrefs({ key: ifcCacheKey(model.fileName, model.fileSize), showPlan: true, show3d: true });
      } catch (e) {
        if (gen !== generation) return;
        store.setState({ status: store.getState().model ? 'ready' : 'error', error: errorText(e) });
      }
    },
    async remove(): Promise<void> {
      generation++;
      store.setState({ model: null, status: 'idle', error: null });
      setPrefs({ key: null, nudge: NO_NUDGE });
      await deps.clearCache();
    },
    setPrefs(patch: Partial<Omit<IfcPrefs, 'key' | 'nudge'>>): void {
      const p = { ...patch };
      if (p.opacity !== undefined) p.opacity = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, p.opacity));
      setPrefs(p);
    },
    nudge(stepsX: number, stepsY: number): void {
      const n = store.getState().prefs.nudge;
      setPrefs({ nudge: clampNudge({ dx: n.dx + stepsX * NUDGE_STEP, dy: n.dy + stepsY * NUDGE_STEP }) });
    },
    resetNudge(): void {
      setPrefs({ nudge: NO_NUDGE });
    },
    transform(): IfcTransform {
      return withNudge(IFC_CALIBRATION, store.getState().prefs.nudge);
    },
  });
}

/** The app's overlay store. */
export const ifcOverlay: IfcOverlayStore = createIfcOverlayStore();

export function useIfcOverlay<T>(selector: (s: IfcState) => T): T {
  return useStore(ifcOverlay, selector);
}

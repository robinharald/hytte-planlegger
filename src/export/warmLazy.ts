/**
 * Warms the cache of the lazy libraries in the background, so «Lag PDF» and «Last inn IFC-fil» work at the cabin
 * without network after one online visit (they are not precached: vite.config.ts `LAZY_LIBS_*`, ~6 MB most installs
 * never use).
 *
 * `warmLazyChunks()` (called once after the app has started; main.tsx) waits a few seconds and for an idle moment
 * (requestIdleCallback, else a timer), then — only online, only with a service worker, not on «Spar data», and once
 * per app build — imports the PDF code (planPdf with jsPDF and svg2pdf.js) and the IFC reader (web-ifc), which
 * fetches their chunks, and fetches the web-ifc wasm. The fetched files are put into the service worker's runtime
 * cache ('hytte-lazy-libs', the cache its CacheFirst route reads) directly, because on the very first visit the
 * page is not yet controlled by the worker and its fetches would bypass it. Nothing is evaluated beyond the modules'
 * top level (no PDF is made, the wasm engine is not started). A failure is silent and is retried on the next start.
 */

/** vite.config.ts `workbox.runtimeCaching[0].options.cacheName`. */
export const LAZY_CACHE = 'hytte-lazy-libs';
/** vite.config.ts `LAZY_LIBS_URL`: the files of the lazy libraries (what the runtime cache keeps). */
export const LAZY_FILE = /\/assets\/(?:planPdf-|jspdf|svg2pdf|html2canvas|purify|index\.es-|web-ifc)[^/]*\.(?:js|wasm)$/;
/** localStorage: the build whose lazy files are cached on this device. */
export const WARM_KEY = 'hytte-planlegger:lazy-libs-warm';
/** Wait after start before looking for an idle moment (ms). */
const START_DELAY_MS = 8000;

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

export interface WarmDeps {
  online(): boolean;
  /** A service worker is registered for this page (none in `npm run dev` and in the tests). */
  hasServiceWorker(): Promise<boolean>;
  /** «Spar data» / Lite mode. */
  saveData(): boolean;
  /** Runs `cb` when the page is idle, after the start delay. */
  idle(cb: () => void): void;
  /** Imports the lazy modules; the URLs of the files that were fetched for them. */
  load(): Promise<string[]>;
  cache(): Promise<Pick<Cache, 'match' | 'add'> | null>;
  storage(): KeyValue | null;
  /** Changes with every build that changes the lazy files' names. */
  build: string;
}

/** The URLs of the resources the browser fetched while `run` ran (resource timing), filtered to the lazy files. */
async function fetchedDuring(run: () => Promise<unknown>): Promise<string[]> {
  const urls = new Set<string>();
  let observer: PerformanceObserver | null = null;
  const take = (entries: PerformanceEntryList) => {
    for (const e of entries) if (LAZY_FILE.test(new URL(e.name, location.href).pathname)) urls.add(e.name);
  };
  try {
    observer = new PerformanceObserver((list) => take(list.getEntries()));
    observer.observe({ type: 'resource' });
  } catch {
    observer = null;
  }
  try {
    await run();
  } finally {
    if (observer) {
      take(observer.takeRecords());
      observer.disconnect();
    }
  }
  return [...urls];
}

const defaultDeps: WarmDeps = {
  online: () => typeof navigator !== 'undefined' && navigator.onLine !== false,
  hasServiceWorker: async () => {
    try {
      return typeof navigator !== 'undefined' && !!navigator.serviceWorker && !!(await navigator.serviceWorker.getRegistration());
    } catch {
      return false;
    }
  },
  saveData: () => {
    try {
      return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    } catch {
      return false;
    }
  },
  idle: (cb) => {
    setTimeout(() => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === 'function') ric(cb, { timeout: 20_000 });
      else setTimeout(cb, 0);
    }, START_DELAY_MS);
  },
  load: async () => {
    let wasm = '';
    const urls = await fetchedDuring(async () => {
      // the same imports as «Lag PDF» (ui/ExportDialog.tsx, planPdf.ts renderPdf) and the IFC loader (ifc/loader.ts)
      const [url] = await Promise.all([
        import('web-ifc/web-ifc.wasm?url'),
        import('./planPdf'),
        import('jspdf'),
        import('svg2pdf.js/dist/svg2pdf.es.min.js'),
        import('web-ifc'),
      ]);
      // the wasm itself is fetched by web-ifc only when its engine starts: added to the cache by URL below
      wasm = new URL(url.default, location.href).href;
    });
    return [...new Set([...urls, wasm])].filter(Boolean);
  },
  cache: async () => {
    try {
      return typeof caches === 'undefined' ? null : await caches.open(LAZY_CACHE);
    } catch {
      return null;
    }
  },
  storage: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  },
  build: import.meta.url,
};

/** One warm-up (see the header); resolves to true when the files are (now) in the cache. Exported for the tests. */
export async function warmNow(deps: WarmDeps): Promise<boolean> {
  if (!deps.online() || deps.saveData()) return false;
  const storage = deps.storage();
  try {
    if (storage?.getItem(WARM_KEY) === deps.build) return true;
  } catch {
    // unreadable storage: warm anyway
  }
  if (!(await deps.hasServiceWorker())) return false;
  try {
    const urls = await deps.load();
    const cache = await deps.cache();
    // no script seen (no resource timing): nothing to rely on, try again next time
    if (!cache || !urls.some((u) => /\.js$/.test(u))) return false;
    for (const url of urls) if (!(await cache.match(url))) await cache.add(url);
    try {
      storage?.setItem(WARM_KEY, deps.build);
    } catch {
      // private mode: warmed again next time (cheap: the files come from the cache)
    }
    return true;
  } catch {
    return false;
  }
}

let started = false;

/** Warms the lazy libraries once in the background after the app has started (see the header). */
export function warmLazyChunks(deps: WarmDeps = defaultDeps): void {
  if (started) return;
  started = true;
  deps.idle(() => void warmNow(deps));
}

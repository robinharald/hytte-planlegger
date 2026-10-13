/**
 * The background warm-up of the lazy PDF / IFC libraries (warmLazy.ts) with stand-ins: only online, with a service
 * worker and without «Spar data»; the fetched files go into the runtime cache once per build; a failure leaves no
 * mark (retried on the next start). And the error texts of a first use offline (offline.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, offlineFirstUse } from './offline';
import { LAZY_FILE, WARM_KEY, warmLazyChunks, warmNow } from './warmLazy';
import type { WarmDeps } from './warmLazy';

const URLS = ['https://x.test/hytte-planlegger/assets/planPdf-abc.js', 'https://x.test/hytte-planlegger/assets/jspdf.es.min-def.js', 'https://x.test/hytte-planlegger/assets/web-ifc-123.wasm'];

function setup(over: Partial<WarmDeps> = {}) {
  const map = new Map<string, string>();
  const cached = new Set<string>(['https://x.test/hytte-planlegger/assets/jspdf.es.min-def.js']);
  const cache = { match: vi.fn(async (u: RequestInfo | URL) => (cached.has(String(u)) ? new Response('') : undefined)), add: vi.fn(async (u: RequestInfo | URL) => void cached.add(String(u))) };
  const deps: WarmDeps = {
    online: () => true,
    hasServiceWorker: async () => true,
    saveData: () => false,
    idle: (cb) => cb(),
    load: vi.fn(async () => URLS),
    cache: async () => cache,
    storage: () => ({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }),
    build: 'build-1',
    ...over,
  };
  return { deps, cache, cached, map };
}

describe('warming the lazy libraries', () => {
  it('puts the fetched files that are missing into the runtime cache, once per build', async () => {
    const { deps, cache, cached, map } = setup();
    expect(await warmNow(deps)).toBe(true);
    expect(deps.load).toHaveBeenCalledTimes(1);
    expect(cache.add.mock.calls.map((c) => String(c[0]))).toEqual([URLS[0], URLS[2]]);
    for (const u of URLS) expect(cached.has(u)).toBe(true);
    expect(map.get(WARM_KEY)).toBe('build-1');
    // the next start: nothing to do
    expect(await warmNow(deps)).toBe(true);
    expect(deps.load).toHaveBeenCalledTimes(1);
    // a new build warms again
    expect(await warmNow({ ...deps, build: 'build-2' })).toBe(true);
    expect(deps.load).toHaveBeenCalledTimes(2);
  });

  it('does nothing offline, without a service worker or with «Spar data»', async () => {
    for (const over of [{ online: () => false }, { hasServiceWorker: async () => false }, { saveData: () => true }] as Partial<WarmDeps>[]) {
      const { deps, map } = setup(over);
      expect(await warmNow(deps)).toBe(false);
      expect(deps.load).not.toHaveBeenCalled();
      expect(map.has(WARM_KEY)).toBe(false);
    }
  });

  it('leaves no mark when a download fails or nothing was seen, so the next start tries again', async () => {
    const failing = setup({ load: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) });
    expect(await warmNow(failing.deps)).toBe(false);
    expect(failing.map.has(WARM_KEY)).toBe(false);
    const blind = setup({ load: vi.fn(async () => [URLS[2]]) });
    expect(await warmNow(blind.deps)).toBe(false);
    expect(blind.map.has(WARM_KEY)).toBe(false);
  });

  it('starts once, at an idle moment', () => {
    const idle = vi.fn<(cb: () => void) => void>();
    const { deps } = setup({ idle });
    warmLazyChunks(deps);
    warmLazyChunks(deps);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('knows the lazy files by the names the service worker caches at runtime (vite.config.ts LAZY_LIBS_URL)', () => {
    expect(LAZY_FILE.test('/hytte-planlegger/assets/planPdf-lKPLFHRQ.js')).toBe(true);
    expect(LAZY_FILE.test('/assets/web-ifc-api-x1.js')).toBe(true);
    expect(LAZY_FILE.test('/assets/web-ifc-Bq2.wasm')).toBe(true);
    expect(LAZY_FILE.test('/assets/index-Cx1.js')).toBe(false);
    expect(LAZY_FILE.test('/assets/index.esm-Cx1.js')).toBe(false); // Firebase, precached
  });
});

describe('first use offline', () => {
  it('recognises a library that could not be downloaded', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://x/assets/planPdf-1.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Aborted(both async and sync fetching of the wasm failed)'))).toBe(true);
    expect(isChunkLoadError(new Error('no pages'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch')).toBe(false);
    expect(offlineFirstUse(new Error('no pages'), false)).toBe(false);
    expect(offlineFirstUse(new Error('no pages'), true)).toBe(true);
  });
});

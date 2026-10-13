/**
 * Loads an IFC file the user picked: the device cache first (cache.ts, keyed by name + size), else web-ifc — imported
 * lazily (its ~6 MB API and 1.6 MB wasm are never in the app's start-up chunk) with the wasm URL from Vite
 * (`web-ifc/web-ifc.wasm?url`; cached on first use, not precached: vite.config.ts LAZY_LIBS_*) and single-threaded
 * (GitHub Pages is not cross-origin isolated). The parsed model is cached; the file itself is not kept.
 */
import { offlineFirstUse } from '../export/offline';
import { ifcCacheKey, readCachedIfc, writeCachedIfc } from './cache';
import { parseIfcModel } from './parse';
import type { WebIfcApi, WebIfcModule } from './parse';
import type { ParsedIfc } from './types';

/** 'offline': web-ifc or its wasm could not be downloaded (never used on this device, no network); the file is fine. */
export type IfcLoadErrorReason = 'not-ifc' | 'failed' | 'empty' | 'offline';

export class IfcLoadError extends Error {
  readonly reason: IfcLoadErrorReason;
  constructor(reason: IfcLoadErrorReason, cause?: unknown) {
    super(`IFC load failed: ${reason}`, cause === undefined ? undefined : { cause });
    this.name = 'IfcLoadError';
    this.reason = reason;
  }
}

/** The file as the loader needs it (a `File` from the picker). */
export interface IfcFileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

let engine: Promise<{ mod: WebIfcModule; api: WebIfcApi }> | null = null;

function webIfc(): Promise<{ mod: WebIfcModule; api: WebIfcApi }> {
  engine ??= (async () => {
    const [mod, wasm] = await Promise.all([import('web-ifc'), import('web-ifc/web-ifc.wasm?url')]);
    const api = new mod.IfcAPI();
    await api.Init(() => wasm.default, true);
    return { mod, api };
  })().catch((e: unknown) => {
    engine = null;
    throw e;
  });
  return engine;
}

/** STEP files start with "ISO-10303-21;" (after an optional byte-order mark or blank lines). */
export function looksLikeIfc(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 256));
  return /^\s*(﻿|ï»¿)?\s*ISO-10303-21\s*;/.test(head);
}

export async function loadIfcFile(file: IfcFileLike, deps: { parse?: (bytes: Uint8Array) => Promise<ParsedIfc> } = {}): Promise<ParsedIfc> {
  const key = ifcCacheKey(file.name, file.size);
  const cached = await readCachedIfc(key);
  if (cached) return cached;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    throw new IfcLoadError('failed', e);
  }
  if (!looksLikeIfc(bytes)) throw new IfcLoadError('not-ifc');
  let model: ParsedIfc;
  try {
    model = deps.parse
      ? await deps.parse(bytes)
      : await webIfc().then(
          ({ mod, api }) => parseIfcModel(mod, api, bytes, { name: file.name, size: file.size }),
          (e: unknown) => {
            throw new IfcLoadError(offlineFirstUse(e) ? 'offline' : 'failed', e);
          },
        );
  } catch (e) {
    throw e instanceof IfcLoadError ? e : new IfcLoadError('failed', e);
  }
  if (model.meshes.length === 0) throw new IfcLoadError('empty');
  await writeCachedIfc(model);
  return model;
}

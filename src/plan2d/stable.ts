/**
 * Structural sharing for the plan's render data (fix round 2 after phase 2a, render cost of drags). A drag derives a
 * fresh model every frame: every wall, room, opening and deck is a new object even where nothing changed, so every
 * memoised layer re-rendered. `shareEqual(prev, next)` returns `next` with every part that is deep-equal to the
 * matching part of `prev` replaced by that previous instance (and `prev` itself when nothing changed), so the layers
 * and their per-item components only re-render where the geometry really changed. Pure, no React.
 *
 * Matching: plain objects key by key; arrays whose items all carry a string `id` by id (an inserted or removed wall
 * does not shift the identities of the others), other arrays index by index. Numbers compare with `Object.is` (a
 * re-derive of unchanged input gives the very same floats). Anything that is not a plain object or array (class
 * instances, functions) is compared by identity only.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
};

const idOf = (v: unknown): string | null => (isPlainObject(v) && typeof v.id === 'string' ? v.id : null);

function shareArray(prev: readonly unknown[], next: readonly unknown[]): readonly unknown[] {
  let byId: Map<string, unknown> | null = null;
  if (next.length > 0 && prev.length > 0 && next.every((x) => idOf(x) !== null) && prev.every((x) => idOf(x) !== null)) {
    byId = new Map(prev.map((x) => [idOf(x)!, x]));
    if (byId.size !== prev.length) byId = null;
  }
  let same = prev.length === next.length;
  const out = next.map((item, i) => {
    const match = byId ? byId.get(idOf(item)!) : prev[i];
    const shared = match === undefined ? item : shareEqual(match, item);
    if (!Object.is(shared, prev[i])) same = false;
    return shared;
  });
  return same ? prev : out;
}

/** `next` with every part deep-equal to the matching part of `prev` replaced by the previous instance (see header). */
export function shareEqual<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;
  if (Array.isArray(prev) && Array.isArray(next)) return shareArray(prev, next) as T;
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const shared = Object.prototype.hasOwnProperty.call(prev, k) ? shareEqual(prev[k], next[k]) : next[k];
      if (!Object.is(shared, prev[k]) || !Object.prototype.hasOwnProperty.call(prev, k)) same = false;
      out[k] = shared;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

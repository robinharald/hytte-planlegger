/**
 * Norwegian number formatting for the UI, the plan labels and the 3D labels.
 * Comma decimals, one decimal for metres and square metres, "×" between dimensions, "m²".
 * `formatM(v)` returns "2,2 m"; pass `false` as the second argument for the bare number "2,2".
 */

/** Round half away from zero at `decimals` and print with a comma. Never prints "-0,0". */
export function formatNumber(v: number, decimals = 1): string {
  if (!Number.isFinite(v)) return '–';
  const f = 10 ** decimals;
  let r = Math.round(Math.abs(v) * f) / f;
  if (v < 0 && r !== 0) r = -r;
  return r.toFixed(decimals).replace('.', ',');
}

/** Metres with one decimal: "2,2 m" (or "2,2" when `withUnit` is false). */
export function formatM(v: number, withUnit = true): string {
  const n = formatNumber(v, 1);
  return withUnit ? `${n} m` : n;
}

/** Square metres with one decimal: "13,4 m²". */
export function formatM2(v: number): string {
  return `${formatNumber(v, 1)} m²`;
}

/** Inner dimensions: "2,2 × 4,2 m"; "ca. 2,2 × 4,2 m" when the room is not a rectangle. */
export function formatDims(w: number, h: number, approx = false): string {
  const s = `${formatNumber(w, 1)} × ${formatNumber(h, 1)} m`;
  return approx ? `ca. ${s}` : s;
}

/** Lengths that need centimetres (thicknesses, heights): "0,12 m", "2,22 m". */
export function formatLength(v: number, decimals = 2): string {
  return `${formatNumber(v, decimals)} m`;
}

/** Plan point: "(5,0; 6,2)" — semicolon because the decimal separator is a comma. */
export function formatPoint(p: readonly [number, number]): string {
  return `(${formatNumber(p[0], 1)}; ${formatNumber(p[1], 1)})`;
}

/** Degrees without decimals: "28°". */
export function formatDegrees(v: number): string {
  return `${formatNumber(v, 0)}°`;
}

/** Byte counts: "512 B", "8,0 kB", "1,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} kB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

/** Two-digit helper. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "11.10.2026 19:30" in the device's local time. Returns the input when it is not a valid date. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "11.10.2026" (local date). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Minutes after midnight → "15:00" for <input type="time">. */
export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** "15:00" → 900. Returns null for unparsable input. */
export function timeToMinutes(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

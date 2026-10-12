/**
 * Parsing and checking of typed numbers (docs/phase2-plan.md §3.7 "Number fields"): "2,4", "2,40" and "2.40" are all
 * 2.4; a trailing unit ("2,4 m", "28°") and spaces are ignored; anything else is invalid. Values outside [min, max]
 * are rejected (max 30 m by default), never clamped. Pure, unit-tested.
 */
import { formatNumber } from './format';

/** Default upper limit of a length field (m). */
export const MAX_LENGTH = 30;

/** "2,4" / "2.40" / " 2,40 m " → 2.4; null when it is not one plain decimal number. */
export function parseDecimal(text: string): number | null {
  const t = text
    .trim()
    .replace(/\s*(m|°|grader)$/i, '')
    .replace(/^−/, '-');
  if (!/^-?(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return null;
  const v = Number(t.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Round half away from zero; the 1e-9 nudge makes 2.405 → 2.41 despite 2.405 · 100 = 240.4999… in binary. */
export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(Math.abs(v) * f + 1e-9) / f;
  return v < 0 ? -r : r;
}

export interface NumberRule {
  min: number;
  max: number;
  decimals: number;
}

/** The value a field commits for `text`, rounded to the field's decimals, or null when it is rejected. */
export function acceptNumber(text: string, rule: NumberRule): number | null {
  const v = parseDecimal(text);
  if (v === null) return null;
  const r = roundTo(v, rule.decimals);
  if (r < rule.min - 1e-9 || r > rule.max + 1e-9) return null;
  return r;
}

/** The field's text for a value: comma decimals, fixed number of decimals ("2,40"). */
export function formatField(v: number, decimals: number): string {
  return formatNumber(v, decimals);
}

/** Has the value changed in the field's precision? */
export function differs(a: number, b: number, decimals: number): boolean {
  return Math.abs(roundTo(a, decimals) - roundTo(b, decimals)) > 0.5 * 10 ** -decimals;
}

/** value ± step, rounded and clamped to the rule (the −/+ buttons). */
export function stepValue(value: number, step: number, rule: NumberRule): number {
  return Math.min(rule.max, Math.max(rule.min, roundTo(value + step, rule.decimals)));
}

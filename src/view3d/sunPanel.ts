/**
 * Sun panel helpers (pure, no three.js; ui/Controls.tsx «Sol og skygge» imports them):
 *  - `SUN_PRESET_KEYS` / `sunPresetPatch`: Midtsommer (21 June), Jevndøgn (20 March), Midtvinter (21 December) in
 *    the year of the chosen date, keeping the time; «I dag» = today's date and the time now (rounded to 5 min), both
 *    on the clock at the cabin (Site.timezone), not the device's.
 *  - `sunDay(site, date)`: the sunrises and sunsets on that local day at the cabin (suncalc `getTimes` at
 *    `site.originLatLon` with the zone's UTC offset at local noon, for the day and its neighbours, since near the
 *    midnight sun the evening's sunset can fall after midnight), as minutes after local midnight; `alwaysUp`
 *    (midnight sun) / `alwaysDown` (polar night) when the sun does not cross the horizon that day.
 *  - `daylightStops`: the slider's daylight band as [from, to] fractions of the 00:00–23:55 range.
 */
import { getTimes } from 'suncalc';
import { localInstant, zoneOffsetMs } from '../geometry/geo';
import type { Site } from '../model/types';

export type SunPresetKey = 'midsummer' | 'equinox' | 'midwinter' | 'today';

export const SUN_PRESET_KEYS: readonly SunPresetKey[] = ['midsummer', 'equinox', 'midwinter', 'today'];

/** Month-day of the fixed presets. */
export const SUN_PRESET_DAYS: Record<Exclude<SunPresetKey, 'today'>, string> = {
  midsummer: '06-21',
  equinox: '03-20',
  midwinter: '12-21',
};

/** The slider's range: 00:00 … 23:55 in 5-minute steps. */
export const SLIDER_MAX = 24 * 60 - 5;

const DAY_MS = 86_400_000;

type ClockSite = Pick<Site, 'timezone'>;
type SunSite = Pick<Site, 'timezone' | 'originLatLon'>;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Wall-clock date (YYYY-MM-DD) and minutes after midnight in the site's time zone at instant `now`. */
export function siteClock(site: ClockSite, now: Date): { date: string; minutes: number } {
  const wall = now.getTime() + zoneOffsetMs(site.timezone, now.getTime());
  const d = new Date(wall);
  return {
    date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function yearOf(date: string, fallback: string): string {
  return /^\d{4}-/.test(date) ? date.slice(0, 4) : fallback.slice(0, 4);
}

/** The date (and for «I dag» the time) a preset sets, given the chosen date and the instant now. */
export function sunPresetPatch(key: SunPresetKey, current: { date: string; minutes: number }, site: ClockSite, now: Date): { date: string; minutes: number } {
  const clock = siteClock(site, now);
  if (key === 'today') return { date: clock.date, minutes: Math.min(SLIDER_MAX, Math.round(clock.minutes / 5) * 5) };
  return { date: `${yearOf(current.date, clock.date)}-${SUN_PRESET_DAYS[key]}`, minutes: current.minutes };
}

/** The preset the chosen date matches (`today`: the date «I dag» set, when given), or null. */
export function activeSunPreset(date: string, today: string | null): SunPresetKey | null {
  for (const key of ['midsummer', 'equinox', 'midwinter'] as const) if (date.slice(4) === `-${SUN_PRESET_DAYS[key]}`) return key;
  return today !== null && date === today ? 'today' : null;
}

export interface SunEvent {
  kind: 'rise' | 'set';
  /** Minutes after local midnight. */
  minutes: number;
}

export interface SunDay {
  /** Sunrises and sunsets on this local day, in time order. */
  events: SunEvent[];
  alwaysUp: boolean;
  alwaysDown: boolean;
}

/** Minutes after local midnight of `instant` when it falls on local `date`, else null. */
function localMinutes(site: ClockSite, instant: Date | null, date: string): number | null {
  if (!instant || !Number.isFinite(instant.getTime())) return null;
  if (siteClock(site, instant).date !== date) return null;
  const wall = instant.getTime() + zoneOffsetMs(site.timezone, instant.getTime());
  return (((wall % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
}

function shiftDate(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** suncalc times of the civil day `date` at the cabin, or null for a malformed date. */
function timesOn(site: SunSite, date: string): ReturnType<typeof getTimes> | null {
  const noon = localInstant(site as Site, date, 12 * 60);
  if (!Number.isFinite(noon.getTime())) return null;
  const offsetMin = zoneOffsetMs(site.timezone, noon.getTime()) / 60_000;
  return getTimes(noon, site.originLatLon.lat, site.originLatLon.lon, 0, offsetMin);
}

/** Sunrises and sunsets at the cabin on the local date (see the header). */
export function sunDay(site: SunSite, date: string): SunDay {
  const today = timesOn(site, date);
  if (!today) return { events: [], alwaysUp: false, alwaysDown: false };
  const events: SunEvent[] = [];
  for (const t of [timesOn(site, shiftDate(date, -1)), today, timesOn(site, shiftDate(date, 1))]) {
    if (!t) continue;
    const pairs: [SunEvent['kind'], Date | null][] = [
      ['rise', t.sunrise],
      ['set', t.sunset],
    ];
    for (const [kind, at] of pairs) {
      const m = localMinutes(site, at, date);
      if (m !== null && !events.some((e) => e.kind === kind && Math.abs(e.minutes - m) < 1)) events.push({ kind, minutes: m });
    }
  }
  events.sort((a, b) => a.minutes - b.minutes);
  const none = events.length === 0;
  return { events, alwaysUp: none && today.alwaysUp === true, alwaysDown: none && today.alwaysDown === true };
}

/** The first sunrise and the last sunset of the day (null when there is none). */
export function riseAndSet(day: SunDay): { sunrise: number | null; sunset: number | null } {
  const rise = day.events.find((e) => e.kind === 'rise');
  const set = [...day.events].reverse().find((e) => e.kind === 'set');
  return { sunrise: rise?.minutes ?? null, sunset: set?.minutes ?? null };
}

export interface SunTick extends SunEvent {
  /** Position on the slider (0 … 1). */
  f: number;
  /** Has room for its time label (at least `minGap` after the previous label). */
  label: boolean;
}

/** The day's sunrise / sunset ticks on the slider; a label that would run into the previous one is left out. */
export function sunTicks(day: SunDay, minGap = 0.14): SunTick[] {
  const out: SunTick[] = [];
  let last = -Infinity;
  for (const e of day.events) {
    const f = sliderFraction(e.minutes);
    const label = f - last >= minGap;
    if (label) last = f;
    out.push({ ...e, f, label });
  }
  return out;
}

/** Fraction of the slider (0 … 1) for minutes after midnight. */
export function sliderFraction(minutes: number): number {
  return Math.max(0, Math.min(1, minutes / SLIDER_MAX));
}

/** The daylight band(s) under the slider as [from, to] fractions. */
export function daylightStops(day: SunDay): [number, number][] {
  if (day.alwaysUp) return [[0, 1]];
  if (day.events.length === 0) return [];
  const out: [number, number][] = [];
  // the sun is up at midnight when the day's first event is a sunset
  let from: number | null = day.events[0].kind === 'set' ? 0 : null;
  for (const e of day.events) {
    if (e.kind === 'rise' && from === null) from = sliderFraction(e.minutes);
    else if (e.kind === 'set' && from !== null) {
      out.push([from, sliderFraction(e.minutes)]);
      from = null;
    }
  }
  if (from !== null) out.push([from, 1]);
  return out;
}

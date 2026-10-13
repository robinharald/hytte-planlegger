/**
 * Sun panel helpers (pure, no three.js; ui/Controls.tsx «Sol og skygge» imports them):
 *  - `SUN_PRESET_KEYS` / `sunPresetPatch`: Midtsommer (21 June), Jevndøgn (20 March), Midtvinter (21 December) in
 *    the year of the chosen date, keeping the time; «I dag» = today's date and the time now (rounded to 5 min), both
 *    on the clock at the cabin (Site.timezone), not the device's.
 *  - `sunDay(site, date)`: the sunrises and sunsets on that local day at the cabin, as minutes after local midnight:
 *    the sun's altitude (suncalc `getPosition` at `site.originLatLon`, as for the light) sampled every 5 minutes from
 *    local midnight to the next, against suncalc's sunrise altitude (−0.833°: refraction and the sun's disc), each
 *    sign change refined to the second (suncalc's `getTimes` works per solar day, so next to the midnight-sun period
 *    it misses a dip below the horizon that belongs to an always-up neighbour); `alwaysUp` (midnight sun) /
 *    `alwaysDown` (polar night) when the sun does not cross the horizon that day.
 *  - `daylightStops`: the slider's daylight band as [from, to] fractions of the 00:00–23:55 range.
 */
import { getPosition } from 'suncalc';
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

/**
 * suncalc's sunrise / sunset altitude (−0.833° geometric: refraction and the sun's disc) as the apparent altitude in
 * degrees that suncalc v2's `getPosition` returns (it adds its refraction at the horizon, 0.484°, below 0°).
 */
const HORIZON = -0.833 + 0.48396;
/** Sampling step of the day (ms). */
const SAMPLE_MS = 5 * 60_000;

/** Sunrises and sunsets at the cabin on the local date (see the header). */
export function sunDay(site: SunSite, date: string): SunDay {
  const from = localInstant(site as Site, date, 0).getTime();
  const to = localInstant(site as Site, shiftDate(date, 1), 0).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return { events: [], alwaysUp: false, alwaysDown: false };
  const { lat, lon } = site.originLatLon;
  const up = (t: number) => getPosition(new Date(t), lat, lon).altitude > HORIZON;
  const events: SunEvent[] = [];
  let t0 = from;
  let up0 = up(t0);
  let anyUp = up0;
  for (let t1 = Math.min(to, from + SAMPLE_MS); t0 < to; t1 = Math.min(to, t1 + SAMPLE_MS)) {
    const up1 = up(t1);
    anyUp ||= up1;
    if (up1 !== up0) {
      // the crossing to the second
      let lo = t0;
      let hi = t1;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (up(mid) === up0) lo = mid;
        else hi = mid;
      }
      const m = localMinutes(site, new Date(hi), date);
      if (m !== null) events.push({ kind: up1 ? 'rise' : 'set', minutes: m });
    }
    t0 = t1;
    up0 = up1;
  }
  const none = events.length === 0;
  return { events, alwaysUp: none && anyUp, alwaysDown: none && !anyUp };
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

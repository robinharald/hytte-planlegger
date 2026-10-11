/**
 * Site georeference and sun position: plan directions ↔ compass bearings, plan ↔ WGS84, local wall-clock time in
 * the site's time zone → instant, and the sun direction in the plan frame. Pure functions, no React/three.
 *
 * Conventions (docs/architecture.md "Coordinate systems"):
 *  - A compass bearing β (degrees clockwise from true north) is the plan unit vector
 *    `(sin(β − B), cos(β − B))` with `B = site.planNorthBearing` (bearing of plan +y). Plan +x bears B + 90°.
 *  - Plan → geo: east/north offsets from the plan origin `E = x·cos B + y·sin B`, `N = −x·sin B + y·cos B`
 *    (for B = 106° this is the calibration of docs/kalibrering-ifc.md), then a local equirectangular projection
 *    around `site.originLatLon` with the WGS84 metres-per-degree series evaluated at the origin latitude
 *    (sub-millimetre over the site; exactly invertible).
 *
 * Decisions where the architecture is silent / deviations:
 *  - suncalc is v2 (see node_modules/suncalc): `getPosition` returns DEGREES, the azimuth is already a compass
 *    bearing (north-based, clockwise) and the altitude is refraction-corrected. So `bearing = azimuth` (the
 *    architecture's `azimuth + π` is the suncalc v1 convention). The sun is computed at `site.originLatLon`.
 *  - `localInstant`: `dateISO` is read as `YYYY-MM-DD` (anything after the 10th character is ignored); `minutes`
 *    may be fractional or ≥ 1440 (rolls over to the next day). The zone offset comes from
 *    `Intl.DateTimeFormat(…, { timeZone }).formatToParts` in two passes, so DST changes are handled; a wall time
 *    that does not exist (spring forward) moves forward by the DST shift, an ambiguous one (fall back) resolves to
 *    the later instant. An unknown time zone falls back to UTC; a malformed date gives an Invalid Date.
 *  - `sunInPlan` with an Invalid Date returns the sun straight below the horizon (dir (0,0,−1), altitude −90°,
 *    isUp false) instead of NaNs, so a renderer just switches the light off.
 */
import { getPosition } from 'suncalc';
import type { Site, Vec2, Vec3 } from '../model/types';

const DEG = Math.PI / 180;

/** Normalises an angle in degrees to [0, 360). */
function normDeg(a: number): number {
  const r = a % 360;
  const n = r < 0 ? r + 360 : r;
  return n === 0 || n >= 360 ? 0 : n;
}

// ---------------------------------------------------------------------------
// Bearings ↔ plan directions
// ---------------------------------------------------------------------------

/** Plan unit vector of a compass bearing (degrees clockwise from true north). */
export function planDirOfBearing(site: Site, bearingDeg: number): Vec2 {
  const a = (bearingDeg - site.planNorthBearing) * DEG;
  return [Math.sin(a), Math.cos(a)];
}

/** Compass bearing in [0, 360) of a plan direction (need not be unit). The zero vector gives the bearing of plan +y. */
export function bearingOfPlanDir(site: Site, v: Vec2): number {
  return normDeg(Math.atan2(v[0], v[1]) / DEG + site.planNorthBearing);
}

/** Plan unit vector pointing to true north (for the north arrow). */
export function trueNorthInPlan(site: Site): Vec2 {
  return planDirOfBearing(site, 0);
}

// ---------------------------------------------------------------------------
// Plan ↔ WGS84
// ---------------------------------------------------------------------------

/** WGS84 metres per degree of latitude and longitude at a latitude (standard series). */
function metresPerDegree(latDeg: number): { lat: number; lon: number } {
  const p = latDeg * DEG;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}

/** East/north offsets (m) from the plan origin of a plan point. */
export function planToEastNorth(site: Site, p: Vec2): { east: number; north: number } {
  const b = site.planNorthBearing * DEG;
  const c = Math.cos(b);
  const s = Math.sin(b);
  return { east: p[0] * c + p[1] * s, north: -p[0] * s + p[1] * c };
}

/** Plan point of east/north offsets (m) from the plan origin. Inverse of `planToEastNorth`. */
export function eastNorthToPlan(site: Site, east: number, north: number): Vec2 {
  const b = site.planNorthBearing * DEG;
  const c = Math.cos(b);
  const s = Math.sin(b);
  return [east * c - north * s, east * s + north * c];
}

/** Geographic position of a plan point. (0, 0) is `site.originLatLon`. */
export function planToLatLon(site: Site, p: Vec2): { lat: number; lon: number } {
  const { east, north } = planToEastNorth(site, p);
  const m = metresPerDegree(site.originLatLon.lat);
  return { lat: site.originLatLon.lat + north / m.lat, lon: site.originLatLon.lon + east / m.lon };
}

/** Plan point of a geographic position. Inverse of `planToLatLon`. */
export function latLonToPlan(site: Site, lat: number, lon: number): Vec2 {
  const m = metresPerDegree(site.originLatLon.lat);
  return eastNorthToPlan(site, (lon - site.originLatLon.lon) * m.lon, (lat - site.originLatLon.lat) * m.lat);
}

// ---------------------------------------------------------------------------
// Local wall-clock time → instant
// ---------------------------------------------------------------------------

/** One formatter per time zone; null when the zone is unknown to Intl. */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    } catch {
      f = null;
    }
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * Offset (ms) of the wall clock in `timeZone` from UTC at the instant `ms` (e.g. +7 200 000 for Europe/Oslo in
 * summer). 0 for an unknown zone.
 */
export function zoneOffsetMs(timeZone: string, ms: number): number {
  const f = formatterFor(timeZone);
  if (f === null || !Number.isFinite(ms)) return 0;
  const parts = f.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get('hour') % 24;
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the wall clock in `site.timezone` shows `dateISO` (YYYY-MM-DD) + `minutes` after midnight. */
export function localInstant(site: Site, dateISO: string, minutes: number): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO);
  if (m === null || !Number.isFinite(minutes)) return new Date(NaN);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + Math.round(minutes * 60_000);
  const first = wall - zoneOffsetMs(site.timezone, wall);
  return new Date(wall - zoneOffsetMs(site.timezone, first));
}

// ---------------------------------------------------------------------------
// Sun
// ---------------------------------------------------------------------------

/**
 * Sun position at the site for an instant: `dir` = unit vector TOWARDS the sun in the plan frame (z up),
 * `altitudeDeg` (refraction-corrected), `bearingDeg` (compass), `isUp` = altitude > 0.
 */
export function sunInPlan(site: Site, instant: Date): { dir: Vec3; altitudeDeg: number; bearingDeg: number; isUp: boolean } {
  if (!Number.isFinite(instant.getTime())) return { dir: [0, 0, -1], altitudeDeg: -90, bearingDeg: 0, isUp: false };
  const p = getPosition(instant, site.originLatLon.lat, site.originLatLon.lon);
  const bearingDeg = normDeg(p.azimuth);
  const alt = p.altitude * DEG;
  const d = planDirOfBearing(site, bearingDeg);
  const c = Math.cos(alt);
  return { dir: [d[0] * c, d[1] * c, Math.sin(alt)], altitudeDeg: p.altitude, bearingDeg, isUp: p.altitude > 0 };
}

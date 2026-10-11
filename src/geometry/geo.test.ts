import { describe, expect, it } from 'vitest';
import type { Site, Vec2 } from '../model/types';
import { createForslagD } from '../model/seed/forslagD';
import {
  bearingOfPlanDir,
  eastNorthToPlan,
  latLonToPlan,
  localInstant,
  planDirOfBearing,
  planToEastNorth,
  planToLatLon,
  sunInPlan,
  trueNorthInPlan,
  zoneOffsetMs,
} from './geo';

const SITE: Site = {
  originLatLon: { lat: 68.61305, lon: 14.968157 },
  planNorthBearing: 106,
  floorElevation: 161,
  waterLevel: 152,
  terrainId: 'merkesvatnet-2026-10',
  groundWorks: [],
  timezone: 'Europe/Oslo',
  trees: [],
};

/** The sun-study position from the task: 68.613 N 14.968 E. */
const SUN_SITE: Site = { ...SITE, originLatLon: { lat: 68.613, lon: 14.968 } };

function expectVec(v: Vec2, x: number, y: number, digits = 3): void {
  expect(v[0]).toBeCloseTo(x, digits);
  expect(v[1]).toBeCloseTo(y, digits);
}

/** Smallest absolute difference of two bearings (degrees). */
function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe('bearings ↔ plan directions', () => {
  it('planDirOfBearing for B = 106', () => {
    expectVec(planDirOfBearing(SITE, 0), -0.961, -0.276);
    expectVec(planDirOfBearing(SITE, 106), 0, 1, 12);
    expectVec(planDirOfBearing(SITE, 196), 1, 0, 12);
    expectVec(planDirOfBearing(SITE, 286), 0, -1, 12); // the glass bump faces WNW, towards the lake
    expectVec(planDirOfBearing(SITE, 16), -1, 0, 12);
  });

  it('true north in plan points down-left (106° counter-clockwise from plan +y)', () => {
    expect(trueNorthInPlan(SITE)).toEqual(planDirOfBearing(SITE, 0));
    const [x, y] = trueNorthInPlan(SITE);
    expect(Math.hypot(x, y)).toBeCloseTo(1, 12);
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
  });

  it('bearingOfPlanDir is the inverse, normalised to [0, 360)', () => {
    for (const b of [0, 1, 45, 105.5, 106, 196, 270, 286, 359.5]) {
      const back = bearingOfPlanDir(SITE, planDirOfBearing(SITE, b));
      expect(back).toBeGreaterThanOrEqual(0);
      expect(back).toBeLessThan(360);
      expect(bearingDiff(back, b)).toBeLessThan(1e-9);
    }
    expect(bearingOfPlanDir(SITE, [0, 1])).toBeCloseTo(106, 12);
    expect(bearingOfPlanDir(SITE, [1, 0])).toBeCloseTo(196, 12);
    expect(bearingOfPlanDir(SITE, [0, 5])).toBeCloseTo(106, 12); // need not be unit
    expect(bearingOfPlanDir(SITE, [0, 0])).toBeCloseTo(106, 12);
    expect(bearingOfPlanDir({ ...SITE, planNorthBearing: 0 }, [-1, 0])).toBeCloseTo(270, 12);
    expect(bearingOfPlanDir({ ...SITE, planNorthBearing: 0 }, [0, 1])).toBe(0);
  });
});

describe('plan ↔ WGS84', () => {
  it('planToLatLon(0, 0) is the site origin', () => {
    expect(planToLatLon(SITE, [0, 0])).toEqual(SITE.originLatLon);
  });

  it('round-trips plan → lat/lon → plan', () => {
    for (const p of [
      [0, 0],
      [12, 3.1],
      [-50, 80],
      [200, -150],
    ] as Vec2[]) {
      const { lat, lon } = planToLatLon(SITE, p);
      expectVec(latLonToPlan(SITE, lat, lon), p[0], p[1], 8); // 1e-8 m
    }
  });

  it('east/north offsets follow the IFC calibration (E = −0.2756x + 0.9613y, N = −0.9613x − 0.2756y)', () => {
    for (const [x, y] of [
      [1, 0],
      [0, 1],
      [12, 3.1],
    ] as Vec2[]) {
      const { east, north } = planToEastNorth(SITE, [x, y]);
      // The calibration coefficients have 4 decimals: allow 1e-4 per metre of offset.
      const tol = 1e-4 * (Math.abs(x) + Math.abs(y));
      expect(Math.abs(east - (-0.2756 * x + 0.9613 * y))).toBeLessThanOrEqual(tol);
      expect(Math.abs(north - (-0.9613 * x - 0.2756 * y))).toBeLessThanOrEqual(tol);
      expectVec(eastNorthToPlan(SITE, east, north), x, y, 12);
    }
  });

  it('uses WGS84 metres per degree: 0.001° of latitude ≈ 111.54 m due north', () => {
    const p = latLonToPlan(SITE, SITE.originLatLon.lat + 0.001, SITE.originLatLon.lon);
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(111.54, 1);
    const n = trueNorthInPlan(SITE);
    expect((p[0] * n[0] + p[1] * n[1]) / Math.hypot(p[0], p[1])).toBeCloseTo(1, 9);
    const q = latLonToPlan(SITE, SITE.originLatLon.lat, SITE.originLatLon.lon + 0.001);
    expect(Math.hypot(q[0], q[1])).toBeCloseTo(40.68, 1); // 111.41 km · cos 68.6° per degree of longitude
  });

  it('the address point lies ≈ 3.1 m W, 6.8 m S of the plan origin', () => {
    const p = latLonToPlan(SITE, 68.612989, 14.968081);
    const { east, north } = planToEastNorth(SITE, p);
    expect(east).toBeCloseTo(-3.1, 0);
    expect(north).toBeCloseTo(-6.8, 0);
  });
});

describe('localInstant (wall clock in Site.timezone)', () => {
  it('summer time (UTC+2) and winter time (UTC+1) in Europe/Oslo', () => {
    expect(localInstant(SITE, '2026-06-21', 13 * 60).toISOString()).toBe('2026-06-21T11:00:00.000Z');
    expect(localInstant(SITE, '2026-01-15', 12 * 60).toISOString()).toBe('2026-01-15T11:00:00.000Z');
    expect(localInstant(SITE, '2026-06-21', 15 * 60 + 30).toISOString()).toBe('2026-06-21T13:30:00.000Z');
  });

  it('handles the DST transitions (last Sunday of March / October 2026)', () => {
    expect(localInstant(SITE, '2026-03-29', 60 + 30).toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(localInstant(SITE, '2026-03-29', 3 * 60).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    // 02:30 does not exist on that day: moved forward by the DST shift (= 03:30 CEST).
    expect(localInstant(SITE, '2026-03-29', 2 * 60 + 30).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(localInstant(SITE, '2026-10-25', 3 * 60).toISOString()).toBe('2026-10-25T02:00:00.000Z');
    expect(localInstant(SITE, '2026-10-25', 60).toISOString()).toBe('2026-10-24T23:00:00.000Z');
  });

  it('rolls minutes over midnight, ignores a time part of the date string, and is device-zone independent', () => {
    expect(localInstant(SITE, '2026-06-21', 24 * 60).toISOString()).toBe('2026-06-21T22:00:00.000Z');
    expect(localInstant(SITE, '2026-06-21T23:59:00Z', 0).toISOString()).toBe('2026-06-20T22:00:00.000Z');
    expect(localInstant(SITE, '2026-06-21', 13 * 60 + 0.5).toISOString()).toBe('2026-06-21T11:00:30.000Z');
  });

  it('other zones; unknown zone → UTC; malformed input → Invalid Date', () => {
    expect(localInstant({ ...SITE, timezone: 'America/New_York' }, '2026-06-21', 12 * 60).toISOString()).toBe(
      '2026-06-21T16:00:00.000Z',
    );
    expect(localInstant({ ...SITE, timezone: 'UTC' }, '2026-06-21', 0).toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(localInstant({ ...SITE, timezone: 'Mars/Olympus' }, '2026-06-21', 60).toISOString()).toBe('2026-06-21T01:00:00.000Z');
    expect(Number.isNaN(localInstant(SITE, '', 60).getTime())).toBe(true);
    expect(Number.isNaN(localInstant(SITE, '21.06.2026', 60).getTime())).toBe(true);
    expect(Number.isNaN(localInstant(SITE, '2026-06-21', Number.NaN).getTime())).toBe(true);
  });

  it('zoneOffsetMs', () => {
    expect(zoneOffsetMs('Europe/Oslo', Date.UTC(2026, 5, 21, 11))).toBe(2 * 3600_000);
    expect(zoneOffsetMs('Europe/Oslo', Date.UTC(2026, 0, 15, 11))).toBe(3600_000);
    expect(zoneOffsetMs('Asia/Kolkata', Date.UTC(2026, 0, 15, 11))).toBe(5.5 * 3600_000);
    expect(zoneOffsetMs('Not/AZone', Date.UTC(2026, 0, 15, 11))).toBe(0);
    expect(zoneOffsetMs('Europe/Oslo', Number.NaN)).toBe(0);
  });
});

describe('sunInPlan', () => {
  it('21 June 13:00 Europe/Oslo at 68.613 N 14.968 E: sun due south, ≈ 45° high', () => {
    const sun = sunInPlan(SUN_SITE, localInstant(SUN_SITE, '2026-06-21', 13 * 60));
    expect(bearingDiff(sun.bearingDeg, 180)).toBeLessThanOrEqual(10);
    expect(Math.abs(sun.altitudeDeg - 45)).toBeLessThanOrEqual(3);
    expect(sun.isUp).toBe(true);
    const [x, y, z] = sun.dir;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect(z).toBeCloseTo(Math.sin((sun.altitudeDeg * Math.PI) / 180), 12);
    const d = planDirOfBearing(SUN_SITE, sun.bearingDeg);
    const c = Math.cos((sun.altitudeDeg * Math.PI) / 180);
    expect(x).toBeCloseTo(d[0] * c, 12);
    expect(y).toBeCloseTo(d[1] * c, 12);
    // Due south is plan (0.961, 0.276): mostly plan +x (the new wing side).
    expect(x).toBeGreaterThan(0.6);
  });

  it('midnight sun: at 01:00 that night the sun is up, just above the northern horizon', () => {
    const sun = sunInPlan(SUN_SITE, localInstant(SUN_SITE, '2026-06-21', 60));
    expect(sun.isUp).toBe(true);
    expect(sun.altitudeDeg).toBeGreaterThan(0);
    expect(sun.altitudeDeg).toBeLessThanOrEqual(3);
    expect(bearingDiff(sun.bearingDeg, 0)).toBeLessThanOrEqual(15);
    expect(sun.dir[2]).toBeGreaterThan(0);
  });

  it('polar night: the sun stays below the horizon at noon on 21 December', () => {
    const sun = sunInPlan(SUN_SITE, localInstant(SUN_SITE, '2026-12-21', 12 * 60));
    expect(sun.isUp).toBe(false);
    expect(sun.altitudeDeg).toBeLessThan(0);
    expect(sun.dir[2]).toBeLessThan(0);
  });

  it('the seed site gives the same picture, and an Invalid Date is "below the horizon"', () => {
    const site = createForslagD().site;
    expect(sunInPlan(site, localInstant(site, '2026-06-21', 15 * 60)).isUp).toBe(true);
    expect(sunInPlan(site, new Date(Number.NaN))).toEqual({ dir: [0, 0, -1], altitudeDeg: -90, bearingDeg: 0, isUp: false });
  });
});

import { describe, expect, it } from 'vitest';
import { activeSunPreset, daylightStops, riseAndSet, siteClock, SLIDER_MAX, sunDay, sunPresetPatch, sunTicks } from './sunPanel';

/** The cabin (Merkesvatnet, Vesterålen): 68.613 N. */
const SITE = { timezone: 'Europe/Oslo', originLatLon: { lat: 68.613, lon: 14.968 } };

describe('sun presets', () => {
  const now = new Date('2026-10-13T10:02:00Z'); // 12:02 at the cabin (CEST)
  it('set the solstices and the equinox in the chosen year and keep the time', () => {
    const cur = { date: '2027-08-03', minutes: 900 };
    expect(sunPresetPatch('midsummer', cur, SITE, now)).toEqual({ date: '2027-06-21', minutes: 900 });
    expect(sunPresetPatch('equinox', cur, SITE, now)).toEqual({ date: '2027-03-20', minutes: 900 });
    expect(sunPresetPatch('midwinter', cur, SITE, now)).toEqual({ date: '2027-12-21', minutes: 900 });
  });
  it('«I dag» is the date and time now on the clock at the cabin, rounded to 5 minutes', () => {
    expect(sunPresetPatch('today', { date: '2026-06-21', minutes: 900 }, SITE, now)).toEqual({ date: '2026-10-13', minutes: 720 });
    // 23:30 UTC on 13 October is already 14 October at the cabin
    expect(siteClock(SITE, new Date('2026-10-13T23:30:00Z'))).toEqual({ date: '2026-10-14', minutes: 90 });
    // never past the slider's end
    expect(sunPresetPatch('today', { date: '2026-06-21', minutes: 0 }, SITE, new Date('2026-10-13T21:58:00Z')).minutes).toBe(SLIDER_MAX);
  });
  it('know which preset the date matches', () => {
    expect(activeSunPreset('2026-06-21', null)).toBe('midsummer');
    expect(activeSunPreset('2031-12-21', '2031-12-21')).toBe('midwinter');
    expect(activeSunPreset('2026-03-20', null)).toBe('equinox');
    expect(activeSunPreset('2026-10-13', '2026-10-13')).toBe('today');
    expect(activeSunPreset('2026-10-12', '2026-10-13')).toBeNull();
    expect(activeSunPreset('2026-10-13', null)).toBeNull();
  });
});

describe('sunrise / sunset ticks at 68.613 N', () => {
  it('21 June: midnight sun, no ticks, the whole slider is daylight', () => {
    const d = sunDay(SITE, '2026-06-21');
    expect(d).toEqual({ events: [], alwaysUp: true, alwaysDown: false });
    expect(daylightStops(d)).toEqual([[0, 1]]);
  });

  it('21 December: polar night, no ticks, no daylight', () => {
    const d = sunDay(SITE, '2026-12-21');
    expect(d).toEqual({ events: [], alwaysUp: false, alwaysDown: true });
    expect(daylightStops(d)).toEqual([]);
  });

  it('20 March: one sunrise about 06:00 and one sunset about 18:17 local time (CET)', () => {
    const d = sunDay(SITE, '2026-03-20');
    expect(d.alwaysUp || d.alwaysDown).toBe(false);
    expect(d.events.map((e) => e.kind)).toEqual(['rise', 'set']);
    const { sunrise, sunset } = riseAndSet(d);
    // solar noon ≈ 12:00 − 4 min × 14.97° E + 1 h (CET) + 7 min (equation of time) ≈ 12:07; the day ≈ 12 h 17 min
    expect(sunrise!).toBeGreaterThan(5 * 60 + 45);
    expect(sunrise!).toBeLessThan(6 * 60 + 15);
    expect(sunset!).toBeGreaterThan(18 * 60);
    expect(sunset!).toBeLessThan(18 * 60 + 35);
    expect(daylightStops(d)).toEqual([[sunrise! / SLIDER_MAX, sunset! / SLIDER_MAX]]);
  });

  it('follows summer time: on 1 August the sun sets after 23:00 on the clock (CEST)', () => {
    const { sunrise, sunset } = riseAndSet(sunDay(SITE, '2026-08-01'));
    expect(sunset!).toBeGreaterThan(22 * 60 + 45);
    expect(sunrise!).toBeLessThan(3 * 60 + 30);
  });

  it('near the midnight sun, a sunset of the evening before can fall after midnight', () => {
    const d = sunDay(SITE, '2026-05-22');
    expect(d.alwaysUp).toBe(false);
    expect(d.events[0].kind).toBe('set');
    expect(d.events[0].minutes).toBeLessThan(60);
    expect(d.events[1].kind).toBe('rise');
    // up at midnight until the set, then from the rise to the end of the day
    const stops = daylightStops(d);
    expect(stops[0][0]).toBe(0);
    expect(stops[stops.length - 1][1]).toBe(1);
  });

  it('labels the ticks unless they would run into each other', () => {
    const ticks = sunTicks(sunDay(SITE, '2026-05-22'));
    expect(ticks.map((t) => t.kind)).toEqual(['set', 'rise']);
    expect(ticks.map((t) => t.label)).toEqual([true, false]); // 00:22 and 01:30 are too close for two labels
    expect(sunTicks(sunDay(SITE, '2026-03-20')).every((t) => t.label)).toBe(true);
    expect(sunTicks(sunDay(SITE, '2026-06-21'))).toEqual([]);
  });

  it('builds the band from the events', () => {
    expect(daylightStops({ events: [{ kind: 'set', minutes: 30 }, { kind: 'rise', minutes: 120 }], alwaysUp: false, alwaysDown: false })).toEqual([
      [0, 30 / SLIDER_MAX],
      [120 / SLIDER_MAX, 1],
    ]);
    expect(daylightStops({ events: [{ kind: 'rise', minutes: 60 }], alwaysUp: false, alwaysDown: false })).toEqual([[60 / SLIDER_MAX, 1]]);
  });

  it('is safe with a malformed date', () => {
    expect(sunDay(SITE, 'nonsense')).toEqual({ events: [], alwaysUp: false, alwaysDown: false });
  });
});

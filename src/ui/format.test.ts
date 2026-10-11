import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDateTime,
  formatDegrees,
  formatDims,
  formatM,
  formatM2,
  formatNumber,
  minutesToTime,
  timeToMinutes,
} from './format';

describe('formatNumber', () => {
  it('uses a comma and one decimal by default', () => {
    expect(formatNumber(2.2)).toBe('2,2');
    expect(formatNumber(170.16)).toBe('170,2');
    expect(formatNumber(3)).toBe('3,0');
  });
  it('rounds half away from zero', () => {
    expect(formatNumber(2.25)).toBe('2,3');
    expect(formatNumber(-2.25)).toBe('-2,3');
  });
  it('never prints negative zero', () => {
    expect(formatNumber(-0.04)).toBe('0,0');
    expect(formatNumber(-0)).toBe('0,0');
  });
  it('handles other decimal counts and non-finite input', () => {
    expect(formatNumber(1.234, 2)).toBe('1,23');
    expect(formatNumber(28, 0)).toBe('28');
    expect(formatNumber(Number.NaN)).toBe('–');
  });
});

describe('metres and square metres', () => {
  it('formatM with and without unit', () => {
    expect(formatM(2.2)).toBe('2,2 m');
    expect(formatM(2.2, false)).toBe('2,2');
    expect(formatM(12)).toBe('12,0 m');
  });
  it('formatM2', () => {
    expect(formatM2(13.44)).toBe('13,4 m²');
    expect(formatM2(0)).toBe('0,0 m²');
  });
  it('formatDims', () => {
    expect(formatDims(2.2, 4.2)).toBe('2,2 × 4,2 m');
    expect(formatDims(2.2, 4.2, true)).toBe('ca. 2,2 × 4,2 m');
  });
  it('formatDegrees', () => {
    expect(formatDegrees(28.4)).toBe('28°');
  });
});

describe('bytes and dates', () => {
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(8192)).toBe('8,0 kB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
  it('formatDateTime uses dd.mm.yyyy hh:mm', () => {
    const d = new Date(2026, 9, 11, 19, 5);
    expect(formatDateTime(d.toISOString())).toBe('11.10.2026 19:05');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});

describe('time inputs', () => {
  it('round-trips minutes', () => {
    expect(minutesToTime(900)).toBe('15:00');
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(24 * 60 + 5)).toBe('23:59');
    expect(timeToMinutes('15:00')).toBe(900);
    expect(timeToMinutes('7:30')).toBe(450);
    expect(timeToMinutes('25:00')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
  });
});

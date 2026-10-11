import { describe, expect, it } from 'vitest';
import { aspectFactor, CAMERA_PRESETS, easeInOutQuad, presetScale, presetView, presetWorld, REF_ASPECT, REF_BOUNDS } from './cameras';

const close = (a: number[], b: number[], eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('camera presets', () => {
  it('reproduce the architecture doc for the reference bounds', () => {
    const v = presetView('oversikt', REF_BOUNDS);
    expect(close(v.position, [36, -25, 26])).toBe(true);
    expect(close(v.target, [11.5, 4.5, 1.5])).toBe(true);
    const t = presetView('ovenfra', REF_BOUNDS);
    expect(close(t.position, [12, 4.49, 54])).toBe(true);
    expect(close(t.target, [12, 4.5, 0])).toBe(true);
    const i = presetView('inne-stua', REF_BOUNDS);
    expect(close(i.position, [9.5, 1.2, 1.6])).toBe(true);
    expect(presetScale(REF_BOUNDS)).toBeCloseTo(1, 12);
  });

  it('translate with the bounds centre', () => {
    const shifted = { min: [REF_BOUNDS.min[0] + 10, REF_BOUNDS.min[1] - 5] as [number, number], max: [REF_BOUNDS.max[0] + 10, REF_BOUNDS.max[1] - 5] as [number, number] };
    for (const p of CAMERA_PRESETS) {
      const a = presetView(p, REF_BOUNDS);
      const b = presetView(p, shifted);
      expect(close(b.position, [a.position[0] + 10, a.position[1] - 5, a.position[2]])).toBe(true);
      expect(close(b.target, [a.target[0] + 10, a.target[1] - 5, a.target[2]])).toBe(true);
    }
  });

  it('scale the camera offset with the bounds diagonal (clamped)', () => {
    const big = { min: [0, 0] as [number, number], max: [REF_BOUNDS.max[0] * 2 - REF_BOUNDS.min[0] * 2, (REF_BOUNDS.max[1] - REF_BOUNDS.min[1]) * 2] as [number, number] };
    expect(presetScale(big)).toBeCloseTo(2, 9);
    const a = presetView('oversikt', REF_BOUNDS);
    const b = presetView('oversikt', big);
    const da = Math.hypot(...a.position.map((v, i) => v - a.target[i]));
    const db = Math.hypot(...b.position.map((v, i) => v - b.target[i]));
    expect(db / da).toBeCloseTo(2, 9);
    const tiny = { min: [0, 0] as [number, number], max: [1, 1] as [number, number] };
    expect(presetScale(tiny)).toBe(0.5);
    const huge = { min: [0, 0] as [number, number], max: [1000, 1000] as [number, number] };
    expect(presetScale(huge)).toBe(3);
  });

  it('keep ovenfra above its target and the interior preset at eye height', () => {
    const b = { min: [-3, -8] as [number, number], max: [30, 20] as [number, number] };
    const top = presetView('ovenfra', b);
    expect(Math.abs(top.position[0] - top.target[0])).toBeLessThan(1e-9);
    expect(top.position[2]).toBeGreaterThan(40);
    const inside = presetView('inne-stua', b);
    expect(inside.position[2]).toBeCloseTo(1.6, 9);
  });

  it('presetWorld maps to the world frame', () => {
    const w = presetWorld('oversikt', REF_BOUNDS);
    expect([w.position.x, w.position.y, w.position.z]).toEqual([36, 26, 25]);
    expect([w.target.x, w.target.y, w.target.z]).toEqual([11.5, 1.5, -4.5]);
  });

  it('falls back gracefully for degenerate bounds', () => {
    const v = presetView('oversikt', { min: [NaN, NaN], max: [NaN, NaN] });
    expect(v.position.every(Number.isFinite)).toBe(true);
  });

  it('ease is monotonic from 0 to 1', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 12);
    let prev = 0;
    for (let k = 0; k <= 1; k += 0.05) {
      const e = easeInOutQuad(k);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = e;
    }
  });
});

describe('viewport aspect', () => {
  it('pulls exterior presets back in narrow viewports (at most 2.5×), never eye-level ones', () => {
    expect(aspectFactor('oversikt', REF_ASPECT)).toBe(1);
    expect(aspectFactor('oversikt', 1.6)).toBe(1);
    expect(aspectFactor('oversikt', REF_ASPECT / 2)).toBeCloseTo(2, 12);
    expect(aspectFactor('oversikt', 0.1)).toBe(2.5);
    expect(aspectFactor('inne-stua', 0.3)).toBe(1);
    expect(aspectFactor('oversikt', 0)).toBe(1);
  });

  it('keeps the target and scales the camera offset', () => {
    const a = presetWorld('oversikt', REF_BOUNDS);
    const b = presetWorld('oversikt', REF_BOUNDS, REF_ASPECT / 2);
    expect(b.target.distanceTo(a.target)).toBeCloseTo(0, 9);
    expect(b.position.distanceTo(b.target)).toBeCloseTo(2 * a.position.distanceTo(a.target), 9);
  });
});

/** IFC → plan transform math: the calibration, the inverse, the SVG and three.js matrices and the nudge. */
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { toWorld } from '../view3d/coords';
import { sliceTriangles } from './slice';
import { IFC_CALIBRATION, NUDGE_MAX, clampNudge, ifcHeight, ifcToPlan, planToIfc, svgMatrix, withNudge, worldMatrix } from './transform';
import type { IfcTransform } from './transform';

const SAMPLES: IfcTransform[] = [
  IFC_CALIBRATION,
  { dx: -3, dy: 7.5, dz: 0.4, rotationDeg: 33, mirror: false },
  { dx: 1.2, dy: -0.4, dz: -1, rotationDeg: -120, mirror: true },
];
const POINTS: [number, number, number][] = [
  [0, 0, 0],
  [-4.82, -1.9, 0.9],
  [7.4, 4.52, 3.87],
];

describe('IFC transform', () => {
  it('is the calibration of docs/kalibrering-ifc.md: X = x + 4.71, Y = 1.79 − z, H = y in web-ifc’s Y-up world', () => {
    expect(IFC_CALIBRATION).toEqual({ dx: 4.71, dy: 1.79, dz: 0, rotationDeg: 0, mirror: false });
    // web-ifc world (x, y, z) → IFC frame (u, v, h) = (x, −z, y)
    for (const [x, y, z] of [
      [-4.82, 0.9, 1.9],
      [7.4, 2.22, -4.52],
    ]) {
      const [px, py] = ifcToPlan(IFC_CALIBRATION, x, -z);
      expect(px).toBeCloseTo(x + 4.71, 9);
      expect(py).toBeCloseTo(1.79 - z, 9);
      expect(ifcHeight(IFC_CALIBRATION, y)).toBe(y);
    }
    // the west gable's cladding (IFC X = −4.82) lands 0.11 outside the axis x = 0
    expect(ifcToPlan(IFC_CALIBRATION, -4.82, 0)[0]).toBeCloseTo(-0.11, 9);
  });

  it('planToIfc inverts ifcToPlan, with rotation and mirror', () => {
    for (const t of SAMPLES) {
      for (const [u, v] of POINTS) {
        const [x, y] = ifcToPlan(t, u, v);
        const [u2, v2] = planToIfc(t, x, y);
        expect(u2).toBeCloseTo(u, 9);
        expect(v2).toBeCloseTo(v, 9);
      }
    }
    // a mirror flips the orientation
    const m = SAMPLES[2];
    const a = ifcToPlan(m, 0, 0);
    const b = ifcToPlan(m, 1, 0);
    const c = ifcToPlan(m, 0, 1);
    expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeCloseTo(-1, 9);
  });

  it('the SVG matrix maps like ifcToPlan', () => {
    for (const t of SAMPLES) {
      const [a, b, c, d, e, f] = /matrix\(([^)]*)\)/.exec(svgMatrix(t))![1].split(' ').map(Number);
      for (const [u, v] of POINTS) {
        const [x, y] = ifcToPlan(t, u, v);
        expect(a * u + c * v + e).toBeCloseTo(x, 5);
        expect(b * u + d * v + f).toBeCloseTo(y, 5);
      }
    }
    expect(svgMatrix(IFC_CALIBRATION)).toBe('matrix(1 0 0 1 4.71 1.79)');
  });

  it('the three.js matrix maps like ifcToPlan followed by view3d toWorld', () => {
    for (const t of SAMPLES) {
      const m = new Matrix4().set(...(worldMatrix(t) as Parameters<Matrix4['set']>));
      for (const [u, v, h] of POINTS) {
        const [x, y] = ifcToPlan(t, u, v);
        const got = new Vector3(u, v, h).applyMatrix4(m);
        const want = toWorld(x, y, h + t.dz);
        expect(got.distanceTo(want)).toBeLessThan(1e-9);
      }
    }
  });

  it('the nudge is whole centimetres within ±10 cm on top of the calibration', () => {
    expect(clampNudge({ dx: 0.034, dy: -0.016 })).toEqual({ dx: 0.03, dy: -0.02 });
    expect(clampNudge({ dx: 0.5, dy: -7 })).toEqual({ dx: NUDGE_MAX, dy: -NUDGE_MAX });
    expect(clampNudge({ dx: Number.NaN, dy: -0 })).toEqual({ dx: 0, dy: 0 });
    const t = withNudge(IFC_CALIBRATION, { dx: 0.02, dy: -0.3 });
    expect(t.dx).toBeCloseTo(4.73, 9);
    expect(t.dy).toBeCloseTo(1.69, 9);
    expect(IFC_CALIBRATION.dx).toBe(4.71);
  });
});

describe('sliceTriangles', () => {
  // unit cube, 12 triangles, each face split along a diagonal
  const P = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
  const I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const length = (s: number[]) => {
    let l = 0;
    for (let i = 0; i < s.length; i += 4) l += Math.hypot(s[i + 2] - s[i], s[i + 3] - s[i + 1]);
    return l;
  };

  it('cuts a closed box into its outline', () => {
    const s = sliceTriangles(P, I, 0.4);
    expect(s.length).toBe(8 * 4); // 2 segments per side face
    expect(length(s)).toBeCloseTo(4, 9);
  });

  it('gives nothing above or below; a vertex on the plane counts as below (the bottom outline, not the top)', () => {
    expect(sliceTriangles(P, I, 1.5)).toEqual([]);
    expect(sliceTriangles(P, I, -0.5)).toEqual([]);
    expect(sliceTriangles(P, I, 1)).toEqual([]);
    expect(length(sliceTriangles(P, I, 0))).toBeCloseTo(4, 9);
    expect(length(sliceTriangles(P, I, 1 - 1e-9))).toBeCloseTo(4, 6);
  });

  it('appends to the given array', () => {
    const out = [9, 9, 9, 9];
    sliceTriangles(P, I, 0.5, out);
    expect(out.slice(0, 4)).toEqual([9, 9, 9, 9]);
    expect(out.length).toBe(4 + 8 * 4);
  });
});

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { fromWorld, rotationYForPlanDir, toWorld, toWorldTuple, vec3ToWorld } from './coords';

describe('coords', () => {
  it('maps plan (x, y, z) to world (x, z, -y)', () => {
    const w = toWorld(1, 2, 3);
    expect([w.x, w.y, w.z]).toEqual([1, 3, -2]);
    expect(toWorldTuple(1, 2, 3)).toEqual([1, 3, -2]);
    const v = vec3ToWorld([4, 5, 6]);
    expect([v.x, v.y, v.z]).toEqual([4, 6, -5]);
  });

  it('round-trips through fromWorld', () => {
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [12.5, -4.6, 1.47],
      [-0.11, 12.1, 3.87],
    ];
    for (const [x, y, z] of pts) {
      expect(fromWorld(toWorld(x, y, z))).toEqual([x, y, z]);
    }
    const w = new Vector3(3, 4, 5);
    const [x, y, z] = fromWorld(w);
    expect(toWorld(x, y, z).equals(w)).toBe(true);
  });

  it('is a proper rotation (right-handed, determinant +1)', () => {
    const ex = toWorld(1, 0, 0);
    const ey = toWorld(0, 1, 0);
    const ez = toWorld(0, 0, 1);
    const c = new Vector3().crossVectors(ex, ey);
    expect(c.distanceTo(ez)).toBeLessThan(1e-12);
  });

  it('rotationYForPlanDir aligns local +x with the plan direction and local +z with the right normal', () => {
    const dir: [number, number] = [0, 1]; // plan +y
    const ry = rotationYForPlanDir(dir);
    expect(ry).toBeCloseTo(Math.PI / 2, 12);
    // local +x → world (cos ry, 0, −sin ry) should equal toWorld(dir)
    const lx = new Vector3(Math.cos(ry), 0, -Math.sin(ry));
    expect(lx.distanceTo(toWorld(dir[0], dir[1], 0))).toBeLessThan(1e-12);
    // local +z → world (sin ry, 0, cos ry) should equal the plan right normal (dy, −dx) = (1, 0)
    const lz = new Vector3(Math.sin(ry), 0, Math.cos(ry));
    expect(lz.distanceTo(toWorld(1, 0, 0))).toBeLessThan(1e-12);
  });
});

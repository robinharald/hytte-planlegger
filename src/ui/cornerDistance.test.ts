/**
 * "Avstand fra hjørne" (docs/phase2-plan.md §3.7) on the real seed: from the inner face of the nearer crossing wall to
 * the near edge of the opening, along the stored host; a typed distance becomes the stored offset for moveOpening.
 */
import { describe, expect, it } from 'vitest';
import { selectOpening } from '../state/selection';
import { cornerDistance, offsetForCornerDistance } from './cornerDistance';
import { seedFixture } from './testSeed';

const { derived } = seedFixture();
const at = (id: string) => {
  const hit = selectOpening(derived, id);
  if (!hit) throw new Error(`no opening ${id}`);
  return cornerDistance(derived, hit.opening, hit.wall);
};

describe('cornerDistance on Forslag D', () => {
  it('d-sov-ny on w-gang-n: 0,84 m from the face of w-wing-w (x 16 + 0,06) to the door edge (x 16,9)', () => {
    const cd = at('d-sov-ny');
    expect(cd?.crossingWallId).toBe('w-wing-w');
    expect(cd?.side).toBe('start');
    expect(cd?.face).toBeCloseTo(0.06, 6);
    expect(cd?.distance).toBeCloseTo(0.84, 6);
    // The temporary dimension runs from the wall face to the door edge, parallel to the host.
    expect(cd?.a[0]).toBeCloseTo(16.06, 6);
    expect(cd?.b[0]).toBeCloseTo(16.9, 6);
    expect(cd?.a[1]).toBeCloseTo(cd?.b[1] ?? NaN, 9);
  });

  it('door-mellom-vf on the main north edge measures to the vindfang | kjøkken wall w-vf-kjk', () => {
    const cd = at('door-mellom-vf');
    expect(cd?.crossingWallId).toBe('w-vf-kjk');
    // Edge from (16; 6,2) westwards: the wall's west face is at x 8,29 (s 7,71), the door's east edge at x 7,465.
    expect(cd?.distance).toBeCloseTo(8.29 - 7.465, 6);
  });

  it('a window near a corner measures to the inner face of the other exterior wall (win-bad-e1)', () => {
    const cd = at('win-bad-e1');
    expect(cd?.side).toBe('start');
    expect(cd?.crossingWallId.startsWith('blk-wing/')).toBe(true);
    // Wing east edge from (20,8; −2) northwards; the south wall's inner face is 0,16 inside; window 1,4 … 2,0.
    expect(cd?.face).toBeCloseTo(0.16, 6);
    expect(cd?.distance).toBeCloseTo(1.24, 6);
  });

  it('a typed distance becomes the stored offset (both sides)', () => {
    expect(offsetForCornerDistance({ side: 'start', face: 0.06 }, 0.8, 1)).toBeCloseTo(1.46, 9);
    expect(offsetForCornerDistance({ side: 'end', face: 4.64 }, 0.8, 1)).toBeCloseTo(3.24, 9);
    const hit = selectOpening(derived, 'd-sov-ny');
    const cd = at('d-sov-ny');
    if (!hit || !cd) throw new Error('missing');
    // Typing today's distance gives today's offset back.
    expect(offsetForCornerDistance(cd, hit.opening.opening.width, cd.distance)).toBeCloseTo(hit.opening.opening.offset, 9);
  });
});

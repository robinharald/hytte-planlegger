/**
 * Plan sections of IFC meshes: the horizontal plane h = const cuts every triangle that has vertices on both sides into
 * one segment. A vertex exactly on the plane counts as below, so a triangle gives 0 or 2 crossing edges and closed
 * solids give closed outlines (as separate segments; the plan draws them as one path).
 */

/** Appends the segments [u0, v0, u1, v1] where the plane h cuts the triangles (positions are (u, v, h) triples). */
export function sliceTriangles(positions: ArrayLike<number>, indices: ArrayLike<number>, h: number, out: number[] = []): number[] {
  const pts: number[] = [0, 0, 0, 0];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    let n = 0;
    for (let e = 0; e < 3; e++) {
      const ia = indices[t + e] * 3;
      const ib = indices[t + ((e + 1) % 3)] * 3;
      const ha = positions[ia + 2];
      const hb = positions[ib + 2];
      if (ha > h === hb > h) continue;
      const s = (h - ha) / (hb - ha);
      if (n < 2) {
        pts[n * 2] = positions[ia] + (positions[ib] - positions[ia]) * s;
        pts[n * 2 + 1] = positions[ia + 1] + (positions[ib + 1] - positions[ia + 1]) * s;
      }
      n++;
    }
    if (n !== 2) continue;
    if (Math.abs(pts[0] - pts[2]) < 1e-6 && Math.abs(pts[1] - pts[3]) < 1e-6) continue;
    out.push(pts[0], pts[1], pts[2], pts[3]);
  }
  return out;
}

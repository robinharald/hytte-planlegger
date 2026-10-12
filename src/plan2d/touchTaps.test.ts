/**
 * Phone taps select rooms (UX review of phase 2a: at the iPhone's starting zoom, 11,6 px/m, a tap on a room's label
 * selected a wall or a door in 18 of 24 rooms, because the 24 px touch hit bands are about 2 m wide there).
 *
 * jsdom has no SVG hit testing, so the plan's hit areas are replayed here from the same inputs the layers draw with
 * (storeyData.ts, labelLayout.ts and editModel.ts `hitBandPx`), top to bottom in the plan's layer order: room label
 * boxes (LabelLayer), structure (StructureLayer: stairs, chimney, posts, 10 px beam corridors), openings (footprint +
 * band), walls and dividers (footprint + band), then the room polygons. PlanView.edit.test.tsx checks that the layers
 * really draw those bands and label hit areas.
 */
import { describe, expect, it } from 'vitest';
import { distancePointSegment, pointInPolygon } from '../geometry/polygon';
import type { DerivedRoom } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import { createAppStore } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { CORRIDOR_COARSE_PX, hitBandPx } from './editModel';
import { labelFonts, layoutRoomLabels } from './labelLayout';
import { openingFrame } from './svg';
import { labelDensity } from './svg';
import { storeyData } from './storeyData';

const store = createAppStore(createForslagD());
store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
const derived = deriveForState(store.getState());
const data = storeyData(derived, 'ground');

type Hit = string;

/** What a tap at plan point p selects at `scale` px/m with a hit band of `bandPx` (labels as hit areas or not). */
function tapAt(p: Vec2, scale: number, bandPx: number, labelHits: boolean): Hit {
  const halfBand = bandPx / 2 / scale;
  if (labelHits) {
    const labels = layoutRoomLabels(data.rooms, labelDensity(scale), scale, labelFonts(scale), data.labelObstacles);
    for (const { room, label, at } of [...labels].reverse()) {
      const hw = label.w / 2 / scale;
      const hh = label.h / 2 / scale;
      if (Math.abs(p[0] - at[0]) <= hw && Math.abs(p[1] - at[1]) <= hh) return `room:${room.id}`;
    }
  }
  for (const el of [...data.structure].reverse()) {
    if (el.kind === 'stair' && el.footprint.length >= 3 && pointInPolygon(p, el.footprint)) return `structure:${el.id}`;
    if (el.kind === 'chimney' && p[0] >= el.min[0] && p[0] <= el.max[0] && p[1] >= el.min[1] && p[1] <= el.max[1]) return `structure:${el.id}`;
    if (el.kind === 'post' && Math.abs(p[0] - el.position[0]) <= el.size / 2 && Math.abs(p[1] - el.position[1]) <= el.size / 2) return `structure:${el.id}`;
    if (el.kind === 'beam' && distancePointSegment(p, el.a, el.b) <= 5 / scale) return `structure:${el.id}`;
  }
  for (const { wall, opening } of [...data.openings].reverse()) {
    if (opening.isGhost) continue;
    const f = openingFrame(wall, opening);
    if ((opening.footprint.length >= 3 && pointInPolygon(p, opening.footprint)) || distancePointSegment(p, f.start, f.end) <= halfBand) return `opening:${opening.id}`;
  }
  for (const w of [...data.dividers].reverse()) if (distancePointSegment(p, w.a, w.b) <= halfBand) return `wall:${w.id}`;
  for (const w of [...data.pieces].reverse()) {
    if ((w.footprint.length >= 3 && pointInPolygon(p, w.footprint)) || distancePointSegment(p, w.a, w.b) <= halfBand) return `wall:${w.id}`;
  }
  for (const r of [...data.rooms].reverse()) {
    if (pointInPolygon(p, r.polygon) && !r.holes.some((h) => pointInPolygon(p, h))) return `room:${r.id}`;
  }
  return 'none';
}

/** The tap point of a room: the centre of its drawn label at that zoom, else its label point. */
function labelPointAt(room: DerivedRoom, scale: number): Vec2 {
  const placed = layoutRoomLabels(data.rooms, labelDensity(scale), scale, labelFonts(scale), data.labelObstacles).find((l) => l.room.id === room.id);
  return placed ? placed.at : room.labelPoint;
}

function roomsSelected(scale: number, bandPx: number, labelHits: boolean): { ok: number; misses: string[] } {
  let ok = 0;
  const misses: string[] = [];
  for (const r of data.rooms) {
    const hit = tapAt(labelPointAt(r, scale), scale, bandPx, labelHits);
    if (hit === `room:${r.id}`) ok++;
    else misses.push(`${r.room?.name ?? r.id} → ${hit}`);
  }
  return { ok, misses };
}

describe('phone taps on room labels select the room', () => {
  it('the ground plan has the 24 rooms the review tapped', () => {
    expect(data.rooms).toHaveLength(24);
  });

  it('11,6 px/m: at least 22 of the 24 rooms (the 24 px band and labels without hit areas got far fewer)', () => {
    const now = roomsSelected(11.6, hitBandPx(true, 11.6), true);
    expect(now.ok, now.misses.join('; ')).toBeGreaterThanOrEqual(22);
    const before = roomsSelected(11.6, CORRIDOR_COARSE_PX, false);
    expect(before.ok).toBeLessThan(22);
  });

  it('the touch band is at most 0,25 m when zoomed out and the 24 px band when zoomed in', () => {
    expect(hitBandPx(true, 11.6)).toBeCloseTo(2.9, 6);
    expect(hitBandPx(true, 46)).toBeCloseTo(11.5, 6);
    expect(hitBandPx(true, 138)).toBe(24);
    expect(hitBandPx(false, 11.6)).toBe(12);
  });
});

import { describe, expect, it } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import { labelPoint } from '../geometry/polygon';
import type { DerivedRoom } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { TerrainAsset, Vec2 } from '../model/types';
import { createPlanFixture } from './fixture';
import {
  LABEL_FONT,
  LABEL_FONT_SMALL,
  boxFitsRegion,
  labelFitHalfSize,
  labelFonts,
  labelVariants,
  layoutRoomLabels,
  roomLabelLines,
  segmentEntersBox,
  textWidthPx,
  wrapName,
} from './labelLayout';
import type { Box, LabelRegion, PlacedRoomLabel } from './labelLayout';
import { storeyData } from './storeyData';
import { labelDensity } from './svg';

const d = createPlanFixture();
const kitchen = d.rooms.find((r) => r.id === 'rom-kjokken')!;

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

type TestRoom = Pick<DerivedRoom, 'id' | 'room' | 'dims' | 'area' | 'bbox' | 'labelPoint' | 'polygon' | 'holes'>;

/** A rectangular (or given) room with a label point at the polygon's pole of inaccessibility unless given. */
function room(id: string, name: string, polygon: Vec2[], opts: { lp?: Vec2; area?: number; approx?: boolean } = {}): TestRoom {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const min: Vec2 = [Math.min(...xs), Math.min(...ys)];
  const max: Vec2 = [Math.max(...xs), Math.max(...ys)];
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  return {
    id,
    room: { ...kitchen.room!, id, name, type: 'soverom' },
    dims: { w, h, approx: opts.approx ?? false },
    area: opts.area ?? w * h,
    bbox: { min, max },
    labelPoint: opts.lp ?? labelPoint(polygon),
    polygon,
    holes: [],
  };
}

/** The label rectangle (plan metres) as tested against the room, clearance included. */
function innerBox(p: PlacedRoomLabel<TestRoom | DerivedRoom>, scale: number): Box {
  const [hw, hh] = labelFitHalfSize(p.label.w, p.label.h, scale);
  return { x0: p.at[0] - hw, y0: p.at[1] - hh, x1: p.at[0] + hw, y1: p.at[1] + hh };
}

describe('text metrics', () => {
  it('uses Barlow advances: bold names are wider, narrow glyphs are narrow', () => {
    // Barlow 600 "Hovedbad" = 4.437 em (rounded up per glyph: 4.47 em).
    expect(textWidthPx('Hovedbad', 12, true)).toBeCloseTo(4.47 * 12, 6);
    expect(textWidthPx('Hovedbad', 12, true)).toBeGreaterThan(textWidthPx('Hovedbad', 12));
    expect(textWidthPx('iii', 10)).toBeLessThan(textWidthPx('mmm', 10) / 2);
    expect(textWidthPx('2,9 m²', 10)).toBeCloseTo((0.54 + 0.27 + 0.53 + 0.2 + 0.83 + 0.33) * 10, 6);
    expect(textWidthPx('', 12)).toBe(0);
  });

  it('assumes a wide glyph for characters it does not know', () => {
    expect(textWidthPx('漢', 10)).toBeCloseTo(6.2, 6);
  });
});

describe('label text', () => {
  it('shows name, comma-decimal dims (ca. when not rectangular) and area at full density', () => {
    expect(roomLabelLines(kitchen, 'full')).toEqual(['Kjøkken', 'ca. 5,8 × 5,7 m', '24,5 m²']);
    const bad = d.rooms.find((r) => r.id === 'rom-bad')!;
    expect(roomLabelLines(bad, 'full')).toEqual(['Bad', '2,8 × 2,8 m', '7,8 m²']);
  });

  it('shows the name only at medium density and nothing when zoomed out', () => {
    expect(roomLabelLines(kitchen, 'name')).toEqual(['Kjøkken']);
    expect(roomLabelLines(kitchen, 'none')).toEqual([]);
  });

  it('gives openings in the floor (apning) the name only', () => {
    const apning = { ...kitchen, room: { ...kitchen.room!, name: 'Trappeåpning', type: 'apning' as const } };
    expect(roomLabelLines(apning, 'full')).toEqual(['Trappeåpning']);
    expect(labelVariants(apning, 'full', [LABEL_FONT]).every((v) => v.kind === 'name')).toBe(true);
  });

  it('labels faces without a room record "Uten navn" and falls back for blank names', () => {
    const unnamed = { ...kitchen, room: undefined };
    expect(roomLabelLines(unnamed, 'full')).toEqual(['Uten navn', 'ca. 5,8 × 5,7 m', '24,5 m²']);
    const blank = { ...kitchen, room: { ...kitchen.room!, name: '   ' } };
    expect(roomLabelLines(blank, 'name')).toEqual(['Uten navn']);
  });

  it('wraps a name into two balanced lines, never leaving a line under three characters', () => {
    expect(wrapName('Korridor (nedre)')).toEqual(['Korridor', '(nedre)']);
    expect(wrapName('Soverom (ny fløy)')).toEqual(['Soverom', '(ny fløy)']);
    expect(wrapName('Hems 1 (soverom)')).toEqual(['Hems 1', '(soverom)']);
    expect(wrapName('Teknisk / vask')).toEqual(['Teknisk /', 'vask']);
    expect(wrapName('Soverom 3')).toBeNull();
    expect(wrapName('Bad')).toBeNull();
    expect(wrapName('  ')).toBeNull();
  });
});

describe('label variants', () => {
  const r = room('r', 'Korridor (øvre)', rect(0, 0, 4, 2));

  it('orders full layouts (stacked, then dims · area) in the normal font, then the small font, then compact, then the name', () => {
    const v = labelVariants(r, 'full', [LABEL_FONT, LABEL_FONT_SMALL]);
    const sig = v.map((x) => `${x.kind}/${x.font === LABEL_FONT ? 'n' : 's'}/${x.lines.length - x.nameLines}/${x.nameLines}`);
    expect(sig).toEqual([
      'full/n/2/1',
      'full/n/2/2',
      'full/n/1/1',
      'full/n/1/2',
      'full/s/2/1',
      'full/s/2/2',
      'full/s/1/1',
      'full/s/1/2',
      'compact/n/1/1',
      'compact/n/1/2',
      'compact/s/1/1',
      'compact/s/1/2',
      'name/n/0/1',
      'name/n/0/2',
      'name/s/0/1',
      'name/s/0/2',
    ]);
    expect(v[2].lines).toEqual(['Korridor (øvre)', '4,0 × 2,0 m · 8,0 m²']);
    expect(v[8].lines).toEqual(['Korridor (øvre)', '8,0 m²']);
  });

  it('measures each variant and centres its lines', () => {
    const [full] = labelVariants(r, 'full', [LABEL_FONT]);
    expect(full.h).toBe(LABEL_FONT.line + 2 * LABEL_FONT.detailLine);
    expect(full.ys[0]).toBeCloseTo(-full.h / 2 + LABEL_FONT.line / 2, 9);
    expect(full.ys[2]).toBeCloseTo(full.h / 2 - LABEL_FONT.detailLine / 2, 9);
    expect(full.w).toBeCloseTo(Math.max(textWidthPx('Korridor (øvre)', 12, true), textWidthPx('4,0 × 2,0 m', 10.5), textWidthPx('8,0 m²', 10.5)), 9);
  });

  it('offers names only at name density and nothing at none', () => {
    expect(labelVariants(r, 'name', [LABEL_FONT]).map((x) => x.lines)).toEqual([['Korridor (øvre)'], ['Korridor', '(øvre)']]);
    expect(labelVariants(r, 'none', [LABEL_FONT])).toEqual([]);
  });

  it('uses the small font alone below 12 px/m and tries it second above', () => {
    expect(labelFonts(11.9)).toEqual([LABEL_FONT_SMALL]);
    expect(labelFonts(12)).toEqual([LABEL_FONT, LABEL_FONT_SMALL]);
    expect(LABEL_FONT_SMALL.name).toBeLessThan(LABEL_FONT.name);
  });
});

describe('box in region', () => {
  const L: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 1],
    [1, 1],
    [1, 3],
    [0, 3],
  ];
  const region = (obstacles: Vec2[][] = [], holes: Vec2[][] = []): LabelRegion => ({ polygon: L, holes, obstacles });

  it('detects segments entering the open box, not ones touching or passing it', () => {
    const box = { x0: 0, y0: 0, x1: 2, y1: 2 };
    expect(segmentEntersBox([-1, 1], [3, 1], box)).toBe(true);
    expect(segmentEntersBox([1, 1], [1, 1], box)).toBe(true);
    expect(segmentEntersBox([-1, 0], [3, 0], box)).toBe(false); // along an edge
    expect(segmentEntersBox([2, 2], [3, 3], box)).toBe(false); // touches a corner
    expect(segmentEntersBox([3, -1], [3, 5], box)).toBe(false);
    expect(segmentEntersBox([-1, 3], [3, -1], box)).toBe(true); // diagonal through
  });

  it('accepts boxes inside an L-shaped room and rejects ones across its inner corner', () => {
    expect(boxFitsRegion({ x0: 0.1, y0: 0.1, x1: 3.9, y1: 0.9 }, region())).toBe(true);
    expect(boxFitsRegion({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 2.9 }, region())).toBe(true);
    expect(boxFitsRegion({ x0: 0.5, y0: 0.5, x1: 1.5, y1: 1.5 }, region())).toBe(false); // crosses the notch
    expect(boxFitsRegion({ x0: 2, y0: 2, x1: 3, y1: 2.5 }, region())).toBe(false); // outside
    expect(boxFitsRegion({ x0: -0.1, y0: 0.1, x1: 0.5, y1: 0.5 }, region())).toBe(false); // through a wall
  });

  it('keeps clear of holes and obstacles, whether they overlap, sit inside or contain the box', () => {
    const stair = rect(2, 0, 3, 1);
    expect(boxFitsRegion({ x0: 1.5, y0: 0.2, x1: 2.5, y1: 0.8 }, region([stair]))).toBe(false);
    expect(boxFitsRegion({ x0: 0.1, y0: 0.1, x1: 3.9, y1: 0.9 }, region([rect(2, 0.4, 2.2, 0.6)]))).toBe(false);
    expect(boxFitsRegion({ x0: 2.2, y0: 0.2, x1: 2.8, y1: 0.8 }, region([stair]))).toBe(false);
    expect(boxFitsRegion({ x0: 0.1, y0: 0.1, x1: 1.9, y1: 0.9 }, region([stair]))).toBe(true);
    expect(boxFitsRegion({ x0: 0.1, y0: 0.1, x1: 3.9, y1: 0.9 }, region([], [rect(3, 0.3, 3.5, 0.7)]))).toBe(false);
    expect(boxFitsRegion({ x0: 0.1, y0: 0.1, x1: 1, y1: 1 }, { polygon: [], holes: [], obstacles: [] })).toBe(false);
  });
});

describe('room label layout', () => {
  const S = 30;
  const fonts = [LABEL_FONT, LABEL_FONT_SMALL];
  const lay = (rooms: TestRoom[], scale = S, obstacles: Vec2[][] = []) => layoutRoomLabels(rooms, labelDensity(scale), scale, labelFonts(scale), obstacles);

  it('keeps the full label at the label point when the room is big enough', () => {
    const [p] = lay([room('stue', 'Stue', rect(0, 0, 6, 4))]);
    expect(p.label.kind).toBe('full');
    expect(p.label.lines).toEqual(['Stue', '6,0 × 4,0 m', '24,0 m²']);
    expect(p.at).toEqual(labelPoint(rect(0, 0, 6, 4)));
  });

  it('puts dims and area on one line in a long, narrow room', () => {
    const [p] = lay([room('gang', 'Gang', rect(0, 0, 4.6, 1.1))], 24.7);
    expect(p.label.kind).toBe('full');
    expect(p.label.lines).toEqual(['Gang', '4,6 × 1,1 m · 5,1 m²']);
  });

  it('falls back to a compact "name / m²" label before dropping to the name alone', () => {
    // 1.3 × 2.2 m at 24.7 px/m: no full label fits (32 px wide), "Bod / 2,9 m²" does.
    const [p] = lay([room('bod', 'Bod', rect(0, 0, 1.3, 2.2))], 24.7);
    expect(p.label.kind).toBe('compact');
    expect(p.label.lines).toEqual(['Bod', '2,9 m²']);
    // Narrower still: only the name.
    const [q] = lay([room('do', 'Do', rect(0, 0, 0.9, 2.2))], 24.7);
    expect(q.label.kind).toBe('name');
    expect(q.label.lines).toEqual(['Do']);
  });

  it('shows names only between 8 and 20 px/m and nothing below 8', () => {
    const big = room('stue', 'Stue', rect(0, 0, 10, 6));
    expect(lay([big], 19.9)[0].label.kind).toBe('name');
    expect(lay([big], 19.9)[0].label.font).toBe(LABEL_FONT);
    expect(lay([big], 11)[0].label.font).toBe(LABEL_FONT_SMALL);
    expect(lay([big], 8)[0].label.lines).toEqual(['Stue']);
    expect(lay([big], 7.9)).toEqual([]);
    expect(lay([big], 20)[0].label.kind).toBe('full');
  });

  it('moves the label off an off-centre label point so it stays inside the room', () => {
    // Label point 0.3 m from the west wall of a 5 m wide room: centred there the label would cross the wall.
    const r = room('hems', 'Hems 2 (soverom)', rect(0, 0, 5, 3), { lp: [0.3, 1.5] });
    const [p] = lay([r], 24.7);
    expect(p.label.kind).toBe('full');
    expect(p.at[0]).toBeGreaterThan(0.3);
    expect(boxFitsRegion(innerBox(p, 24.7), { polygon: r.polygon, holes: [], obstacles: [] })).toBe(true);
    // It moved no further than needed: towards the bbox centre, not beyond it.
    expect(p.at[0]).toBeLessThanOrEqual(2.5 + 1e-9);
  });

  it('keeps labels off stairs in the room and never across a wall', () => {
    // A corridor with a stair filling its west half: the label goes to the free east half.
    const corridor = room('korr', 'Korridor (øvre)', rect(0, 0, 4.7, 2), { lp: [1.2, 1] });
    const stair = rect(0, 0, 2.2, 2);
    const [p] = lay([corridor], 30, [stair]);
    expect(p).toBeDefined();
    const box = innerBox(p, 30);
    expect(box.x0).toBeGreaterThanOrEqual(2.2 - 1e-9);
    expect(boxFitsRegion(box, { polygon: corridor.polygon, holes: [], obstacles: [stair] })).toBe(true);
  });

  it('places the larger room first and moves or drops a label that would overlap one placed before', () => {
    // Overlapping faces (not produced by room detection, but the layout must not rely on that).
    const big = room('big', 'Stue', rect(0, 0, 3, 2), { area: 6 });
    const small = room('small', 'Kjøkken', rect(0, 0, 3, 2), { area: 5 });
    const out = layoutRoomLabels([small, big], 'name', 30, fonts);
    expect(out[0].room.id).toBe('big');
    expect(out).toHaveLength(2);
    const [a, b] = out.map((o) => innerBox(o, 30));
    expect(a.x0 >= b.x1 || b.x0 >= a.x1 || a.y0 >= b.y1 || b.y0 >= a.y1).toBe(true);
    // A room too small for a second label next to the first gets none.
    const tiny = room('tiny', 'Kjøkken', rect(0, 0, 3, 0.6), { area: 1 });
    const out2 = layoutRoomLabels([room('big2', 'Stue', rect(0, 0, 3, 0.6), { area: 6 }), tiny], 'name', 30, [LABEL_FONT]);
    expect(out2.map((o) => o.room.id)).toEqual(['big2']);
  });

  it('keeps labels of rooms far enough apart', () => {
    const out = layoutRoomLabels([room('a', 'Bad', rect(-1, 0, 1, 2)), room('b', 'Do', rect(3, 0, 5, 2))], 'name', 30, fonts);
    expect(out.map((o) => o.room.id).sort()).toEqual(['a', 'b']);
  });
});

describe('room labels on Forslag D', () => {
  const project = createForslagD();
  const derived = deriveVariant(project.variants[0], project.site, terrainJson as unknown as TerrainAsset);
  /** Plan-only at 1400 × 900 px (measured in the app). */
  const LAPTOP = 24.7;

  it('labels every room of 4 m² or more with name, dims and area at the laptop Plan-only zoom', () => {
    for (const storey of ['ground', 'loft']) {
      const s = storeyData(derived, storey);
      const out = layoutRoomLabels(s.rooms, labelDensity(LAPTOP), LAPTOP, labelFonts(LAPTOP), s.labelObstacles);
      const byId = new Map(out.map((o) => [o.room.id, o]));
      for (const r of s.rooms.filter((x) => x.area >= 4)) {
        const p = byId.get(r.id);
        expect(p?.label.kind, `${r.room?.name}`).toBe('full');
        expect(p!.label.lines.join(' ')).toContain('m²');
        expect(p!.label.lines.join(' ')).toMatch(/\d,\d × \d,\d m/);
      }
    }
  });

  it('keeps every label inside its room, off stairs, chimney and posts, and apart, at any zoom', () => {
    for (const scale of [8, 9.4, 11.25, 16, 20, 24.7, 30, 45, 80]) {
      for (const storey of ['ground', 'loft']) {
        const s = storeyData(derived, storey);
        const out = layoutRoomLabels(s.rooms, labelDensity(scale), scale, labelFonts(scale), s.labelObstacles);
        const boxes: Box[] = [];
        for (const p of out) {
          const box = innerBox(p, scale);
          expect(boxFitsRegion(box, { polygon: p.room.polygon, holes: p.room.holes, obstacles: s.labelObstacles }), `${p.room.room?.name} @ ${scale}`).toBe(true);
          for (const b of boxes) expect(box.x0 >= b.x1 || b.x0 >= box.x1 || box.y0 >= b.y1 || b.y0 >= box.y1).toBe(true);
          boxes.push(box);
        }
      }
    }
  });

  it('keeps the Korridor (øvre) label off both stairs', () => {
    const s = storeyData(derived, 'ground');
    const out = layoutRoomLabels(s.rooms, 'full', LAPTOP, labelFonts(LAPTOP), s.labelObstacles);
    const p = out.find((o) => o.room.id === 'room-korr-ovre')!;
    const stairs = s.structure.filter((x) => x.kind === 'stair');
    expect(stairs).toHaveLength(2);
    expect(boxFitsRegion(innerBox(p, LAPTOP), { polygon: p.room.polygon, holes: [], obstacles: stairs.map((x) => (x.kind === 'stair' ? x.footprint : [])) })).toBe(true);
  });

  it('lays out a storey fast enough for wheel zooming', () => {
    const s = storeyData(derived, 'ground');
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) layoutRoomLabels(s.rooms, 'full', 20 + i, labelFonts(20 + i), s.labelObstacles);
    expect((performance.now() - t0) / 20).toBeLessThan(20);
  });
});

import { describe, expect, it } from 'vitest';
import { createPlanFixture } from './fixture';
import { cutClipPath, fitBounds, fitRoomLabel, layoutRoomLabels, roomLabelLines, scaleBarLabel, wallPaint, wrapName } from './drawing';
import { COLORS } from './style';

const d = createPlanFixture();
const kitchen = d.rooms.find((r) => r.id === 'rom-kjokken')!;

describe('room labels', () => {
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
  });

  it('labels faces without a room record "Uten navn" and falls back for blank names', () => {
    const unnamed = { ...kitchen, room: undefined };
    expect(roomLabelLines(unnamed, 'full')).toEqual(['Uten navn', 'ca. 5,8 × 5,7 m', '24,5 m²']);
    const blank = { ...kitchen, room: { ...kitchen.room!, name: '   ' } };
    expect(roomLabelLines(blank, 'name')).toEqual(['Uten navn']);
  });
});

describe('scale bar label', () => {
  it('uses comma decimals and no decimals for whole metres', () => {
    expect(scaleBarLabel(5)).toBe('5 m');
    expect(scaleBarLabel(0.5)).toBe('0,5 m');
    expect(scaleBarLabel(0.1)).toBe('0,1 m');
    expect(scaleBarLabel(1000)).toBe('1000 m');
  });
});

describe('wall paint and opening cuts', () => {
  it('paints walls by status and the highlight toggle', () => {
    expect(wallPaint('removed', true)).toEqual({ fill: 'none', stroke: COLORS.wallRemoved, dash: '4 3' });
    expect(wallPaint('removed', false).dash).toBe('4 3');
    expect(wallPaint('new', true)).toEqual({ fill: COLORS.wallNewFill, stroke: COLORS.wallNewStroke });
    expect(wallPaint('new', false).fill).toBe(COLORS.wallExisting);
    expect(wallPaint('existing', true).fill).toBe(COLORS.wallExisting);
  });

  it('builds one outer ring plus one hole per cut', () => {
    const clip = cutClipPath(d.bounds, [
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      [
        [2, 2],
        [3, 2],
        [3, 3],
      ],
    ]);
    expect((clip.match(/Z/g) ?? []).length).toBe(3);
    expect(clip.startsWith(`M${d.bounds.min[0] - 25} ${d.bounds.min[1] - 25}`)).toBe(true);
    expect(cutClipPath(d.bounds, [])).toMatch(/^M[^Z]+Z$/);
    expect(cutClipPath(d.bounds, [[[0, 0]]])).toMatch(/^M[^Z]+Z$/);
  });
});

describe('fit bounds', () => {
  it('grows the built bounds by the dimension lines', () => {
    const r = fitBounds(d.bounds, d.dimensions);
    expect(r.min[1]).toBeCloseTo(-5.8, 9); // total dimension below the deck
    expect(r.min[0]).toBeCloseTo(-1.2, 9); // west chain
    expect(r.max[0]).toBeCloseTo(15.8, 9); // east chain
    expect(r.max[1]).toBeCloseTo(7.2, 9); // north chain
  });

  it('returns the bounds unchanged without (or with degenerate) dimensions', () => {
    expect(fitBounds(d.bounds, [])).toEqual(d.bounds);
    expect(fitBounds(d.bounds, [{ a: [1, 1], b: [1, 1], offset: 50 }])).toEqual(d.bounds);
  });
});

describe('room labels fitted to the room', () => {
  const font = { name: 12, detail: 10.5, line: 13 };
  const room = (name: string, w: number, h: number) => ({
    room: { ...kitchen.room!, name },
    dims: { w, h, approx: false },
    area: w * h,
    bbox: { min: [0, 0] as [number, number], max: [w, h] as [number, number] },
  });

  it('wraps a name into two balanced lines at a space', () => {
    expect(wrapName('Korridor (nedre)')).toEqual(['Korridor', '(nedre)']);
    expect(wrapName('Soverom (ny fløy)')).toEqual(['Soverom', '(ny fløy)']);
    expect(wrapName('Bad')).toBeNull();
  });

  it('keeps the full label when the room is big enough', () => {
    expect(fitRoomLabel(room('Stue', 6, 4), 'full', 40, font)).toMatchObject({ lines: ['Stue', '6,0 × 4,0 m', '24,0 m²'], nameLines: 1 });
  });

  it('drops the details, then wraps the name, then gives up in small rooms', () => {
    expect(fitRoomLabel(room('Bad', 1.9, 1.7), 'full', 26, font).lines).toEqual(['Bad']);
    expect(fitRoomLabel(room('Korridor (nedre)', 2.0, 1.9), 'name', 30, font)).toMatchObject({ lines: ['Korridor', '(nedre)'], nameLines: 2 });
    expect(fitRoomLabel(room('Teknisk / vask', 1.2, 2.2), 'name', 26, font).lines).toEqual([]);
    expect(fitRoomLabel(room('Teknisk / vask', 1.2, 2.2), 'name', 60, font).lines.length).toBeGreaterThan(0);
  });
});

describe('room label layout', () => {
  const font = { name: 12, detail: 10.5, line: 13 };
  const at = (id: string, name: string, x: number, w: number) => ({
    id,
    room: { ...kitchen.room!, id, name },
    dims: { w, h: 2, approx: false },
    area: w * 2,
    bbox: { min: [x - w / 2, 0] as [number, number], max: [x + w / 2, 2] as [number, number] },
    labelPoint: [x, 1] as [number, number],
  });

  it('places the larger room first and drops a smaller neighbour whose label would overlap it', () => {
    const big = at('big', 'Korridor (øvre)', 5, 4);
    const small = at('small', 'Korridor (nedre)', 3.4, 2);
    const out = layoutRoomLabels([small, big], 'name', 30, font);
    expect(out.map((o) => o.room.id)).toEqual(['big']);
  });

  it('keeps labels of rooms far enough apart', () => {
    const out = layoutRoomLabels([at('a', 'Bad', 0, 2), at('b', 'Do', 4, 2)], 'name', 30, font);
    expect(out.map((o) => o.room.id).sort()).toEqual(['a', 'b']);
  });
});

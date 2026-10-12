/**
 * Colours, stroke widths and fonts of the plan. The sheet is always light (an architect's drawing), so all
 * colours are fixed hex values: CSS custom properties are not reliable inside SVG presentation attributes.
 * Accent and "new" match the app theme tokens (`--accent #4f6b55`, `--new #c8742a`).
 * Stroke widths are screen pixels (every stroked element uses vector-effect non-scaling-stroke).
 */
import type { FloorMaterial } from '../model/types';

export const PAPER = '#fafaf7';
export const ACCENT = '#4f6b55';
export const NEW = '#c8742a';

export const COLORS = {
  grid1: '#e4e8e0',
  grid5: '#cdd4c8',
  wallExisting: '#2b2b2b',
  /** Light tint of NEW (#c8742a) for new wall fill. */
  wallNewFill: '#e9b48c',
  wallNewStroke: '#8a4d1c',
  /** "Fjernet" ghosts (removed walls / openings, moved block edges): dashed, with a faint fill of the same grey. */
  wallRemoved: '#6f6f6f',
  divider: '#6b6b6b',
  otherStorey: '#b9c0b7',
  opening: '#2b2b2b',
  openingNew: '#8a4d1c',
  glass: '#4d7da0',
  deck: '#dccbb0',
  deckHatch: '#c8b391',
  deckStroke: '#9c8a6b',
  railing: '#4a4a4a',
  structure: '#333333',
  hotTub: '#cfe3ee',
  hotTubStroke: '#6e97ad',
  tree: '#8fb196',
  labelName: '#1f2620',
  labelMuted: '#5b665d',
  labelNew: '#8a4d1c',
  dimension: '#3b4a3f',
  roofPlan: '#7a8a7c',
  north: '#1f2620',
  scaleBar: '#1f2620',
} as const;

/**
 * Very light floor tints by material only. Kept close to neutral (no orange cast) so that nothing reads as new
 * work unless `highlightNew` is on; then new floors are mixed with NEW by FLOOR_NEW_MIX (drawing.ts floorFill).
 */
export const FLOOR_TINT: Record<FloorMaterial, string> = {
  wood: '#f4f0e7',
  tile: '#e6ebee',
  sauna: '#f0eadf',
  concrete: '#ebebe8',
  deck: '#ece7de',
};

/** Share of NEW mixed into a new floor's material tint when "Marker det som er nytt" is on. */
export const FLOOR_NEW_MIX = 0.22;

export const STROKE = {
  hair: 0.75,
  thin: 1,
  wall: 1.25,
  medium: 1.5,
  selected: 2.5,
} as const;

/** Applied through `style` (custom properties work there, not in presentation attributes). */
export const FONT = "var(--font-body, 'Barlow', 'Barlow Semi Condensed', system-ui, sans-serif)";
/** Text sizes (px). The *Small sizes are used below 12 px/m (svg.ts SMALL_TEXT_BELOW). */
export const FONT_PX = { name: 12, detail: 10.5, dim: 10.5, small: 10, nameSmall: 10, detailSmall: 9, dimSmall: 9 } as const;

/** Opacity of outdoor elements on storeys other than the one with the main floor. */
export const FAINT_OPACITY = 0.35;

/** Spread onto every stroked element so strokes stay crisp at any zoom. */
export const NSS = { vectorEffect: 'non-scaling-stroke' } as const;

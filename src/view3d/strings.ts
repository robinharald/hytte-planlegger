/**
 * User-visible strings of the 3D view; they live in i18n/nb.ts (`nb.view3d`). Numbers go through ui/format.ts
 * (comma decimals, "m²").
 */
import { nb } from '../i18n/nb';
import { formatDims, formatM2 } from '../ui/format';

export const STRINGS = nb.view3d;

/** Second label line of a room: "2,2 × 4,2 m · 9,2 m²" ("ca. …" when the room is not a rectangle). */
export function formatRoomDetail(w: number, h: number, approx: boolean, area: number): string {
  return `${formatDims(w, h, approx)} · ${formatM2(area)}`;
}

/** File names of the exports (light: used by the main bundle's menu and by the lazy PDF module). */

/** "2026-10-13" in local time. */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** «hytta-<forslag>-<åååå-mm-dd>.pdf» (the proposal's name in lower case, æøå spelt out, other signs as dashes). */
export function pdfFileName(proposal: string, date: Date): string {
  const slug =
    proposal
      .toLowerCase()
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'forslag';
  return `hytta-${slug}-${isoDate(date)}.pdf`;
}

/** «hytta-3d-<åååå-mm-dd>.png». */
export function pngFileName(date: Date): string {
  return `hytta-3d-${isoDate(date)}.png`;
}

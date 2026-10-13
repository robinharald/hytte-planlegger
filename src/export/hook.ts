/**
 * Playwright hook for the exports: `window.__hytte.lastExport = { kind, bytes, pages, fileName, … }` after every PDF or
 * PNG export (set on the current `window.__hytte` object; ui/hooks.ts `useTestHook` replaces that object when the
 * project, selection or readiness changes, and carries `lastExport()` over).
 */

export interface LastExport {
  kind: 'pdf' | 'png';
  /** File size in bytes. */
  bytes: number;
  pages: number;
  fileName: string;
  /** PNG only: image size in pixels. */
  width?: number;
  height?: number;
}

let last: LastExport | null = null;

export function lastExport(): LastExport | null {
  return last;
}

export function publishLastExport(info: LastExport): void {
  last = info;
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __hytte?: Record<string, unknown> };
  if (w.__hytte) w.__hytte.lastExport = info;
  else w.__hytte = { lastExport: info };
}

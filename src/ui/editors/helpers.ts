/**
 * Pure helpers of the Egenskaper editors (kept out of the component files so fast refresh works): what "Ta tilbake"
 * selects, labels, the block side edges the size fields move, the part lines of a mixed block, the free run steps
 * are added on.
 */
import { nb } from '../../i18n/nb';
import type { DerivedBlock, DerivedDeck, DerivedFurniture } from '../../model/derived';
import type { Id, Vec2 } from '../../model/types';
import type { Selection } from '../../state/selection';
import { formatField } from '../numberInput';
import type { GhostTarget } from '../uiSelection';

/** Shortest free run (m) steps are put on. */
const MIN_STEPS_RUN = 1;

const GHOST_SUFFIX = '/ghost';

/** What "Ta tilbake" selects afterwards. */
export function restoredSelection(ghost: GhostTarget): Selection | null {
  const base = ghost.id.endsWith(GHOST_SUFFIX) ? ghost.id.slice(0, -GHOST_SUFFIX.length) : ghost.id;
  if (ghost.type === 'wall') return { kind: 'wall', id: base };
  if (ghost.type === 'opening') return { kind: 'opening', id: base };
  return null;
}

export function ghostKindLabel(ghost: GhostTarget): string {
  if (ghost.type === 'opening') return nb.openingTypes[ghost.opening.type];
  return nb.edit.ghost.kinds[ghost.type === 'wall' ? 'wall' : 'edge'];
}

export function furnitureName(f: DerivedFurniture): string {
  return f.catalog?.name ?? f.item.catalogId;
}

/** The block edge on the max-x ('x') or max-y ('y') side of the axis bounding box, if there is exactly one. */
export function blockSideEdge(block: DerivedBlock, axis: 'x' | 'y'): DerivedBlock['edges'][number] | null {
  const k = axis === 'x' ? 0 : 1;
  const max = Math.max(...block.axis.map((p) => p[k]));
  const hits = block.edges.filter((e) => e.outward[k] > 0.999 && Math.abs(e.a[k] - max) < 0.01 && Math.abs(e.b[k] - max) < 0.01);
  return hits.length === 1 ? hits[0] : null;
}

function bboxDims(poly: Vec2[]): { w: number; h: number } {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** "Eksisterende: 12,00 × 6,20 m" / "Stue forlenget: lengde 4,00 m" for each part with some area. */
export function partLines(block: DerivedBlock): string[] {
  if (!block.block.parts.length) return [];
  const full = block.axisDims;
  const lines: string[] = [];
  for (const p of block.parts) {
    if (p.outer.length < 3 && p.part.polygon.length < 3) continue;
    const poly = p.part.polygon.length >= 3 ? p.part.polygon : p.outer;
    const d = bboxDims(poly);
    if (d.w < 0.01 || d.h < 0.01) continue;
    const name = p.isImplicit ? nb.edit.block.implicitPart : p.part.name;
    const m = (v: number) => `${formatField(v, 2)} m`;
    if (p.part.isNew && Math.abs(d.h - full.h) < 0.01 && d.w < full.w - 0.01) lines.push(nb.edit.block.partLength(name, m(d.w)));
    else if (p.part.isNew && Math.abs(d.w - full.w) < 0.01 && d.h < full.h - 0.01) lines.push(nb.edit.block.partLength(name, m(d.h)));
    else lines.push(nb.edit.block.partDims(name, `${formatField(d.w, 2)} × ${formatField(d.h, 2)} m`));
  }
  return lines;
}

/** The longest free run (optionally of one edge), if it is long enough for steps. */
export function longestFreeRun(deck: DerivedDeck, edgeId?: Id): DerivedDeck['freeRuns'][number] | null {
  let best: DerivedDeck['freeRuns'][number] | null = null;
  for (const r of deck.freeRuns) {
    if (edgeId && r.edgeId !== edgeId) continue;
    if (!best || r.s1 - r.s0 > best.s1 - best.s0) best = r;
  }
  return best && best.s1 - best.s0 >= MIN_STEPS_RUN ? best : null;
}

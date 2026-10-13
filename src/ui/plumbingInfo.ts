/**
 * The drainage helper's lines under the Vis toggle «Avløp og sluk» (ui/PlumbingToggle.tsx): an analysis
 * (geometry/plumbing.ts `analysePlumbing`) turned into Norwegian sentences from `nb.plumbing`.
 */
import { FIXTURE_REACH_M } from '../geometry/plumbing';
import type { PlumbingAnalysis } from '../geometry/plumbing';
import { nb } from '../i18n/nb';
import type { Id } from '../model/types';

export interface PlumbingInfoLine {
  key: string;
  text: string;
  /** 'ok': fine; 'far': too far (a button that selects the fixture); 'note': context. */
  tone: 'ok' | 'far' | 'note';
  /** The fixture a 'far' line is about. */
  furnitureId?: Id;
  levelId?: Id;
}

/**
 * The Vis section's lines for an analysis: fine toilet pairs, the other toilets (fine or not), the fixtures that are
 * too far, a count of the other fine fixtures, the rooms that use today's drains, and a note on the stacks.
 */
export function plumbingInfoLines(analysis: PlumbingAnalysis, opts: { editable?: boolean } = {}): PlumbingInfoLine[] {
  const S = nb.plumbing;
  const lines: PlumbingInfoLine[] = [];
  if (analysis.fixtures.length === 0) return [{ key: 'none', text: S.none, tone: 'note' }];
  const paired = new Set<Id>();
  for (const p of analysis.pairs) {
    if (!p.fine) continue;
    lines.push({ key: `pair-${p.ids.join('-')}`, text: S.pair(p.roomNames, p.kind, p.axis, p.value), tone: 'ok' });
    for (const id of p.ids) paired.add(id);
  }
  let othersNear = 0;
  for (const f of analysis.fixtures) {
    if (f.state === 'today' || paired.has(f.id)) continue;
    if (f.state === 'far') {
      const text = f.distance === null ? S.noStack(f.catalogId, f.roomName) : S.far(f.catalogId, f.roomName, f.distance, f.limit);
      lines.push({ key: `far-${f.id}`, text, tone: 'far', furnitureId: f.id, levelId: f.levelId });
    } else if (f.toilet && f.distance !== null) {
      lines.push({ key: `near-${f.id}`, text: S.near(f.catalogId, f.roomName, f.distance), tone: 'ok' });
    } else {
      othersNear++;
    }
  }
  if (othersNear > 0) lines.push({ key: 'others', text: S.othersNear(othersNear, FIXTURE_REACH_M), tone: 'ok' });
  if (analysis.todayRooms.length > 0) lines.push({ key: 'today', text: S.today(analysis.todayRooms), tone: 'note' });
  if (opts.editable && analysis.stacks.length > 0) {
    const suggested = analysis.stacks.some((s) => s.suggested);
    lines.push({ key: 'stacks', text: suggested ? S.suggestedNote : S.storedNote, tone: 'note' });
  }
  return lines;
}

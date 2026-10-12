/**
 * Helpers of the shared-proposals UI (TopBar, ProposalsMenu, StatusPill, TrashPanel, RevisionsPanel, ShareDialog,
 * UpdateToast, InstallCard) that are not components: pure rules with tests, the minute clock, the phone's share
 * sheet, and the service-worker registration used by "Oppdater".
 */
import { useEffect, useState } from 'react';
import { nb } from '../i18n/nb';
import type { Id, Variant } from '../model/types';
import { TRASH_MS } from '../state/familyStore';
import type { ProposalMeta, RevisionInfo } from '../state/familyStore';
import type { SyncState } from '../state/familyStore.sync';

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

export type PillState = keyof typeof nb.family.pill;

/**
 * Which text the status pill shows (docs/phase2-plan.md §5; explained in docs/firebase-oppsett.md). An open conflict
 * comes first: that proposal's edits are not saved until the user picks «Hent endringene» or «Lagre over».
 * `pending` also counts writes queued before this page was loaded, so an offline reload never says «Lagret for alle».
 * `elsewhere` (another tab switched this device to another space; this tab saves nothing) wins over everything.
 */
export function pillState(
  s: Pick<SyncState, 'mode' | 'phase' | 'saving' | 'pending' | 'online' | 'failed'> & {
    fallback?: boolean;
    conflicts?: SyncState['conflicts'];
    noFamily?: boolean;
    elsewhere?: boolean;
  },
): PillState {
  if (s.elsewhere) return 'elsewhere';
  if (s.conflicts && s.conflicts.length > 0) return 'conflict';
  if (s.mode === 'local') return s.failed ? 'localFailed' : s.noFamily ? 'noFamily' : s.fallback ? 'unreachable' : 'local';
  if (s.failed) return 'failed';
  if (s.phase === 'error') return 'error';
  if (s.phase === 'connecting') return 'connecting';
  if (s.pending > 0 && !s.online) return 'pending';
  if (s.saving || s.pending > 0) return 'saving';
  return 'synced';
}

/** The time, refreshed every half minute (so "for 2 min siden" and "i dag 14.30" stay true). */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ---------------------------------------------------------------------------
// Proposals menu
// ---------------------------------------------------------------------------

/** The menu's order: the locked base first, then the proposals by creation time (stable). */
export function menuOrder(variants: readonly Variant[], meta: Readonly<Record<Id, ProposalMeta>>): Variant[] {
  const base = variants.filter((v) => v.locked);
  const rest = variants.filter((v) => !v.locked);
  const created = (v: Variant) => meta[v.id]?.createdAt ?? v.createdAt;
  return [...base, ...[...rest].sort((a, b) => created(a).localeCompare(created(b)) || a.name.localeCompare(b.name, 'nb'))];
}

/** "sist endret av Mamma, i dag 14.30" / "sist endret i dag 14.30" / "ikke lagret ennå". */
export function metaLine(v: Variant, meta: ProposalMeta | undefined, now: number): string {
  const f = nb.family;
  if (v.locked) return f.baseLine;
  if (!meta) return f.notSaved;
  const at = f.when(meta.updatedAt, now);
  return meta.updatedBy ? f.changedBy(meta.updatedBy, at) : f.changed(at);
}

// ---------------------------------------------------------------------------
// Tidligere versjoner
// ---------------------------------------------------------------------------

/** Each revision's line: when (with seconds when another one has the same minute), by whom, and its tags. */
export function revisionLabels(revisions: readonly RevisionInfo[], now: number): string[] {
  const r = nb.family.revisions;
  const when = revisions.map((rev) => nb.family.when(rev.savedAt, now));
  return revisions.map((rev, i) => {
    const shared = when.some((w, j) => j !== i && w === when[i]);
    const parts: string[] = [r.savedBy(shared ? nb.family.when(rev.savedAt, now, true) : when[i], rev.savedBy)];
    if (rev.own) parts.push(r.tagOwn);
    if (rev.reason === 'saveOver') parts.push(r.tagSavedOver);
    return parts.join(' · ');
  });
}

// ---------------------------------------------------------------------------
// Papirkurv
// ---------------------------------------------------------------------------

/** Whole days left before a deleted proposal is gone for good (at least 0). */
export function daysLeft(deletedAt: string | null, now: number): number {
  const t = deletedAt ? Date.parse(deletedAt) : NaN;
  if (!Number.isFinite(t)) return 30;
  return Math.max(0, Math.ceil((t + TRASH_MS - now) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Send forslaget
// ---------------------------------------------------------------------------

/** The phone's share sheet when there is one: 'shared', 'cancelled' by the user, or 'unavailable' (copy instead). */
export async function shareLink(data: { title: string; text: string; url: string }): Promise<'shared' | 'cancelled' | 'unavailable'> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav?.share) return 'unavailable';
  try {
    if (nav.canShare && !nav.canShare(data)) return 'unavailable';
    await nav.share(data);
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'unavailable';
  }
}

// ---------------------------------------------------------------------------
// Home-screen card
// ---------------------------------------------------------------------------

export interface InstallEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
}

export function isIos(env: Pick<InstallEnv, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iPad|iPhone|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
}

/** Which card to show: 'ios' (instructions), 'prompt' (Installer button) or none. */
export function installCardKind(env: InstallEnv, hasPrompt: boolean, isDismissed: boolean): 'ios' | 'prompt' | null {
  if (isDismissed || env.standalone) return null;
  if (isIos(env)) return 'ios';
  return hasPrompt ? 'prompt' : null;
}

// ---------------------------------------------------------------------------
// App updates
// ---------------------------------------------------------------------------

/** No two update checks closer than this (visibilitychange can fire often). */
const MIN_CHECK_GAP_MS = 60 * 1000;
let registration: ServiceWorkerRegistration | null = null;
let lastCheck = 0;

/** UpdateToast hands over the registration once the service worker is registered. */
export function setUpdateRegistration(r: ServiceWorkerRegistration | null): void {
  registration = r;
}

/** Look for a new app version now (no-op without a registered service worker or while offline). */
export function requestAppUpdateCheck(): void {
  const r = registration;
  if (!r || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  lastCheck = Date.now();
  void r.update().catch(() => {});
}

/** `requestAppUpdateCheck`, unless one ran within the last minute. */
export function checkForUpdateSoon(): void {
  if (Date.now() - lastCheck >= MIN_CHECK_GAP_MS) requestAppUpdateCheck();
}

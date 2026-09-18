import { needsSessionRecovery, sessionSectionNeedsRecovery } from './sessionRecovery';
import type { LiveGame, Section, Snapshot } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const LIVE_POLL_MS = 60_000;
export const MANUAL_COOLDOWN_MS = 60_000;
export const RESET_GRACE_MS = 2_000;
export type RefreshReason = 'auto' | 'manual';
export type RefreshPurpose = 'aimAuth' | 'sync' | 'live' | 'equipment';
export interface RefreshGateState {
  attemptedAt: number;
  notBefore: number;
  autoNotBefore?: number;
  failures: number;
  sample?: Section<LiveGame>;
  equipment?: Section<import('./matchTypes').LiveEquipment>;
  matchId?: string;
}
export interface SnapshotPlan {
  store: boolean;
  account: boolean;
  collection: boolean;
  live: boolean;
  missingOnly?: boolean;
}
export const FULL_SNAPSHOT: SnapshotPlan = {
  store: true,
  account: true,
  collection: true,
  live: true,
};

export function storeResetAt(snapshot: Snapshot | null, now = Date.now()): number {
  if (!snapshot || snapshot.store.status !== 'ready') return now;
  const store = snapshot.store.data;
  const localExpiry =
    store.dailyExpiresAt - (Number.isFinite(store.clockOffsetMs) ? store.clockOffsetMs : 0);
  if (Number.isFinite(localExpiry) && localExpiry > 0) return localExpiry + RESET_GRACE_MS;

  return snapshot.store.fetchedAt + DAY_MS;
}
export function nextAutomaticAt(
  snapshot: Snapshot | null,
  gate: RefreshGateState | null,
  now = Date.now(),
): number {
  const due =
    hasUnloadedSections(snapshot) || needsSessionRecovery(snapshot)
      ? now
      : storeResetAt(snapshot, now);
  return Math.max(due, gate?.notBefore ?? 0, gate?.autoNotBefore ?? 0);
}
export function snapshotPlan(
  previous: Snapshot | null,
  reason: RefreshReason,
  now = Date.now(),
): SnapshotPlan {
  const manual = reason === 'manual';
  const collectionDue =
    !previous ||
    previous.collection.status !== 'ready' ||
    previous.collection.fetchedAt + DAY_MS <= now;

  const missingOnly =
    !manual &&
    !!previous &&
    previous.store.status === 'ready' &&
    storeResetAt(previous, now) > now &&
    (hasUnloadedSections(previous) || needsSessionRecovery(previous));
  return {
    store: true,
    account: true,
    collection: manual || collectionDue,
    live: false,
    ...(missingOnly ? { missingOnly: true } : {}),
  };
}
export function failureDelay(failures: number, floor = LIVE_POLL_MS): number {
  return Math.min(60 * 60 * 1000, floor * 2 ** Math.min(Math.max(0, failures - 1), 6));
}
export function emptySnapshot(id: string, now = Date.now()): Snapshot {
  const unavailable = {
    status: 'error' as const,
    code: 'NOT_LOADED',
    message: 'Waiting for the first account refresh.',
  };
  return {
    accountId: id,
    demo: false,
    fetchedAt: now,
    store: unavailable,
    wallet: unavailable,
    rank: unavailable,
    xp: unavailable,
    progression: unavailable,
    collection: unavailable,
    loadout: unavailable,
    matches: unavailable,
    liveGame: {
      status: 'error',
      code: 'LIVE_NOT_CHECKED',
      message: 'Open Profile to check the current game.',
    },
  };
}

export function keepCached<T>(old: Section<T> | undefined, next: Section<T>): Section<T> {
  return old?.status === 'ready' && next.status === 'error'
    ? { ...old, warning: { code: next.code, message: next.message, retryAt: next.retryAt } }
    : next;
}

export const ACCOUNT_SECTIONS = [
  'store',
  'wallet',
  'rank',
  'xp',
  'progression',
  'collection',
  'loadout',
  'matches',
] as const;
export function isUnloadedSection(section: Section<unknown> | undefined): boolean {
  return (
    !section ||
    (section.status === 'error' && ['NOT_LOADED', 'INITIAL_SYNC_WAIT'].includes(section.code))
  );
}
export function hasUnloadedSections(snapshot: Snapshot | null): boolean {
  return !snapshot || ACCOUNT_SECTIONS.some((key) => isUnloadedSection(snapshot[key]));
}
export function shouldFetchSection(
  enabled: boolean,
  old: Section<unknown> | undefined,
  missingOnly = false,
): boolean {
  return enabled && (!missingOnly || isUnloadedSection(old) || sessionSectionNeedsRecovery(old));
}

export function waitingSnapshot(
  id: string,
  previous: Snapshot | null,
  retryAt: number,
  now = Date.now(),
): Snapshot {
  const next = { ...(previous ?? emptySnapshot(id, now)), nextAutoRefreshAt: retryAt };
  for (const key of ACCOUNT_SECTIONS) {
    if (isUnloadedSection(next[key]))
      Object.assign(next, {
        [key]: {
          status: 'error',
          code: 'INITIAL_SYNC_WAIT',
          message: 'The first load will retry automatically.',
          retryAt,
        },
      });
  }
  return next;
}

export function failedSnapshot(
  id: string,
  previous: Snapshot | null,
  issue: { code: string; message: string; retryAt?: number },
  now = Date.now(),
): Snapshot {
  const next = { ...(previous ?? emptySnapshot(id, now)), refreshIssue: issue };
  for (const key of ACCOUNT_SECTIONS) {
    if (isUnloadedSection(next[key])) Object.assign(next, { [key]: { status: 'error', ...issue } });
  }
  return next;
}

import type { LiveGame, Section, Snapshot } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const LIVE_POLL_MS = 60_000;
export const MANUAL_COOLDOWN_MS = 60_000;
export const RESET_GRACE_MS = 2_000;
export type RefreshReason = 'auto' | 'manual';
export type RefreshPurpose = 'sync' | 'live';
export interface RefreshGateState {
  attemptedAt: number;
  notBefore: number;
  autoNotBefore?: number;
  failures: number;
  sample?: Section<LiveGame>;
}
export interface SnapshotPlan {
  store: boolean;
  account: boolean;
  collection: boolean;
  live: boolean;
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
  return Math.max(storeResetAt(snapshot, now), gate?.notBefore ?? 0, gate?.autoNotBefore ?? 0);
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

  return { store: true, account: true, collection: manual || collectionDue, live: false };
}
export function failureDelay(failures: number, floor = LIVE_POLL_MS): number {
  return Math.min(60 * 60 * 1000, floor * 2 ** Math.min(Math.max(0, failures - 1), 6));
}
export function emptySnapshot(id: string, now = Date.now()): Snapshot {
  const unavailable = {
    status: 'error' as const,
    code: 'NOT_LOADED',
    message: 'Pull down to load this account.',
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

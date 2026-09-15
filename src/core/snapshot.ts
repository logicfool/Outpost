import type { Snapshot } from './types';

export function mergeSnapshot(previous: Snapshot | null, next: Snapshot): Snapshot {
  if (!previous || previous.accountId !== next.accountId || previous.demo !== next.demo)
    return next;
  const merged = { ...next };
  const keys = [
    'store',
    'wallet',
    'rank',
    'xp',
    'progression',
    'collection',
    'loadout',
    'liveGame',
    'matches',
  ] as const;
  for (const key of keys) {
    const old = previous[key],
      incoming = next[key];
    if (incoming.status === 'error' && ['NOT_LOADED', 'LIVE_NOT_CHECKED'].includes(incoming.code)) {
      Object.assign(merged, { [key]: old });
      continue;
    }
    if (
      old.status === 'ready' &&
      incoming.status === 'ready' &&
      old.fetchedAt > incoming.fetchedAt
    ) {
      Object.assign(merged, { [key]: old });
    }
  }
  return merged;
}

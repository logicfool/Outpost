import { appendMatchSection } from './matchArchive';
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
    const placeholder = (section: typeof incoming | undefined) =>
      section?.status === 'error' &&
      ['NOT_LOADED', 'INITIAL_SYNC_WAIT', 'LIVE_NOT_CHECKED'].includes(section.code);

    if (placeholder(incoming) && old && !placeholder(old)) {
      Object.assign(merged, { [key]: old });
      continue;
    }
    if (
      old?.status === 'ready' &&
      incoming.status === 'ready' &&
      old.fetchedAt > incoming.fetchedAt
    ) {
      Object.assign(merged, { [key]: old });
    }
  }
  merged.matches = appendMatchSection(previous.matches, merged.matches);
  return merged;
}

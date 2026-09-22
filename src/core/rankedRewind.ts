import type { Catalog, MatchSummary } from './types';

export interface RewindRank {
  tier: number;
  rr: number;
  name: string;
  image?: string;
}

export interface RewindDay {
  key: string;
  startedAt: number;
  netRr: number;
  wins: number;
  losses: number;
  matches: MatchSummary[];
  startRank?: RewindRank;
  endRank?: RewindRank;
}

const dayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

const rankAt = (value: number, tiers: Catalog['tiers']): RewindRank | undefined => {
  if (!Number.isFinite(value)) return undefined;
  const tier = Math.max(0, Math.floor(value / 100));
  const rr = Math.max(0, Math.min(99, Math.round(value - tier * 100)));
  const meta = tiers[String(tier)];
  return { tier, rr, name: meta?.name ?? (tier ? `Tier ${tier}` : 'Unrated'), image: meta?.image };
};

export function groupRankedRewind(matches: MatchSummary[], tiers: Catalog['tiers']): RewindDay[] {
  const competitive = matches
    .filter(
      (match) =>
        match.queue === 'competitive' &&
        typeof match.rrChange === 'number' &&
        Number.isFinite(match.rrChange),
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  const groups = new Map<string, MatchSummary[]>();
  for (const match of competitive) {
    const key = dayKey(match.startedAt);
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }
  return [...groups.entries()].map(([key, dayMatches]) => {
    const chronological = [...dayMatches].sort((a, b) => a.startedAt - b.startedAt);
    const first = chronological[0];
    const last = chronological.at(-1);
    const firstEnd =
      first?.tierAfter !== undefined && first.rrAfter !== undefined
        ? first.tierAfter * 100 + first.rrAfter
        : undefined;
    const lastEnd =
      last?.tierAfter !== undefined && last.rrAfter !== undefined
        ? last.tierAfter * 100 + last.rrAfter
        : undefined;
    return {
      key,
      startedAt: new Date(`${key}T00:00:00`).getTime(),
      netRr: dayMatches.reduce((sum, match) => sum + (match.rrChange ?? 0), 0),
      wins: dayMatches.filter((match) => (match.rrChange ?? 0) > 0).length,
      losses: dayMatches.filter((match) => (match.rrChange ?? 0) < 0).length,
      matches: dayMatches,
      startRank:
        firstEnd !== undefined ? rankAt(firstEnd - (first?.rrChange ?? 0), tiers) : undefined,
      endRank: lastEnd !== undefined ? rankAt(lastEnd, tiers) : undefined,
    };
  });
}

export function rewindEntryLabel(days: RewindDay[], now = Date.now()): string {
  const today = dayKey(now);
  const yesterday = dayKey(now - 86400000);
  const day =
    days.find((entry) => entry.key === today) ?? days.find((entry) => entry.key === yesterday);
  if (!day) return 'No ranked matches today';
  const prefix = day.key === today ? 'Today' : 'Yesterday';
  return `${prefix} ${day.netRr >= 0 ? '+' : ''}${day.netRr} RR`;
}

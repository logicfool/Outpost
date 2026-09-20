import type { MatchDetail, MatchSummary } from './types';

export interface MatchFilter {
  queue: string;
  map: string;
  agent: string;
  result: string;
}
export type MatchFilterKey = keyof MatchFilter;
export const EMPTY_FILTER: MatchFilter = { queue: 'all', map: 'all', agent: 'all', result: 'all' };
export const FILTER_KEYS: MatchFilterKey[] = ['queue', 'map', 'agent', 'result'];
export const activeFilterCount = (filter: MatchFilter) =>
  FILTER_KEYS.filter((key) => filter[key] !== 'all').length;

export type MatchDetails = Record<string, MatchDetail | undefined>;

export function matchResult(match: MatchSummary, details: MatchDetails): string | undefined {
  const value = match.preview?.result ?? details[match.id]?.result;
  return value && value !== 'UNKNOWN' ? value : undefined;
}
export function matchAgent(match: MatchSummary, details: MatchDetails): string | undefined {
  return match.preview?.agent || details[match.id]?.agent || undefined;
}
export function matchMap(match: MatchSummary): string | undefined {
  return match.map && match.map !== 'Open match details' ? match.map : undefined;
}

export function applyMatchFilter(
  matches: MatchSummary[],
  filter: MatchFilter,
  details: MatchDetails,
): MatchSummary[] {
  if (!activeFilterCount(filter)) return matches;
  return matches.filter(
    (match) =>
      (filter.queue === 'all' || match.queue === filter.queue) &&
      (filter.map === 'all' || matchMap(match) === filter.map) &&
      (filter.agent === 'all' || matchAgent(match, details) === filter.agent) &&
      (filter.result === 'all' || matchResult(match, details) === filter.result),
  );
}

export function matchFilterOptions(
  matches: MatchSummary[],
  details: MatchDetails,
): Record<MatchFilterKey, string[]> {
  const collect = (pick: (m: MatchSummary) => string | undefined) =>
    [...new Set(matches.map(pick).filter((v): v is string => !!v))].sort((a, b) =>
      a.localeCompare(b),
    );
  return {
    queue: collect((m) => (m.queue && m.queue !== 'unknown' ? m.queue : undefined)),
    map: collect(matchMap),
    agent: collect((m) => matchAgent(m, details)),
    result: ['WIN', 'LOSS', 'DRAW'].filter((value) =>
      matches.some((m) => matchResult(m, details) === value),
    ),
  };
}

export function reconcileFilter(
  filter: MatchFilter,
  options: Record<MatchFilterKey, string[]>,
): MatchFilter {
  const next = { ...filter };
  for (const key of FILTER_KEYS)
    if (next[key] !== 'all' && !options[key].includes(next[key])) next[key] = 'all';
  return next;
}

import { object } from './validation';
export interface LiveStats {
  kills: number;
  deaths: number;
  assists: number;
  observedAt: number;
  source: 'current-match';
}

export function normalizeLiveStats(
  player: unknown,
  inGame: boolean,
  now = Date.now(),
): LiveStats | undefined {
  if (!inGame || !Number.isFinite(now)) return;
  const p = object(player);
  for (const candidate of [p.Stats, p.MatchStats, p.stats, p.matchStats]) {
    const raw = object(candidate),
      values = ['Kills', 'Deaths', 'Assists'].map((key) => raw[key] ?? raw[key.toLowerCase()]);
    if (values.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1000))
      continue;
    return {
      kills: values[0] as number,
      deaths: values[1] as number,
      assists: values[2] as number,
      observedAt: now,
      source: 'current-match',
    };
  }
}
export function freshLiveStats(
  stats: LiveStats | undefined,
  now = Date.now(),
): LiveStats | undefined {
  if (
    !stats ||
    stats.source !== 'current-match' ||
    !Number.isFinite(stats.observedAt) ||
    now - stats.observedAt > 180000 ||
    stats.observedAt - now > 60000
  )
    return;
  if (
    [stats.kills, stats.deaths, stats.assists].some(
      (v) => !Number.isInteger(v) || v < 0 || v > 1000,
    )
  )
    return;
  return stats;
}

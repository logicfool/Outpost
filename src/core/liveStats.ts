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
  if (!inGame) return;
  const p = object(player),
    raw = object(p.Stats ?? p.MatchStats);
  const values = ['Kills', 'Deaths', 'Assists'].map((key) => raw[key] ?? raw[key.toLowerCase()]);
  if (values.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1000))
    return;
  return {
    kills: values[0] as number,
    deaths: values[1] as number,
    assists: values[2] as number,
    observedAt: now,
    source: 'current-match',
  };
}

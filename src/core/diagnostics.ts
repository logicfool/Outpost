export interface RequestDiagnostic {
  at: number;
  service: string;
  method: string;
  status?: number;
  mime?: string;
  shape?: string;
  code: string;
  durationMs: number;
}
const records: RequestDiagnostic[] = [];
export function serviceLabel(url: string): string {
  const parsed = new URL(url),
    path = parsed.pathname;
  if (parsed.hostname === 'valorant-api.com') return 'Public catalog';
  if (parsed.hostname === 'clientconfig.rpg.riotgames.com') return 'Chat configuration';
  if (path.includes('/service/chat')) return 'Chat token';
  return (
    [
      ['/name-service/', 'Player names'],
      ['/mmr/', 'Rank'],
      ['/personalization/', 'Loadout'],
      ['/content-service/', 'Active act'],
      ['/core-game/', 'Current game'],
      ['/pregame/', 'Agent select'],
      ['/match-history/', 'Match history'],
      ['/match-details/', 'Match report'],
      ['/store/', 'Store'],
      ['/contracts/', 'Battle Pass'],
    ].find(([prefix]) => path.includes(prefix!))?.[1] ?? 'Account service'
  );
}
export function mimeLabel(value: string): string {
  return /json/i.test(value)
    ? 'json'
    : /html/i.test(value)
      ? 'html'
      : /text\/plain/i.test(value)
        ? 'plain'
        : value
          ? 'other'
          : 'missing';
}
export function recordRequest(row: RequestDiagnostic): void {
  records.push(row);
  if (records.length > 40) records.shift();
}
export function requestDiagnostics(): RequestDiagnostic[] {
  return records.map((row) => ({ ...row }));
}
export function clearDiagnostics(): void {
  records.length = 0;
}

import type { MatchDetail, MatchSummary, Section, Snapshot, Store, StoreOffer } from './types';
import { AppError, object, uuid } from './validation';
export type MatchPreview = Pick<
  MatchDetail,
  'map' | 'mapImage' | 'agent' | 'agentImage' | 'kills' | 'deaths' | 'assists' | 'result' | 'score'
>;
export interface ArchivedReport {
  imported?: boolean;
  subject: string;
  savedAt: number;
  completed: boolean;
  detail: MatchDetail;
}
export interface MarketRecord {
  id: string;
  accountId: string;
  kind: 'daily' | 'night-market' | 'bundle';
  name: string;
  observedAt: number;
  expiresAt: number;
  offers: StoreOffer[];
}
export interface MatchArchiveStore {
  archivedMatches(
    id: string,
    subject: string,
    start?: number,
    count?: number,
  ): Promise<MatchSummary[]>;
  saveArchivedMatches(id: string, subject: string, matches: MatchSummary[]): Promise<void>;
  archivedMatchTrusted(id: string, subject: string, matchId: string): Promise<boolean>;
  archivedReport(id: string, subject: string, matchId: string): Promise<ArchivedReport | null>;
  saveArchivedReport(id: string, subject: string, report: ArchivedReport): Promise<void>;
  marketHistory(id: string): Promise<MarketRecord[]>;
}
export const ARCHIVE_PAGE_SIZE = 40;
export function matchPreview(detail: MatchDetail): MatchPreview {
  return {
    map: detail.map,
    mapImage: detail.mapImage,
    agent: detail.agent,
    agentImage: detail.agentImage,
    kills: detail.kills,
    deaths: detail.deaths,
    assists: detail.assists,
    result: detail.result,
    score: detail.score,
  };
}
export function validateMatchSummary(input: unknown): MatchSummary {
  const r = object(input);
  uuid(r.id);
  if (
    typeof r.startedAt !== 'number' ||
    !Number.isFinite(r.startedAt) ||
    r.startedAt < 0 ||
    typeof r.queue !== 'string' ||
    r.queue.length > 80 ||
    typeof r.map !== 'string' ||
    r.map.length > 200
  )
    throw new AppError('ARCHIVE_DATA', 'Invalid saved match summary.');
  return { ...r, id: uuid(r.id) } as unknown as MatchSummary;
}
export function mergeMatchSummaries(
  old: readonly MatchSummary[],
  incoming: readonly MatchSummary[],
): MatchSummary[] {
  const rows = new Map(old.map((m) => [m.id, m]));
  for (const value of incoming) {
    const m = value,
      previous = rows.get(m.id);
    rows.set(m.id, {
      ...previous,
      ...m,
      preview: m.preview ?? previous?.preview,
      previewComplete: m.previewComplete ?? previous?.previewComplete,
      rrChange: m.rrChange ?? previous?.rrChange,
      tierAfter: m.tierAfter ?? previous?.tierAfter,
      tierImage: m.tierImage ?? previous?.tierImage,
    });
  }
  return [...rows.values()].sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
}
export function validateArchivedReport(
  report: ArchivedReport,
  subject: string,
  matchId = report.detail?.id,
): ArchivedReport {
  subject = uuid(subject);
  const d = report?.detail;
  if (
    report.subject !== subject ||
    !d ||
    uuid(d.id) !== uuid(matchId) ||
    !Array.isArray(d.players) ||
    !d.players.some((p) => p.subject === subject) ||
    d.players.length > 100 ||
    !Array.isArray(d.rounds) ||
    d.rounds.length > 300 ||
    !Array.isArray(d.teams) ||
    !Array.isArray(d.duels) ||
    typeof d.startedAt !== 'number' ||
    !Number.isFinite(d.startedAt)
  )
    throw new AppError('ARCHIVE_SCOPE', 'Saved report does not match its player and match.');
  if (
    typeof report.savedAt !== 'number' ||
    !Number.isFinite(report.savedAt) ||
    typeof report.completed !== 'boolean'
  )
    throw new AppError('ARCHIVE_DATA', 'Invalid report metadata.');
  if (JSON.stringify(report).length > 4 * 1024 * 1024)
    throw new AppError('ARCHIVE_SIZE', 'This report is too large to keep locally.');
  return report;
}
export function observedMarkets(id: string, store: Store): MarketRecord[] {
  id = uuid(id);
  const rows: MarketRecord[] = [];
  const add = (
    kind: MarketRecord['kind'],
    name: string,
    expiresAt: number,
    offers: StoreOffer[],
    key = '',
  ) => {
    if (!offers.length || !Number.isFinite(expiresAt)) return;
    rows.push({
      id: `${kind}:${
        key ||
        Math.round(expiresAt / 60000) +
          ':' +
          offers
            .map((o) => o.id)
            .sort()
            .join(',')
      }`,
      accountId: id,
      kind,
      name,
      observedAt: store.fetchedAt,
      expiresAt,
      offers,
    });
  };
  add('daily', 'Daily store', store.dailyExpiresAt, store.daily);
  if (store.nightMarket)
    add('night-market', 'Night Market', store.nightMarket.expiresAt, store.nightMarket.offers);
  for (const b of store.bundles)
    add('bundle', b.name, b.expiresAt, b.offers, b.id + ':' + Math.round(b.expiresAt / 60000));
  return rows;
}
export function appendMatchSection(
  old: Section<MatchSummary[]> | undefined,
  next: Section<MatchSummary[]>,
): Section<MatchSummary[]> {
  if (old?.status === 'ready' && next.status === 'ready')
    return { ...next, data: mergeMatchSummaries(old.data, next.data) };
  return next;
}

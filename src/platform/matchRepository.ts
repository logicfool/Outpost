import type * as SQLite from 'expo-sqlite';
import type { MatchSummary } from '../core/types';
import { AppError, uuid } from '../core/validation';
import {
  matchPreview,
  mergeMatchSummaries,
  validateArchivedReport,
  validateMatchSummary,
  type MatchArchiveStore,
  type MarketRecord,
} from '../core/matchArchive';
export const MATCH_ARCHIVE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS match_summaries (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, subject TEXT NOT NULL, match_id TEXT NOT NULL, started_at INTEGER NOT NULL, trusted INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, PRIMARY KEY(account_id,subject,match_id));
  CREATE INDEX IF NOT EXISTS matches_by_date ON match_summaries(account_id,subject,started_at DESC,match_id);
  CREATE TABLE IF NOT EXISTS match_reports (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, subject TEXT NOT NULL, match_id TEXT NOT NULL, saved_at INTEGER NOT NULL, completed INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account_id,subject,match_id));
  CREATE TABLE IF NOT EXISTS market_history (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL, kind TEXT NOT NULL, observed_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account_id,id));
  CREATE INDEX IF NOT EXISTS markets_by_date ON market_history(account_id,observed_at DESC);
`;
export async function upsertMatchRows(
  db: SQLite.SQLiteDatabase,
  id: string,
  subject: string,
  rows: MatchSummary[],
  trusted = true,
): Promise<void> {
  id = uuid(id);
  subject = uuid(subject);
  if (rows.length > 10000)
    throw new AppError('ARCHIVE_SIZE', 'Too many match rows in one operation.');
  for (const input of rows) {
    const m = validateMatchSummary(input);
    const old = await db.getFirstAsync<{ data: string; trusted: number }>(
      'SELECT data,trusted FROM match_summaries WHERE account_id=? AND subject=? AND match_id=?',
      id,
      subject,
      m.id,
    );
    const row = mergeMatchSummaries(old ? [JSON.parse(old.data)] : [], [m])[0]!;
    if (old?.data === JSON.stringify(row) && old.trusted >= Number(trusted)) continue;
    await db.runAsync(
      'INSERT INTO match_summaries(account_id,subject,match_id,started_at,trusted,data) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,subject,match_id) DO UPDATE SET data=excluded.data,started_at=excluded.started_at,trusted=MAX(match_summaries.trusted,excluded.trusted)',
      id,
      subject,
      row.id,
      row.startedAt,
      Number(trusted),
      JSON.stringify(row),
    );
  }
}
export async function upsertMarketRows(
  db: SQLite.SQLiteDatabase,
  rows: MarketRecord[],
): Promise<void> {
  for (const row of rows)
    await db.runAsync(
      'INSERT INTO market_history(account_id,id,kind,observed_at,data) VALUES(?,?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET observed_at=MAX(market_history.observed_at,excluded.observed_at),data=CASE WHEN excluded.observed_at>=market_history.observed_at THEN excluded.data ELSE market_history.data END',
      uuid(row.accountId),
      row.id,
      row.kind,
      row.observedAt,
      JSON.stringify(row),
    );
}
export function matchRepository(
  db: SQLite.SQLiteDatabase,
  write: <T>(work: () => Promise<T>) => Promise<T>,
): MatchArchiveStore {
  return {
    async archivedMatches(id, subject, start = 0, count = 40) {
      if (
        !Number.isInteger(start) ||
        start < 0 ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 10000
      )
        throw new AppError('PAGINATION', 'Invalid saved history range.');
      const rows = await db.getAllAsync<{ data: string }>(
        'SELECT data FROM match_summaries WHERE account_id=? AND subject=? ORDER BY started_at DESC,match_id LIMIT ? OFFSET ?',
        uuid(id),
        uuid(subject),
        count,
        start,
      );
      return rows.map((r) => validateMatchSummary(JSON.parse(r.data)));
    },
    async saveArchivedMatches(id, subject, rows) {
      await write(() => db.withTransactionAsync(() => upsertMatchRows(db, id, subject, rows)));
    },
    async archivedMatchTrusted(id, subject, matchId) {
      const r = await db.getFirstAsync<{ trusted: number }>(
        'SELECT trusted FROM match_summaries WHERE account_id=? AND subject=? AND match_id=?',
        uuid(id),
        uuid(subject),
        uuid(matchId),
      );
      return r?.trusted === 1;
    },
    async archivedReport(id, subject, matchId) {
      const row = await db.getFirstAsync<{ data: string }>(
        'SELECT data FROM match_reports WHERE account_id=? AND subject=? AND match_id=?',
        uuid(id),
        uuid(subject),
        uuid(matchId),
      );
      return row ? validateArchivedReport(JSON.parse(row.data), subject, matchId) : null;
    },
    async saveArchivedReport(id, subject, report) {
      validateArchivedReport(report, subject);
      id = uuid(id);
      subject = uuid(subject);
      await write(() =>
        db.withTransactionAsync(async () => {
          const d = report.detail;
          await db.runAsync(
            'INSERT INTO match_reports(account_id,subject,match_id,saved_at,completed,data) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,subject,match_id) DO UPDATE SET saved_at=excluded.saved_at,completed=excluded.completed,data=excluded.data WHERE excluded.saved_at>=match_reports.saved_at AND excluded.completed>=match_reports.completed',
            id,
            subject,
            d.id,
            report.savedAt,
            Number(report.completed),
            JSON.stringify(report),
          );
          await upsertMatchRows(
            db,
            id,
            subject,
            [
              {
                id: d.id,
                startedAt: d.startedAt,
                queue: d.queue,
                map: d.map,
                mapId: d.mapId,
                mapImage: d.mapImage,
                preview: matchPreview(d),
                previewComplete: report.completed,
              },
            ],
            !report.imported,
          );
        }),
      );
    },
    async marketHistory(id) {
      return (
        await db.getAllAsync<{ data: string }>(
          'SELECT data FROM market_history WHERE account_id=? ORDER BY observed_at DESC',
          uuid(id),
        )
      ).map((r) => JSON.parse(r.data) as MarketRecord);
    },
  };
}

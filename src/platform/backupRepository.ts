import type * as SQLite from 'expo-sqlite';
import type { BackupData, BackupStore } from '../core/backup';
import { BACKUP_LIMIT_BYTES, validateBackupData } from '../core/backup';
import { AppError, uuid } from '../core/validation';
import { preferences } from '../core/preferences';
import { emptySnapshot } from '../core/refreshPolicy';
import { upsertMatchRows } from './matchRepository';
import { matchPreview, observedMarkets } from '../core/matchArchive';
export function backupRepository(
  db: SQLite.SQLiteDatabase,
  write: <T>(fn: () => Promise<T>) => Promise<T>,
): BackupStore {
  const one = async (query: string, ...args: string[]) => {
    const r = await db.getFirstAsync<{ data: string }>(query, ...args);
    return r ? JSON.parse(r.data) : null;
  };
  const rows = async (table: string, id: string) =>
    (
      await db.getAllAsync<{ data: string }>(`SELECT data FROM ${table} WHERE account_id=?`, id)
    ).map((r) => JSON.parse(r.data));
  return {
    async exportAccountData(id, includeReports) {
      id = uuid(id);

      return write(async () => {
        let result: BackupData | undefined;
        await db.withTransactionAsync(async () => {
          const a = await one('SELECT data FROM accounts WHERE id=?', id);
          if (!a || a.demo)
            throw new AppError('BACKUP_ACCOUNT', 'Select a linked account to back up.');
          let size = 0;
          for (const table of [
            'presets',
            'aim_presets',
            'match_summaries',
            'market_history',
            'history',
            ...(includeReports ? ['match_reports'] : []),
          ])
            size +=
              (
                await db.getFirstAsync<{ bytes: number }>(
                  `SELECT COALESCE(SUM(length(data)),0) AS bytes FROM ${table} WHERE account_id=?`,
                  id,
                )
              )?.bytes ?? 0;
          if (size > BACKUP_LIMIT_BYTES - 2000000)
            throw new AppError(
              'BACKUP_SIZE',
              'This archive is too large. Disable full reports to export basic match history.',
            );
          const snapshot = await one('SELECT data FROM snapshots WHERE account_id=?', id),
            aim = await one('SELECT data FROM aim_state WHERE account_id=?', id);
          const matches = await db.getAllAsync<{ subject: string; data: string }>(
            'SELECT subject,data FROM match_summaries WHERE account_id=? ORDER BY started_at DESC',
            id,
          );
          const markets = await rows('market_history', id);
          if (!markets.length && snapshot?.store?.status === 'ready')
            markets.push(...observedMarkets(id, snapshot.store.data));
          const account = {
            puuid: id,
            gameName: a.gameName,
            tagLine: a.tagLine,
            region: a.region,
            shard: a.shard,
            ...(a.createdAt ? { createdAt: a.createdAt } : {}),
            ...(a.country ? { country: a.country } : {}),
          };
          result = validateBackupData({
            account,
            presets: await rows('presets', id),
            aimPresets: await rows('aim_presets', id),
            wishlist: (
              await db.getAllAsync<{ item_id: string }>(
                'SELECT item_id FROM wishlist WHERE account_id=?',
                id,
              )
            ).map((v) => v.item_id),
            matches: matches.map((r) => ({ subject: r.subject, summary: JSON.parse(r.data) })),
            reports: includeReports ? await rows('match_reports', id) : [],
            markets,
            storeHistory: await rows('history', id),
            settings: preferences(
              await one('SELECT data FROM settings WHERE key=?', 'preferences'),
            ),
            ...(snapshot
              ? {
                  profile: {
                    rank: snapshot.rank,
                    xp: snapshot.xp,
                    loadout: snapshot.loadout,
                    progression: snapshot.progression,
                  },
                }
              : {}),
            ...(aim?.snapshot ? { aimSnapshot: aim.snapshot } : {}),
          });
        });
        return result!;
      });
    },
    async restoreAccountData(id, input, restoreSettings, guard) {
      id = uuid(id);
      const data = validateBackupData(input);
      if (data.account.puuid !== id)
        throw new AppError(
          'BACKUP_ACCOUNT',
          'Sign in to the Riot account named in this backup first.',
        );
      await write(() =>
        db.withTransactionAsync(async () => {
          guard();
          const account = await one('SELECT data FROM accounts WHERE id=?', id);
          if (
            !account ||
            account.region !== data.account.region ||
            account.shard !== data.account.shard
          )
            throw new AppError(
              'BACKUP_ACCOUNT',
              'The signed-in account or region does not match this backup.',
            );
          for (const [table, items] of [
            ['presets', data.presets],
            ['aim_presets', data.aimPresets],
          ] as const) {
            const existing = await db.getAllAsync<{ id: string }>(
                `SELECT id FROM ${table} WHERE account_id=?`,
                id,
              ),
              ids = new Set(existing.map((r) => r.id));
            if (ids.size + items.filter((p) => !ids.has(p.id)).length > 30)
              throw new AppError(
                'BACKUP_PRESET_LIMIT',
                'Restoring would exceed 30 presets. Remove unwanted presets first.',
              );
            for (const item of items) {
              guard();
              await db.runAsync(
                `INSERT OR IGNORE INTO ${table}(account_id,id,data) VALUES(?,?,?)`,
                id,
                item.id,
                JSON.stringify(item),
              );
            }
          }
          for (const itemId of data.wishlist) {
            guard();
            await db.runAsync(
              'INSERT OR IGNORE INTO wishlist(account_id,item_id) VALUES(?,?)',
              id,
              itemId,
            );
          }
          for (const row of data.matches) {
            guard();
            const exists = await db.getFirstAsync(
              'SELECT match_id FROM match_summaries WHERE account_id=? AND subject=? AND match_id=?',
              id,
              row.subject,
              row.summary.id,
            );
            if (!exists) await upsertMatchRows(db, id, row.subject, [row.summary], false);
          }
          for (const row of data.reports) {
            guard();
            await db.runAsync(
              'INSERT OR IGNORE INTO match_reports(account_id,subject,match_id,saved_at,completed,data) VALUES(?,?,?,?,?,?)',
              id,
              row.subject,
              row.detail.id,
              row.savedAt,
              Number(row.completed),
              JSON.stringify({ ...row, imported: true }),
            );
          }
          for (const row of data.markets) {
            guard();
            await db.runAsync(
              'INSERT OR IGNORE INTO market_history(account_id,id,kind,observed_at,data) VALUES(?,?,?,?,?)',
              id,
              row.id,
              row.kind,
              row.observedAt,
              JSON.stringify(row),
            );
          }
          for (const row of data.storeHistory) {
            guard();
            await db.runAsync(
              'INSERT OR IGNORE INTO history(account_id,rotation_id,observed_at,data) VALUES(?,?,?,?)',
              id,
              row.id,
              row.observedAt,
              JSON.stringify(row),
            );
          }
          if (data.profile) {
            const current = await one('SELECT data FROM snapshots WHERE account_id=?', id),
              snapshot = current ?? emptySnapshot(id);
            for (const key of ['rank', 'xp', 'loadout', 'progression'] as const) {
              const incoming = data.profile[key],
                old = snapshot[key];
              if (incoming.status === 'ready' && old.status !== 'ready')
                snapshot[key] = {
                  ...incoming,
                  warning: {
                    code: 'RESTORED_LOCAL',
                    message: 'Restored from your backup. Pull down to check for newer Riot data.',
                  },
                };
            }
            guard();
            await db.runAsync(
              'INSERT INTO snapshots(account_id,data) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data',
              id,
              JSON.stringify(snapshot),
            );
          }
          if (data.aimSnapshot) {
            const current = await one('SELECT data FROM aim_state WHERE account_id=?', id);
            if (!current?.snapshot && !current?.pending) {
              guard();
              await db.runAsync(
                'INSERT INTO aim_state(account_id,data) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data',
                id,
                JSON.stringify({ ...current, snapshot: data.aimSnapshot, needsSync: true }),
              );
            }
          }
          if (restoreSettings) {
            const current = preferences(
                await one('SELECT data FROM settings WHERE key=?', 'preferences'),
              ),
              next = { ...data.settings, allowPurchases: current.allowPurchases };
            guard();
            await db.runAsync(
              'INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
              'preferences',
              JSON.stringify(next),
            );
          }
          guard();
        }),
      );
    },
  };
}

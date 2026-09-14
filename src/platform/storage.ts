import * as SQLite from 'expo-sqlite';
import type { Account, Catalog, HistoryEntry, Settings, Snapshot } from '../core/types';
import { DEFAULT_SETTINGS, MAX_ACCOUNTS } from '../core/types';
import { AppError, uuid } from '../core/validation';
import { historyEntry } from '../core/normalize';
import type { Repository } from './storage.types';
let singleton: Promise<Repository> | undefined;
export function openRepository(): Promise<Repository> {
  return (singleton ??= create());
}
async function create(): Promise<Repository> {
  const db = await SQLite.openDatabaseAsync('outpost-v1.db');
  await db.execAsync(`PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, rotation_id TEXT NOT NULL, observed_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account_id, rotation_id));
    CREATE INDEX IF NOT EXISTS history_by_account ON history(account_id, observed_at DESC);
    CREATE TABLE IF NOT EXISTS wishlist (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, item_id TEXT NOT NULL, PRIMARY KEY(account_id,item_id));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    PRAGMA user_version = 1;`);
  let writing: Promise<unknown> = Promise.resolve();
  const write = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writing.catch(() => {}).then(fn);
    writing = next;
    return next;
  };
  const readJson = async <T>(query: string, ...args: string[]): Promise<T | null> => {
    const row = await db.getFirstAsync<{ data: string }>(query, ...args);
    if (!row) return null;
    try {
      return JSON.parse(row.data) as T;
    } catch {
      throw new AppError(
        'LOCAL_DATA',
        'Local cached data is unreadable. Clear the cache in Account settings.',
      );
    }
  };
  const listWishes = async (id: string) =>
    (
      await db.getAllAsync<{ item_id: string }>(
        'SELECT item_id FROM wishlist WHERE account_id = ? ORDER BY item_id',
        uuid(id),
      )
    ).map((r) => r.item_id);
  return {
    async accounts() {
      const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM accounts ORDER BY id');
      return rows.map((r) => JSON.parse(r.data) as Account);
    },
    async saveAccount(account) {
      if (account.demo)
        throw new AppError(
          'DEMO_ISOLATION',
          'Demo accounts are not stored in the real-account database.',
        );
      await write(async () => {
        const existing = await db.getFirstAsync(
          'SELECT id FROM accounts WHERE id = ?',
          uuid(account.puuid),
        );
        const count = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM accounts',
        );
        if (!existing && (count?.count ?? 0) >= MAX_ACCOUNTS)
          throw new AppError(
            'ACCOUNT_LIMIT',
            `${MAX_ACCOUNTS} accounts are already linked. Remove an account before adding another.`,
          );
        await db.runAsync(
          'INSERT INTO accounts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
          account.puuid,
          JSON.stringify(account),
        );
      });
    },
    async removeAccount(id) {
      await write(async () => {
        await db.runAsync('DELETE FROM accounts WHERE id = ?', uuid(id));
        await db.runAsync('DELETE FROM settings WHERE key LIKE ?', `notice.${uuid(id)}.%`);
      });
    },
    snapshot(id) {
      return readJson<Snapshot>('SELECT data FROM snapshots WHERE account_id = ?', uuid(id));
    },
    async saveSnapshot(snapshot) {
      if (snapshot.demo)
        throw new AppError('DEMO_ISOLATION', 'Demo snapshots cannot overwrite real account data.');
      await write(async () => {
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            'INSERT INTO snapshots(account_id,data) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data',
            uuid(snapshot.accountId),
            JSON.stringify(snapshot),
          );
          if (snapshot.store.status === 'ready') {
            const entry = historyEntry(snapshot.accountId, snapshot.store.data);
            await db.runAsync(
              'INSERT INTO history(account_id,rotation_id,observed_at,data) VALUES(?,?,?,?) ON CONFLICT(account_id,rotation_id) DO UPDATE SET data=excluded.data',
              entry.accountId,
              entry.id,
              entry.observedAt,
              JSON.stringify(entry),
            );
          }
          await db.runAsync(
            'DELETE FROM history WHERE observed_at < ?',
            Date.now() - 90 * 86400000,
          );
        });
      });
    },
    async history(id) {
      return (
        await db.getAllAsync<{ data: string }>(
          'SELECT data FROM history WHERE account_id = ? ORDER BY observed_at DESC LIMIT 90',
          uuid(id),
        )
      ).map((r) => JSON.parse(r.data) as HistoryEntry);
    },
    wishlist: listWishes,
    async toggleWish(id, itemId) {
      await write(async () => {
        const exists = await db.getFirstAsync(
          'SELECT item_id FROM wishlist WHERE account_id = ? AND item_id = ?',
          uuid(id),
          uuid(itemId),
        );
        if (exists)
          await db.runAsync(
            'DELETE FROM wishlist WHERE account_id = ? AND item_id = ?',
            id,
            itemId,
          );
        else await db.runAsync('INSERT INTO wishlist(account_id,item_id) VALUES(?,?)', id, itemId);
      });
      return listWishes(id);
    },
    async settings() {
      return {
        ...DEFAULT_SETTINGS,
        ...((await readJson<Settings>('SELECT data FROM settings WHERE key = ?', 'preferences')) ??
          {}),
      };
    },
    async saveSettings(settings) {
      await write(async () => {
        await db.runAsync(
          'INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
          'preferences',
          JSON.stringify(settings),
        );
      });
    },
    catalog() {
      return readJson<Catalog>('SELECT data FROM settings WHERE key = ?', 'catalog');
    },
    async saveCatalog(catalog) {
      await write(async () => {
        await db.runAsync(
          'INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
          'catalog',
          JSON.stringify(catalog),
        );
      });
    },
    async notificationStamp(key) {
      return readJson<string>('SELECT data FROM settings WHERE key = ?', key);
    },
    async setNotificationStamp(key, value) {
      await write(async () => {
        await db.runAsync(
          'INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
          key,
          JSON.stringify(value),
        );
      });
    },
    async clearCache() {
      await write(async () => {
        await db.execAsync(
          "DELETE FROM snapshots; DELETE FROM history; DELETE FROM settings WHERE key = 'catalog';",
        );
      });
    },
  };
}

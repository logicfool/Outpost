import { backupRepository } from './backupRepository';
import {
  matchRepository,
  MATCH_ARCHIVE_SCHEMA,
  upsertMatchRows,
  upsertMarketRows,
} from './matchRepository';
import { observedMarkets } from '../core/matchArchive';
import { emptySnapshot } from '../core/refreshPolicy';
import { validateAimPreset } from '../core/aimSettings';
import type { AimState } from '../core/aimTypes';
import { validatePreset } from '../core/presets';
import { preferences } from '../core/preferences';
import { mergeSnapshot } from '../core/snapshot';
import * as SQLite from 'expo-sqlite';
import type { Account, Catalog, HistoryEntry, Settings, Snapshot } from '../core/types';
import { DEFAULT_SETTINGS, MAX_ACCOUNTS } from '../core/types';
import { AppError, uuid } from '../core/validation';
import { historyEntry } from '../core/normalize';
import { themePreference } from '../core/theme';
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
    CREATE TABLE IF NOT EXISTS refresh_gates (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, purpose TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account_id,purpose));
    CREATE TABLE IF NOT EXISTS presets (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account_id,id));
    CREATE TABLE IF NOT EXISTS purchases (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account_id,id));
    CREATE TABLE IF NOT EXISTS aim_state (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS aim_presets (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account_id,id));
    ${MATCH_ARCHIVE_SCHEMA}
    PRAGMA user_version = 5;`);
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
  const migration = await db.getFirstAsync(
    'SELECT key FROM settings WHERE key=?',
    'archive.migrated.v1',
  );
  if (!migration)
    await write(() =>
      db.withTransactionAsync(async () => {
        const snapshots = await db.getAllAsync<{ account_id: string; data: string }>(
          'SELECT account_id,data FROM snapshots',
        );
        for (const row of snapshots) {
          try {
            const saved = JSON.parse(row.data) as Snapshot;
            if (saved.accountId !== row.account_id || saved.demo) continue;
            if (saved.matches.status === 'ready')
              await upsertMatchRows(db, row.account_id, row.account_id, saved.matches.data);
            if (saved.store.status === 'ready')
              await upsertMarketRows(db, observedMarkets(row.account_id, saved.store.data));
          } catch {}
        }
        await db.runAsync(
          'INSERT INTO settings(key,data) VALUES(?,?)',
          'archive.migrated.v1',
          'true',
        );
      }),
    );
  const matches = matchRepository(db, write);
  return {
    ...matches,
    ...backupRepository(db, write),
    aimState(id) {
      return readJson<AimState>('SELECT data FROM aim_state WHERE account_id = ?', uuid(id));
    },
    async saveAimState(id, state) {
      id = uuid(id);
      if (state.snapshot && state.snapshot.accountId !== id)
        throw new AppError('ACCOUNT_MISMATCH', 'Aim settings belong to another account.');
      const data = JSON.stringify(state);
      if (data.length > 1024 * 1024)
        throw new AppError('AIM_SIZE', 'Aim cache exceeds its safe limit.');
      await write(() =>
        db.runAsync(
          'INSERT INTO aim_state(account_id,data) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data',
          id,
          data,
        ),
      );
    },
    async aimPresets(id) {
      return (
        await db.getAllAsync<{ data: string }>(
          'SELECT data FROM aim_presets WHERE account_id = ? ORDER BY rowid DESC',
          uuid(id),
        )
      ).map((row) => validateAimPreset(JSON.parse(row.data), id));
    },
    async saveAimPreset(input) {
      const p = validateAimPreset(input, input.accountId);
      await write(async () => {
        const old = await db.getFirstAsync(
          'SELECT id FROM aim_presets WHERE account_id=? AND id=?',
          p.accountId,
          p.id,
        );
        const count = await db.getFirstAsync<{ n: number }>(
          'SELECT COUNT(*) AS n FROM aim_presets WHERE account_id=?',
          p.accountId,
        );
        if (!old && (count?.n ?? 0) >= 30)
          throw new AppError('AIM_PRESET_LIMIT', 'Keep up to 30 aim presets per account.');
        await db.runAsync(
          'INSERT INTO aim_presets(account_id,id,data) VALUES(?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET data=excluded.data',
          p.accountId,
          p.id,
          JSON.stringify(p),
        );
      });
    },
    async deleteAimPreset(id, presetId) {
      await write(() =>
        db.runAsync(
          'DELETE FROM aim_presets WHERE account_id=? AND id=?',
          uuid(id),
          uuid(presetId),
        ),
      );
    },
    async presets(id) {
      return (
        await db.getAllAsync<{ data: string }>(
          'SELECT data FROM presets WHERE account_id=?',
          uuid(id),
        )
      ).map((r) => validatePreset(JSON.parse(r.data), id));
    },
    async savePreset(preset) {
      validatePreset(preset, preset.accountId);
      await write(async () => {
        const count = await db.getFirstAsync<{ n: number }>(
          'SELECT COUNT(*) AS n FROM presets WHERE account_id=?',
          preset.accountId,
        );
        const old = await db.getFirstAsync(
          'SELECT id FROM presets WHERE account_id=? AND id=?',
          preset.accountId,
          preset.id,
        );
        if (!old && (count?.n ?? 0) >= 30)
          throw new AppError('PRESET_LIMIT', 'Keep up to 30 presets per account.');
        await db.runAsync(
          'INSERT INTO presets(account_id,id,data) VALUES(?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET data=excluded.data',
          preset.accountId,
          preset.id,
          JSON.stringify(preset),
        );
      });
    },
    async deletePreset(id, presetId) {
      await write(() =>
        db.runAsync('DELETE FROM presets WHERE account_id=? AND id=?', uuid(id), uuid(presetId)),
      );
    },
    async purchaseRecords(id) {
      return (
        await db.getAllAsync<{ data: string }>(
          'SELECT data FROM purchases WHERE account_id=? ORDER BY rowid DESC',
          uuid(id),
        )
      ).map((r) => JSON.parse(r.data));
    },
    async savePurchaseRecord(record) {
      await write(() =>
        db.runAsync(
          'INSERT INTO purchases(account_id,id,data) VALUES(?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET data=excluded.data',
          uuid(record.accountId),
          uuid(record.id),
          JSON.stringify(record),
        ),
      );
    },
    refreshGate(id, purpose) {
      return readJson(
        'SELECT data FROM refresh_gates WHERE account_id = ? AND purpose = ?',
        uuid(id),
        purpose,
      );
    },
    async saveRefreshGate(id, purpose, gate) {
      await write(async () => {
        await db.runAsync(
          'INSERT INTO refresh_gates(account_id,purpose,data) VALUES(?,?,?) ON CONFLICT(account_id,purpose) DO UPDATE SET data=excluded.data',
          uuid(id),
          purpose,
          JSON.stringify(gate),
        );
      });
    },
    selectedAccount() {
      return readJson<string>('SELECT data FROM settings WHERE key = ?', 'selectedAccount');
    },
    async selectAccount(id) {
      if (id) uuid(id);
      await write(async () => {
        await db.runAsync(
          'INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
          'selectedAccount',
          JSON.stringify(id),
        );
      });
    },
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
      return write(async () => {
        const saved = await readJson<Snapshot>(
          'SELECT data FROM snapshots WHERE account_id = ?',
          uuid(id),
        );
        const local = await matches.archivedMatches(
          id,
          id,
          0,
          Math.max(40, saved?.matches.status === 'ready' ? saved.matches.data.length : 0),
        );
        const gate = await readJson<import('../core/refreshPolicy').RefreshGateState>(
          'SELECT data FROM refresh_gates WHERE account_id = ? AND purpose = ?',
          uuid(id),
          'live',
        );
        const result = local.length
          ? {
              ...(saved ?? emptySnapshot(id)),
              matches: {
                status: 'ready' as const,
                data: local,
                fetchedAt: saved?.matches.status === 'ready' ? saved.matches.fetchedAt : 0,
                ...(saved?.matches.status === 'ready' && saved.matches.warning
                  ? { warning: saved.matches.warning }
                  : {}),
              },
            }
          : saved;
        if (result && gate?.sample) {
          const incoming = gate.sample,
            old = result.liveGame;
          if (
            incoming.status === 'ready'
              ? old.status !== 'ready' || incoming.fetchedAt >= old.fetchedAt
              : true
          )
            result.liveGame = incoming;
        }
        return result;
      });
    },
    async saveSnapshot(snapshot) {
      if (snapshot.demo)
        throw new AppError('DEMO_ISOLATION', 'Demo snapshots cannot overwrite real account data.');
      await write(async () => {
        await db.withTransactionAsync(async () => {
          const previous = await readJson<Snapshot>(
            'SELECT data FROM snapshots WHERE account_id = ?',
            snapshot.accountId,
          );
          snapshot = mergeSnapshot(previous, snapshot);
          if (
            snapshot.matches.status === 'ready' &&
            JSON.stringify(previous?.matches) !== JSON.stringify(snapshot.matches)
          )
            await upsertMatchRows(
              db,
              snapshot.accountId,
              snapshot.accountId,
              snapshot.matches.data,
              false,
            );
          await db.runAsync(
            'INSERT INTO snapshots(account_id,data) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data',
            uuid(snapshot.accountId),
            JSON.stringify(snapshot),
          );
          if (
            snapshot.store.status === 'ready' &&
            (previous?.store.status !== 'ready' ||
              previous.store.fetchedAt !== snapshot.store.fetchedAt)
          ) {
            await upsertMarketRows(db, observedMarkets(snapshot.accountId, snapshot.store.data));
            const entry = historyEntry(snapshot.accountId, snapshot.store.data);
            await db.runAsync(
              'INSERT INTO history(account_id,rotation_id,observed_at,data) VALUES(?,?,?,?) ON CONFLICT(account_id,rotation_id) DO UPDATE SET data=excluded.data',
              entry.accountId,
              entry.id,
              entry.observedAt,
              JSON.stringify(entry),
            );
          }
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
      const raw = await readJson<Settings>(
        'SELECT data FROM settings WHERE key = ?',
        'preferences',
      );
      const value = preferences(raw);
      if (raw?.defaultsVersion !== value.defaultsVersion)
        await write(async () => {
          await db.runAsync(
            'INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
            'preferences',
            JSON.stringify(value),
          );
        });
      return value;
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
        await db.execAsync("DELETE FROM snapshots; DELETE FROM settings WHERE key = 'catalog';");
      });
    },
  };
}

import {
  validateSummaryShape,
  validateReportShape,
  validateProfileData,
  validateCatalogShape,
} from './archiveValidation';
import { validateCrosshair } from './crosshair';
import { Buffer } from 'buffer';
import type { Account, HistoryEntry, MatchSummary, Settings, Snapshot } from './types';
import type { AimPreset, AimSnapshot } from './aimTypes';
import type { LoadoutPreset } from './presets';
import { validatePreset } from './presets';
import { validateAimPreset } from './aimSettings';
import {
  validateArchivedReport,
  validateMatchSummary,
  type ArchivedReport,
  type MarketRecord,
} from './matchArchive';
import { AppError, object, safeMedia, uuid } from './validation';
import { preferences } from './preferences';
export const BACKUP_LIMIT_BYTES = 64 * 1024 * 1024;
export interface BackupData {
  account: Pick<
    Account,
    'puuid' | 'gameName' | 'tagLine' | 'region' | 'shard' | 'createdAt' | 'country'
  >;
  presets: LoadoutPreset[];
  aimPresets: AimPreset[];
  wishlist: string[];
  matches: { subject: string; summary: MatchSummary }[];
  reports: ArchivedReport[];
  markets: MarketRecord[];
  storeHistory: HistoryEntry[];
  profile?: Pick<Snapshot, 'rank' | 'xp' | 'loadout' | 'progression'>;
  aimSnapshot?: AimSnapshot;
  settings: Settings;
}
export interface BackupFile {
  format: 'outpost-account-backup';
  version: 1;
  createdAt: number;
  data: BackupData;
  sha256: string;
}
export interface BackupStore {
  exportAccountData(id: string, includeReports: boolean): Promise<BackupData>;
  restoreAccountData(
    id: string,
    data: BackupData,
    restoreSettings: boolean,
    guard: () => void,
  ): Promise<void>;
}
export type BackupHash = (text: string) => Promise<string>;
export function backupCounts(data: BackupData) {
  return {
    loadouts: data.presets.length,
    aimPresets: data.aimPresets.length,
    wishlist: data.wishlist.length,
    matches: data.matches.length,
    reports: data.reports.length,
    nightMarkets: data.markets.filter((m) => m.kind === 'night-market').length,
    storeRotations: data.storeHistory.length,
    bundles: data.markets.filter((m) => m.kind === 'bundle').length,
  };
}
function fail(message = 'The backup contains invalid data.'): never {
  throw new AppError('BACKUP_INVALID', message);
}
function inspect(value: unknown, depth = 0, state = { nodes: 0 }): void {
  if (++state.nodes > 1200000 || depth > 32) fail('The backup exceeds its structure limit.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail();
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 512000) fail('A backup field is too large.');
    if (/^(?:https?|file|data|javascript|content):/i.test(value) && !safeMedia(value))
      fail('The backup contains an untrusted media address.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 50000) fail('Too many entries in the backup.');
    for (const v of value) inspect(v, depth + 1, state);
    return;
  }
  if (!value || typeof value !== 'object') fail();
  for (const [key, v] of Object.entries(value)) {
    if (
      ['fetchedAt', 'observedAt', 'savedAt', 'updatedAt', 'startedAt'].includes(key) &&
      typeof v === 'number' &&
      v > Date.now() + 300000
    )
      fail('A saved record has a future observation time.');
    if (['sessionKey', 'codeVerifier', 'chatEncryptionKey'].includes(key))
      fail('Secrets cannot be backed up.');
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      /(?:password|cookie|token|secret|authorization|credential|encryptionkey|privatekey)/i.test(
        key,
      )
    )
      fail('Authentication credentials cannot be included in an Outpost backup.');
    inspect(v, depth + 1, state);
  }
}
function list<T>(value: unknown, max: number): T[] {
  if (!Array.isArray(value) || value.length > max)
    fail('A backup list is missing or exceeds its limit.');
  return value as T[];
}
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008]/.test(value)) fail();
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail();
  return value;
}
export function validateBackupData(input: unknown): BackupData {
  inspect(input);
  const d = object(input),
    a = object(d.account),
    id = uuid(a.puuid);
  if (
    !['ap', 'eu', 'na', 'br', 'latam', 'kr', 'pbe'].includes(String(a.region)) ||
    !['ap', 'eu', 'na', 'kr', 'pbe'].includes(String(a.shard))
  )
    fail('The account region is invalid.');
  const account = {
    puuid: id,
    gameName: text(a.gameName),
    tagLine: text(a.tagLine),
    region: a.region as Account['region'],
    shard: a.shard as Account['shard'],
    ...(a.country ? { country: text(a.country) } : {}),
    ...(a.createdAt ? { createdAt: number(a.createdAt) } : {}),
  };
  const presets = list<LoadoutPreset>(d.presets, 30).map((p) => {
      const result = validatePreset(p, id);
      number(result.updatedAt);
      return result;
    }),
    aimPresets = list<AimPreset>(d.aimPresets, 30).map((p) => validateAimPreset(p, id));
  const wishlist = list<string>(d.wishlist, 10000).map(uuid);
  const matches = list<{ subject: string; summary: MatchSummary }>(d.matches, 50000).map((row) => {
    const summary = validateMatchSummary(row.summary);
    validateSummaryShape(summary);
    return { subject: uuid(row.subject), summary };
  });
  const reports = list<ArchivedReport>(d.reports, 10000).map((r) => {
    const report = validateArchivedReport(r, uuid(r.subject));
    validateReportShape(report.detail);
    return report;
  });
  const markets = list<MarketRecord>(d.markets, 20000).map((r) => {
    if (r.accountId !== id || !['daily', 'night-market', 'bundle'].includes(r.kind))
      fail('A store record belongs to another account.');
    text(r.id, 6000);
    text(r.name);
    number(r.observedAt);
    number(r.expiresAt);
    validateOffers(r.offers);
    return r;
  });
  const storeHistory = list<HistoryEntry>(d.storeHistory, 10000).map((r) => {
    if (r.accountId !== id) fail();
    text(r.id, 6000);
    number(r.observedAt);
    number(r.expiresAt);
    validateOffers(r.offers);
    return r;
  });
  if (d.profile)
    for (const key of ['rank', 'xp', 'loadout', 'progression'])
      validateProfileData(object(d.profile)[key], key);
  if (d.aimSnapshot) {
    const aim = d.aimSnapshot as AimSnapshot;
    if (aim.accountId !== id) fail();
    number(aim.fetchedAt);
    text(aim.revision, 200000);
    list(aim.crosshairs, 15);
    if (
      aim.current !== null &&
      (!Number.isInteger(aim.current) ||
        aim.current < 0 ||
        !aim.crosshairs.some((c) => c.index === aim.current))
    )
      fail();
    for (const c of aim.crosshairs) {
      number(c.index);
      text(c.name, 48);
      if (c.profile) validateCrosshair(c.profile);
    }
    const sensitivity = object(aim.sensitivity);
    for (const k of ['hipfire', 'ads', 'scoped'])
      if (sensitivity[k] !== null) number(sensitivity[k]);
  }
  const future = Date.now() + 300000;
  for (const row of matches)
    if (row.summary.startedAt > future) fail('A saved match has a future timestamp.');
  for (const row of reports)
    if (row.savedAt > future || row.detail.startedAt > future)
      fail('A saved report has a future timestamp.');
  for (const key of ['rank', 'xp', 'loadout', 'progression'])
    if (d.profile && Number(object(object(d.profile)[key]).fetchedAt) > future)
      fail('The saved profile timestamp is invalid.');
  for (const rows of [presets, aimPresets]) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      fail('Duplicate preset IDs in backup.');
  }
  return {
    account,
    presets,
    aimPresets,
    wishlist,
    matches,
    reports,
    markets,
    storeHistory,
    settings: preferences(d.settings),
    ...(d.profile ? { profile: d.profile as BackupData['profile'] } : {}),
    ...(d.aimSnapshot ? { aimSnapshot: d.aimSnapshot as AimSnapshot } : {}),
  };
}
function validateOffers(value: unknown): void {
  for (const o of list<any>(value, 1000)) {
    text(o.id, 200);
    const i = object(o.item);
    validateCatalogShape(i);
    for (const p of list<any>(o.prices, 10)) {
      uuid(p.currencyId);
      number(p.amount);
      text(p.symbol);
    }
  }
}
export async function encodeBackup(
  data: BackupData,
  hash: BackupHash,
  now = Date.now(),
): Promise<string> {
  data = validateBackupData(data);
  const canonical = JSON.stringify(data);
  if (Buffer.byteLength(canonical, 'utf8') > BACKUP_LIMIT_BYTES - 1000)
    throw new AppError(
      'BACKUP_SIZE',
      'This backup exceeds 64 MiB. Disable full match reports to back up the summaries instead.',
    );
  const envelope: BackupFile = {
    format: 'outpost-account-backup',
    version: 1,
    createdAt: now,
    data,
    sha256: await hash(canonical),
  };
  return JSON.stringify(envelope);
}
export async function decodeBackup(textValue: string, hash: BackupHash): Promise<BackupFile> {
  if (Buffer.byteLength(textValue, 'utf8') > BACKUP_LIMIT_BYTES)
    throw new AppError('BACKUP_SIZE', 'Choose an Outpost backup smaller than 64 MiB.');
  let input: BackupFile;
  try {
    input = JSON.parse(textValue);
  } catch {
    fail('The selected file is not valid JSON.');
  }
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    input!.format !== 'outpost-account-backup' ||
    input!.version !== 1 ||
    !Number.isFinite(input!.createdAt) ||
    !/^[0-9a-f]{64}$/.test(input!.sha256)
  )
    fail('This is not a supported Outpost backup.');
  const digest = await hash(JSON.stringify(input!.data));
  if (digest !== input!.sha256)
    throw new AppError(
      'BACKUP_CHECKSUM',
      'The backup checksum did not match. Nothing was restored.',
    );
  if (input!.createdAt > Date.now() + 300000 || input!.createdAt < 0)
    fail('The backup creation time is invalid.');
  return { ...input!, data: validateBackupData(input!.data) };
}

import { nativeFetcher } from './network';
import { PlayerScope } from '../core/playerScope';
import type { IdentityEdit } from '../core/playerTypes';
import type { Loadout } from '../core/types';
import { Platform } from 'react-native';
import { CatalogClient } from '../core/catalog';
import { HttpClient } from '../core/http';
import { RiotClient, connectAccount } from '../core/riot';
import { EMPTY_CATALOG, MAX_ACCOUNTS } from '../core/types';
import type { Account, Catalog, LoginTokens, Region, Snapshot } from '../core/types';
import { AppError } from '../core/validation';
import { reauthenticateWithCookies, sessionActive } from '../core/auth';
import { openRepository } from './storage';
import type { Repository } from './storage.types';
import { vault, randomHex } from './secure';
import { cancelAccountNotifications, updateStoreNotifications } from './notifications';
export class Runtime {
  readonly http = new HttpClient(nativeFetcher);
  readonly publicClient = new CatalogClient(new HttpClient(nativeFetcher));
  catalog: Catalog = { ...EMPTY_CATALOG };
  private clients = new Map<string, RiotClient>();
  private scopes = new Map<string, PlayerScope>();
  private rejectedSessions = new Set<string>();
  private flights = new Map<string, Promise<Snapshot>>();
  private identityFlights = new Map<string, Promise<Loadout>>();
  private clientFlights = new Map<string, Promise<RiotClient>>();
  private generations = new Map<string, number>();
  private lastSync = new Map<string, number>();
  constructor(readonly repository: Repository) {}
  async loadCatalog(force = false): Promise<Catalog> {
    if (
      !force &&
      this.catalog.schemaVersion === 4 &&
      this.catalog.fetchedAt > Date.now() - (this.catalog.failedPaths?.length ? 30000 : 86400000)
    )
      return this.catalog;
    const cached = await this.repository.catalog();

    if (
      !force &&
      cached?.schemaVersion === 4 &&
      cached.fetchedAt > Date.now() - (cached.failedPaths?.length ? 30000 : 86400000)
    )
      return (this.catalog = cached);
    const fresh = await this.publicClient.load(cached ?? this.catalog);
    if (!Object.keys(fresh.items).length) return (this.catalog = cached ?? { ...EMPTY_CATALOG });
    this.catalog = fresh;
    for (const client of this.clients.values()) client.updateCatalog(fresh);
    await this.repository.saveCatalog(fresh);
    return fresh;
  }
  async link(input: LoginTokens, region?: Region, expectedId?: string): Promise<Account> {
    if (Platform.OS === 'web')
      throw new AppError('NATIVE_REQUIRED', 'Real Riot sign-in is disabled on web.');
    const session = await connectAccount(this.http, input, region);
    if (expectedId && expectedId !== session.account.puuid)
      throw new AppError(
        'ACCOUNT_MISMATCH',
        'Sign in to the account you selected for reconnection.',
      );
    const existing = await this.repository.accounts();
    if (!existing.some((a) => a.puuid === session.account.puuid) && existing.length >= MAX_ACCOUNTS)
      throw new AppError(
        'ACCOUNT_LIMIT',
        `Remove one of the ${MAX_ACCOUNTS} linked accounts before adding another.`,
      );
    const old = existing.find((a) => a.puuid === session.account.puuid);
    if (old) session.account.addedAt = old.addedAt;
    await vault.write(session);
    try {
      await this.repository.saveAccount(session.account);
    } catch (error) {
      if (!old) await vault.remove(session.account.puuid);
      throw error;
    }
    this.invalidate(session.account.puuid);
    await this.flights.get(session.account.puuid)?.catch(() => {});
    return session.account;
  }
  private invalidate(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.clients.get(id)?.dispose();
    this.clients.delete(id);
    this.scopes.delete(id);
    this.rejectedSessions.delete(id);
    this.clientFlights.delete(id);
    this.lastSync.delete(id);
  }
  async client(id: string): Promise<RiotClient> {
    const existing = this.clients.get(id);
    if (existing?.isActive()) return existing;
    const rejected = this.rejectedSessions.has(id) || existing?.needsReauth() === true;
    if (rejected) this.rejectedSessions.add(id);
    if (existing) {
      existing.dispose();
      this.clients.delete(id);
    }
    const pending = this.clientFlights.get(id);
    if (pending) return pending;
    const generation = this.generations.get(id) ?? 0;
    const work = (async () => {
      let session = await vault.read(id);
      if (!session)
        throw new AppError(
          'SESSION_EXPIRED',
          'Reconnect your Riot account to fetch fresh data. Cached data remains available.',
        );
      if (rejected || !sessionActive(session)) {
        if (!session.reauth?.cookies?.ssid)
          throw new AppError(
            'SESSION_EXPIRED',
            'Reconnect your Riot account to fetch fresh data. Cached data remains available.',
          );
        const freshTokens = await reauthenticateWithCookies(
          session.reauth.cookies,
          { state: randomHex(), nonce: randomHex(), createdAt: Date.now() },
          nativeFetcher,
        );
        const refreshed = await connectAccount(this.http, freshTokens, session.account.region);
        if (refreshed.account.puuid !== id)
          throw new AppError(
            'ACCOUNT_MISMATCH',
            'Silent reauthentication returned a different Riot account. Interactive sign-in is required.',
          );
        refreshed.account.addedAt = session.account.addedAt;
        if (generation !== (this.generations.get(id) ?? 0))
          throw new AppError(
            'SESSION_REMOVED',
            'Session renewal was discarded after account removal.',
          );
        refreshed.account.canReauth = Boolean(refreshed.reauth?.cookies.ssid);
        await vault.write(refreshed);
        await this.repository.saveAccount(refreshed.account);
        this.rejectedSessions.delete(id);
        session = refreshed;
      }
      await this.loadCatalog();
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError(
          'SESSION_REMOVED',
          'Account initialization was discarded after a session change.',
        );
      const scope =
        this.scopes.get(id) ??
        new PlayerScope(id, session.account.gameName, session.account.tagLine);
      this.scopes.set(id, scope);
      const client = new RiotClient(session, this.http, this.publicClient, this.catalog, scope);
      this.clients.set(id, client);
      return client;
    })();
    this.clientFlights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.clientFlights.get(id) === work) this.clientFlights.delete(id);
    }
  }
  async sync(id: string): Promise<Snapshot> {
    const inFlight = this.flights.get(id);
    if (inFlight) return inFlight;
    const last = this.lastSync.get(id) ?? 0;
    if (Date.now() - last < 30000)
      throw new AppError(
        'LOCAL_COOLDOWN',
        'Wait a moment before refreshing this account again.',
        last + 30000,
      );
    const generation = this.generations.get(id) ?? 0;
    const run = async () => {
      await this.loadCatalog();
      const client = await this.client(id);
      const snapshot = await client.snapshot();
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError(
          'SESSION_REMOVED',
          'This sync was discarded because the account changed.',
        );
      const account = (await this.repository.accounts()).find((a) => a.puuid === id);
      if (!account) throw new AppError('SESSION_REMOVED', 'This account was removed.');
      await this.repository.saveSnapshot(snapshot);
      this.lastSync.set(id, Date.now());
      if ((await this.repository.settings()).reminders && snapshot.store.status === 'ready') {
        await updateStoreNotifications(
          account,
          snapshot.store.data,
          await this.repository.wishlist(id),
          this.repository,
        ).catch(() => {});
      }
      return snapshot;
    };
    const work = run();
    this.flights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.flights.get(id) === work) this.flights.delete(id);
    }
  }
  async saveIdentity(id: string, edit: IdentityEdit): Promise<Loadout> {
    if (this.identityFlights.has(id))
      throw new AppError('LOADOUT_BUSY', 'An identity update is already running.');
    const generation = this.generations.get(id) ?? 0;
    const run = async () => {
      const data = await (await this.client(id)).saveIdentity(edit);
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('ACCOUNT_CHANGED', 'The account changed while saving.');
      const saved = await this.repository.snapshot(id);
      if (saved)
        await this.repository.saveSnapshot({
          ...saved,
          loadout: { status: 'ready', data, fetchedAt: Date.now() },
        });
      return data;
    };
    const work = run();
    this.identityFlights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.identityFlights.get(id) === work) this.identityFlights.delete(id);
    }
  }
  async remove(id: string): Promise<void> {
    const initializing = this.clientFlights.get(id);
    this.invalidate(id);
    await initializing?.catch(() => {});

    await this.flights.get(id)?.catch(() => {});
    await this.identityFlights.get(id)?.catch(() => {});
    await cancelAccountNotifications(id);
    await vault.remove(id);
    await this.repository.removeAccount(id);
  }
  async clearCache(): Promise<void> {
    const pending = [
      ...this.flights.values(),
      ...this.clientFlights.values(),
      ...this.identityFlights.values(),
    ];
    for (const id of new Set([
      ...this.clients.keys(),
      ...this.clientFlights.keys(),
      ...this.flights.keys(),
      ...this.identityFlights.keys(),
    ]))
      this.invalidate(id);
    await Promise.allSettled(pending);
    this.publicClient.clear();
    await this.repository.clearCache();
    this.catalog = { ...EMPTY_CATALOG };
  }
}
let promise: Promise<Runtime> | undefined;
export function getRuntime(): Promise<Runtime> {
  return (promise ??= openRepository().then((repo) => new Runtime(repo)));
}

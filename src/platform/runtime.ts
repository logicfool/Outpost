import {
  DAY_MS,
  LIVE_POLL_MS,
  MANUAL_COOLDOWN_MS,
  emptySnapshot,
  failureDelay,
  nextAutomaticAt,
  snapshotPlan,
  storeResetAt,
  type RefreshReason,
  type RefreshGateState,
} from '../core/refreshPolicy';
import type { LiveGame, Section } from '../core/types';
import { nativeFetcher } from './network';
import { activateChatStorage, removeChatStorage } from './chatStorage';
import { PlayerScope } from '../core/playerScope';
import type { IdentityEdit } from '../core/playerTypes';
import type { Loadout } from '../core/types';
import { Platform } from 'react-native';
import { CatalogClient } from '../core/catalog';
import { HttpClient } from '../core/http';
import { RiotClient, connectAccount } from '../core/riot';
import { EMPTY_CATALOG, MAX_ACCOUNTS } from '../core/types';
import type { Account, Catalog, LoginTokens, Region, Snapshot } from '../core/types';
import { AppError, safeError } from '../core/validation';
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
  private liveFlights = new Map<string, Promise<Section<LiveGame>>>();
  private catalogFlight?: Promise<Catalog>;
  constructor(
    readonly repository: Repository,
    private now: () => number = Date.now,
  ) {}
  async loadCatalog(force = false, allowNetwork = true): Promise<Catalog> {
    if (this.catalogFlight) return this.catalogFlight;
    const work = async () => {
      const cached = Object.keys(this.catalog.items).length
        ? this.catalog
        : await this.repository.catalog();
      const ttl = cached?.failedPaths?.length ? 30 * 60000 : DAY_MS;
      if (!allowNetwork && !cached) return this.catalog;
      if (
        cached &&
        (!allowNetwork ||
          (!force && cached.schemaVersion === 5 && cached.fetchedAt + ttl > this.now()))
      ) {
        this.catalog = cached;
        for (const client of this.clients.values()) client.updateCatalog(cached);
        return cached;
      }
      if (force) this.publicClient.clear();
      const fresh = await this.publicClient.load(cached ?? this.catalog);
      this.catalog = fresh;
      for (const client of this.clients.values()) client.updateCatalog(fresh);
      await this.repository.saveCatalog(fresh);
      return fresh;
    };
    const promise = work();
    this.catalogFlight = promise;
    try {
      return await promise;
    } finally {
      if (this.catalogFlight === promise) this.catalogFlight = undefined;
    }
  }
  private linkQueue: Promise<unknown> = Promise.resolve();
  private linkingAccounts = new Set<string>();
  link(input: LoginTokens, region?: Region, expectedId?: string): Promise<Account> {
    const work = this.linkQueue
      .catch(() => {})
      .then(() => this.linkAccount(input, region, expectedId));
    this.linkQueue = work;
    return work;
  }
  private async linkAccount(
    input: LoginTokens,
    region?: Region,
    expectedId?: string,
  ): Promise<Account> {
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
    if (old && !expectedId)
      throw new AppError(
        'ACCOUNT_ALREADY_LINKED',
        'This Riot account is already linked. Select it in Settings, or sign in with a different Riot account.',
      );
    if (old) session.account.addedAt = old.addedAt;
    const id = session.account.puuid,
      initializing = this.clientFlights.get(id);
    this.linkingAccounts.add(id);
    try {
      this.invalidate(id);
      await Promise.allSettled(
        [initializing, this.flights.get(id), this.identityFlights.get(id)].filter(
          (p): p is Promise<any> => !!p,
        ),
      );
      const oldSession = old ? await vault.read(id) : null;
      await vault.write(session);
      try {
        await this.repository.saveAccount(session.account);
      } catch (error) {
        if (oldSession) await vault.write(oldSession);
        else await vault.remove(id);
        throw error;
      }
      activateChatStorage(id);
      return session.account;
    } finally {
      this.linkingAccounts.delete(id);
      this.invalidate(id);
    }
  }
  private invalidate(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.clients.get(id)?.dispose();
    this.clients.delete(id);
    this.scopes.delete(id);
    this.rejectedSessions.delete(id);
    this.clientFlights.delete(id);
  }
  async client(id: string): Promise<RiotClient> {
    if (this.linkingAccounts.has(id))
      throw new AppError(
        'SESSION_LINKING',
        'This account is being reconnected. Refresh after sign-in completes.',
      );
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
      await this.loadCatalog(false, false);
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

  async sync(id: string, reason: RefreshReason = 'auto'): Promise<Snapshot> {
    const inFlight = this.flights.get(id);
    if (inFlight) return inFlight;
    const generation = this.generations.get(id) ?? 0;
    const run = async (): Promise<Snapshot> => {
      const [previous, gate] = await Promise.all([
        this.repository.snapshot(id),
        this.repository.refreshGate(id, 'sync'),
      ]);
      if (previous && (previous.accountId !== id || previous.demo))
        throw new AppError(
          'ACCOUNT_MISMATCH',
          'This cached snapshot belongs to a different account.',
        );
      if (!Object.keys(this.catalog.items).length) {
        const cachedCatalog = await this.repository.catalog();
        if (cachedCatalog) {
          this.catalog = cachedCatalog;
          for (const client of this.clients.values()) client.updateCatalog(cachedCatalog);
        }
      }
      const now = this.now(),
        nextAt = nextAutomaticAt(previous, gate, now);
      if (reason === 'auto' && previous && nextAt > now)
        return { ...previous, nextAutoRefreshAt: nextAt };
      if ((gate?.notBefore ?? 0) > now || (reason === 'auto' && (gate?.autoNotBefore ?? 0) > now)) {
        if (reason === 'manual')
          throw new AppError(
            'LOCAL_COOLDOWN',
            'Please wait before refreshing again. Cached data is still available.',
            gate!.notBefore,
          );
        return { ...(previous ?? emptySnapshot(id, now)), nextAutoRefreshAt: nextAt };
      }

      const reservation: RefreshGateState = {
        attemptedAt: now,
        notBefore: now + MANUAL_COOLDOWN_MS,
        autoNotBefore: now + 5 * 60000,
        failures: gate?.failures ?? 0,
      };
      await this.repository.saveRefreshGate(id, 'sync', reservation);
      let next: Snapshot;
      try {
        await this.loadCatalog(reason === 'manual');
        const client = await this.client(id);
        next = await client.snapshot(previous, snapshotPlan(previous, reason, this.now()));
      } catch (reason) {
        const e = safeError(reason);
        if (generation !== (this.generations.get(id) ?? 0)) throw e;
        next = {
          ...(previous ?? emptySnapshot(id, now)),
          refreshIssue: { code: e.code, message: e.message, retryAt: e.retryAt },
        };
      }
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError(
          'SESSION_REMOVED',
          'This refresh was discarded after an account change.',
        );
      const account = (await this.repository.accounts()).find((a) => a.puuid === id);
      if (!account) throw new AppError('SESSION_REMOVED', 'This account was removed.');
      const storeError = next.store.status === 'error' ? next.store : next.store.warning;
      const retryAt = Math.max(
        next.refreshIssue?.retryAt ?? 0,
        ...['store', 'wallet', 'rank', 'xp', 'progression', 'collection', 'loadout', 'matches'].map(
          (key) => {
            const section = next[key as keyof Snapshot] as Section<unknown>;
            return section.status === 'error'
              ? (section.retryAt ?? 0)
              : (section.warning?.retryAt ?? 0);
          },
        ),
      );
      const resetStillPending =
        next.store.status === 'ready' && storeResetAt(next, this.now()) <= this.now() + 2000;
      const failed = !!storeError || !!next.refreshIssue || resetStillPending;
      const failures = failed ? (gate?.failures ?? 0) + 1 : 0;
      const completedGate: RefreshGateState = {
        attemptedAt: now,
        failures,
        notBefore: Math.max(now + MANUAL_COOLDOWN_MS, retryAt),
        autoNotBefore: Math.max(
          now + MANUAL_COOLDOWN_MS,
          retryAt,
          failed ? this.now() + failureDelay(failures, 5 * 60000) : 0,
        ),
      };
      await this.repository.saveRefreshGate(id, 'sync', completedGate);
      next.nextAutoRefreshAt = nextAutomaticAt(next, completedGate, this.now());
      if (storeError && !next.refreshIssue)
        next.refreshIssue = {
          code: storeError.code,
          message: storeError.message,
          retryAt: completedGate.autoNotBefore,
        };
      if (resetStillPending && !next.refreshIssue)
        next.refreshIssue = {
          code: 'STORE_RESET_PENDING',
          message: 'Riot has not returned the new rotation yet. The next attempt is delayed.',
          retryAt: completedGate.autoNotBefore,
        };

      const latest = await this.repository.snapshot(id);
      if (latest?.liveGame) next.liveGame = latest.liveGame;
      await this.repository.saveSnapshot(next);
      if (
        !failed &&
        (await this.repository.settings()).reminders &&
        next.store.status === 'ready'
      ) {
        await updateStoreNotifications(
          account,
          next.store.data,
          await this.repository.wishlist(id),
          this.repository,
        ).catch(() => {});
      }
      return (await this.repository.snapshot(id)) ?? next;
    };
    const work = run();
    this.flights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.flights.get(id) === work) this.flights.delete(id);
    }
  }

  async live(id: string): Promise<Section<LiveGame>> {
    const flight = this.liveFlights.get(id);
    if (flight) return flight;
    const generation = this.generations.get(id) ?? 0;
    const run = async (): Promise<Section<LiveGame>> => {
      const gate = await this.repository.refreshGate(id, 'live');
      const now = this.now();
      if ((gate?.notBefore ?? 0) > now)
        return (
          gate?.sample ?? {
            status: 'error',
            code: 'LOCAL_COOLDOWN',
            message: 'The next live check is scheduled.',
            retryAt: gate!.notBefore,
          }
        );
      await this.repository.saveRefreshGate(id, 'live', {
        attemptedAt: now,
        notBefore: now + LIVE_POLL_MS,
        failures: gate?.failures ?? 0,
        sample: gate?.sample,
      });
      let sample: Section<LiveGame>;
      try {
        sample = {
          status: 'ready',
          data: await (await this.client(id)).liveGame(),
          fetchedAt: this.now(),
        };
      } catch (reason) {
        const e = safeError(reason);
        sample = { status: 'error', code: e.code, message: e.message, retryAt: e.retryAt };
      }
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError(
          'SESSION_REMOVED',
          'This live check was discarded after an account change.',
        );
      const error = sample.status === 'error' ? sample : sample.data.detailError;
      const failures = error ? (gate?.failures ?? 0) + 1 : 0;
      const notBefore = Math.max(
        this.now() + (error ? failureDelay(failures) : LIVE_POLL_MS),
        error?.retryAt ?? 0,
      );
      sample =
        sample.status === 'ready'
          ? { ...sample, data: { ...sample.data, nextCheckAt: notBefore } }
          : { ...sample, retryAt: notBefore };
      await this.repository.saveRefreshGate(id, 'live', {
        attemptedAt: now,
        notBefore,
        failures,
        sample,
      });
      const previous = await this.repository.snapshot(id);
      if (previous) await this.repository.saveSnapshot({ ...previous, liveGame: sample });
      return sample;
    };
    const work = run();
    this.liveFlights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.liveFlights.get(id) === work) this.liveFlights.delete(id);
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
    await this.linkQueue.catch(() => {});
    const initializing = this.clientFlights.get(id);
    this.invalidate(id);
    await initializing?.catch(() => {});
    await this.liveFlights.get(id)?.catch(() => {});

    await this.flights.get(id)?.catch(() => {});
    await this.identityFlights.get(id)?.catch(() => {});
    await cancelAccountNotifications(id);
    await removeChatStorage(id);
    await vault.remove(id);
    await this.repository.removeAccount(id);
  }
  async clearCache(): Promise<void> {
    const pending = [
      ...this.flights.values(),
      ...this.clientFlights.values(),
      ...this.identityFlights.values(),
      ...this.liveFlights.values(),
    ];
    for (const id of new Set([
      ...this.clients.keys(),
      ...this.clientFlights.keys(),
      ...this.flights.keys(),
      ...this.identityFlights.keys(),
      ...this.liveFlights.keys(),
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

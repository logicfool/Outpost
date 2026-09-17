import { FriendLookupGate } from '../core/friendLookup';
import { needsSessionRecovery } from '../core/sessionRecovery';
import {
  stageSessionRenewal,
  checkpointCookies,
  sessionCheckpointMatches,
  sessionHealth,
} from '../core/sessionRenewal';
import { logoutRiotSession } from '../core/logout';
import { rememberBundles } from '../core/bundles';
import { recordRequest } from '../core/diagnostics';
import type { Session } from '../core/types';
import {
  quotePurchase,
  validatePurchaseQuote,
  ownsOffer,
  unresolvedForItem,
  type PurchaseQuote,
  type PurchaseRecord,
} from '../core/purchases';
import { CURRENCIES } from '../core/normalize';
import { catalogItem } from '../core/catalog';
import { validatePreset, type LoadoutPreset } from '../core/presets';
import { ITEM_TYPES } from '../core/normalize';
import {
  DAY_MS,
  LIVE_POLL_MS,
  MANUAL_COOLDOWN_MS,
  waitingSnapshot,
  failedSnapshot,
  hasUnloadedSections,
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
import { CatalogClient, buildCatalog, mergeCatalog } from '../core/catalog';
import { HttpClient } from '../core/http';
import { RiotClient, connectAccount } from '../core/riot';
import { EMPTY_CATALOG, MAX_ACCOUNTS } from '../core/types';
import type { Account, Catalog, LoginTokens, Region, Snapshot } from '../core/types';
import { AppError, safeError, uuid } from '../core/validation';
import { reauthenticateWithCookies, sessionActive } from '../core/auth';
import { openRepository } from './storage';
import type { Repository } from './storage.types';
import { vault, randomHex, randomId } from './secure';
import { cancelAccountNotifications, updateStoreNotifications } from './notifications';
export class Runtime {
  readonly http = new HttpClient(nativeFetcher);
  readonly publicClient = new CatalogClient(new HttpClient(nativeFetcher));
  catalog: Catalog = { ...EMPTY_CATALOG };
  private signoutFlights = new Map<string, Promise<void>>();
  private signingOut = new Set<string>();
  private clients = new Map<string, RiotClient>();
  private scopes = new Map<string, PlayerScope>();
  private rejectedSessions = new Set<string>();
  private flights = new Map<string, Promise<Snapshot>>();
  private identityFlights = new Map<string, Promise<Loadout>>();
  private clientFlights = new Map<string, Promise<RiotClient>>();
  private generations = new Map<string, number>();
  private purchaseFlights = new Map<string, Promise<PurchaseRecord>>();
  private purchaseCheckFlights = new Map<
    string,
    { recordId: string; work: Promise<PurchaseRecord> }
  >();
  private quotes = new Map<string, PurchaseQuote>();
  private quoteTimes = new Map<string, number>();
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
          (!force && cached.schemaVersion === 9 && cached.fetchedAt + ttl > this.now()))
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
  private async persistSession(session: Session): Promise<void> {
    await vault.write(session);
    if (!sessionCheckpointMatches(await vault.read(session.account.puuid), session))
      throw new AppError(
        'SESSION_SAVE',
        'Secure session verification failed. Reconnect this account without removing it.',
      );
  }
  private portraits?: FriendLookupGate;
  async friendIdentity(id: string, subject: string) {
    const generation = this.generations.get(id) ?? 0;
    const client = await this.client(id);
    client.scope.player(subject);
    return (this.portraits ??= new FriendLookupGate(this.repository, this.now)).run(
      id,
      subject,
      async () => {
        const value = await client.friendIdentity(subject);
        if (generation !== (this.generations.get(id) ?? 0))
          throw new AppError('SESSION_REMOVED', 'The account changed.');
        return value;
      },
    );
  }
  async savedAccount(id: string): Promise<Account | null> {
    const generation = this.generations.get(id) ?? 0;
    if (this.linkingAccounts.has(id)) return null;
    const session = await vault.read(id);
    if (!session) return null;
    const listed = (await this.repository.accounts()).find((a) => a.puuid === id);
    if (!listed || generation !== (this.generations.get(id) ?? 0) || this.linkingAccounts.has(id))
      return null;
    if (
      listed.canReauth !== session.account.canReauth ||
      listed.expiresAt !== session.account.expiresAt
    )
      await this.repository.saveAccount(session.account);
    return session.account;
  }
  async sessionHealth(id: string) {
    return sessionHealth(await vault.read(id), this.now());
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
    if (this.signingOut.has(session.account.puuid))
      throw new AppError('SIGNING_OUT', 'This account is signing out.');
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
      await this.purchaseFlights.get(id)?.catch(() => {});
      await this.purchaseCheckFlights.get(id)?.work.catch(() => {});
      this.invalidate(id);
      await Promise.allSettled(
        [initializing, this.flights.get(id), this.identityFlights.get(id)].filter(
          (p): p is Promise<any> => !!p,
        ),
      );
      let oldSession: Session | null = null;
      if (old) {
        try {
          oldSession = await vault.read(id);
        } catch (reason) {
          if (safeError(reason).code !== 'VAULT_CORRUPT') throw reason;
        }
      }
      try {
        await this.persistSession(session);
        await this.repository.saveAccount(session.account);
      } catch (error) {
        if (oldSession) await vault.write(oldSession);
        else if (!old) await vault.remove(id);

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
    this.quotes.delete(id);
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.clients.get(id)?.dispose();
    this.clients.delete(id);
    this.scopes.delete(id);
    this.rejectedSessions.delete(id);
    this.clientFlights.delete(id);
  }
  async client(id: string): Promise<RiotClient> {
    if (this.signingOut.has(id)) throw new AppError('SIGNING_OUT', 'This account is signing out.');
    if (this.linkingAccounts.has(id))
      throw new AppError(
        'SESSION_LINKING',
        'This account is being reconnected. Refresh after sign-in completes.',
      );
    const existing = this.clients.get(id);
    if (existing?.isActive()) return existing;

    await existing?.settleRejection();
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
        const failure = session.renewalFailure;
        if (failure && failure.retryAt > this.now()) {
          const loginRequired = [
            'REAUTH_REQUIRED',
            'REAUTH_UNAVAILABLE',
            'REAUTH_COOKIE',
            'REAUTH_ACCOUNT_MISMATCH',
            'ACCOUNT_MISMATCH',
          ].includes(failure.code);
          throw new AppError(
            loginRequired ? 'REAUTH_REQUIRED' : 'RENEWAL_WAIT',
            loginRequired
              ? 'Riot requires this account to sign in again. Its saved game data and chats are still present.'
              : 'Session renewal is waiting after a temporary failure. Your saved session is still present.',
            failure.retryAt,
          );
        }
        const pendingUsable =
          session.renewalPending &&
          !session.accessRejected &&
          session.account.expiresAt > this.now() + 30000;
        if (!pendingUsable && !session.reauth?.cookies?.ssid)
          throw new AppError(
            'SESSION_EXPIRED',
            'This account has no reusable Riot cookie saved. Reconnect it once using Riot sign-in; do not remove the account.',
          );
        const report = (code: string) =>
          recordRequest({
            at: this.now(),
            service: 'Session renewal',
            method: 'STATE',
            code,
            durationMs: 0,
          });
        report(pendingUsable ? 'RESUME_PENDING_EXCHANGE' : 'START');
        try {
          if (!pendingUsable) {
            session = {
              ...session,
              ...(rejected ? { accessRejected: true } : {}),
              renewalFailure: { code: 'RENEWAL_IN_PROGRESS', retryAt: this.now() + 60000 },
            };
            await this.persistSession(session);
            const freshTokens = await reauthenticateWithCookies(
              session.reauth!.cookies,
              { state: randomHex(), nonce: randomHex(), createdAt: Date.now() },
              nativeFetcher,
              async (cookies) => {
                if (generation !== (this.generations.get(id) ?? 0))
                  throw new AppError(
                    'SESSION_REMOVED',
                    'The account changed during cookie renewal.',
                  );
                session = checkpointCookies(session!, cookies, this.now());
                await this.persistSession(session);
                report('COOKIE_ROTATION_CHECKPOINTED');
              },
            );
            if (generation !== (this.generations.get(id) ?? 0))
              throw new AppError('SESSION_REMOVED', 'This account changed during renewal.');
            session = stageSessionRenewal(session, freshTokens, this.now());
            await this.persistSession(session);
            report('ROTATION_SAVED');
          }
          if (generation !== (this.generations.get(id) ?? 0))
            throw new AppError(
              'SESSION_REMOVED',
              'This account changed before renewal verification.',
            );
          const refreshed = await connectAccount(
            this.http,
            {
              accessToken: session.accessToken,
              expiresAt: session.account.expiresAt,
              reauthCookies: session.reauth?.cookies,
            },
            session.account.region,
          );
          if (refreshed.account.puuid !== id)
            throw new AppError(
              'ACCOUNT_MISMATCH',
              'Silent renewal returned another account. Reconnect this account.',
            );
          refreshed.account.addedAt = session.account.addedAt;
          if (generation !== (this.generations.get(id) ?? 0))
            throw new AppError(
              'SESSION_REMOVED',
              'Session renewal was discarded after an account change.',
            );
          await this.persistSession(refreshed);
          session = refreshed;
          this.rejectedSessions.delete(id);
          await this.repository.saveAccount(refreshed.account);
          report('RENEWED_AND_SAVED');
        } catch (reason) {
          const error = safeError(reason);
          if (generation === (this.generations.get(id) ?? 0)) {
            const retryAt = Math.max(this.now() + 60000, error.retryAt ?? 0);
            await this.persistSession({
              ...session,
              ...(error.status === 401 ? { accessRejected: true, renewalPending: false } : {}),
              renewalFailure: { code: error.code, retryAt },
            }).catch(() => {});
            report(error.code);
            throw new AppError(error.code, error.message, retryAt, error.status);
          }
          throw error;
        }
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
      const client = new RiotClient(
        session,
        this.http,
        this.publicClient,
        this.catalog,
        scope,
        async () => {
          if (generation !== (this.generations.get(id) ?? 0)) return;
          this.rejectedSessions.add(id);
          const saved = await vault.read(id);
          if (
            !saved ||
            saved.accessToken !== session!.accessToken ||
            generation !== (this.generations.get(id) ?? 0)
          )
            return;
          await this.persistSession({ ...saved, accessRejected: true });
          recordRequest({
            at: this.now(),
            service: 'Session renewal',
            method: 'STATE',
            code: 'REJECTED_TOKEN_SAVED',
            durationMs: 0,
          });
        },
      );
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
      const report = (code: string) =>
        recordRequest({
          at: this.now(),
          service: 'Account refresh',
          method: 'SYNC',
          code,
          durationMs: Math.max(0, this.now() - now),
        });
      if (reason === 'auto' && previous && nextAt > now) {
        report(
          hasUnloadedSections(previous)
            ? 'INITIAL_LOAD_COOLDOWN'
            : previous.store.status === 'ready' && !previous.refreshIssue
              ? 'CACHED_UNTIL_RESET'
              : 'REFRESH_RETRY_WAIT',
        );
        return waitingSnapshot(id, previous, nextAt, now);
      }
      if ((gate?.notBefore ?? 0) > now || (reason === 'auto' && (gate?.autoNotBefore ?? 0) > now)) {
        report('REQUEST_COOLDOWN');
        if (reason === 'manual')
          throw new AppError(
            'LOCAL_COOLDOWN',
            'Please wait before refreshing again.',
            gate!.notBefore,
          );
        return waitingSnapshot(id, previous, nextAt, now);
      }

      const reservation: RefreshGateState = {
        attemptedAt: now,
        notBefore: now + MANUAL_COOLDOWN_MS,
        autoNotBefore: now + 5 * 60000,
        failures: gate?.failures ?? 0,
      };
      await this.repository.saveRefreshGate(id, 'sync', reservation);
      report(
        hasUnloadedSections(previous)
          ? 'INITIAL_LOAD_STARTED'
          : reason === 'manual'
            ? 'MANUAL_REFRESH_STARTED'
            : 'ROTATION_REFRESH_STARTED',
      );
      let next: Snapshot;
      try {
        await this.loadCatalog(reason === 'manual');
        const client = await this.client(id);
        next = await client.snapshot(previous, snapshotPlan(previous, reason, this.now()));
      } catch (reason) {
        const e = safeError(reason);
        if (generation !== (this.generations.get(id) ?? 0)) throw e;
        report('LOAD_FAILED_' + e.code);
        next = failedSnapshot(
          id,
          previous,
          { code: e.code, message: e.message, retryAt: e.retryAt },
          now,
        );
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
      const failed =
        !!storeError || !!next.refreshIssue || needsSessionRecovery(next) || resetStillPending;
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
      if (next.store.status === 'ready') {
        const enriched = rememberBundles(this.catalog, next.store.data.bundles);
        if (enriched !== this.catalog) {
          this.catalog = enriched;
          await this.repository.saveCatalog(enriched);
        }
      }
      if (!failed && next.store.status === 'ready') {
        try {
          const preferences = await this.repository.settings();
          if (preferences.reminders || preferences.wishlistAlerts)
            await updateStoreNotifications(
              account,
              next.store.data,
              await this.repository.wishlist(id),
              this.repository,
            );
        } catch {
          report('NOTIFICATION_SETUP_FAILED');
        }
      }
      report(failed ? 'LOAD_RETRY_SCHEDULED' : 'ACCOUNT_DATA_READY');
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
  private equipmentFlights = new Map<
    string,
    Promise<Section<import('../core/matchTypes').LiveEquipment>>
  >();
  async liveEquipment(
    id: string,
    matchId: string,
  ): Promise<Section<import('../core/matchTypes').LiveEquipment>> {
    uuid(id);
    uuid(matchId);
    const flight = this.equipmentFlights.get(id);
    if (flight)
      return flight.then((result) =>
        result.status === 'ready' && result.data.matchId !== matchId
          ? {
              status: 'error' as const,
              code: 'MATCH_CHANGED',
              message: 'Open the current match again.',
            }
          : result,
      );
    const generation = this.generations.get(id) ?? 0;
    const run = async (): Promise<Section<import('../core/matchTypes').LiveEquipment>> => {
      const game = await this.live(id);
      if (game.status !== 'ready') return game;
      if (game.data.matchId !== matchId || !game.data.players?.some((p) => p.subject === id))
        return {
          status: 'error',
          code: 'MATCH_SCOPE',
          message: 'Open your current match to view skins.',
        };
      const gate = await this.repository.refreshGate(id, 'equipment'),
        now = this.now();
      if ((gate?.notBefore ?? 0) > now)
        return gate?.matchId === matchId && gate.equipment
          ? gate.equipment
          : {
              status: 'error',
              code: 'LOCAL_COOLDOWN',
              message: 'Match skins can be checked once a minute.',
              retryAt: gate!.notBefore,
            };
      await this.repository.saveRefreshGate(id, 'equipment', {
        attemptedAt: now,
        notBefore: now + 60000,
        failures: gate?.failures ?? 0,
        matchId,
      });
      let result: Section<import('../core/matchTypes').LiveEquipment>;
      try {
        await this.loadCatalog().catch(() => {});
        if (generation !== (this.generations.get(id) ?? 0))
          throw new AppError('SESSION_REMOVED', 'The account changed.');
        result = {
          status: 'ready',
          data: await (await this.client(id)).liveEquipment(matchId),
          fetchedAt: this.now(),
        };
      } catch (reason) {
        const e = safeError(reason);
        result = { status: 'error', code: e.code, message: e.message, retryAt: e.retryAt };
      }
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('SESSION_REMOVED', 'The account changed.');
      const failed = result.status === 'error',
        failures = failed ? (gate?.failures ?? 0) + 1 : 0;
      const notBefore = Math.max(
        this.now() + (failed ? failureDelay(failures) : 60000),
        result.status === 'error' ? (result.retryAt ?? 0) : 0,
      );
      if (result.status === 'error') result = { ...result, retryAt: notBefore };
      await this.repository.saveRefreshGate(id, 'equipment', {
        attemptedAt: now,
        notBefore,
        failures,
        matchId,
        equipment: result,
      });
      return result;
    };
    const work = run();
    this.equipmentFlights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.equipmentFlights.get(id) === work) this.equipmentFlights.delete(id);
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
  async saveBuddy(
    id: string,
    weaponId: string,
    buddy: import('../core/buddies').BuddyChoice | null,
    expectedVersion?: number,
    guard?: () => void,
  ): Promise<Loadout> {
    if (this.identityFlights.has(id))
      throw new AppError('LOADOUT_BUSY', 'Wait for the current equipment change.');
    const generation = this.generations.get(id) ?? 0;
    const run = async () => {
      await this.loadCatalog();
      const data = await (
        await this.client(id)
      ).saveBuddy(weaponId, buddy, expectedVersion, () => {
        guard?.();
        if (generation !== (this.generations.get(id) ?? 0))
          throw new AppError('ACCOUNT_CHANGED', 'The account changed before applying.');
      });
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('ACCOUNT_CHANGED', 'The account changed.');
      const saved = await this.repository.snapshot(id);
      if (saved)
        await this.repository.saveSnapshot({
          ...saved,
          loadout: { status: 'ready', data, fetchedAt: this.now() },
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
  async refreshMedia(): Promise<Catalog> {
    const partial = buildCatalog({ weapons: await this.publicClient.weaponSkins() });
    this.catalog = {
      ...mergeCatalog(this.catalog, partial),
      schemaVersion: this.catalog.schemaVersion,
      fetchedAt: this.catalog.fetchedAt,
      failedPaths: this.catalog.failedPaths,
    };
    for (const client of this.clients.values()) client.updateCatalog(this.catalog);
    await this.repository.saveCatalog(this.catalog);
    return this.catalog;
  }
  async loadoutEditor(id: string) {
    await this.loadCatalog();
    return (await this.client(id)).loadoutEditor();
  }
  async applyPreset(id: string, preset: LoadoutPreset): Promise<Loadout> {
    validatePreset(preset, id);
    if (this.identityFlights.has(id))
      throw new AppError('LOADOUT_BUSY', 'An equipment update is already running.');
    const generation = this.generations.get(id) ?? 0;
    const run = async () => {
      await this.loadCatalog();
      const data = await (await this.client(id)).applyPreset(preset);
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('ACCOUNT_CHANGED', 'The account changed.');
      const snapshot = await this.repository.snapshot(id);
      if (snapshot)
        await this.repository.saveSnapshot({
          ...snapshot,
          loadout: { status: 'ready', data, fetchedAt: this.now() },
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
  private pendingFor(records: PurchaseRecord[], itemId: string, canonicalId?: string) {
    return records.filter((r) =>
      unresolvedForItem(
        { ...r, canonicalItemId: r.canonicalItemId ?? this.catalog.items[r.itemId]?.canonicalId },
        itemId,
        canonicalId,
      ),
    );
  }
  async purchaseQuote(id: string, itemId: string): Promise<PurchaseQuote> {
    if (!(await this.repository.settings()).allowPurchases)
      throw new AppError('PURCHASE_DISABLED', 'Enable phone purchases in Settings first.');
    if (this.purchaseFlights.has(id) || this.purchaseCheckFlights.has(id))
      throw new AppError(
        'PURCHASE_BUSY',
        'Wait for this account’s purchase or ownership check to finish.',
      );
    if ((this.quoteTimes.get(id) ?? 0) > this.now())
      throw new AppError(
        'LOCAL_COOLDOWN',
        'Wait a moment before reviewing another purchase.',
        this.quoteTimes.get(id),
      );
    this.quoteTimes.set(id, this.now() + 15000);
    this.quotes.delete(id);
    const generation = this.generations.get(id) ?? 0;
    const records = await this.repository.purchaseRecords(id);
    const retryAt = Math.max(0, ...records.map((r) => r.retryAt ?? 0));
    if (retryAt > this.now())
      throw new AppError(
        'RATE_LIMIT',
        'Riot asked this account to wait before another purchase request.',
        retryAt,
      );
    const client = await this.client(id);
    const [store, wallet, owned] = await Promise.all([
      client.store(true),
      client.wallet(true),
      client.ownedIds(ITEM_TYPES.skin),
    ]);
    const quote = quotePurchase(store, wallet, itemId, id, randomId(), this.now());
    const pending = this.pendingFor(records, quote.offer.item.id, quote.offer.item.canonicalId);
    if (ownsOffer(owned, quote.offer)) {
      for (const old of pending)
        await this.repository.savePurchaseRecord({
          ...old,
          state: 'complete',
          ownershipVerified: true,
          lastCheckedAt: this.now(),
          message: 'Ownership is confirmed. Riot provides the original transaction details.',
        });
      throw new AppError(
        'ALREADY_OWNED',
        'This skin is already owned. Its saved purchase record has been reconciled.',
      );
    }
    for (const old of pending) {
      if (old.phase === 'prepared')
        await this.repository.savePurchaseRecord({
          ...old,
          state: 'not-submitted',
          message:
            'Preparation was interrupted before network dispatch. No purchase request was sent.',
        });
      else
        throw new AppError(
          'ORDER_PENDING',
          'An earlier purchase of this skin is unconfirmed. Check it in Purchase history before buying the same skin again. Other daily skins are not blocked.',
        );
    }
    if (generation !== (this.generations.get(id) ?? 0))
      throw new AppError('ACCOUNT_CHANGED', 'The account changed while reviewing this offer.');
    this.quotes.set(id, quote);
    return JSON.parse(JSON.stringify(quote)) as PurchaseQuote;
  }
  async confirmPurchase(
    id: string,
    quoteId: string,
    assertSelected: () => void = () => {},
  ): Promise<PurchaseRecord> {
    if (this.purchaseFlights.has(id) || this.purchaseCheckFlights.has(id))
      throw new AppError(
        'PURCHASE_BUSY',
        'This account already has a purchase or ownership check in progress.',
      );
    const quote = this.quotes.get(id);
    if (!quote || quote.id !== quoteId)
      throw new AppError('PURCHASE_CONFIRMATION', 'Review a fresh quote before confirming.');
    this.quotes.delete(id);
    validatePurchaseQuote(quote, quote, this.now());
    assertSelected();
    const generation = this.generations.get(id) ?? 0;
    const guard = () => {
      assertSelected();
      validatePurchaseQuote(quote, quote, this.now());
      if (generation !== (this.generations.get(id) ?? 0) || this.linkingAccounts.has(id))
        throw new AppError('ACCOUNT_CHANGED', 'The account changed before purchase submission.');
    };
    const run = async (): Promise<PurchaseRecord> => {
      guard();
      if (!(await this.repository.settings()).allowPurchases)
        throw new AppError('PURCHASE_DISABLED', 'Phone purchases are disabled.');
      if (
        this.pendingFor(
          await this.repository.purchaseRecords(id),
          quote.offer.item.id,
          quote.offer.item.canonicalId,
        ).length
      )
        throw new AppError(
          'ORDER_PENDING',
          'Check the previous purchase of this skin before continuing.',
        );
      const client = await this.client(id);
      const [store, wallet, owned] = await Promise.all([
        client.store(true),
        client.wallet(true),
        client.ownedIds(ITEM_TYPES.skin),
      ]);
      validatePurchaseQuote(
        quote,
        quotePurchase(store, wallet, quote.offer.item.id, id, quote.id, this.now()),
        this.now(),
      );
      if (ownsOffer(owned, quote.offer))
        throw new AppError('ALREADY_OWNED', 'This skin is already owned.');
      guard();
      let record: PurchaseRecord = {
        id: quote.id,
        accountId: id,
        offerId: quote.offer.id,
        itemId: quote.offer.item.id,
        canonicalItemId: quote.offer.item.canonicalId,
        name: quote.offer.item.name,
        price: quote.price,
        at: this.now(),
        state: 'submitting',
        protocol: 'direct-v2',
        phase: 'prepared',
        balanceBefore: wallet.find((m) => m.currencyId === CURRENCIES.VP)?.amount,
      };
      await this.repository.savePurchaseRecord(record);
      let dispatched = false;
      try {
        const result = await client.purchaseOffer(record.offerId, record.price, async () => {
          guard();
          if (!(await this.repository.settings()).allowPurchases)
            throw new AppError(
              'PURCHASE_DISABLED',
              'Phone purchases were disabled before submission.',
            );
          record = { ...record, phase: 'dispatching' };
          await this.repository.savePurchaseRecord(record);
          guard();
          dispatched = true;
        });
        record = {
          ...record,
          ...result,
          phase: 'verification',
          message:
            result.state === 'failed'
              ? 'Riot rejected the purchase. Review the saved code before trying a new quote.'
              : 'Request accepted; checking whether the skin was delivered.',
        };
      } catch (reason) {
        const error = safeError(reason);
        const rejected =
          dispatched && [400, 401, 403, 404, 405, 410, 422, 429].includes(error.status ?? 0);
        record = {
          ...record,
          state: !dispatched ? 'not-submitted' : rejected ? 'failed' : 'unknown',
          errorCode: error.code,
          httpStatus: error.status,
          retryAt: error.retryAt,
          message: !dispatched
            ? `No purchase request was sent. ${error.message}`
            : rejected
              ? error.message
              : 'The purchase result is uncertain. Check ownership; do not repeat the same purchase.',
        };
      }

      try {
        await this.repository.savePurchaseRecord(record);
      } catch {
        throw new AppError(
          'PURCHASE_SAVE',
          'The purchase may have been submitted but its receipt could not be saved. Do not retry. Check Purchase history and the official client.',
        );
      }
      if (dispatched && !['failed', 'not-submitted'].includes(record.state)) {
        record = await this.reconcileOwnership(record, client);
        await this.repository.savePurchaseRecord(record);
      }
      return record;
    };
    const work = run();
    this.purchaseFlights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.purchaseFlights.get(id) === work) this.purchaseFlights.delete(id);
    }
  }
  private async reconcileOwnership(
    record: PurchaseRecord,
    client: RiotClient,
  ): Promise<PurchaseRecord> {
    const [owned, wallet] = await Promise.allSettled([
      client.ownedIds(ITEM_TYPES.skin),
      client.wallet(true),
    ]);
    const item = catalogItem(this.catalog, record.itemId, 'skin');
    const failures = [owned, wallet].flatMap((result) =>
      result.status === 'rejected' ? [safeError(result.reason)] : [],
    );
    const retryAt = Math.max(record.retryAt ?? 0, ...failures.map((error) => error.retryAt ?? 0));
    const delivered =
      owned.status === 'fulfilled' &&
      [
        record.itemId,
        record.canonicalItemId,
        item.canonicalId,
        ...(item.levels ?? []).map((l) => l.id),
      ].some((id) => id && owned.value.has(id));
    const next: PurchaseRecord = {
      ...record,
      lastCheckedAt: this.now(),
      ...(retryAt > this.now() ? { retryAt } : {}),
      ...(failures.length ? { errorCode: failures[0]!.code } : {}),
      ...(wallet.status === 'fulfilled'
        ? { balanceAfter: wallet.value.find((m) => m.currencyId === CURRENCIES.VP)?.amount }
        : {}),
      ...(delivered
        ? {
            state: 'complete',
            ownershipVerified: true,
            errorCode: undefined,
            message:
              'Skin ownership is confirmed. The wallet and cached collection have been updated where available.',
          }
        : {
            message:
              record.state === 'failed'
                ? record.message
                : 'Ownership is not confirmed yet. Check again after one minute; this never resends the purchase.',
          }),
    };
    try {
      const cached = await this.repository.snapshot(record.accountId);
      if (cached)
        await this.repository.saveSnapshot({
          ...cached,
          ...(wallet.status === 'fulfilled'
            ? { wallet: { status: 'ready', data: wallet.value, fetchedAt: this.now() } }
            : {}),
          ...(delivered && cached.collection.status === 'ready'
            ? {
                collection: {
                  status: 'ready',
                  data: [
                    ...new Map(
                      [...cached.collection.data, item].map((i) => [i.canonicalId, i]),
                    ).values(),
                  ],
                  fetchedAt: this.now(),
                },
              }
            : {}),
        });
    } catch {}
    return next;
  }
  async checkPurchase(id: string, recordId: string): Promise<PurchaseRecord> {
    if (this.purchaseFlights.has(id))
      throw new AppError(
        'PURCHASE_BUSY',
        'Wait for this account’s purchase to finish before checking its outcome.',
      );
    const current = this.purchaseCheckFlights.get(id);
    if (current) {
      if (current.recordId === recordId) return current.work;
      throw new AppError(
        'PURCHASE_BUSY',
        'One ownership check is already running for this account.',
      );
    }
    const work = this.checkPurchaseOnce(id, recordId);
    this.purchaseCheckFlights.set(id, { recordId, work });
    try {
      return await work;
    } finally {
      if (this.purchaseCheckFlights.get(id)?.work === work) this.purchaseCheckFlights.delete(id);
    }
  }
  private async checkPurchaseOnce(id: string, recordId: string): Promise<PurchaseRecord> {
    const record = (await this.repository.purchaseRecords(id)).find((r) => r.id === recordId);
    if (!record) throw new AppError('ORDER_SCOPE', 'This order does not belong to this account.');
    if ((record.retryAt ?? 0) > this.now())
      throw new AppError(
        'RATE_LIMIT',
        'Riot asked this account to wait before checking again.',
        record.retryAt,
      );
    const key = 'notice.' + id + '.ordercheck.' + recordId;
    const last = Math.max(
      Number(await this.repository.notificationStamp(key)) || 0,
      record.lastCheckedAt ?? 0,
    );
    if (last + 60000 > this.now())
      throw new AppError(
        'LOCAL_COOLDOWN',
        'Order status can be checked once per minute.',
        last + 60000,
      );
    await this.repository.setNotificationStamp(key, String(this.now()));
    if (record.phase === 'prepared') {
      const next: PurchaseRecord = {
        ...record,
        state: 'not-submitted',
        message: 'The app stopped before dispatch. No purchase request was sent.',
        lastCheckedAt: this.now(),
      };
      await this.repository.savePurchaseRecord(next);
      return next;
    }
    if (['complete', 'failed', 'not-submitted'].includes(record.state)) return record;
    const client = await this.client(id);
    let next = record;
    if (record.orderId && record.protocol !== 'direct-v2') {
      try {
        next = { ...record, ...(await client.getOrder(record.orderId)), message: undefined };
      } catch (reason) {
        const error = safeError(reason);
        next = {
          ...record,
          errorCode: error.code,
          httpStatus: error.status,
          retryAt: Math.max(record.retryAt ?? 0, error.retryAt ?? 0),
        };
      }
    }
    next = await this.reconcileOwnership(next, client);
    await this.repository.savePurchaseRecord(next);
    return next;
  }
  async signOut(id: string): Promise<void> {
    const existing = this.signoutFlights.get(id);
    if (existing) return existing;
    const work = async () => {
      await this.linkQueue.catch(() => {});
      this.signingOut.add(id);
      try {
        await this.purchaseFlights.get(id)?.catch(() => {});
        const pending = [
          this.clientFlights.get(id),
          this.flights.get(id),
          this.liveFlights.get(id),
          this.identityFlights.get(id),
          this.equipmentFlights.get(id),
        ].filter(Boolean);
        this.invalidate(id);
        await Promise.allSettled(pending);
        const session = await vault.read(id);
        if (!session)
          throw new AppError(
            'LOGOUT_NO_COOKIE',
            'No saved Riot session. Use Remove locally instead.',
          );
        const gateKey = `notice.${id}.logout.notBefore`;
        const due = Number(await this.repository.notificationStamp(gateKey)) || 0;
        if (due > this.now())
          throw new AppError('LOCAL_COOLDOWN', 'Wait before signing out again.', due);
        await this.repository.setNotificationStamp(gateKey, String(this.now() + 60000));
        try {
          await logoutRiotSession(session, nativeFetcher);
        } catch (reason) {
          const error = safeError(reason);
          if (error.retryAt)
            await this.repository.setNotificationStamp(
              gateKey,
              String(Math.max(this.now() + 60000, error.retryAt)),
            );
          throw error;
        }
        await this.remove(id);
      } finally {
        this.signingOut.delete(id);
      }
    };
    const flight = work();
    this.signoutFlights.set(id, flight);
    try {
      await flight;
    } finally {
      if (this.signoutFlights.get(id) === flight) this.signoutFlights.delete(id);
    }
  }
  async remove(id: string): Promise<void> {
    await this.linkQueue.catch(() => {});
    await this.purchaseFlights.get(id)?.catch(() => {});
    await this.purchaseCheckFlights.get(id)?.work.catch(() => {});
    this.quotes.delete(id);
    const initializing = this.clientFlights.get(id);
    this.invalidate(id);
    await initializing?.catch(() => {});
    await this.liveFlights.get(id)?.catch(() => {});
    await this.equipmentFlights.get(id)?.catch(() => {});

    await this.flights.get(id)?.catch(() => {});
    await this.identityFlights.get(id)?.catch(() => {});
    await cancelAccountNotifications(id);
    await removeChatStorage(id);
    await vault.remove(id);
    await this.repository.removeAccount(id);
  }
  async clearCache(): Promise<void> {
    await Promise.allSettled([
      ...this.purchaseFlights.values(),
      ...[...this.purchaseCheckFlights.values()].map((check) => check.work),
    ]);
    const pending = [
      ...this.flights.values(),
      ...this.clientFlights.values(),
      ...this.identityFlights.values(),
      ...this.liveFlights.values(),
      ...this.equipmentFlights.values(),
    ];
    for (const id of new Set([
      ...this.clients.keys(),
      ...this.clientFlights.keys(),
      ...this.flights.keys(),
      ...this.identityFlights.keys(),
      ...this.liveFlights.keys(),
      ...this.equipmentFlights.keys(),
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

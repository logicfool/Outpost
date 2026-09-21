import { refreshDeadline } from '../core/refreshPolicy';
import { mergeSnapshot } from '../core/snapshot';
import { livePollInterval, PROFILE_POLL_MS, completedLiveTransition } from '../core/refreshPolicy';
import { CredentialQueue } from '../core/credentialQueue';
import { PreferenceSession } from '../core/preferenceSession';
import { AimService, type AimConsent } from '../core/aimService';
import type { AimEdit, AimState } from '../core/aimTypes';
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
  quoteBundlePurchase,
  bundleOwnedQuantity,
  validateBundleLines,
  type BundleOwnership,
} from '../core/bundlePurchase';
import {
  quotePurchase,
  validatePurchaseQuote,
  ownsOffer,
  unresolvedForItem,
  type PurchaseQuote,
  type PurchaseRecord,
} from '../core/purchases';
import { CURRENCIES } from '../core/normalize';
import { catalogItem, CATALOG_SCHEMA_VERSION } from '../core/catalog';
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
import { vault, preferencesVault, randomHex, randomId } from './secure';
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
  private aimService?: AimService;
  private credentialQueue = new CredentialQueue();
  private preferenceSession?: PreferenceSession;
  private aim() {
    return (this.aimService ??= new AimService(
      this.repository,
      (id) => this.preferenceClient(id),
      this.now,
      randomId,
    ));
  }
  private async preferenceClient(id: string): Promise<import('../core/aimService').AimApi> {
    const guard = this.aimGuard(id);
    guard();
    await this.client(id);
    guard();
    const scoped = await this.credentialQueue.run(id, async () => {
      guard();
      const auth = (this.preferenceSession ??= new PreferenceSession(
        vault,
        preferencesVault,
        {
          read: (key) => this.repository.refreshGate(key, 'aimAuth'),
          save: (key, value) => this.repository.saveRefreshGate(key, 'aimAuth', value),
        },
        this.http,
        nativeFetcher,
        () => ({ state: randomHex(), nonce: randomHex(), createdAt: Date.now() }),
        Platform.OS === 'android' ? 'expo-android' : 'fetch-standard',
        this.now,
      ));
      return auth.get(id, guard);
    });
    guard();
    const client = new RiotClient(scoped, this.http, this.publicClient, this.catalog);
    const request = async <T>(work: () => Promise<T>): Promise<T> => {
      guard();
      try {
        const value = await work();
        guard();
        return value;
      } catch (error) {
        if (safeError(error).status === 401)
          await this.credentialQueue
            .run(id, async () => {
              guard();
              const saved = await preferencesVault.read(id);
              guard();
              if (saved?.accessToken === scoped.accessToken)
                await preferencesVault.write({ ...saved, accessRejected: true });
            })
            .catch(() =>
              recordRequest({
                at: this.now(),
                service: 'Aim authorization',
                method: 'STATE',
                code: 'AIM_REJECTION_CHECKPOINT_FAILED',
                durationMs: 0,
              }),
            );
        throw error;
      }
    };
    return {
      readAimDocument: () => request(() => client.readAimDocument()),
      writeAimDocument: (data, selection) =>
        request(() =>
          client.writeAimDocument(data, () => {
            guard();
            selection();
          }),
        ),
    };
  }
  private aimGuard(id: string, selection?: () => void) {
    const generation = this.generations.get(id) ?? 0;
    return () => {
      selection?.();
      if (
        generation !== (this.generations.get(id) ?? 0) ||
        this.signingOut.has(id) ||
        this.linkingAccounts.has(id)
      )
        throw new AppError('ACCOUNT_CHANGED', 'The account changed during the settings operation.');
    };
  }
  syncAim(
    id: string,
    reason: 'auto' | 'manual' = 'manual',
    selection?: () => void,
  ): Promise<AimState> {
    return this.aim().sync(uuid(id), reason, this.aimGuard(id, selection));
  }
  applyAim(
    id: string,
    edit: AimEdit,
    consent: AimConsent,
    selection: () => void,
  ): Promise<AimState> {
    return this.aim().apply(uuid(id), edit, consent, this.aimGuard(id, selection));
  }
  acceptAimServerState(id: string, selection: () => void): Promise<AimState> {
    return this.aim().acceptServerState(uuid(id), this.aimGuard(id, selection));
  }
  async markAimLogin(id: string): Promise<void> {
    await this.aim().markLogin(uuid(id));
  }
  async loadCatalog(force = false, allowNetwork = true): Promise<Catalog> {
    if (!allowNetwork && Object.keys(this.catalog.items).length) return this.catalog;
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
          (!force &&
            cached.schemaVersion === CATALOG_SCHEMA_VERSION &&
            cached.fetchedAt + ttl > this.now()))
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
      await this.credentialQueue.drain(id);
      await preferencesVault?.remove(id).catch(() =>
        recordRequest({
          at: this.now(),
          service: 'Aim authorization',
          method: 'LOCAL',
          code: 'AIM_CACHE_CLEAR_FAILED',
          durationMs: 0,
        }),
      );
      await this.aimService?.drain(id);
      await this.purchaseFlights.get(id)?.catch(() => {});
      await this.purchaseCheckFlights.get(id)?.work.catch(() => {});
      this.invalidate(id);
      await Promise.allSettled(
        [
          initializing,
          this.flights.get(id),
          this.identityFlights.get(id),
          this.profileFlights.get(id),
          this.liveFlights.get(id),
          ...[...this.archivedReportFlights]
            .filter(([key]) => key.startsWith(id + ':'))
            .map(([, work]) => work),
        ].filter((p): p is Promise<any> => !!p),
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
    const work = this.credentialQueue.run(id, async () => {
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('SESSION_REMOVED', 'The account changed.');
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
              Platform.OS === 'android' ? 'expo-android' : 'fetch-standard',
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
        () =>
          this.credentialQueue.run(id, async () => {
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
          }),
      );
      this.clients.set(id, client);
      return client;
    });
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
        const hasMetadata = Object.keys(this.catalog.items).length > 0;
        if (!hasMetadata) await this.loadCatalog();
        const client = await this.client(id);
        next = await client.snapshot(previous, snapshotPlan(previous, reason, this.now()));
        if (next.matches.status === 'ready' && !next.matches.warning)
          await this.repository.saveArchivedMatches?.(id, id, next.matches.data);
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
      const profileKeys = ['rank', 'xp', 'loadout', 'progression', 'matches'] as const;
      if (
        profileKeys.some((key) => {
          const current = next[key],
            prior = previous?.[key];
          return (
            current.status === 'ready' &&
            (prior?.status !== 'ready' || current.fetchedAt !== prior.fetchedAt)
          );
        })
      ) {
        const profileGate = await this.repository.refreshGate(id, 'profile');
        await this.repository.saveRefreshGate(id, 'profile', {
          ...profileGate,
          attemptedAt: now,
          notBefore: Math.max(profileGate?.notBefore ?? 0, this.now() + PROFILE_POLL_MS, retryAt),
          failures: profileGate?.failures ?? 0,
        });
      }

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
  private profileFlights = new Map<string, Promise<Snapshot | null>>();
  async profile(id: string, reason: 'auto' | 'manual' = 'auto'): Promise<Snapshot | null> {
    id = uuid(id);
    const flight = this.profileFlights.get(id);
    if (flight) {
      const result = await flight;
      if (result || reason === 'auto') return result;
      return this.profile(id, reason);
    }
    const generation = this.generations.get(id) ?? 0;
    const guard = () => {
      if (
        generation !== (this.generations.get(id) ?? 0) ||
        this.signingOut.has(id) ||
        this.linkingAccounts.has(id)
      )
        throw new AppError('ACCOUNT_CHANGED', 'The selected account changed.');
    };
    const run = async () => {
      await this.flights.get(id);
      guard();
      const gate = await this.repository.refreshGate(id, 'profile');
      guard();
      const now = this.now(),
        deadline = refreshDeadline(gate, reason);
      if (deadline > now) {
        recordRequest({
          at: now,
          service: 'Profile refresh',
          method: 'SYNC',
          code: gate?.failures ? 'PROFILE_BACKOFF_WAIT' : 'PROFILE_RECENT_RESULT',
          durationMs: 0,
        });
        if (reason === 'manual') {
          const cached = await this.repository.snapshot(id);
          guard();
          return cached ? { ...cached, profileNextCheckAt: deadline } : null;
        }
        return null;
      }
      const previous = await this.repository.snapshot(id);
      guard();
      if (!previous) return null;
      const reservation = {
        ...gate,
        attemptedAt: now,
        notBefore: now + PROFILE_POLL_MS,
        failures: gate?.failures ?? 0,
      };
      await this.repository.saveRefreshGate(id, 'profile', reservation);
      guard();
      let next: Snapshot;
      try {
        next = await (
          await this.client(id)
        ).snapshot(previous, {
          store: false,
          account: true,
          collection: false,
          live: false,
          fresh: true,
        });
      } catch (reason) {
        const e = safeError(reason);
        next = {
          ...previous,
          profileIssue: { code: e.code, message: e.message, retryAt: e.retryAt },
        };
      }
      guard();
      if (next.matches.status === 'ready' && !next.matches.warning)
        await this.repository.saveArchivedMatches(id, id, next.matches.data);
      guard();
      const errors = ['rank', 'xp', 'progression', 'loadout', 'matches']
        .map((key) => next[key as keyof Snapshot] as Section<unknown>)
        .map((s) => (s.status === 'error' ? s : s.warning))
        .filter(Boolean);
      const issue = errors[0] ?? next.profileIssue,
        failures = issue ? (gate?.failures ?? 0) + 1 : 0;
      const notBefore = Math.max(
        this.now() + (issue ? failureDelay(failures, PROFILE_POLL_MS) : PROFILE_POLL_MS),
        ...errors.map((e) => e?.retryAt ?? 0),
        next.profileIssue?.retryAt ?? 0,
      );
      next.profileNextCheckAt = notBefore;
      next.profileIssue = issue
        ? { code: issue.code, message: issue.message, retryAt: notBefore }
        : undefined;
      const latest = await this.repository.snapshot(id);
      guard();
      const merged = mergeSnapshot(latest, next);
      merged.store = latest?.store ?? previous.store;
      merged.wallet = latest?.wallet ?? previous.wallet;
      merged.collection = latest?.collection ?? previous.collection;
      merged.liveGame = latest?.liveGame ?? previous.liveGame;
      merged.nextAutoRefreshAt = latest?.nextAutoRefreshAt ?? previous.nextAutoRefreshAt;
      merged.refreshIssue = latest?.refreshIssue;
      await this.repository.saveSnapshot(merged);
      guard();
      const postMatchFound =
        gate?.postMatchId &&
        merged.matches.status === 'ready' &&
        merged.matches.data.some((m) => m.id === gate.postMatchId);
      await this.repository.saveRefreshGate(id, 'profile', {
        ...reservation,
        notBefore,
        failures,
        postMatchId: postMatchFound ? undefined : gate?.postMatchId,
        postMatchAttempts: postMatchFound
          ? undefined
          : gate?.postMatchId
            ? (gate.postMatchAttempts ?? 0) + 1
            : undefined,
        lastMatchId: merged.liveGame.status === 'ready' ? merged.liveGame.data.matchId : undefined,
        lastState: merged.liveGame.status === 'ready' ? merged.liveGame.data.state : undefined,
      });
      if (postMatchFound)
        recordRequest({
          at: this.now(),
          service: 'Profile refresh',
          method: 'SYNC',
          code: 'POST_MATCH_SYNCED',
          durationMs: 0,
        });
      recordRequest({
        at: this.now(),
        service: 'Profile refresh',
        method: 'SYNC',
        code: issue ? 'PROFILE_RETRY' : 'PROFILE_UPDATED',
        durationMs: this.now() - now,
      });
      return this.repository.snapshot(id);
    };
    const work = run();
    this.profileFlights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.profileFlights.get(id) === work) this.profileFlights.delete(id);
    }
  }
  private archivedReportFlights = new Map<string, Promise<import('../core/types').MatchDetail>>();
  async matchReport(
    id: string,
    matchId: string,
    subject = id,
  ): Promise<import('../core/types').MatchDetail> {
    id = uuid(id);
    subject = uuid(subject);
    matchId = uuid(matchId);
    const key = `${id}:${subject}:${matchId}`;
    const flight = this.archivedReportFlights.get(key);
    if (flight) return flight;
    const generation = this.generations.get(id) ?? 0;
    const guard = () => {
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('ACCOUNT_CHANGED', 'The account changed while opening its archive.');
    };
    const run = async () => {
      const saved = await this.repository.archivedReport(id, subject, matchId);
      guard();
      if (saved && (saved.completed || this.now() - saved.savedAt < 60000)) {
        if (!saved.imported && (await this.repository.archivedMatchTrusted(id, subject, matchId))) {
          const account = (await this.repository.accounts()).find((a) => a.puuid === id);
          guard();
          if (account) {
            const scope =
              this.scopes.get(id) ?? new PlayerScope(id, account.gameName, account.tagLine);
            for (const p of saved.detail.players) scope.remember(p);
            this.scopes.set(id, scope);
          }
        }
        return saved.detail;
      }
      const client = await this.client(id);
      guard();
      if (await this.repository.archivedMatchTrusted(id, subject, matchId)) {
        client.scope.player(subject);
        client.scope.allowMatch(subject, matchId);
      }
      const detail = await client.matchDetail(matchId, subject, !!saved && !saved.completed);
      guard();
      if (detail.id !== matchId) throw new AppError('MATCH_SCOPE', 'Riot returned another match.');
      await this.repository.saveArchivedReport(id, subject, {
        subject,
        savedAt: this.now(),
        completed: detail.completed === true,
        detail,
      });
      guard();
      return detail;
    };
    const work = run();
    this.archivedReportFlights.set(key, work);
    try {
      return await work;
    } finally {
      if (this.archivedReportFlights.get(key) === work) this.archivedReportFlights.delete(key);
    }
  }
  private historyFlights = new Map<string, Promise<import('../core/types').MatchSummary[]>>();
  async historyPage(
    id: string,
    subject: string,
    start: number,
    count = 40,
  ): Promise<import('../core/types').MatchSummary[]> {
    id = uuid(id);
    subject = uuid(subject);
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 100
    )
      throw new AppError('PAGINATION', 'Invalid history page.');
    const key = `${id}:${subject}`,
      flight = this.historyFlights.get(key);
    if (flight) {
      await flight;
      return this.repository.archivedMatches(id, subject, start, count);
    }
    const generation = this.generations.get(id) ?? 0;
    const guard = () => {
      if (
        generation !== (this.generations.get(id) ?? 0) ||
        this.signingOut.has(id) ||
        this.linkingAccounts.has(id)
      )
        throw new AppError('ACCOUNT_CHANGED', 'The account changed while loading history.');
    };
    const run = async () => {
      guard();
      const cached = await this.repository.archivedMatches(id, subject, start, count);
      guard();
      if (cached.length === count) return cached;
      const purpose = `history:${subject}` as const,
        gate = await this.repository.refreshGate(id, purpose);
      guard();
      const head = (await this.repository.archivedMatches(id, subject, 0, 1))[0]?.id;
      const sameHead = gate?.historyHeadId === head;
      if (sameHead && gate?.historyExhausted) return cached;
      if ((gate?.notBefore ?? 0) > this.now()) {
        if (cached.length) return cached;
        throw new AppError(
          'LOCAL_COOLDOWN',
          'Wait before loading another history page.',
          gate!.notBefore,
        );
      }
      let cursor = sameHead ? (gate?.nextIndex ?? 0) : 0;
      const reservation = {
        attemptedAt: this.now(),
        notBefore: this.now() + 60000,
        failures: gate?.failures ?? 0,
        nextIndex: cursor,
        historyHeadId: head,
      };
      await this.repository.saveRefreshGate(id, purpose, reservation);
      guard();
      const client = await this.client(id);
      guard();
      let exhausted = false,
        rows = cached;
      try {
        for (let page = 0; page < 2 && rows.length < count && cursor < 1000; page++) {
          const incoming = await client.matchHistory(cursor, 20, subject);
          guard();
          await this.repository.saveArchivedMatches(id, subject, incoming);
          guard();
          cursor += incoming.length;
          exhausted = incoming.length < 20 || cursor >= 1000;
          rows = await this.repository.archivedMatches(id, subject, start, count);
          guard();
          if (exhausted) break;
        }
        const latestHead = (await this.repository.archivedMatches(id, subject, 0, 1))[0]?.id;
        guard();
        await this.repository.saveRefreshGate(id, purpose, {
          ...reservation,
          failures: 0,
          nextIndex: cursor,
          historyHeadId: latestHead,
          historyExhausted: exhausted,
        });
        if (!rows.length && !exhausted)
          throw new AppError(
            'HISTORY_CONTINUE',
            'Already saved pages were checked. Load older matches again after the cooldown to continue.',
            reservation.notBefore,
          );
        return rows;
      } catch (reason) {
        guard();
        const e = safeError(reason);
        if (e.code !== 'HISTORY_CONTINUE')
          await this.repository.saveRefreshGate(id, purpose, {
            ...reservation,
            nextIndex: cursor,
            notBefore: Math.max(this.now() + 60000, e.retryAt ?? 0),
            failures: (gate?.failures ?? 0) + 1,
          });
        throw e;
      }
    };
    const work = run();
    this.historyFlights.set(key, work);
    try {
      return await work;
    } finally {
      if (this.historyFlights.get(key) === work) this.historyFlights.delete(key);
    }
  }

  async live(id: string, reason: 'auto' | 'manual' = 'auto'): Promise<Section<LiveGame>> {
    id = uuid(id);
    const flight = this.liveFlights.get(id);
    if (flight) {
      const result = await flight;
      if (
        reason === 'auto' ||
        result.status !== 'ready' ||
        this.now() - (result.data.observedAt ?? 0) < 5000
      )
        return result;
      return this.live(id, reason);
    }
    const generation = this.generations.get(id) ?? 0;
    const run = async (): Promise<Section<LiveGame>> => {
      const gate = await this.repository.refreshGate(id, 'live');
      const now = this.now();
      const deadline =
        gate?.failures === 0 && gate.sample?.status === 'ready'
          ? Math.min(
              refreshDeadline(gate, reason),
              gate.attemptedAt + livePollInterval(gate.sample.data),
            )
          : refreshDeadline(gate, reason);
      if (deadline > now)
        return gate?.sample?.status === 'ready'
          ? { ...gate.sample, data: { ...gate.sample.data, nextCheckAt: deadline } }
          : (gate?.sample ?? {
              status: 'error',
              code: 'LOCAL_COOLDOWN',
              message: 'The next live check is scheduled.',
              retryAt: gate!.notBefore,
            });
      await this.repository.saveRefreshGate(id, 'live', {
        attemptedAt: now,
        notBefore:
          now + livePollInterval(gate?.sample?.status === 'ready' ? gate.sample.data : undefined),
        failures: gate?.failures ?? 0,
        sample: gate?.sample,
      });
      let sample: Section<LiveGame>;
      try {
        sample = {
          status: 'ready',
          data: await (await this.client(id)).liveGame(true),
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
      if (
        sample.status === 'ready' &&
        sample.data.state === 'in_game' &&
        gate?.sample?.status === 'ready'
      ) {
        const previous = gate.sample.data;
        const changed = previous.matchId !== sample.data.matchId || previous.state !== 'in_game';
        const cutoff = changed ? previous.observedAt : previous.presenceNotBefore;
        if (cutoff) sample = { ...sample, data: { ...sample.data, presenceNotBefore: cutoff } };
      }
      const error = sample.status === 'error' ? sample : sample.data.detailError;
      const failures = error ? (gate?.failures ?? 0) + 1 : 0;
      const notBefore = Math.max(
        error
          ? this.now() + failureDelay(failures)
          : now + livePollInterval(sample.status === 'ready' ? sample.data : undefined),
        this.now() + 1000,
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
      const ended = completedLiveTransition(gate?.sample, sample);
      if (ended) {
        const profileGate = await this.repository.refreshGate(id, 'profile');
        await this.repository.saveRefreshGate(id, 'profile', {
          attemptedAt: profileGate?.attemptedAt ?? 0,
          notBefore: profileGate?.notBefore ?? 0,
          failures: profileGate?.failures ?? 0,
          ...profileGate,
          postMatchId: ended,
          postMatchAttempts: 0,
        });
        recordRequest({
          at: this.now(),
          service: 'Profile refresh',
          method: 'SYNC',
          code: 'POST_MATCH_QUEUED',
          durationMs: 0,
        });
      }

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
  async party(id: string, fresh = false): Promise<Section<import('../core/partyTypes').Party>> {
    id = uuid(id);
    const generation = this.generations.get(id) ?? 0;
    try {
      await this.loadCatalog().catch(() => {});
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('SESSION_REMOVED', 'The account changed.');
      const data = await (await this.client(id)).party(fresh);
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('SESSION_REMOVED', 'The account changed.');
      return { status: 'ready', data, fetchedAt: this.now() };
    } catch (reason) {
      const e = safeError(reason);
      return { status: 'error', code: e.code, message: e.message, retryAt: e.retryAt };
    }
  }

  async partyCommand(
    id: string,
    run: (client: RiotClient) => Promise<import('../core/partyTypes').Party>,
  ): Promise<import('../core/partyTypes').Party> {
    id = uuid(id);
    if (this.partyFlights.has(id))
      throw new AppError('PARTY_BUSY', 'Wait for the current party change to finish.');
    const generation = this.generations.get(id) ?? 0;
    const work = (async () => {
      const data = await run(await this.client(id));
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('ACCOUNT_CHANGED', 'The account changed before this finished.');
      return data;
    })();
    this.partyFlights.set(id, work);
    try {
      return await work;
    } finally {
      if (this.partyFlights.get(id) === work) this.partyFlights.delete(id);
    }
  }
  private partyFlights = new Map<string, Promise<import('../core/partyTypes').Party>>();
  async sprayEditor(id: string) {
    await this.loadCatalog();
    return (await this.client(uuid(id))).sprayEditor();
  }
  async saveSprays(
    id: string,
    edits: import('../core/sprays').SprayEdit[],
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
      ).saveSprays(edits, expectedVersion, () => {
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
  private async bundleOwnership(
    client: RiotClient,
    lines: import('../core/types').BundleLine[],
    strict = true,
  ) {
    validateBundleLines(lines);
    const types = [...new Set(lines.map((l) => l.itemTypeId))];
    const results = await Promise.allSettled(types.map((type) => client.ownedQuantities(type))),
      owned: BundleOwnership = new Map(),
      errors: ReturnType<typeof safeError>[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') owned.set(types[index]!, result.value);
      else errors.push(safeError(result.reason));
    });
    if (strict && errors.length) throw errors[0];
    return { owned, errors };
  }
  private async reconcileBundle(
    record: PurchaseRecord,
    client: RiotClient,
  ): Promise<PurchaseRecord> {
    const bundle = record.bundle!;
    const [inventory, wallet] = await Promise.all([
      this.bundleOwnership(client, bundle.lines, false),
      client
        .wallet(true)
        .then((data) => ({ data, error: undefined }))
        .catch((reason) => ({ data: undefined, error: safeError(reason) })),
    ]);
    const delivered = bundle.lines
      .filter(
        (l) =>
          inventory.owned.has(l.itemTypeId) &&
          bundleOwnedQuantity(l, inventory.owned, this.catalog) >= l.quantity,
      )
      .map((l) => l.itemId);
    const complete = delivered.length === bundle.lines.length,
      errors = [...inventory.errors, ...(wallet.error ? [wallet.error] : [])];
    const retryAt = Math.max(record.retryAt ?? 0, ...errors.map((e) => e.retryAt ?? 0));
    const next: PurchaseRecord = {
      ...record,
      bundle: { ...bundle, delivered },
      lastCheckedAt: this.now(),
      state: complete ? 'complete' : 'unknown',
      ownershipVerified: complete,
      ...(retryAt > this.now() ? { retryAt } : {}),
      ...(wallet.data
        ? { balanceAfter: wallet.data.find((m) => m.currencyId === CURRENCIES.VP)?.amount }
        : {}),
      errorCode: complete ? undefined : (errors[0]?.code ?? record.errorCode),
      message: complete
        ? 'All bundle items are owned. Check Riot for billing details.'
        : `${delivered.length} / ${bundle.lines.length} items confirmed. Check again later; this purchase will not be resent.`,
    };
    try {
      const cached = await this.repository.snapshot(record.accountId);
      if (cached) {
        const additions = bundle.lines
          .filter((l) => delivered.includes(l.itemId))
          .map((l) => catalogItem(this.catalog, l.itemId));
        await this.repository.saveSnapshot({
          ...cached,
          ...(wallet.data
            ? { wallet: { status: 'ready' as const, data: wallet.data, fetchedAt: this.now() } }
            : {}),
          ...(additions.length && cached.collection.status === 'ready'
            ? {
                collection: {
                  status: 'ready' as const,
                  data: [
                    ...new Map(
                      [...cached.collection.data, ...additions].map((i) => [
                        i.kind + ':' + (i.kind === 'skin' ? i.canonicalId : i.id),
                        i,
                      ]),
                    ).values(),
                  ],
                  fetchedAt: this.now(),
                },
              }
            : {}),
        });
      }
    } catch {}
    return next;
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
  async purchaseQuote(
    id: string,
    itemId: string,
    kind: 'skin' | 'bundle' = 'skin',
  ): Promise<PurchaseQuote> {
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
    if (kind === 'bundle') {
      const [store, wallet] = await Promise.all([client.store(true), client.wallet(true)]);
      const bundle = store.bundles.find((b) => b.id === itemId || b.catalogId === itemId);
      if (!bundle?.checkout)
        throw new AppError(
          'BUNDLE_OFFERS',
          'Riot did not return complete bundle purchase offers. Buy this bundle in VALORANT.',
        );
      const { owned } = await this.bundleOwnership(client, bundle.checkout.lines);
      const quote = quoteBundlePurchase(
        store,
        wallet,
        itemId,
        id,
        randomId(),
        owned,
        this.catalog,
        this.now(),
      );
      const pending = [
        ...new Map(
          quote
            .bundle!.lines.flatMap((l) => this.pendingFor(records, l.itemId, l.canonicalItemId))
            .map((r) => [r.id, r]),
        ).values(),
      ];
      for (const old of pending) {
        if (old.phase === 'prepared')
          await this.repository.savePurchaseRecord({
            ...old,
            state: 'not-submitted',
            message: 'Preparation stopped before dispatch.',
          });
        else
          throw new AppError(
            'ORDER_PENDING',
            'A purchase containing these items is unconfirmed. Check Purchase history first.',
          );
      }
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('ACCOUNT_CHANGED', 'The account changed while reviewing this bundle.');
      this.quotes.set(id, quote);
      return JSON.parse(JSON.stringify(quote)) as PurchaseQuote;
    }
    const [store, wallet, owned] = await Promise.all([
      client.store(true),
      client.wallet(true),
      client.ownedIds(ITEM_TYPES.skin),
    ]);
    const quote = quotePurchase(store, wallet, itemId, id, randomId(), this.now());
    const pending = this.pendingFor(records, quote.offer.item.id, quote.offer.item.canonicalId);
    if (ownsOffer(owned, quote.offer)) {
      for (const old of pending)
        if (!old.bundle)
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
      const records = await this.repository.purchaseRecords(id);
      const pending = quote.bundle
        ? quote.bundle.lines.flatMap((l) => this.pendingFor(records, l.itemId, l.canonicalItemId))
        : this.pendingFor(records, quote.offer.item.id, quote.offer.item.canonicalId);
      if (pending.length)
        throw new AppError(
          'ORDER_PENDING',
          'Check the previous purchase containing this item before continuing.',
        );
      const client = await this.client(id);
      const [store, wallet, owned] = await Promise.all([
        client.store(true),
        client.wallet(true),
        quote.bundle ? Promise.resolve(new Set<string>()) : client.ownedIds(ITEM_TYPES.skin),
      ]);
      if (quote.bundle) {
        const bundle = store.bundles.find((b) => b.id === quote.bundle!.id);
        if (!bundle?.checkout)
          throw new AppError(
            'BUNDLE_OFFERS',
            'This bundle is no longer available for phone checkout.',
          );
        const inventory = await this.bundleOwnership(client, bundle.checkout.lines);
        validatePurchaseQuote(
          quote,
          quoteBundlePurchase(
            store,
            wallet,
            quote.bundle.id,
            id,
            quote.id,
            inventory.owned,
            this.catalog,
            this.now(),
          ),
          this.now(),
        );
      } else {
        validatePurchaseQuote(
          quote,
          quotePurchase(store, wallet, quote.offer.item.id, id, quote.id, this.now()),
          this.now(),
        );
        if (ownsOffer(owned, quote.offer))
          throw new AppError('ALREADY_OWNED', 'This skin is already owned.');
      }
      guard();
      let record: PurchaseRecord = {
        id: quote.id,
        accountId: id,
        offerId: quote.offer.id,
        itemId: quote.offer.item.id,
        canonicalItemId: quote.offer.item.canonicalId,
        ...(quote.bundle ? { bundle: { id: quote.bundle.id, lines: quote.bundle.lines } } : {}),
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
        const submit = quote.bundle
          ? (before: () => Promise<void>) =>
              client.purchaseBundle(quote.bundle!.lines, record.price, before)
          : (before: () => Promise<void>) =>
              client.purchaseOffer(record.offerId, record.price, before);
        const result = await submit(async () => {
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
              : record.bundle
                ? 'Request acknowledged; checking each bundle item.'
                : 'Request accepted; checking whether the skin was delivered.',
        };
      } catch (reason) {
        const error = safeError(reason);
        const rejected =
          dispatched &&
          !quote.bundle &&
          [400, 401, 403, 404, 405, 410, 422, 429].includes(error.status ?? 0);
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
    if (record.bundle) return this.reconcileBundle(record, client);
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
        await this.credentialQueue.drain(id);
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
    await this.profileFlights.get(id)?.catch(() => {});
    await Promise.allSettled(
      [...this.historyFlights].filter(([key]) => key.startsWith(id + ':')).map(([, work]) => work),
    );
    await Promise.allSettled(
      [...this.archivedReportFlights.entries()]
        .filter(([key]) => key.startsWith(id + ':'))
        .map(([, value]) => value),
    );
    await this.aimService?.drain(id);
    await this.credentialQueue.drain(id);
    await preferencesVault?.remove(id);
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
      ...this.historyFlights.values(),
      ...this.profileFlights.values(),
      ...this.archivedReportFlights.values(),
      ...this.flights.values(),
      ...this.clientFlights.values(),
      ...this.identityFlights.values(),
      ...this.liveFlights.values(),
      ...this.equipmentFlights.values(),
    ];
    for (const id of new Set([
      ...[...this.historyFlights.keys()].map((key) => key.split(':')[0]!),
      ...this.profileFlights.keys(),
      ...[...this.archivedReportFlights.keys()].map((key) => key.split(':')[0]!),
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

import {
  stageSessionRenewal,
  sessionCheckpointMatches,
  sessionHealth,
} from '../core/sessionRenewal';
import { recordRequest } from '../core/diagnostics';
import type { Session } from '../core/types';
import {
  quotePurchase,
  validatePurchaseQuote,
  type PurchaseQuote,
  type PurchaseRecord,
} from '../core/purchases';
import { validatePreset, type LoadoutPreset } from '../core/presets';
import { ITEM_TYPES } from '../core/normalize';
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
import { vault, randomHex, randomId } from './secure';
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
  private purchaseFlights = new Map<string, Promise<PurchaseRecord>>();
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
          (!force && cached.schemaVersion === 6 && cached.fetchedAt + ttl > this.now()))
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
          session.renewalPending && session.account.expiresAt > this.now() + 30000;
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
        next.store.status === 'ready' &&
        ((await this.repository.settings()).reminders ||
          (await this.repository.settings()).wishlistAlerts)
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
  async purchaseQuote(id: string, itemId: string): Promise<PurchaseQuote> {
    if ((this.quoteTimes.get(id) ?? 0) > this.now())
      throw new AppError(
        'LOCAL_COOLDOWN',
        'Wait a moment before requesting another purchase quote.',
      );
    this.quoteTimes.set(id, this.now() + 15000);
    const unresolved = (await this.repository.purchaseRecords(id)).some((r) =>
      ['submitting', 'accepted', 'unknown'].includes(r.state),
    );
    if (unresolved)
      throw new AppError(
        'ORDER_PENDING',
        'A previous purchase is unconfirmed. Check its status before another purchase.',
      );
    const client = await this.client(id);
    const [store, wallet, owned] = await Promise.all([
      client.store(true),
      client.wallet(true),
      client.ownedIds(ITEM_TYPES.skin),
    ]);
    const quote = quotePurchase(store, wallet, itemId, id, randomId(), this.now());
    if (
      owned.has(quote.offer.item.id) ||
      owned.has(quote.offer.id) ||
      quote.offer.item.levels?.some((l) => owned.has(l.id))
    )
      throw new AppError('ALREADY_OWNED', 'This skin is already in your collection.');
    this.quotes.set(id, quote);
    return JSON.parse(JSON.stringify(quote)) as PurchaseQuote;
  }
  async confirmPurchase(id: string, quoteId: string): Promise<PurchaseRecord> {
    if (this.purchaseFlights.has(id))
      throw new AppError('PURCHASE_BUSY', 'This account already has a purchase in progress.');
    if (!(await this.repository.settings()).allowPurchases)
      throw new AppError('PURCHASE_DISABLED', 'Phone purchases are disabled.');
    const quote = this.quotes.get(id);
    this.quotes.delete(id);
    if (!quote || quote.id !== quoteId)
      throw new AppError('PURCHASE_CONFIRMATION', 'Review a fresh quote before confirming.');
    if (this.now() >= quote.expiresAt)
      throw new AppError(
        'PURCHASE_EXPIRED',
        'This confirmation has expired. Review the current offer again.',
      );
    const generation = this.generations.get(id) ?? 0;
    const run = async () => {
      if (
        (await this.repository.purchaseRecords(id)).some((r) =>
          ['submitting', 'accepted', 'unknown'].includes(r.state),
        )
      )
        throw new AppError('ORDER_PENDING', 'Check the previous purchase before continuing.');
      const client = await this.client(id);
      const [store, wallet, owned] = await Promise.all([
        client.store(true),
        client.wallet(true),
        client.ownedIds(ITEM_TYPES.skin),
      ]);
      const fresh = quotePurchase(store, wallet, quote.offer.item.id, id, quote.id, this.now());
      validatePurchaseQuote(quote, fresh, this.now());
      if (quote.offer.item.levels?.some((l) => owned.has(l.id)) || owned.has(quote.offer.item.id))
        throw new AppError('ALREADY_OWNED', 'This skin is already owned.');
      if (generation !== (this.generations.get(id) ?? 0))
        throw new AppError('ACCOUNT_CHANGED', 'The account changed before confirmation.');
      let record: PurchaseRecord = {
        id: quote.id,
        accountId: id,
        offerId: quote.offer.id,
        itemId: quote.offer.item.id,
        name: quote.offer.item.name,
        price: quote.price,
        at: this.now(),
        state: 'submitting',
      };
      await this.repository.savePurchaseRecord(record);
      try {
        if (generation !== (this.generations.get(id) ?? 0))
          throw new AppError('ACCOUNT_CHANGED', 'The account changed before submission.');
        if (!(await this.repository.settings()).allowPurchases)
          throw new AppError(
            'PURCHASE_DISABLED',
            'Phone purchases were disabled before submission.',
          );
        const result = await client.createOrder(record.id, record.offerId);
        record = { ...record, ...result };
      } catch (reason) {
        const e = safeError(reason),
          rejected =
            [400, 401, 403, 404, 405, 409, 410, 422, 429].includes(e.status ?? 0) ||
            ['ACCOUNT_CHANGED', 'PURCHASE_DISABLED'].includes(e.code);
        record = {
          ...record,
          state: rejected ? 'failed' : 'unknown',
          message: rejected
            ? `Riot rejected the request (${e.code}). No automatic retry was made.`
            : 'The purchase outcome is unconfirmed. Do not retry; check Riot or order status.',
        };
      }
      await this.repository.savePurchaseRecord(record);
      const cached = await this.repository.snapshot(id);
      if (cached)
        try {
          await this.repository.saveSnapshot({
            ...cached,
            wallet: { status: 'ready', data: await client.wallet(true), fetchedAt: this.now() },
          });
        } catch {}
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
  async checkPurchase(id: string, recordId: string): Promise<PurchaseRecord> {
    const record = (await this.repository.purchaseRecords(id)).find((r) => r.id === recordId);
    if (!record) throw new AppError('ORDER_SCOPE', 'This order does not belong to this account.');
    const key = 'notice.' + id + '.ordercheck.' + recordId,
      last = Number(await this.repository.notificationStamp(key));
    if (last + 60000 > this.now())
      throw new AppError('LOCAL_COOLDOWN', 'Order status can be checked once per minute.');
    await this.repository.setNotificationStamp(key, String(this.now()));
    const client = await this.client(id);
    let next = record;
    if (record.orderId)
      next = { ...record, ...(await client.getOrder(record.orderId)), message: undefined };
    else if ((await client.ownedIds(ITEM_TYPES.skin)).has(record.itemId))
      next = {
        ...record,
        state: 'complete',
        message: 'Ownership is now confirmed. Check Riot for the original transaction details.',
      };
    await this.repository.savePurchaseRecord(next);
    return next;
  }
  async remove(id: string): Promise<void> {
    await this.linkQueue.catch(() => {});
    await this.purchaseFlights.get(id)?.catch(() => {});
    this.quotes.delete(id);
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

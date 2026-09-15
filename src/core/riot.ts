import {
  weaponChoices,
  preparePreset,
  verifyPreset,
  type LoadoutPreset,
  type LoadoutEditor,
} from './presets';
import { orderResult } from './purchases';
import { submitConfirmedOffer } from './purchaseRequest';
import { ownedItemIds } from './ownership';
import { assertCookieSubject, cleanSessionCookies } from './sessionCookies';
import { DAY_MS, FULL_SNAPSHOT, keepCached, type SnapshotPlan } from './refreshPolicy';
import { parseChatBootstrap } from './chatBootstrap';
import { prepareIdentityEdit, verifyIdentity } from './identity';
import { PlayerScope } from './playerScope';
import { hasPlayerName, nameAliases } from './playerNames';
import { glzOrigin, normalizeLive } from './live';
import { catalogWithContent } from './rank';
import type { PlayerRef, PlayerProfile, IdentityEdit } from './playerTypes';
import type {
  Catalog,
  LiveGame,
  LoginTokens,
  MatchDetail,
  MatchSummary,
  Region,
  Section,
  Session,
  Snapshot,
  Store,
  Loadout,
} from './types';
import {
  accountFromUserInfo,
  decodeJwtClaimsUnverified,
  REGIONS,
  sessionActive,
  validateSession,
} from './auth';
import { CatalogClient } from './catalog';
import { HttpClient, SingleFlightCache, type RequestPolicy } from './http';
import {
  AppError,
  array,
  object,
  requiredNumber,
  safeError,
  sameSubject,
  text,
  token,
  uuid,
} from './validation';
import {
  ITEM_TYPES,
  normalizeCollection,
  normalizeLoadout,
  normalizeMatchDetail,
  normalizeMatches,
  normalizeProgression,
  normalizeRank,
  normalizeStore,
  normalizeWallet,
} from './normalize';
const PLATFORM =
  'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';
export async function connectAccount(
  http: HttpClient,
  input: LoginTokens,
  regionOverride?: Region,
): Promise<Session> {
  token(input.accessToken);
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now() + 30000)
    throw new AppError('SESSION_EXPIRED', 'The supplied session has expired.');
  const headers = {
    Authorization: `Bearer ${input.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const [info, entitlements] = await Promise.all([
    http.json('https://auth.riotgames.com/userinfo', { headers }),
    http.json('https://entitlements.auth.riotgames.com/api/token/v1', {
      method: 'POST',
      headers,
      body: '{}',
    }),
  ]);
  const subject = uuid(object(info.data).sub);
  const cookies = cleanSessionCookies(input.reauthCookies);
  assertCookieSubject(cookies, subject);
  if (input.idToken) {
    const idSubject = text(decodeJwtClaimsUnverified(input.idToken).sub);
    if (idSubject && idSubject.toLowerCase() !== subject)
      throw new AppError('ACCOUNT_MISMATCH', 'The login tokens refer to different accounts.');
  }
  let detected: string | undefined;
  if (input.idToken) {
    try {
      const geo = await http.json('https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ id_token: token(input.idToken) }),
      });
      detected = text(object(object(geo.data).affinities).live) || undefined;
    } catch (error) {
      if (!regionOverride)
        throw new AppError(
          'REGION',
          'Riot could not detect the account region. Choose a region and reconnect.',
        );
    }
  }
  const region =
    regionOverride ?? (REGIONS.includes(detected as Region) ? (detected as Region) : undefined);
  if (!region) throw new AppError('REGION', 'Choose the account region to finish linking.');
  const session: Session = {
    version: 2,
    account: accountFromUserInfo(
      info.data,
      region,
      Math.min(input.expiresAt, Date.now() + 3600000),
    ),
    accessToken: input.accessToken,
    entitlementsToken: token(object(entitlements.data).entitlements_token),
    reauth: cookies.ssid ? { cookies, capturedAt: Date.now() } : undefined,
  };

  session.account.canReauth = Boolean(session.reauth?.cookies.ssid);
  return validateSession(session);
}
async function section<T>(loader: () => Promise<T>): Promise<Section<T>> {
  try {
    return { status: 'ready', data: await loader(), fetchedAt: Date.now() };
  } catch (error) {
    const e = safeError(error);
    return { status: 'error', message: e.message, code: e.code, retryAt: e.retryAt };
  }
}
export class RiotClient {
  private cache = new SingleFlightCache();
  private aliases = new Map<string, { name: string; tag: string; until: number }>();
  private loadoutEndpoint: 'v3' | 'v2' = 'v3';
  private storeEndpoint: 'v2' | 'v3' = 'v2';
  private identityWrite: Promise<Loadout> | undefined;
  private disposed = false;
  private sessionRejected = false;
  needsReauth() {
    return this.sessionRejected;
  }
  constructor(
    private session: Session,
    private http: HttpClient,
    private publicClient: CatalogClient,
    private catalog: Catalog,
    readonly scope = new PlayerScope(
      session.account.puuid,
      session.account.gameName,
      session.account.tagLine,
    ),
  ) {
    validateSession(session);
  }
  updateCatalog(catalog: Catalog) {
    this.catalog = catalog;
  }
  isActive() {
    return !this.disposed && !this.sessionRejected && sessionActive(this.session);
  }
  dispose() {
    this.disposed = true;
    this.cache.clear();
  }
  private async read(
    path: string,
    ttlMs = 60000,
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    body?: unknown,
    expectedSubject = this.session.account.puuid,
    host: 'pd' | 'shared' | 'glz' = 'pd',
    policy: RequestPolicy = {},
  ) {
    if (this.disposed) throw new AppError('SESSION_REMOVED', 'The account was disconnected.');
    if (!sessionActive(this.session))
      throw new AppError('SESSION_EXPIRED', 'Your Riot session expired. Reconnect to refresh.');
    if (!path.startsWith('/') || path.includes('..') || path.includes('://') || path.includes('\\'))
      throw new AppError('NETWORK_POLICY', 'The request path is not allowed.');
    const { shard, region } = this.session.account;
    uuid(expectedSubject);
    const origin = host === 'glz' ? glzOrigin(region, shard) : `https://${host}.${shard}.a.pvp.net`;
    const encoded = method === 'GET' ? undefined : JSON.stringify(body ?? {});
    return this.cache.get(`${host}:${method}:${path}:${encoded ?? ''}`, ttlMs, async () => {
      const clientVersion = await this.publicClient.version();
      if (!this.isActive())
        throw new AppError('SESSION_EXPIRED', 'The account session changed. Refresh to retry.');
      const result = await this.http
        .json(
          `${origin}${path}`,
          {
            method,
            ...(encoded !== undefined ? { body: encoded } : {}),
            headers: {
              Authorization: `Bearer ${this.session.accessToken}`,
              'X-Riot-Entitlements-JWT': this.session.entitlementsToken,
              'X-Riot-ClientVersion': clientVersion,
              'X-Riot-ClientPlatform': PLATFORM,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
          policy,
        )
        .catch((error) => {
          if (safeError(error).status === 401) {
            this.sessionRejected = true;
            this.cache.clear();
          }
          throw error;
        });
      if (this.disposed) throw new AppError('SESSION_REMOVED', 'The account was disconnected.');
      sameSubject(object(result.data), expectedSubject);
      return result;
    });
  }
  private async rankCatalog(): Promise<Catalog> {
    try {
      const result = await this.read(
        '/content-service/v3/content',
        10 * 60000,
        'GET',
        undefined,
        this.session.account.puuid,
        'shared',
      );
      return catalogWithContent(this.catalog, result.data);
    } catch (error) {
      const e = safeError(error);
      if (e.status === 401 || e.status === 403 || e.code === 'SESSION_REMOVED') throw e;
      return this.catalog;
    }
  }
  async rank(subject = this.session.account.puuid) {
    this.scope.player(subject);
    const [result, catalog] = await Promise.all([
      this.read(`/mmr/v1/players/${uuid(subject)}`, 60000, 'GET', undefined, subject),
      this.rankCatalog(),
    ]);
    return normalizeRank(result.data, catalog);
  }
  private async resolveNames<T extends PlayerRef>(players: T[]): Promise<T[]> {
    const self = this.session.account;
    const ids = [
      ...new Set(
        players
          .filter(
            (p) =>
              !p.hidden &&
              p.subject !== self.puuid &&
              (this.aliases.get(p.subject)?.until ?? 0) < Date.now(),
          )
          .map((p) => uuid(p.subject)),
      ),
    ].slice(0, 20);
    if (ids.length)
      try {
        const response = await this.read('/name-service/v2/players', 5 * 60000, 'PUT', ids);
        for (const [id, alias] of nameAliases(response.data, ids)) {
          if (this.aliases.size >= 1500) this.aliases.delete(this.aliases.keys().next().value!);
          this.aliases.set(id, { ...alias, until: Date.now() + 10 * 60000 });
        }
      } catch {}
    return players.map((player) => {
      if (player.subject === self.puuid)
        return { ...player, name: self.gameName, tag: self.tagLine };
      if (player.hidden) return { ...player, name: 'Hidden player', tag: '' };
      const alias = this.aliases.get(player.subject);
      return alias
        ? { ...player, name: alias.name, tag: alias.tag }
        : { ...player, name: hasPlayerName(player.name) ? player.name : 'Name unavailable' };
    });
  }
  async liveGame(): Promise<LiveGame> {
    return this.cache.get('live-result', 60000, () => this.fetchLiveGame());
  }
  private async fetchLiveGame(): Promise<LiveGame> {
    const id = this.session.account.puuid;
    for (const mode of ['core-game', 'pregame'] as const) {
      let matchId: string;
      try {
        const current = object(
          (await this.read(`/${mode}/v1/players/${id}`, 60000, 'GET', undefined, id, 'glz')).data,
        );
        matchId = uuid(current.MatchID);
      } catch (error) {
        const e = safeError(error);
        if (e.status === 404 || e.code === 'PLAYER_ABSENT') continue;
        throw e;
      }
      const state = mode === 'core-game' ? 'in_game' : 'agent_select';
      try {
        const detail = await this.read(
          `/${mode}/v1/matches/${matchId}`,
          60000,
          'GET',
          undefined,
          id,
          'glz',
        );
        const game = normalizeLive(detail.data, state, matchId, id, this.catalog);
        game.players = await this.resolveNames(game.players ?? []);
        for (const player of game.players) this.scope.remember(player);
        return game;
      } catch (error) {
        const e = safeError(error);
        if (e.code === 'SESSION_REMOVED' || e.code === 'ACCOUNT_MISMATCH') throw e;
        return {
          state,
          matchId,
          observedAt: Date.now(),
          detailError: { code: e.code, message: e.message, retryAt: e.retryAt },
        };
      }
    }
    return { state: 'idle', observedAt: Date.now() };
  }
  async store(fresh = false): Promise<Store> {
    const id = this.session.account.puuid;

    let result,
      endpoint = this.storeEndpoint;
    try {
      result = await this.read(
        `/store/${endpoint}/storefront/${id}`,
        fresh ? 0 : 60000,
        endpoint === 'v3' ? 'POST' : 'GET',
      );
    } catch (error) {
      const e = safeError(error);
      if (endpoint !== 'v2' || (e.status !== 404 && e.status !== 405 && e.status !== 410)) throw e;
      endpoint = 'v3';
      result = await this.read(`/store/v3/storefront/${id}`, fresh ? 0 : 60000, 'POST');
      this.storeEndpoint = 'v3';
    }
    let fallbackPrices: unknown;
    const panel = object(object(result.data).SkinsPanelLayout);
    if (array(panel.SingleItemOffers).length && array(panel.SingleItemStoreOffers).length === 0) {
      try {
        fallbackPrices = (await this.read('/store/v1/offers/', DAY_MS)).data;
      } catch {}
    }
    return normalizeStore(
      result.data,
      this.catalog,
      result.serverTime,
      result.receivedAt,
      endpoint,
      fallbackPrices,
    );
  }
  async matchHistory(
    start = 0,
    count = 20,
    subject = this.session.account.puuid,
  ): Promise<MatchSummary[]> {
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      start > 1000 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 50
    )
      throw new AppError('PAGINATION', 'The requested match range is invalid.');
    this.scope.player(subject);
    const id = uuid(subject),
      query = `startIndex=${start}&endIndex=${start + count}`;
    const [history, updates] = await Promise.all([
      this.read(`/match-history/v1/history/${id}?${query}`, 60000, 'GET', undefined, id),
      this.read(
        `/mmr/v1/players/${id}/competitiveupdates?${query}&queue=competitive`,
        60000,
        'GET',
        undefined,
        id,
      ).catch(() => undefined),
    ]);
    const matches = normalizeMatches(history.data, updates?.data, this.catalog);
    for (const match of matches) this.scope.allowMatch(id, uuid(match.id));
    return matches;
  }
  async matchDetail(id: string, subject = this.session.account.puuid): Promise<MatchDetail> {
    id = uuid(id);
    subject = uuid(subject);
    this.scope.player(subject);
    if (!this.scope.allowsMatch(subject, id)) await this.matchHistory(0, 20, subject);
    if (!this.scope.allowsMatch(subject, id))
      throw new AppError('MATCH_SCOPE', 'Open a match from this player’s loaded history.');
    const raw = await this.read(`/match-details/v1/matches/${id}`, 24 * 60 * 60000);
    const detail = normalizeMatchDetail(
      raw.data,
      subject,
      this.catalog,
      this.session.account.puuid,
    );
    detail.players = await this.resolveNames(detail.players);
    for (const player of detail.players) this.scope.remember(player);
    detail.duels = detail.duels.map((duel) => ({
      ...duel,
      name: detail.players.find((p) => p.subject === duel.subject)?.name ?? duel.name,
    }));
    return detail;
  }
  async chatBootstrap() {
    if (!this.isActive())
      throw new AppError('SESSION_EXPIRED', 'Reconnect your account before opening chat.');
    const headers = {
      Authorization: `Bearer ${this.session.accessToken}`,
      'X-Riot-Entitlements-JWT': this.session.entitlementsToken,
    };
    const [pas, config] = await Promise.all([
      this.http.text('https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat', { headers }),
      this.http.json(
        'https://clientconfig.rpg.riotgames.com/api/v1/config/player?app=Riot%20Client',
        { headers },
      ),
    ]).catch((error) => {
      if (safeError(error).status === 401) {
        this.sessionRejected = true;
        this.cache.clear();
      }
      throw error;
    });
    if (!this.isActive())
      throw new AppError('SESSION_REMOVED', 'The account changed while opening chat.');
    return parseChatBootstrap(this.session, pas.data, config.data);
  }
  async playerProfile(subject: string): Promise<PlayerProfile> {
    subject = uuid(subject);
    const entry = this.scope.player(subject);
    const [rank, matches] = await Promise.all([
      section(() => this.rank(subject)),
      section(() => this.matchHistory(0, 20, subject)),
    ]);
    if (this.disposed) throw new AppError('SESSION_REMOVED', 'The account was disconnected.');
    return {
      player: entry.player,
      rank,
      matches,
      fetchedAt: Date.now(),
      identitySource: entry.source,
    };
  }
  private async rawLoadout() {
    const base = `/personalization/${this.loadoutEndpoint}/players/${this.session.account.puuid}/playerloadout`;
    try {
      return { path: base, raw: (await this.read(base, 0)).data };
    } catch (error) {
      const e = safeError(error);
      if (this.loadoutEndpoint !== 'v3' || ![404, 405, 410].includes(e.status ?? 0)) throw e;
      const path = `/personalization/v2/players/${this.session.account.puuid}/playerloadout`;
      const raw = (await this.read(path, 0)).data;
      normalizeLoadout(raw, this.catalog);
      this.loadoutEndpoint = 'v2';
      return { path, raw };
    }
  }
  async loadout(): Promise<Loadout> {
    const { raw } = await this.rawLoadout();
    return { ...normalizeLoadout(raw, this.catalog), endpoint: this.loadoutEndpoint };
  }
  async saveIdentity(edit: IdentityEdit): Promise<Loadout> {
    if (this.identityWrite)
      throw new AppError('SAVE_IN_PROGRESS', 'Wait for the current identity change to finish.');
    const run = async () => {
      const id = this.session.account.puuid;
      const { path, raw: current } = await this.rawLoadout();
      const owned = async (type: string) => {
        const response = object((await this.read(`/store/v1/entitlements/${id}/${type}`, 0)).data);
        const entries = Array.isArray(response.Entitlements)
          ? response.Entitlements
          : array(response.EntitlementsByTypes).flatMap((g) => array(object(g).Entitlements));
        return new Set(entries.map((e) => text(object(e).ItemID).toLowerCase()));
      };
      const [cards, titles] = await Promise.all([
        edit.cardId ? owned(ITEM_TYPES.card) : new Set<string>(),
        edit.titleId ? owned(ITEM_TYPES.title) : new Set<string>(),
      ]);
      const body = prepareIdentityEdit(current, edit, cards, titles);

      await this.read(path, 0, 'PUT', body);
      const verified = (await this.read(path, 0)).data;
      verifyIdentity(verified, body);
      this.cache.clear();
      return normalizeLoadout(verified, this.catalog);
    };
    const work = run();
    this.identityWrite = work;
    try {
      return await work;
    } finally {
      if (this.identityWrite === work) this.identityWrite = undefined;
    }
  }
  async ownedIds(type: string, fresh = true): Promise<Set<string>> {
    if (!Object.values(ITEM_TYPES).includes(type))
      throw new AppError('ITEM_TYPE', 'Unsupported collection category.');
    const id = this.session.account.puuid,
      raw = object(
        (await this.read(`/store/v1/entitlements/${id}/${type}`, fresh ? 0 : 60000)).data,
      );
    return ownedItemIds(raw, type);
  }
  async wallet(fresh = false) {
    return normalizeWallet(
      (await this.read(`/store/v1/wallet/${this.session.account.puuid}`, fresh ? 0 : 60000)).data,
    );
  }
  async loadoutEditor(): Promise<LoadoutEditor> {
    const [{ raw }, levels, chromas] = await Promise.all([
      this.rawLoadout(),
      this.ownedIds(ITEM_TYPES.skin),
      this.ownedIds(ITEM_TYPES.chroma),
    ]);
    return {
      current: weaponChoices(raw),
      ownedLevels: [...levels],
      ownedChromas: [...chromas],
      version:
        typeof object(raw).Version === 'number' ? (object(raw).Version as number) : undefined,
    };
  }
  async applyPreset(preset: LoadoutPreset): Promise<Loadout> {
    if (this.identityWrite)
      throw new AppError('SAVE_IN_PROGRESS', 'Wait for the current equipment change to finish.');
    const run = async () => {
      const initial = await this.rawLoadout();
      const [levels, chromas] = await Promise.all([
        this.ownedIds(ITEM_TYPES.skin),
        this.ownedIds(ITEM_TYPES.chroma),
      ]);
      const latest = await this.rawLoadout();
      if (
        JSON.stringify(weaponChoices(initial.raw)) !== JSON.stringify(weaponChoices(latest.raw)) ||
        object(initial.raw).Version !== object(latest.raw).Version
      )
        throw new AppError(
          'LOADOUT_CONFLICT',
          'Equipment changed in another client. Review it before applying again.',
        );
      const body = preparePreset(
        latest.raw,
        preset,
        this.session.account.puuid,
        levels,
        chromas,
        this.catalog,
      );
      await this.read(latest.path, 0, 'PUT', body);
      const verified = (await this.read(latest.path, 0)).data;
      verifyPreset(verified, preset.weapons);
      this.cache.clear();
      return normalizeLoadout(verified, this.catalog);
    };
    const work = run();
    this.identityWrite = work;
    try {
      return await work;
    } finally {
      if (this.identityWrite === work) this.identityWrite = undefined;
    }
  }

  async purchaseOffer(offerId: string, price: number, beforeDispatch: () => Promise<void>) {
    const result = await submitConfirmedOffer(
      (path, body, policy) =>
        this.read(path, 0, 'POST', body, this.session.account.puuid, 'pd', policy),
      offerId,
      price,
      async () => {
        if (!this.isActive())
          throw new AppError('SESSION_EXPIRED', 'The selected session expired before submission.');
        await beforeDispatch();
        if (!this.isActive())
          throw new AppError(
            'SESSION_EXPIRED',
            'The selected session changed before network dispatch.',
          );
      },
    );
    this.cache.clear();
    return result;
  }

  async getOrder(orderId: string) {
    return orderResult((await this.read(`/store/v1/order/${uuid(orderId)}`, 0)).data, orderId);
  }
  async snapshot(
    previous?: Snapshot | null,
    plan: SnapshotPlan = FULL_SNAPSHOT,
  ): Promise<Snapshot> {
    const id = this.session.account.puuid;
    if (previous && previous.accountId !== id)
      throw new AppError('ACCOUNT_MISMATCH', 'Cached snapshot belongs to another account.');
    const pick = async <T>(
      enabled: boolean,
      old: Section<T> | undefined,
      loader: () => Promise<T>,
    ): Promise<Section<T>> =>
      enabled
        ? keepCached(old, await section(loader))
        : (old ?? {
            status: 'error',
            code: 'NOT_LOADED',
            message: 'Open this feature or pull down to refresh.',
          });
    const [store, wallet, rank, xp, progression, collection, loadout, liveGame, matches] =
      await Promise.all([
        pick(plan.store, previous?.store, () => this.store(true)),
        pick(plan.store, previous?.wallet, async () =>
          normalizeWallet((await this.read(`/store/v1/wallet/${id}`)).data),
        ),
        pick(plan.account, previous?.rank, () => this.rank()),
        pick(plan.account, previous?.xp, async () => {
          const progress = object(
            object((await this.read(`/account-xp/v1/players/${id}`, 2 * 60000)).data).Progress,
          );
          return {
            level: requiredNumber(progress.Level, 'account level'),
            xp: requiredNumber(progress.XP, 'account XP'),
          };
        }),
        pick(plan.account, previous?.progression, async () =>
          normalizeProgression(
            (await this.read(`/contracts/v1/contracts/${id}`, 2 * 60000)).data,
            this.catalog,
          ),
        ),
        pick(plan.collection, previous?.collection, async () => {
          const groups = await Promise.all(
            Object.values(ITEM_TYPES).map(async (type) => {
              const value = object(
                (await this.read(`/store/v1/entitlements/${id}/${type}`, 5 * 60000)).data,
              );
              if (Array.isArray(value.EntitlementsByTypes)) return value.EntitlementsByTypes;
              if (Array.isArray(value.Entitlements))
                return [{ ItemTypeID: type, Entitlements: value.Entitlements }];
              throw new AppError(
                'SCHEMA',
                'An inventory category is unavailable. The collection is not being reported as complete.',
              );
            }),
          );
          return normalizeCollection({ EntitlementsByTypes: groups.flat() }, this.catalog);
        }),
        pick(plan.account, previous?.loadout, () => this.loadout()),
        pick(plan.live, previous?.liveGame, () => this.liveGame()),
        pick(plan.account, previous?.matches, () => this.matchHistory()),
      ]);
    return {
      accountId: id,
      fetchedAt: Date.now(),
      demo: false,
      store,
      wallet,
      rank,
      xp,
      progression,
      collection,
      loadout,
      liveGame,
      matches,
    };
  }
}

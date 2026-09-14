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
} from './types';
import {
  accountFromUserInfo,
  decodeJwtClaimsUnverified,
  REGIONS,
  sessionActive,
  validateSession,
} from './auth';
import { CatalogClient } from './catalog';
import { HttpClient, SingleFlightCache } from './http';
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
    reauth: input.reauthCookies?.ssid
      ? { cookies: input.reauthCookies, capturedAt: Date.now() }
      : undefined,
  };

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
  private allowedMatches = new Set<string>();
  private disposed = false;
  constructor(
    private session: Session,
    private http: HttpClient,
    private publicClient: CatalogClient,
    private catalog: Catalog,
  ) {
    validateSession(session);
  }
  dispose() {
    this.disposed = true;
    this.cache.clear();
    this.allowedMatches.clear();
  }
  private async read(path: string, ttlMs = 60000, method: 'GET' | 'POST' = 'GET') {
    if (this.disposed) throw new AppError('SESSION_REMOVED', 'The account was disconnected.');
    if (!sessionActive(this.session))
      throw new AppError(
        'SESSION_EXPIRED',
        'Your Riot session expired. Reconnect to refresh account data.',
      );
    if (!path.startsWith('/') || path.includes('..') || path.includes('://') || path.includes('\\'))
      throw new AppError('NETWORK_POLICY', 'The request path is not allowed.');
    const { puuid, shard } = this.session.account;
    uuid(puuid);
    return this.cache.get(`${method}:${path}`, ttlMs, async () => {
      let clientVersion: string;
      try {
        clientVersion = await this.publicClient.version();
      } catch {
        throw new AppError(
          'CLIENT_VERSION',
          'The current VALORANT client version could not be resolved. Retry when the public catalog is available.',
        );
      }
      if (this.disposed || !sessionActive(this.session))
        throw new AppError('SESSION_EXPIRED', 'Reconnect your Riot account before refreshing.');
      const result = await this.http.json(`https://pd.${shard}.a.pvp.net${path}`, {
        method,
        ...(method === 'POST' ? { body: '{}' } : {}),
        headers: {
          Authorization: `Bearer ${this.session.accessToken}`,
          'X-Riot-Entitlements-JWT': this.session.entitlementsToken,
          'X-Riot-ClientVersion': clientVersion,
          'X-Riot-ClientPlatform': PLATFORM,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (this.disposed) throw new AppError('SESSION_REMOVED', 'The account was disconnected.');
      sameSubject(object(result.data), puuid);
      return result;
    });
  }

  private async glzRead(path: string, ttlMs = 30000) {
    if (this.disposed) throw new AppError('SESSION_REMOVED', 'The account was disconnected.');
    if (!sessionActive(this.session))
      throw new AppError(
        'SESSION_EXPIRED',
        'Your Riot session expired. Reconnect to refresh account data.',
      );
    if (!path.startsWith('/') || path.includes('..') || path.includes('://') || path.includes('\\'))
      throw new AppError('NETWORK_POLICY', 'The request path is not allowed.');
    const { region, shard } = this.session.account;
    return this.cache.get(`glz:${path}`, ttlMs, async () => {
      const clientVersion = await this.publicClient.version();
      return this.http.json(`https://glz-${region}-1.${shard}.a.pvp.net${path}`, {
        headers: {
          Authorization: `Bearer ${this.session.accessToken}`,
          'X-Riot-Entitlements-JWT': this.session.entitlementsToken,
          'X-Riot-ClientVersion': clientVersion,
          'X-Riot-ClientPlatform': PLATFORM,
          Accept: 'application/json',
        },
      });
    });
  }
  async liveGame(): Promise<LiveGame> {
    const id = this.session.account.puuid;
    const resolveMap = async (mode: 'core-game' | 'pregame', matchId: string) => {
      try {
        const detail = object((await this.glzRead(`/${mode}/v1/matches/${matchId}`)).data);
        const mapId = text(detail.MapID) || text(detail.MapId);
        const meta = this.catalog.maps[mapId];
        return { map: meta?.name || mapId.split('/').pop() || undefined, mapImage: meta?.image };
      } catch {
        return {};
      }
    };
    try {
      const current = object((await this.glzRead(`/core-game/v1/players/${id}`)).data);
      const matchId = text(current.MatchID);
      if (matchId)
        return { state: 'in_game', matchId, ...(await resolveMap('core-game', matchId)) };
    } catch (error) {
      const e = safeError(error);
      if (e.status && ![404, 400].includes(e.status)) throw e;
    }
    try {
      const pre = object((await this.glzRead(`/pregame/v1/players/${id}`)).data);
      const matchId = text(pre.MatchID);
      if (matchId)
        return { state: 'agent_select', matchId, ...(await resolveMap('pregame', matchId)) };
    } catch (error) {
      const e = safeError(error);
      if (e.status && ![404, 400].includes(e.status)) throw e;
    }
    return { state: 'offline' };
  }
  async store(): Promise<Store> {
    const id = this.session.account.puuid;

    let result,
      endpoint: 'v2' | 'v3' = 'v2';
    try {
      result = await this.read(`/store/v2/storefront/${id}`);
    } catch (error) {
      const e = safeError(error);
      if (e.status !== 404 && e.status !== 405 && e.status !== 410) throw e;
      endpoint = 'v3';
      result = await this.read(`/store/v3/storefront/${id}`, 60000, 'POST');
    }
    let fallbackPrices: unknown;
    const panel = object(object(result.data).SkinsPanelLayout);
    if (array(panel.SingleItemOffers).length && array(panel.SingleItemStoreOffers).length === 0) {
      try {
        fallbackPrices = (await this.read('/store/v1/offers/', 15 * 60000)).data;
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
  async matchHistory(start = 0, count = 20): Promise<MatchSummary[]> {
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      start > 1000 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 50
    )
      throw new AppError('PAGINATION', 'The requested match range is invalid.');
    const id = this.session.account.puuid,
      query = `startIndex=${start}&endIndex=${start + count}`;
    const [history, updates] = await Promise.all([
      this.read(`/match-history/v1/history/${id}?${query}`),
      this.read(`/mmr/v1/players/${id}/competitiveupdates?${query}&queue=competitive`).catch(
        () => undefined,
      ),
    ]);
    const matches = normalizeMatches(history.data, updates?.data, this.catalog);
    for (const match of matches) this.allowedMatches.add(uuid(match.id));
    return matches;
  }
  async matchDetail(id: string): Promise<MatchDetail> {
    uuid(id);
    if (!this.allowedMatches.has(id)) await this.matchHistory();
    if (!this.allowedMatches.has(id))
      throw new AppError(
        'MATCH_SCOPE',
        'Only matches in this account’s loaded history may be opened.',
      );
    return normalizeMatchDetail(
      (await this.read(`/match-details/v1/matches/${id}`, 24 * 60 * 60000)).data,
      this.session.account.puuid,
      this.catalog,
    );
  }
  async snapshot(): Promise<Snapshot> {
    const id = this.session.account.puuid;
    const [store, wallet, rank, xp, progression, collection, loadout, liveGame, matches] =
      await Promise.all([
        section(() => this.store()),
        section(async () => normalizeWallet((await this.read(`/store/v1/wallet/${id}`)).data)),
        section(async () =>
          normalizeRank((await this.read(`/mmr/v1/players/${id}`, 2 * 60000)).data, this.catalog),
        ),
        section(async () => {
          const progress = object(
            object((await this.read(`/account-xp/v1/players/${id}`, 2 * 60000)).data).Progress,
          );
          return {
            level: requiredNumber(progress.Level, 'account level'),
            xp: requiredNumber(progress.XP, 'account XP'),
          };
        }),
        section(async () =>
          normalizeProgression(
            (await this.read(`/contracts/v1/contracts/${id}`, 2 * 60000)).data,
            this.catalog,
          ),
        ),
        section(async () => {
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
        section(async () =>
          normalizeLoadout(
            (await this.read(`/personalization/v2/players/${id}/playerloadout`, 2 * 60000)).data,
            this.catalog,
          ),
        ),
        section(() => this.liveGame()),
        section(() => this.matchHistory()),
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

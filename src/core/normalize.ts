import type {
  ActStat,
  Bundle,
  Catalog,
  CatalogItem,
  HistoryEntry,
  Loadout,
  MatchDetail,
  MatchPlayer,
  MatchSummary,
  Money,
  Progression,
  QueueCareer,
  Ranked,
  RoundOutcome,
  Store,
  StoreOffer,
} from './types';
import {
  AppError,
  array,
  nullableNumber,
  number,
  object,
  requiredArray,
  requiredNumber,
  text,
  timestamp,
} from './validation';
import { catalogItem } from './catalog';
export const CURRENCIES = {
  VP: '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741',
  RP: 'e59aa87c-4cbf-517a-5983-6e81511be9b7',
  KC: '85ca954a-41f2-ce94-9b45-8ca3dd39a00d',
};
export const ITEM_TYPES = {
  skin: 'e7c63390-eda7-46e0-bb7a-a6abdacd2433',
  chroma: '3ad1b2b2-acdb-4524-852f-954a76ddae0a',
  buddy: 'dd3bf334-87f3-40bd-b043-682a57a8dc3a',
  spray: 'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475',
  card: '3f296c07-64c3-494c-923b-fe692a4fa1bd',
  title: 'de7caa6b-adf7-4588-bbd1-143831e786c6',
  agent: '01bb38e1-da47-4e6a-9b3d-945fe4655707',
};
const QUEUES: Record<string, string> = {
  competitive: 'Competitive',
  unrated: 'Unrated',
  swiftplay: 'Swiftplay',
  spikerush: 'Spike Rush',
  deathmatch: 'Deathmatch',
  ggteam: 'Escalation',
  onefa: 'Replication',
  hurm: 'Team Deathmatch',
  premier: 'Premier',
  newmap: 'New Map',
  snowball: 'Snowball Fight',
};
export function queueName(id: string): string {
  return (
    QUEUES[id] ?? (id && id !== 'unknown' ? id.charAt(0).toUpperCase() + id.slice(1) : 'Custom')
  );
}
const resolved = (item: CatalogItem, fallback: string) =>
  item.name.startsWith('Unresolved') ? fallback : item.name;
export function money(raw: unknown): Money[] {
  return Object.entries(object(raw))
    .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)
    .map(([currencyId, amount]) => ({
      currencyId,
      symbol: Object.entries(CURRENCIES).find(([, id]) => id === currencyId)?.[0] ?? 'Currency',
      amount: amount as number,
    }));
}
function offer(raw: unknown, catalog: Catalog, overridePrices?: unknown, id?: string): StoreOffer {
  const o = object(raw),
    rewards = array(o.Rewards).map(object);
  return {
    id: id ?? text(o.OfferID),
    item: catalogItem(catalog, text(rewards[0]?.ItemID, text(o.OfferID))),
    prices: money(overridePrices ?? o.Cost),
  };
}
export function normalizeStore(
  raw: unknown,
  catalog: Catalog,
  serverTime: number,
  receivedAt: number,
  endpoint: 'v2' | 'v3' | 'demo' = 'v2',
  fallbackPrices: unknown = {},
): Store {
  const store = object(raw),
    panel = object(store.SkinsPanelLayout);
  const dailyIds = requiredArray(panel.SingleItemOffers, 'store offers').map((v) => text(v));
  const ttl = requiredNumber(panel.SingleItemOffersRemainingDurationInSeconds, 'store reset');
  const dailyDetails = new Map(
    array(panel.SingleItemStoreOffers).map((o) => [text(object(o).OfferID), o]),
  );
  for (const o of array(object(fallbackPrices).Offers))
    if (!dailyDetails.has(text(object(o).OfferID))) dailyDetails.set(text(object(o).OfferID), o);
  const daily = dailyIds.map((id) =>
    offer(dailyDetails.get(id) ?? { OfferID: id, Rewards: [{ ItemID: id }] }, catalog),
  );
  const featured = object(store.FeaturedBundle);
  const rawBundles = [...array(featured.Bundles), ...(featured.Bundle ? [featured.Bundle] : [])];
  const bundles: Bundle[] = [];
  for (const value of rawBundles) {
    const b = object(value),
      id = text(b.ID);
    if (!id || bundles.some((existing) => existing.id === id)) continue;
    const meta = catalog.bundles[text(b.DataAssetID)] ?? catalog.bundles[id];
    const offers = array(b.ItemOffers).map((rawItem) => {
      const io = object(rawItem);
      return offer(io.Offer, catalog, io.DiscountedCost);
    });
    if (!offers.length)
      for (const value of array(b.Items)) {
        const bi = object(value),
          item = object(bi.Item),
          itemId = text(item.ItemID);
        offers.push({
          id: itemId,
          item: catalogItem(catalog, itemId),
          prices: money({ [text(bi.CurrencyID)]: bi.DiscountedPrice ?? bi.BasePrice }),
        });
      }
    bundles.push({
      id,
      name: meta?.name ?? 'Featured collection',
      image: meta?.image,
      prices: money(b.TotalDiscountedCost ?? b.TotalBaseCost),
      expiresAt:
        serverTime +
        number(b.DurationRemainingInSeconds, number(featured.BundleRemainingDurationInSeconds)) *
          1000,
      offers,
    });
  }
  const bonus = object(store.BonusStore),
    accessory = object(store.AccessoryStore);
  const nightMarket = store.BonusStore
    ? {
        offers: requiredArray(bonus.BonusStoreOffers, 'Night Market').map((raw) => {
          const bo = object(raw),
            base = object(bo.Offer),
            normalized = offer(base, catalog, bo.DiscountCosts, text(bo.BonusOfferID));
          const discount = nullableNumber(bo.DiscountPercent);
          return {
            ...normalized,
            originalPrices: money(base.Cost),
            discountPercent: discount === null ? undefined : Math.max(0, Math.min(100, discount)),
            seen: typeof bo.IsSeen === 'boolean' ? bo.IsSeen : undefined,
          };
        }),
        expiresAt:
          serverTime +
          requiredNumber(bonus.BonusStoreRemainingDurationInSeconds, 'Night Market reset') * 1000,
      }
    : null;
  return {
    daily,
    dailyExpiresAt: serverTime + ttl * 1000,
    bundles,
    nightMarket,
    accessories: array(accessory.AccessoryStoreOffers).map((v) => offer(object(v).Offer, catalog)),
    accessoriesExpireAt:
      typeof accessory.AccessoryStoreRemainingDurationInSeconds === 'number'
        ? serverTime + number(accessory.AccessoryStoreRemainingDurationInSeconds) * 1000
        : undefined,
    fetchedAt: receivedAt,
    clockOffsetMs: serverTime - receivedAt,
    endpoint,
  };
}
export function normalizeWallet(raw: unknown): Money[] {
  const r = object(raw);
  if (!r.Balances || typeof r.Balances !== 'object' || Array.isArray(r.Balances))
    throw new AppError('SCHEMA', 'Wallet balances are unavailable.');
  return money(r.Balances);
}
function tierMeta(catalog: Catalog, tier: number | null) {
  const meta = tier ? catalog.tiers[String(tier)] : undefined;
  return {
    name: meta?.name ?? (tier === null || tier === 0 ? 'Unrated' : `Tier ${tier}`),
    image: meta?.image,
  };
}
export function normalizeRank(raw: unknown, catalog: Catalog, activeSeasonId?: string): Ranked {
  const r = object(raw),
    queues = object(r.QueueSkills);
  if (!r.QueueSkills) throw new AppError('SCHEMA', 'Rank information is unavailable.');
  const seasons = object(object(queues.competitive).SeasonalInfoBySeasonID),
    latest = object(r.LatestCompetitiveUpdate);
  const currentId = activeSeasonId ?? catalog.currentSeasonId;
  const seasonId = currentId ?? (text(latest.SeasonID) || undefined);
  const currentSeason = Boolean(currentId && seasonId === currentId);
  const season = object(seasons[seasonId ?? '']);
  const tier = nullableNumber(season.CompetitiveTier),
    meta = tierMeta(catalog, tier);
  const seasonMeta = catalog.seasons ?? {};
  const career: QueueCareer[] = Object.entries(queues)
    .map(([queue, value]) => {
      const acts: ActStat[] = Object.entries(object(object(value).SeasonalInfoBySeasonID))
        .map(([id, info]) => {
          const s = object(info),
            actTier = nullableNumber(s.CompetitiveTier),
            actMeta = tierMeta(catalog, actTier);
          return {
            seasonId: id,
            name: seasonMeta[id]?.name ?? 'Earlier act',
            startsAt: seasonMeta[id]?.startsAt,
            current: id === currentId,
            tier: actTier,
            tierName: actMeta.name,
            image: actMeta.image,
            rr: nullableNumber(s.RankedRating),
            wins: number(s.NumberOfWinsWithPlacements, number(s.NumberOfWins)),
            games: number(s.NumberOfGames),
          };
        })
        .filter((act) => act.games > 0)
        .sort(
          (a, b) => Number(b.current) - Number(a.current) || (b.startsAt ?? 0) - (a.startsAt ?? 0),
        );
      return {
        queue,
        acts,
        wins: acts.reduce((sum, act) => sum + act.wins, 0),
        games: acts.reduce((sum, act) => sum + act.games, 0),
      };
    })
    .filter((entry) => entry.acts.length)
    .sort((a, b) =>
      a.queue === 'competitive' ? -1 : b.queue === 'competitive' ? 1 : b.games - a.games,
    );

  let peak: { tier: number; seasonId: string } | undefined;
  for (const [id, info] of Object.entries(seasons)) {
    const s = object(info),
      candidates = [
        nullableNumber(s.CompetitiveTier),
        ...Object.entries(object(s.WinsByTier))
          .filter(([, count]) => typeof count === 'number' && count > 0)
          .map(([key]) => Number(key)),
      ];
    for (const candidate of candidates)
      if (
        candidate !== null &&
        Number.isInteger(candidate) &&
        candidate > 2 &&
        (!peak || candidate > peak.tier)
      )
        peak = { tier: candidate, seasonId: id };
  }
  return {
    name: meta.name,
    image: meta.image,
    tier,
    rr: nullableNumber(season.RankedRating),
    wins: nullableNumber(season.NumberOfWins),
    games: nullableNumber(season.NumberOfGames),
    seasonId,
    currentSeason,
    seasonName: seasonId ? seasonMeta[seasonId]?.name : undefined,
    peak: peak
      ? {
          tier: peak.tier,
          ...tierMeta(catalog, peak.tier),
          seasonName: seasonMeta[peak.seasonId]?.name,
        }
      : undefined,
    career,
  };
}
export function normalizeCollection(raw: unknown, catalog: Catalog): CatalogItem[] {
  const root = object(raw);
  const groups = requiredArray(root.EntitlementsByTypes, 'collection');
  const unique = new Map<string, CatalogItem>();
  for (const value of groups) {
    const group = object(value),
      kind = Object.entries(ITEM_TYPES).find(([, id]) => id === group.ItemTypeID)?.[0] as
        CatalogItem['kind'] | undefined;
    for (const rawItem of requiredArray(group.Entitlements, 'owned items')) {
      const item = catalogItem(catalog, text(object(rawItem).ItemID), kind ?? 'unknown');

      const key = item.kind === 'skin' ? item.canonicalId : `${item.kind}:${item.id}`;
      if (!unique.has(key)) unique.set(key, item);
    }
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function normalizeLoadout(raw: unknown, catalog: Catalog): Loadout {
  const r = object(raw),
    identity = object(r.Identity);
  const guns = requiredArray(r.Guns, 'loadout').map((value) => {
    const g = object(value),
      skin = catalogItem(catalog, text(g.SkinLevelID, text(g.SkinID)), 'skin');
    return {
      weapon: skin.weapon ?? 'Weapon',
      skin,
      buddy: g.CharmID ? catalogItem(catalog, text(g.CharmID), 'buddy') : undefined,
    };
  });
  return {
    guns,
    card: identity.PlayerCardID
      ? catalogItem(catalog, text(identity.PlayerCardID), 'card')
      : undefined,
    title: identity.PlayerTitleID
      ? catalogItem(catalog, text(identity.PlayerTitleID), 'title')
      : undefined,
  };
}
export function normalizeProgression(raw: unknown, catalog: Catalog): Progression {
  const r = object(raw);
  const contracts = requiredArray(r.Contracts, 'progression')
    .map((value) => {
      const c = object(value),
        id = text(c.ContractDefinitionID),
        meta = catalog.contracts[id];
      const level = requiredNumber(c.ProgressionLevelReached, 'contract level'),
        xp = requiredNumber(c.ProgressionTowardsNextLevel, 'contract XP');
      const next = meta?.levels[level];
      return {
        id,
        name: meta?.name ?? `Contract · ${id.slice(0, 8)}`,
        level,
        xp,
        nextLevelXp: next && next.xp > 0 ? next.xp : undefined,
        nextReward: next?.rewardId ? catalogItem(catalog, next.rewardId) : undefined,
        currentBattlepass: Boolean(
          catalog.currentSeasonId &&
          meta?.relationId === catalog.currentSeasonId &&
          meta?.relationType?.toLowerCase() === 'season',
        ),
      };
    })
    .sort((a, b) => Number(b.currentBattlepass) - Number(a.currentBattlepass) || b.level - a.level);
  return {
    contracts,
    missions: array(r.Missions).map((value) => {
      const m = object(value);
      return {
        id: text(m.ID),
        complete: m.Complete === true,
        expiresAt: timestamp(m.ExpirationTime),
        objectives: Object.values(object(m.Objectives)).filter(
          (v): v is number => typeof v === 'number' && Number.isFinite(v),
        ),
      };
    }),
    weeklyRefillAt: timestamp(object(r.MissionMetadata).WeeklyRefillTime),
  };
}
export function normalizeMatches(raw: unknown, updates: unknown, catalog: Catalog): MatchSummary[] {
  const ranked = new Map(
    array(object(updates).Matches).map((v) => [text(object(v).MatchID), object(v)]),
  );
  return requiredArray(object(raw).History, 'match history').map((value) => {
    const m = object(value),
      id = text(m.MatchID),
      update = ranked.get(id),
      mapId = text(update?.MapID),
      meta = catalog.maps[mapId];
    const tierAfter = nullableNumber(update?.TierAfterUpdate) ?? undefined;
    return {
      id,
      startedAt: number(m.GameStartTime),
      queue: text(m.QueueID, 'unknown'),
      map: meta?.name ?? 'Open match details',
      mapImage: meta?.image,
      rrChange:
        typeof update?.RankedRatingEarned === 'number' ? update.RankedRatingEarned : undefined,
      tierAfter,
      tierImage: tierAfter ? catalog.tiers[String(tierAfter)]?.image : undefined,
    };
  });
}
function roundOutcome(round: Record<string, unknown>): RoundOutcome {
  const value = `${text(round.roundResultCode)} ${text(round.roundResult)}`.toLowerCase();
  return value.includes('defuse')
    ? 'defuse'
    : value.includes('detonat')
      ? 'detonate'
      : value.includes('elimin')
        ? 'elimination'
        : value.includes('surrender')
          ? 'surrender'
          : value.includes('time')
            ? 'time'
            : 'other';
}
export function normalizeMatchDetail(
  raw: unknown,
  accountId: string,
  catalog: Catalog,
): MatchDetail {
  const r = object(raw),
    info = object(r.matchInfo),
    me = accountId.toLowerCase();
  const rawPlayers = requiredArray(r.players, 'match players').map(object);
  const player = rawPlayers.find((p) => text(p.subject).toLowerCase() === me);
  if (!player)
    throw new AppError('ACCOUNT_MISMATCH', 'This match does not contain the signed-in account.');
  const teams = array(r.teams).map(object),
    own = teams.find((t) => t.teamId === player.teamId),
    other = teams.find((t) => t.teamId !== player.teamId);
  const roundResults = array(r.roundResults).map(object);
  const hits = new Map<string, { head: number; body: number; legs: number }>(),
    duels = new Map<string, { kills: number; deaths: number }>();
  for (const round of roundResults)
    for (const stats of array(round.playerStats).map(object)) {
      const subject = text(stats.subject).toLowerCase();
      for (const damage of array(stats.damage).map(object)) {
        const h = hits.get(subject) ?? { head: 0, body: 0, legs: 0 };
        h.head += number(damage.headshots);
        h.body += number(damage.bodyshots);
        h.legs += number(damage.legshots);
        hits.set(subject, h);
      }
      for (const kill of array(stats.kills).map(object)) {
        const killer = text(kill.killer).toLowerCase(),
          victim = text(kill.victim).toLowerCase();
        const opponent = killer === me ? victim : victim === me ? killer : '';
        if (!opponent || opponent === me) continue;
        const duel = duels.get(opponent) ?? { kills: 0, deaths: 0 };
        if (killer === me) duel.kills++;
        else duel.deaths++;
        duels.set(opponent, duel);
      }
    }
  const headshotPct = (subject: string) => {
    const h = hits.get(subject),
      total = h ? h.head + h.body + h.legs : 0;
    return h && total > 0 ? Math.round((h.head * 1000) / total) / 10 : null;
  };
  const players: MatchPlayer[] = rawPlayers
    .map((p) => {
      const subject = text(p.subject).toLowerCase(),
        stats = object(p.stats),
        agent = catalogItem(catalog, text(p.characterId), 'agent');
      const score = nullableNumber(stats.score),
        rounds = nullableNumber(stats.roundsPlayed),
        tier = nullableNumber(p.competitiveTier),
        tierInfo = tier ? catalog.tiers[String(tier)] : undefined;
      return {
        subject,
        name: text(p.gameName) || 'Player',
        tag: text(p.tagLine),
        teamId: text(p.teamId),
        self: subject === me,
        agent: resolved(agent, 'Unknown agent'),
        agentImage: agent.image,
        level: nullableNumber(p.accountLevel),
        tier,
        tierName: tierInfo?.name,
        tierImage: tierInfo?.image,
        kills: nullableNumber(stats.kills),
        deaths: nullableNumber(stats.deaths),
        assists: nullableNumber(stats.assists),
        score,
        acs: score !== null && rounds && rounds > 0 ? Math.round(score / rounds) : null,
        headshotPct: headshotPct(subject),
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const self = players.find((p) => p.self)!,
    byId = new Map(players.map((p) => [p.subject, p]));
  return {
    id: text(info.matchId),
    map: catalog.maps[text(info.mapId)]?.name ?? 'Unknown map',
    mapImage: catalog.maps[text(info.mapId)]?.image,
    queue: text(info.queueID, text(info.queueId, 'unknown')),
    startedAt: number(info.gameStartMillis),
    durationMs: nullableNumber(info.gameLengthMillis) ?? undefined,
    agent: self.agent,
    agentImage: self.agentImage,
    kills: self.kills,
    deaths: self.deaths,
    assists: self.assists,
    acs: self.acs,
    headshotPct: self.headshotPct,
    result:
      info.isCompleted !== true
        ? 'UNKNOWN'
        : own?.won === true
          ? 'WIN'
          : other?.won === true
            ? 'LOSS'
            : own && other && own.roundsWon === other.roundsWon
              ? 'DRAW'
              : 'UNKNOWN',
    score:
      own && other && typeof own.roundsWon === 'number' && typeof other.roundsWon === 'number'
        ? `${own.roundsWon} - ${other.roundsWon}`
        : '-',
    teamId: text(player.teamId) || undefined,
    teams: teams.map((t) => ({
      id: text(t.teamId),
      roundsWon: nullableNumber(t.roundsWon),
      won: t.won === true,
    })),
    players,
    rounds: roundResults.map((round, index) => ({
      number: index + 1,
      winningTeam: text(round.winningTeam),
      outcome: roundOutcome(round),
    })),
    duels: [...duels.entries()]
      .map(([subject, duel]) => ({
        subject,
        name: byId.get(subject)?.name ?? 'Player',
        agentImage: byId.get(subject)?.agentImage,
        ...duel,
      }))
      .sort((a, b) => b.kills + b.deaths - (a.kills + a.deaths)),
  };
}
export function remainingSeconds(expiresAt: number, now = Date.now(), clockOffsetMs = 0): number {
  return Math.max(0, Math.ceil((expiresAt - now - clockOffsetMs) / 1000));
}
export function countdown(expiresAt: number, now = Date.now(), clockOffsetMs = 0): string {
  const seconds = remainingSeconds(expiresAt, now, clockOffsetMs);
  if (!seconds) return 'Refresh available';
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function historyEntry(accountId: string, store: Store): HistoryEntry {
  const key = `${Math.round(store.dailyExpiresAt / 60000)}:${store.daily
    .map((o) => o.id)
    .sort()
    .join(',')}`;
  return {
    id: key,
    accountId,
    observedAt: store.fetchedAt,
    expiresAt: store.dailyExpiresAt,
    offers: store.daily,
  };
}
export function wishlistHits(store: Store, wishlist: string[]): StoreOffer[] {
  const wanted = new Set(wishlist);
  return [...store.daily, ...(store.nightMarket?.offers ?? [])].filter((offer) =>
    wanted.has(offer.item.canonicalId),
  );
}

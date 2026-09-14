import type { ActStat, Catalog, QueueCareer, Ranked } from './types';
import { AppError, nullableNumber, number, object, text, timestamp } from './validation';

const TIER_NAMES = [
  'Unrated',
  'Unused',
  'Unused',
  ...['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal'].flatMap(
    (name) => [1, 2, 3].map((n) => `${name} ${n}`),
  ),
  'Radiant',
];
export function tierMeta(catalog: Catalog, tier: number | null) {
  const meta = tier !== null ? catalog.tiers[String(tier)] : undefined;
  return {
    name:
      meta?.name ?? (tier === null ? 'Rank not returned' : (TIER_NAMES[tier] ?? `Tier ${tier}`)),
    image: meta?.image,
  };
}
export function catalogWithContent(catalog: Catalog, raw: unknown): Catalog {
  const list = object(raw).Seasons;
  if (!Array.isArray(list)) return catalog;
  const acts = list.map(object).filter((s) => text(s.Type).toLowerCase() === 'act');
  const active = acts.filter((s) => s.IsActive === true);
  const seasons = { ...catalog.seasons };
  for (const act of acts) {
    const id = text(act.ID);
    if (!id) continue;
    seasons[id] = {
      name: seasons[id]?.name ?? text(act.Name, 'Act'),
      startsAt: timestamp(act.StartTime) ?? seasons[id]?.startsAt,
      endsAt: timestamp(act.EndTime) ?? seasons[id]?.endsAt,
    };
  }
  return {
    ...catalog,
    seasons,
    currentSeasonId: active.length === 1 ? text(active[0]?.ID) : catalog.currentSeasonId,
  };
}
export function resolveRank(raw: unknown, catalog: Catalog, activeSeasonId?: string): Ranked {
  const root = object(raw),
    queues = object(root.QueueSkills),
    latest = object(root.LatestCompetitiveUpdate);
  if (!root.QueueSkills && !root.LatestCompetitiveUpdate)
    throw new AppError('SCHEMA', 'Riot did not return rank data. This is not an unranked result.');
  const seasons = object(object(queues.competitive).SeasonalInfoBySeasonID);
  const metadata = catalog.seasons ?? {},
    currentId = activeSeasonId ?? catalog.currentSeasonId;
  const latestId = text(latest.SeasonID) || undefined;
  let seasonId = currentId && Object.hasOwn(seasons, currentId) ? currentId : latestId;
  let source: Ranked['source'] =
    seasonId && seasonId === currentId ? 'active-season' : 'latest-update';
  if (!seasonId) {
    const ids = Object.keys(seasons).filter(
      (id) => nullableNumber(object(seasons[id]).CompetitiveTier) !== null,
    );
    const dated = ids
      .filter((id) => metadata[id]?.startsAt !== undefined)
      .sort((a, b) => (metadata[b]?.startsAt ?? 0) - (metadata[a]?.startsAt ?? 0));
    seasonId = dated[0] ?? (ids.length === 1 ? ids[0] : undefined);
    source = seasonId ? 'latest-played' : 'unrated';
  }
  const currentSeason = Boolean(currentId && currentId === seasonId);
  const season = object(seasons[seasonId ?? '']),
    sameUpdate = Boolean(seasonId && latestId === seasonId);

  const candidateTier =
    nullableNumber(season.CompetitiveTier) ??
    (sameUpdate ? nullableNumber(latest.TierAfterUpdate) : null);
  const tier =
    candidateTier !== null &&
    Number.isInteger(candidateTier) &&
    candidateTier >= 0 &&
    candidateTier <= 27
      ? candidateTier
      : null;
  const rr =
    tier === null || tier === 0
      ? null
      : (nullableNumber(season.RankedRating) ??
        (sameUpdate ? nullableNumber(latest.RankedRatingAfterUpdate) : null));
  const career: QueueCareer[] = Object.entries(queues)
    .map(([queue, value]) => {
      const acts: ActStat[] = Object.entries(object(object(value).SeasonalInfoBySeasonID))
        .map(([id, entry]) => {
          const info = object(entry),
            actTier = nullableNumber(info.CompetitiveTier),
            meta = tierMeta(catalog, actTier);
          return {
            seasonId: id,
            name: metadata[id]?.name ?? 'Earlier act',
            startsAt: metadata[id]?.startsAt,
            current: id === currentId,
            tier: actTier,
            tierName: meta.name,
            image: meta.image,
            rr: nullableNumber(info.RankedRating),
            wins: number(info.NumberOfWinsWithPlacements, number(info.NumberOfWins)),
            games: number(info.NumberOfGames),
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
    .filter((q) => q.acts.length)
    .sort(
      (a, b) =>
        Number(b.queue === 'competitive') - Number(a.queue === 'competitive') || b.games - a.games,
    );
  let peak: { tier: number; seasonId: string } | undefined;
  for (const [id, entry] of Object.entries(seasons)) {
    const info = object(entry),
      candidates = [
        nullableNumber(info.CompetitiveTier),
        ...Object.entries(object(info.WinsByTier))
          .filter(([, wins]) => typeof wins === 'number' && wins > 0)
          .map(([key]) => Number(key)),
      ];
    for (const candidate of candidates)
      if (
        candidate !== null &&
        Number.isInteger(candidate) &&
        candidate >= 3 &&
        candidate <= 27 &&
        (!peak || candidate > peak.tier)
      )
        peak = { tier: candidate, seasonId: id };
  }
  const meta = tierMeta(catalog, tier);
  return {
    ...meta,
    tier,
    rr,
    seasonId,
    currentSeason,
    source,
    seasonName: seasonId ? metadata[seasonId]?.name : undefined,
    note:
      tier === null
        ? 'No rank value was returned. Refresh to retry.'
        : !currentSeason
          ? 'Last reported rank; the current act was not returned by Riot.'
          : undefined,
    placementsRemaining: nullableNumber(season.GamesNeededForRating) ?? undefined,
    wins: nullableNumber(season.NumberOfWinsWithPlacements) ?? nullableNumber(season.NumberOfWins),
    games: nullableNumber(season.NumberOfGames),
    career,
    peak: peak
      ? {
          tier: peak.tier,
          ...tierMeta(catalog, peak.tier),
          seasonName: metadata[peak.seasonId]?.name,
        }
      : undefined,
  };
}

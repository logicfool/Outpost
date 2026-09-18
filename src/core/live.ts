import { normalizeLiveStats } from './liveStats';
import type { Catalog, LiveGame } from './types';
import type { LivePlayer } from './playerTypes';
import { catalogItem } from './catalog';
import { tierMeta } from './rank';
import { matchProgress } from './liveProgress';
import { AppError, array, nullableNumber, object, text, uuid } from './validation';

export function glzOrigin(region: string, shard: string): string {
  const actualRegion = shard === 'pbe' ? 'na' : region;
  if (
    !['na', 'br', 'latam', 'eu', 'ap', 'kr'].includes(actualRegion) ||
    !['na', 'pbe', 'eu', 'ap', 'kr'].includes(shard)
  ) {
    throw new AppError('REGION', 'The live-game region is invalid.');
  }
  return `https://glz-${actualRegion}-1.${shard}.a.pvp.net`;
}
export function normalizeLive(
  raw: unknown,
  state: 'agent_select' | 'in_game',
  matchId: string,
  self: string,
  catalog: Catalog,
): LiveGame {
  const root = object(raw),
    returnedId = text(root.MatchID) || text(root.ID);
  if (returnedId && uuid(returnedId) !== uuid(matchId))
    throw new AppError('MATCH_SCOPE', 'The live match changed. Refresh to try again.');
  const rawTeams = [...array(root.Teams), root.AllyTeam, root.EnemyTeam]
    .filter(Boolean)
    .map(object);
  const all = [
    ...array(root.Players),
    ...rawTeams.flatMap((t) => array(t.Players).map((p) => ({ ...object(p), TeamID: t.TeamID }))),
  ];
  if (!Array.isArray(root.Players) && !rawTeams.some((t) => Array.isArray(t.Players)))
    throw new AppError('SCHEMA', 'Riot did not return the live roster.');
  const players = new Map<string, LivePlayer>();
  for (const value of all) {
    const p = object(value),
      identity = object(p.PlayerIdentity),
      subject = uuid(p.Subject ?? identity.Subject);
    const hidden = identity.Incognito === true && subject !== self,
      hideLevel = identity.HideAccountLevel === true && subject !== self;
    const agentId = text(p.CharacterID),
      agent = agentId ? catalogItem(catalog, agentId, 'agent') : undefined;
    const tier = nullableNumber(p.CompetitiveTier),
      meta = tierMeta(catalog, tier);
    players.set(subject, {
      stats: normalizeLiveStats(p, state === 'in_game'),
      subject,
      self: subject === self,
      teamId: text(p.TeamID),
      hidden,
      hideLevel,
      name: hidden ? 'Hidden player' : text(p.GameName, subject === self ? 'You' : 'Player'),
      tag: hidden ? '' : text(p.TagLine),
      level: hideLevel ? null : nullableNumber(identity.AccountLevel),
      card: text(identity.PlayerCardID)
        ? catalogItem(catalog, text(identity.PlayerCardID), 'card')
        : undefined,
      title: text(identity.PlayerTitleID)
        ? catalogItem(catalog, text(identity.PlayerTitleID), 'title')
        : undefined,
      agent: agent?.name.startsWith('Unresolved') ? 'Not selected' : agent?.name,
      agentImage: agent?.image,
      selection: text(p.CharacterSelectionState) || undefined,
      tier,
      tierName: tier !== null ? meta.name : undefined,
      tierImage: meta.image,
    });
  }
  if (!players.has(self))
    throw new AppError('ACCOUNT_MISMATCH', 'The live match does not contain your account.');
  const mapId = text(root.MapID) || text(root.MapId),
    map = catalog.maps[mapId];
  return {
    state,
    matchId: uuid(matchId),
    mapId,
    progress:
      state === 'in_game'
        ? matchProgress(raw, players.get(self)!.teamId, text(root.QueueID), Date.now())
        : undefined,
    map: map?.name ?? (mapId.split('/').pop() || undefined),
    mapImage: map?.image,
    queue: text(root.QueueID) || undefined,
    gamePod: text(root.GamePodID) || undefined,
    players: [...players.values()],
    observedAt: Date.now(),
  };
}

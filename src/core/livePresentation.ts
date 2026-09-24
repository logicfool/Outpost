import { isGauntlet, gauntletGroups } from './gauntlet';
import type { Catalog, LiveGame, Ranked, Section } from './types';
import type { LivePlayer } from './playerTypes';
import type { LiveEquipment, MatchProgress } from './matchTypes';
import { tierMeta } from './rank';
import { hasScorePair } from './liveProgress';
export interface LiveRankEntry {
  data?: Ranked;
  checkedAt: number;
  issue?: string;
  retryAt?: number;
  code?: string;
}
export interface LiveViewState {
  accountId: string;
  matchId: string;
  teamId?: string;
  loadoutSubject?: string;
  score?: MatchProgress;
  equipment?: Section<LiveEquipment>;
  ranks: Record<string, LiveRankEntry>;
  rankFlights: Map<string, Promise<LiveRankEntry>>;
  rankBlockedUntil?: number;
}
/** Match-local UI state, never an authorization scope or persistent credential store. */
export class LiveMatchMemory {
  private account?: string;
  private views = new Map<string, LiveViewState>();
  syncAccount(accountId?: string) {
    if (this.account !== accountId) {
      this.account = accountId;
      this.views.clear();
    }
  }
  forMatch(accountId: string | undefined, matchId: string | undefined): LiveViewState {
    this.syncAccount(accountId);
    const key = matchId ?? '';
    let view = this.views.get(key);
    if (!view) {
      if (this.views.size >= 3) this.views.delete(this.views.keys().next().value!);
      view = { accountId: accountId ?? '', matchId: key, ranks: {}, rankFlights: new Map() };
      this.views.set(key, view);
    }
    return view;
  }
}
export function liveTeams(game: LiveGame, ownId?: string) {
  if (isGauntlet(game)) return gauntletGroups(game, ownId);
  const players = game.players ?? [],
    own = players.find((p) => p.subject === ownId || p.self);
  const ids = [...new Set(players.map((p) => p.teamId))];
  const grouped =
    game.queue?.toLowerCase() !== 'deathmatch' &&
    ids.length > 1 &&
    !!own?.teamId &&
    ids.every((id) => !!id);
  if (!grouped) return [{ id: 'all', label: 'Players', friendly: true, players }];
  return ids
    .sort((a, b) => Number(b === own!.teamId) - Number(a === own!.teamId))
    .map((id) => ({
      id,
      label: id === own!.teamId ? 'Your team' : ids.length === 2 ? 'Opponents' : id,
      friendly: id === own!.teamId,
      players: players.filter((p) => p.teamId === id),
    }));
}
export function liveRank(player: LivePlayer, rank?: Ranked, catalog?: Catalog) {
  if (player.hidden) return { name: 'Hidden', label: 'Rank', image: undefined, rr: null };
  const known = (n: unknown): boolean =>
    typeof n === 'number' && Number.isInteger(n) && n >= 3 && n <= 27;
  if (rank?.currentSeason && known(rank.tier))
    return { name: rank.name, image: rank.image, label: 'Current', rr: rank.rr };
  if (known(player.tier)) {
    const meta = catalog ? tierMeta(catalog, player.tier!) : undefined;
    return {
      name: player.tierName ?? meta?.name ?? 'Ranked',
      image: player.tierImage ?? meta?.image,
      label: 'In this match',
      rr: null,
    };
  }
  if (rank && known(rank.tier))
    return { name: rank.name, image: rank.image, label: 'Last ranked', rr: rank.rr };
  if ((rank?.currentSeason && rank.tier === 0) || player.tier === 0)
    return {
      name: 'Unranked',
      image: rank?.image ?? player.tierImage,
      label: rank?.currentSeason ? 'Current' : 'In this match',
      rr: null,
    };
  return { name: 'Not reported', image: undefined, label: 'Current', rr: null };
}
export function retainedLiveScore(
  view: LiveViewState,
  game: LiveGame | undefined,
  current?: MatchProgress,
): MatchProgress | undefined {
  if (!game || isGauntlet(game) || game.state !== 'in_game' || game.matchId !== view.matchId) {
    view.score = undefined;
    return;
  }
  if (hasScorePair(current)) view.score = { ...current!, matchId: game.matchId };
  return hasScorePair(current) ? current : (view.score ?? current);
}

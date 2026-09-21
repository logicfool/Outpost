import type { Friend } from './chatTypes';
import type { LiveGame } from './types';
import type { MatchProgress } from './matchTypes';
import { object, text } from './validation';
import { presenceFields } from './presenceState';

export const LIVE_SCORE_MAX_AGE = 180000;
export const liveMapKey = (value: unknown) =>
  typeof value === 'string'
    ? value
        .trim()
        .replace(/\\/g, '/')
        .replace(/\.(umap|uasset)$/i, '')
        .replace(/\/+$/, '')
        .toLowerCase()
    : '';
const sameMap = (a: unknown, b: unknown) => {
  const left = liveMapKey(a),
    right = liveMapKey(b);
  if (!left || !right) return false;
  if (left.includes('/') && right.includes('/')) return left === right;
  return left.split('/').pop() === right.split('/').pop();
};
export const LIVE_SCORE_FRESH_MS = LIVE_SCORE_MAX_AGE;
const identityKey = (value: unknown) => text(value).trim().toLowerCase();
export const hasScorePair = (value?: MatchProgress): boolean =>
  !!value && count(value.allyScore) !== undefined && count(value.enemyScore) !== undefined;

const ROUND_QUEUES = new Set([
  'competitive',
  'unrated',
  'swiftplay',
  'spikerush',
  'premier',
  'onefa',
  'newmap',
]);
const numeric = (v: unknown) =>
  typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : NaN;
const count = (v: unknown): number | undefined => {
  const n = numeric(v);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : undefined;
};
const first = (...values: unknown[]) => values.find((v) => count(v) !== undefined);
export function presenceProgress(
  raw: unknown,
  inGame: boolean,
  now = Date.now(),
): MatchProgress | undefined {
  if (!inGame) return;
  const { root, match, party } = presenceFields(raw);
  if (root.isValid === false) return;
  const matchId = identityKey(match.matchId) || identityKey(match.matchID) || undefined;
  let ally = count(first(match.matchScoreAllyTeam, match.scoreAllyTeam)),
    enemy = count(first(match.matchScoreEnemyTeam, match.scoreEnemyTeam));
  let source: MatchProgress['source'] = 'friend-presence';
  const ownerMatchId = identityKey(party.partyOwnerMatchId) || identityKey(party.partyOwnerMatchID);
  const sameOwnerMatch = !!matchId && ownerMatchId.toLowerCase() === matchId.toLowerCase();
  const ownerConflict = !!matchId && !!ownerMatchId && !sameOwnerMatch;
  if (
    (ally === undefined || enemy === undefined) &&
    !ownerConflict &&
    (party.isPartyOwner === true || sameOwnerMatch)
  ) {
    ally = count(party.partyOwnerMatchScoreAllyTeam);
    enemy = count(party.partyOwnerMatchScoreEnemyTeam);
    source = 'party-owner';
  }
  const queue = (text(match.queueId) || text(party.queueId)).toLowerCase(),
    rounds = ROUND_QUEUES.has(queue);
  const explicitRound = count(
    first(match.currentRound, match.roundNumber, match.CurrentRound, match.RoundNumber),
  );
  const validRound =
    rounds && explicitRound !== undefined && explicitRound >= 1 && explicitRound <= 200
      ? explicitRound
      : undefined;
  if (ally === undefined || enemy === undefined)
    return validRound ? { roundNumber: validRound, source, observedAt: now, matchId } : undefined;
  const completedRounds = rounds ? ally + enemy : undefined;
  return {
    allyScore: ally,
    enemyScore: enemy,
    completedRounds,
    ...(validRound
      ? { roundNumber: validRound }
      : rounds
        ? { roundNumber: completedRounds! + 1, roundEstimated: true }
        : { scoreOnly: true }),
    source,
    ...(source === 'party-owner' && text(party.partyOwnerMatchCurrentTeam)
      ? { scoreTeamId: text(party.partyOwnerMatchCurrentTeam) }
      : {}),
    observedAt: now,
    matchId,
  };
}
export function progressLabel(progress?: MatchProgress, now = Date.now()): string | undefined {
  if (!progress) return;
  const age = now - progress.observedAt;
  if (!Number.isFinite(age) || age < -60000 || age > LIVE_SCORE_MAX_AGE) return;
  const parts = [
    count(progress.roundNumber) !== undefined &&
    Number(progress.roundNumber) >= 1 &&
    Number(progress.roundNumber) <= 200
      ? `Round ${progress.roundEstimated ? '~' : ''}${progress.roundNumber}`
      : undefined,
    hasScorePair(progress) ? `${progress.allyScore} - ${progress.enemyScore}` : undefined,
  ];
  return parts.filter(Boolean).join(' · ') || undefined;
}

export interface SharedPartyProgress {
  progress: MatchProgress;
  mapId: string;
  ownerTeamId: string;
  partyId: string;
}
/** Keep the owner score separate until the authenticated current roster can orient it. */
export function sharedPartyProgress(
  raw: unknown,
  inGame: boolean,
  now = Date.now(),
): SharedPartyProgress | undefined {
  if (!inGame) return;
  const { root, match, party } = presenceFields(raw);
  if (root.isValid === false) return;
  const state = (v: unknown) => text(v).replace(/[_ -]/g, '').toUpperCase();
  const mapId = text(match.matchMap),
    ownerMap = text(party.partyOwnerMatchMap),
    ownerTeamId = text(party.partyOwnerMatchCurrentTeam);
  const matchId = text(match.matchId) || text(match.matchID),
    ownerId = text(party.partyOwnerMatchId) || text(party.partyOwnerMatchID),
    partyId = text(party.partyId);
  if (
    state(match.sessionLoopState) !== 'INGAME' ||
    state(party.partyOwnerSessionLoopState) !== 'INGAME' ||
    !sameMap(mapId, ownerMap) ||
    !['blue', 'red'].includes(ownerTeamId.toLowerCase()) ||
    !partyId ||
    /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(partyId)
  )
    return;
  if (matchId && ownerId && matchId.toLowerCase() !== ownerId.toLowerCase()) return;
  const allyScore = count(party.partyOwnerMatchScoreAllyTeam),
    enemyScore = count(party.partyOwnerMatchScoreEnemyTeam);
  if (allyScore === undefined || enemyScore === undefined) return;
  const queue = (text(match.queueId) || text(party.queueId)).toLowerCase(),
    rounds = ROUND_QUEUES.has(queue);
  return {
    mapId,
    ownerTeamId,
    partyId,
    progress: {
      allyScore,
      enemyScore,
      source: 'party-owner',
      observedAt: now,
      matchId: matchId || undefined,
      scoreTeamId: ownerTeamId,
      binding: 'party-context',
      ...(rounds
        ? {
            completedRounds: allyScore + enemyScore,
            roundNumber: allyScore + enemyScore + 1,
            roundEstimated: true,
          }
        : { scoreOnly: true }),
    },
  };
}

export function ownLiveProgress(
  game: LiveGame | undefined,
  self: Friend | undefined,
  connected: boolean,
  now = Date.now(),
  friends: readonly Friend[] = [],
): MatchProgress | undefined {
  if (!game || game.state !== 'in_game') return;
  const candidates: MatchProgress[] = [],
    own = game.players?.find((p) => p.self);
  const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const orient = (p: MatchProgress): MatchProgress | undefined => {
    if (!p.scoreTeamId) return p;
    const team = p.scoreTeamId.toLowerCase(),
      ours = own?.teamId.toLowerCase();
    if (!ours || !['blue', 'red'].includes(ours) || !['blue', 'red'].includes(team)) return;
    return team === ours
      ? p
      : { ...p, allyScore: p.enemyScore, enemyScore: p.allyScore, scoreTeamId: own!.teamId };
  };
  if (
    game.progress &&
    (!game.progress.matchId || (!!game.matchId && sameId(game.progress.matchId, game.matchId))) &&
    progressLabel(game.progress, now)
  )
    candidates.push(game.progress);
  if (connected) {
    const accept = (presence: Friend | undefined, teammate: boolean) => {
      if (!presence || presence.presence !== 'in_game') return;
      const member = game.players?.find((p) => p.subject === presence.subject);
      if (
        teammate &&
        (!member ||
          member.hidden ||
          !own ||
          !own.teamId ||
          member.teamId !== own.teamId ||
          member.subject === own.subject)
      )
        return;
      if (!teammate && own && presence.subject !== own.subject) return;
      let progress = presence.progress,
        shared = false;
      if (!hasScorePair(progress) && !teammate && presence.partyProgress && own) {
        const candidate = presence.partyProgress;
        if (sameMap(candidate.mapId, game.mapId) && sameMap(presence.mapId, game.mapId)) {
          progress = candidate.progress;
          shared = true;
        }
      }
      if (!progress || !progressLabel(progress, now)) return;
      const ids = [presence.matchId, progress.matchId].filter((id): id is string => !!id);
      if (ids.length) {
        if (!game.matchId || ids.some((id) => !sameId(id, game.matchId!))) return;
      } else {
        if (game.presenceNotBefore && progress.observedAt < game.presenceNotBefore) return;
        if (!sameMap(presence.mapId, game.mapId)) return;
        if (
          game.queue &&
          presence.queue &&
          presence.queue.toLowerCase() !== game.queue.toLowerCase()
        )
          return;
        if (
          teammate &&
          (presence.presenceSource !== 'valorant' ||
            !Number.isFinite(presence.updatedAt) ||
            now - presence.updatedAt! > LIVE_SCORE_MAX_AGE ||
            now - presence.updatedAt! < -60000)
        )
          return;
        if (!teammate && !own && !presence.queue) return;
      }
      const result = orient(progress);
      if (!result) return;
      candidates.push({
        ...result,
        source: teammate
          ? 'teammate-presence'
          : progress.source === 'party-owner'
            ? 'party-owner'
            : 'self-presence',
        binding: shared
          ? 'party-context'
          : ids.length
            ? 'match-id'
            : teammate
              ? 'roster-map'
              : 'self-map',
      });
    };
    accept(self, false);
    for (const friend of friends) accept(friend, true);
  }
  const complete = (p: MatchProgress) =>
    count(p.allyScore) !== undefined && count(p.enemyScore) !== undefined;
  // An updated roster may contain only a round counter. Never let that erase a valid score.
  return candidates.sort(
    (a, b) => Number(complete(b)) - Number(complete(a)) || b.observedAt - a.observedAt,
  )[0];
}

export function matchProgress(
  raw: unknown,
  teamId: string,
  queue: string,
  now = Date.now(),
): MatchProgress | undefined {
  const r = object(raw),
    rows = Array.isArray(r.Teams) ? r.Teams.map(object) : [];
  const own = rows.find((t) => t.TeamID === teamId),
    other = rows.find((t) => t.TeamID !== teamId);
  const ally = count(own?.RoundsWon),
    enemy = count(other?.RoundsWon),
    n = count(r.CurrentRound);
  const roundNumber =
    ROUND_QUEUES.has(queue) && n !== undefined && n > 0 && n <= 200 ? n : undefined;
  if ((ally === undefined || enemy === undefined) && roundNumber === undefined) return;
  return {
    ...(ally !== undefined && enemy !== undefined ? { allyScore: ally, enemyScore: enemy } : {}),
    roundNumber,
    source: 'match',
    observedAt: now,
    matchId: text(r.MatchID) || undefined,
  };
}

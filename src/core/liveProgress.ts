import type { Friend } from './chatTypes';
import type { LiveGame } from './types';
import type { MatchProgress } from './matchTypes';
import { object, text } from './validation';
import { presenceFields } from './presenceState';

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
  const matchId = text(match.matchId) || text(match.matchID) || undefined;
  let ally = count(first(match.matchScoreAllyTeam, match.scoreAllyTeam)),
    enemy = count(first(match.matchScoreEnemyTeam, match.scoreEnemyTeam));
  let source: MatchProgress['source'] = 'friend-presence';
  const ownerMatchId = text(party.partyOwnerMatchId) || text(party.partyOwnerMatchID);
  const sameOwnerMatch = !!matchId && ownerMatchId === matchId;
  if (
    (ally === undefined || enemy === undefined) &&
    (party.isPartyOwner === true || sameOwnerMatch)
  ) {
    ally = count(party.partyOwnerMatchScoreAllyTeam);
    enemy = count(party.partyOwnerMatchScoreEnemyTeam);
    source = 'party-owner';
  }
  const queue = (text(match.queueId) || text(party.queueId)).toLowerCase(),
    rounds = ROUND_QUEUES.has(queue);
  const explicitRound = count(first(match.currentRound, match.roundNumber));
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
    observedAt: now,
    matchId,
  };
}
export function progressLabel(progress?: MatchProgress, now = Date.now()): string | undefined {
  if (!progress) return;
  const age = now - progress.observedAt;
  if (age < -60000 || age > 180000) return;
  const parts = [
    progress.roundNumber !== undefined
      ? `Round ${progress.roundEstimated ? '~' : ''}${progress.roundNumber}`
      : undefined,
    progress.allyScore !== undefined && progress.enemyScore !== undefined
      ? `${progress.allyScore} - ${progress.enemyScore}`
      : undefined,
  ];
  return parts.filter(Boolean).join(' · ') || undefined;
}

export function ownLiveProgress(
  game: LiveGame | undefined,
  self: Friend | undefined,
  connected: boolean,
  now = Date.now(),
): MatchProgress | undefined {
  if (!game || game.state !== 'in_game') return;
  if (game.progress && progressLabel(game.progress, now)) return game.progress;
  if (
    !connected ||
    !self ||
    self.presence !== 'in_game' ||
    !self.progress ||
    !progressLabel(self.progress, now)
  )
    return;
  if (self.matchId) {
    if (self.matchId !== game.matchId) return;
  } else if (
    !self.mapId ||
    !game.mapId ||
    self.mapId !== game.mapId ||
    !self.queue ||
    !game.queue ||
    self.queue !== game.queue
  )
    return;
  return {
    ...self.progress,
    source: self.progress.source === 'party-owner' ? 'party-owner' : 'self-presence',
  };
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

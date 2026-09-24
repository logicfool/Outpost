// Synthetic Gauntlet exchanges, not an authenticated live capture.
const { ID, MATCH } = require('./helpers.cjs');
const { makeDemo } = require('../.test-build/demo.js');
const { normalizeLive } = require('../.test-build/live.js');
const { normalizeMatchDetail } = require('../.test-build/normalize.js');
function gauntletFixture({ health = true, complete = false, now = Date.now() } = {}) {
  const catalog = makeDemo(now).catalog;
  const agent = Object.values(catalog.items).find((i) => i.kind === 'agent');
  const card = Object.values(catalog.items).find((i) => i.kind === 'card');
  const Players = Array.from({ length: 16 }, (_, i) => ({
    Subject: i === 0 ? ID : `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`,
    TeamID: `Duo${Math.floor(i / 2) + 1}`,
    GameName: `Fixture player ${i + 1}`,
    TagLine: 'TEST',
    CharacterID: agent.id,
    PlayerIdentity: { AccountLevel: 30, PlayerCardID: card.id },
  }));
  const Teams = Array.from({ length: 8 }, (_, i) => ({
    TeamID: `Duo${i + 1}`,
    TeamName: `Fixture duo ${i + 1}`,
    RoundsWon: i,
    ...(health
      ? {
          TeamHealth: i >= 6 ? 0 : 100 - i * 10,
          MaxTeamHealth: 100,
          IsEliminated: i >= 6,
        }
      : {}),
  }));
  const raw = {
    MatchID: MATCH,
    QueueID: 'abilitydraftarena',
    MapID: '/Game/Maps/AbilityDraft/AbilityDraft',
    Players,
    Teams,
  };
  const game = normalizeLive(raw, 'in_game', MATCH, ID, catalog);
  game.observedAt = now;
  game.gauntlet.observedAt = now;
  game.gauntlet.teams.forEach((t) => {
    t.seenAt = now;
    if (t.evidenceAt !== undefined) t.evidenceAt = now;
  });
  const ranks = [3, 5, 8, 1, 4, 6, 7, 2];
  const reportRaw = {
    matchInfo: {
      matchId: MATCH,
      mapId: raw.MapID,
      queueID: raw.QueueID,
      isCompleted: complete,
      gameStartMillis: now - 600000,
    },
    players: Players.map((p) => ({
      subject: p.Subject,
      teamId: p.TeamID,
      gameName: p.GameName,
      tagLine: p.TagLine,
      characterId: p.CharacterID,
      playerCard: card.id,
      accountLevel: 30,
      stats: { kills: 7, deaths: 4, assists: 2, roundsPlayed: 10, score: 1000 },
    })),
    teams: Teams.map((t, i) => ({
      teamId: t.TeamID,
      teamName: t.TeamName,
      ...(health
        ? {
            teamHealth: complete ? (i === 3 ? 70 : 0) : t.TeamHealth,
            isEliminated: complete ? i !== 3 : t.IsEliminated,
          }
        : {}),
      ...(complete ? { won: i === 3, finalPlacement: ranks[i] } : {}),
      roundsWon: t.RoundsWon,
    })),
  };
  const report = normalizeMatchDetail(reportRaw, ID, catalog);
  return { raw, game, reportRaw, report, catalog, ownId: ID };
}
module.exports = { gauntletFixture };

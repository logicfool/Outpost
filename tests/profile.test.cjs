const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../.test-build/normalize.js');
const c = require('../.test-build/catalog.js');
const { ID, OTHER, MATCH, catalog } = require('./helpers.cjs');
const A = '66666666-6666-4666-8666-666666666666',
  B = '77777777-7777-4777-8777-777777777777',
  OLD = '88888888-8888-4888-8888-888888888888';
const withSeasons = () => ({
  ...catalog(),
  tiers: { 12: { name: 'GOLD 1' }, 15: { name: 'PLATINUM 1' }, 16: { name: 'PLATINUM 2' } },
  seasons: {
    [A]: { name: 'V26 // ACT V', startsAt: 3000 },
    [OLD]: { name: 'V25 // ACT III', startsAt: 1000 },
  },
  currentSeasonId: A,
});
test('career lists acts newest first with names, totals and peak', () => {
  const rank = n.normalizeRank(
    {
      QueueSkills: {
        competitive: {
          SeasonalInfoBySeasonID: {
            [OLD]: {
              CompetitiveTier: 12,
              NumberOfWinsWithPlacements: 7,
              NumberOfGames: 14,
              WinsByTier: { 16: 1, 12: 6 },
            },
            [A]: {
              CompetitiveTier: 15,
              RankedRating: 55,
              NumberOfWinsWithPlacements: 10,
              NumberOfGames: 20,
            },
          },
        },
        unrated: {
          SeasonalInfoBySeasonID: {
            [A]: { NumberOfWins: 3, NumberOfGames: 5 },
            [B]: { NumberOfGames: 0 },
          },
        },
      },
    },
    withSeasons(),
  );
  assert.equal(rank.name, 'PLATINUM 1');
  assert.equal(rank.seasonName, 'V26 // ACT V');
  assert.deepEqual(
    rank.career.map((q) => q.queue),
    ['competitive', 'unrated'],
  );
  assert.deepEqual(
    rank.career[0].acts.map((a) => a.name),
    ['V26 // ACT V', 'V25 // ACT III'],
  );
  assert.equal(rank.career[0].wins, 17);
  assert.equal(rank.career[0].games, 34);
  assert.equal(rank.career[1].acts.length, 1);
  assert.equal(rank.peak.tier, 16);
  assert.equal(rank.peak.name, 'PLATINUM 2');
  assert.equal(rank.peak.seasonName, 'V25 // ACT III');
});
test('match report builds scoreboard, round outcomes and personal duels', () => {
  const data = {
    matchInfo: {
      matchId: MATCH,
      isCompleted: true,
      mapId: 'ascent',
      queueID: 'competitive',
      gameStartMillis: 1000,
      gameLengthMillis: 2400000,
    },
    players: [
      {
        subject: ID,
        gameName: 'Me',
        tagLine: 'ONE',
        teamId: 'Blue',
        accountLevel: 50,
        stats: { kills: 2, deaths: 1, assists: 0, score: 600, roundsPlayed: 2 },
      },
      {
        subject: OTHER,
        gameName: 'Rival',
        tagLine: 'TWO',
        teamId: 'Red',
        stats: { kills: 1, deaths: 2, score: 900, roundsPlayed: 2 },
      },
    ],
    teams: [
      { teamId: 'Blue', won: true, roundsWon: 2 },
      { teamId: 'Red', won: false, roundsWon: 0 },
    ],
    roundResults: [
      {
        winningTeam: 'Blue',
        roundResult: 'Eliminated',
        roundResultCode: 'Elimination',
        playerStats: [
          {
            subject: ID,
            kills: [{ killer: ID, victim: OTHER }],
            damage: [{ headshots: 1, bodyshots: 1, legshots: 0 }],
          },
          { subject: OTHER, kills: [{ killer: OTHER, victim: ID }] },
        ],
      },
      {
        winningTeam: 'Blue',
        roundResult: 'Bomb defused',
        roundResultCode: 'Defuse',
        playerStats: [{ subject: ID, kills: [{ killer: ID, victim: OTHER }] }],
      },
    ],
  };
  const detail = n.normalizeMatchDetail(data, ID, catalog());
  assert.deepEqual(
    detail.players.map((p) => p.name),
    ['Rival', 'Me'],
  );
  assert.equal(detail.players.find((p) => p.self).headshotPct, 50);
  assert.equal(detail.players.find((p) => p.self).level, 50);
  assert.deepEqual(
    detail.rounds.map((r) => r.outcome),
    ['elimination', 'defuse'],
  );
  assert.deepEqual(detail.duels, [
    { subject: OTHER, name: 'Rival', agentImage: undefined, kills: 2, deaths: 1 },
  ]);
  assert.equal(detail.durationMs, 2400000);
  assert.equal(detail.teamId, 'Blue');
  assert.equal(detail.acs, 300);
});
test('queue ids get readable names', () => {
  assert.equal(n.queueName('swiftplay'), 'Swiftplay');
  assert.equal(n.queueName('ggteam'), 'Escalation');
  assert.equal(n.queueName(''), 'Custom');
});
test('season names come from the catalog act titles', () => {
  const cat = c.buildCatalog({
    seasons: {
      data: [
        { uuid: 'episode', displayName: 'V26' },
        {
          uuid: A,
          parentUuid: 'episode',
          displayName: 'ACT V',
          title: null,
          startTime: '2026-08-19T00:00:00Z',
        },
      ],
    },
  });
  assert.equal(cat.seasons[A].name, 'V26 // ACT V');
});

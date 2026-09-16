const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, MATCH } = require('./helpers.cjs');
const {
  presenceProgress,
  progressLabel,
  ownLiveProgress,
  matchProgress,
} = require('../.test-build/liveProgress.js');
const now = Date.now();
const owner = () => ({
  matchPresenceData: { sessionLoopState: 'INGAME', queueId: 'competitive', matchMap: 'ascent' },
  partyPresenceData: {
    isPartyOwner: true,
    partyOwnerMatchScoreAllyTeam: 7,
    partyOwnerMatchScoreEnemyTeam: 5,
  },
});
test('owner presence reports score with a visibly estimated next round', () => {
  const p = presenceProgress(owner(), true, now);
  assert.equal(p.roundNumber, 13);
  assert.equal(p.completedRounds, 12);
  assert.equal(p.roundEstimated, true);
  assert.equal(progressLabel(p, now), 'Round ~13 · 7 - 5');
});
test('another party members leader score is not treated as that member match', () => {
  const d = owner();
  d.partyPresenceData.isPartyOwner = false;
  assert.equal(presenceProgress(d, true, now), undefined);
});
test('matching explicit match IDs can associate a party-owner score', () => {
  const d = owner();
  d.partyPresenceData.isPartyOwner = false;
  d.partyPresenceData.partyOwnerMatchId = MATCH;
  d.matchPresenceData.matchId = MATCH;
  assert.equal(presenceProgress(d, true, now).allyScore, 7);
});
test('matching map name alone does not prove two players are in the same match', () => {
  const d = owner();
  d.partyPresenceData.isPartyOwner = false;
  d.partyPresenceData.partyOwnerMatchMap = 'ascent';
  assert.equal(presenceProgress(d, true, now), undefined);
});
test('menus and agent select never retain in-game score progress', () =>
  assert.equal(presenceProgress(owner(), false, now), undefined));
test('deathmatch score is not converted to a bogus round 61', () => {
  const d = owner();
  d.matchPresenceData.queueId = 'deathmatch';
  d.partyPresenceData.partyOwnerMatchScoreAllyTeam = 35;
  d.partyPresenceData.partyOwnerMatchScoreEnemyTeam = 25;
  const p = presenceProgress(d, true, now);
  assert.equal(p.roundNumber, undefined);
  assert.equal(progressLabel(p, now), '35 - 25');
});
test('zero scores are legitimate, malformed negatives or missing scores remain unknown', () => {
  const d = owner();
  d.partyPresenceData.partyOwnerMatchScoreAllyTeam = 0;
  d.partyPresenceData.partyOwnerMatchScoreEnemyTeam = 0;
  assert.equal(presenceProgress(d, true, now).roundNumber, 1);
  d.partyPresenceData.partyOwnerMatchScoreEnemyTeam = -1;
  assert.equal(presenceProgress(d, true, now), undefined);
});
test('explicit round counter is preferred and not marked as estimated', () => {
  const d = owner();
  d.matchPresenceData.currentRound = 12;
  const p = presenceProgress(d, true, now);
  assert.equal(p.roundNumber, 12);
  assert.equal(p.roundEstimated, undefined);
});
test('old presence score is not displayed indefinitely', () => {
  assert.equal(progressLabel(presenceProgress(owner(), true, now), now + 180001), undefined);
});
test('own live progress requires matching game identity or matching map and queue', () => {
  const game = { state: 'in_game', matchId: MATCH, mapId: 'ascent', queue: 'competitive' },
    self = {
      subject: ID,
      presence: 'in_game',
      mapId: 'ascent',
      queue: 'competitive',
      progress: presenceProgress(owner(), true, now),
    };
  assert.equal(ownLiveProgress(game, self, true, now).allyScore, 7);
  assert.equal(ownLiveProgress({ ...game, mapId: 'bind' }, self, true, now), undefined);
  assert.equal(ownLiveProgress(game, { ...self, matchId: ID }, true, now), undefined);
  assert.equal(ownLiveProgress(game, self, false, now), undefined);
});
test('match Version is not used as a round counter', () => {
  assert.equal(matchProgress({ Version: 57341 }, 'Blue', 'competitive', now), undefined);
});
test('explicit live team scores preserve the authenticated players orientation', () => {
  const p = matchProgress(
    {
      CurrentRound: 8,
      Teams: [
        { TeamID: 'Red', RoundsWon: 4 },
        { TeamID: 'Blue', RoundsWon: 3 },
      ],
    },
    'Blue',
    'competitive',
    now,
  );
  assert.equal(p.allyScore, 3);
  assert.equal(p.enemyScore, 4);
  assert.equal(p.roundNumber, 8);
});

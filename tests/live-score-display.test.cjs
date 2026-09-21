const test = require('node:test'),
  assert = require('node:assert/strict');
const { ownLiveProgress, progressLabel } = require('../.test-build/liveProgress.js');
const { ID, OTHER, MATCH } = require('./helpers.cjs');
const NOW = 1800000000000;
const game = () => ({
  state: 'in_game',
  matchId: MATCH,
  mapId: '/Game/Maps/Ascent/Ascent',
  players: [
    { subject: ID, self: true, teamId: 'Blue' },
    { subject: OTHER, self: false, teamId: 'Blue' },
  ],
});
const self = () => ({
  subject: ID,
  presence: 'in_game',
  mapId: '/game/maps/ascent/ascent',
  queue: 'competitive',
  progress: { allyScore: 10, enemyScore: 12, source: 'party-owner', observedAt: NOW },
});
test('score matches the same Unreal map path regardless of casing', () => {
  assert.equal(ownLiveProgress(game(), self(), true, NOW)?.allyScore, 10);
});
test('a missing optional queue does not discard a verified self score on the same map', () => {
  const p = self();
  delete p.queue;
  assert.equal(ownLiveProgress(game(), p, true, NOW)?.enemyScore, 12);
});
test('a newer round-only observation cannot replace a complete score pair', () => {
  const g = game();
  g.progress = { roundNumber: 23, source: 'match', observedAt: NOW + 1, matchId: MATCH };
  assert.equal(ownLiveProgress(g, self(), true, NOW + 1)?.allyScore, 10);
});
test('explicit map and queue mismatches still reject self scores', () => {
  assert.equal(
    ownLiveProgress({ ...game(), mapId: '/Game/Maps/Bonsai/Bonsai' }, self(), true, NOW),
    undefined,
  );
  assert.equal(ownLiveProgress({ ...game(), queue: 'swiftplay' }, self(), true, NOW), undefined);
});
test('disconnected, wrong-account and unrelated teammate scores do not enter the live scoreboard', () => {
  assert.equal(ownLiveProgress(game(), self(), false, NOW), undefined);
  assert.equal(ownLiveProgress(game(), { ...self(), subject: OTHER }, true, NOW), undefined);
  assert.equal(
    ownLiveProgress(game(), undefined, true, NOW, [{ ...self(), subject: OTHER }]),
    undefined,
  );
});
test('different full map paths with the same final component are not treated as identical', () => {
  const g = game();
  g.mapId = '/Game/Maps/Other/Ascent';
  assert.equal(ownLiveProgress(g, self(), true, NOW), undefined);
});
test('an invalid presence cannot generate score candidates', () => {
  const { presenceProgress, sharedPartyProgress } = require('../.test-build/liveProgress.js');
  const data = {
    isValid: false,
    sessionLoopState: 'INGAME',
    matchMap: 'Ascent',
    queueId: 'competitive',
    isPartyOwner: true,
    partyId: OTHER,
    partyOwnerSessionLoopState: 'INGAME',
    partyOwnerMatchMap: 'Ascent',
    partyOwnerMatchCurrentTeam: 'Blue',
    partyOwnerMatchScoreAllyTeam: 10,
    partyOwnerMatchScoreEnemyTeam: 12,
  };
  assert.equal(presenceProgress(data, true, NOW), undefined);
  assert.equal(sharedPartyProgress(data, true, NOW), undefined);
});
test('a non-owner party score stays separate until own match context supplies orientation', () => {
  const { presenceProgress, sharedPartyProgress } = require('../.test-build/liveProgress.js');
  const raw = {
    sessionLoopState: 'INGAME',
    matchMap: '/game/maps/ascent/ascent',
    queueId: 'competitive',
    isPartyOwner: false,
    partyId: OTHER,
    partyOwnerSessionLoopState: 'INGAME',
    partyOwnerMatchMap: '/Game/Maps/Ascent/Ascent',
    partyOwnerMatchCurrentTeam: 'Red',
    partyOwnerMatchScoreAllyTeam: 12,
    partyOwnerMatchScoreEnemyTeam: 10,
  };
  assert.equal(presenceProgress(raw, true, NOW), undefined);
  const shared = sharedPartyProgress(raw, true, NOW);
  assert.ok(shared);
  const p = { ...self(), progress: undefined, partyProgress: shared };
  const score = ownLiveProgress(game(), p, true, NOW);
  assert.equal(score.allyScore, 10);
  assert.equal(score.enemyScore, 12);
  assert.equal(score.binding, 'party-context');
});
test('conflicting owner-match ids and sentinel party ids cannot yield shared scores', () => {
  const { sharedPartyProgress } = require('../.test-build/liveProgress.js');
  const raw = {
    sessionLoopState: 'INGAME',
    matchMap: 'Ascent',
    queueId: 'competitive',
    partyId: OTHER,
    partyOwnerSessionLoopState: 'INGAME',
    partyOwnerMatchMap: 'Ascent',
    partyOwnerMatchCurrentTeam: 'Blue',
    partyOwnerMatchScoreAllyTeam: 10,
    partyOwnerMatchScoreEnemyTeam: 12,
    matchId: MATCH,
    partyOwnerMatchId: OTHER,
  };
  assert.equal(sharedPartyProgress(raw, true, NOW), undefined);
  delete raw.partyOwnerMatchId;
  raw.partyId = '00000000-0000-0000-0000-000000000000';
  assert.equal(sharedPartyProgress(raw, true, NOW), undefined);
});

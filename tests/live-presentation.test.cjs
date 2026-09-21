const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  LiveMatchMemory,
  liveRank,
  liveTeams,
  retainedLiveScore,
} = require('../.test-build/livePresentation.js');
const {
  ownLiveProgress,
  presenceProgress,
  sharedPartyProgress,
  progressLabel,
} = require('../.test-build/liveProgress.js');
const { ID, OTHER, MATCH, catalog } = require('./helpers.cjs');
const NOW = 1800000000000;
const game = () => ({
  state: 'in_game',
  matchId: MATCH,
  mapId: '/Game/Maps/Ascent/Ascent',
  queue: 'competitive',
  players: [
    { subject: ID, self: true, teamId: 'Blue', name: 'You' },
    { subject: OTHER, teamId: 'Blue', name: 'Teammate' },
  ],
});
const score = (patch = {}) => ({
  allyScore: 10,
  enemyScore: 12,
  source: 'self-presence',
  observedAt: NOW,
  ...patch,
});
test('live match tab choice, ranks and cosmetics survive subpage navigation', () => {
  const cache = new LiveMatchMemory(),
    view = cache.forMatch(ID, MATCH);
  view.teamId = 'Red';
  view.score = score();
  view.equipment = { status: 'ready', fetchedAt: NOW, data: { matchId: MATCH, players: [] } };
  assert.equal(cache.forMatch(ID, MATCH), view);
  assert.equal(cache.forMatch(ID, MATCH).teamId, 'Red');
  assert.equal(cache.forMatch(ID, OTHER).score, undefined);
});
test('live UI memory never leaks retained scores across accounts', () => {
  const cache = new LiveMatchMemory();
  cache.forMatch(ID, MATCH).score = score();
  assert.equal(cache.forMatch(OTHER, MATCH).score, undefined);
  assert.equal(cache.forMatch(ID, MATCH).score, undefined);
});
test('complete live score remains last-reported rather than disappearing with a missing sample', () => {
  const view = new LiveMatchMemory().forMatch(ID, MATCH);
  retainedLiveScore(view, game(), score());
  assert.equal(retainedLiveScore(view, game(), undefined).allyScore, 10);
  assert.equal(view.score.observedAt, NOW);
  assert.equal(
    retainedLiveScore(view, game(), { source: 'match', roundNumber: 23, observedAt: NOW + 1000 })
      .enemyScore,
    12,
  );
  assert.equal(progressLabel(view.score, NOW + 180001), undefined);
  assert.equal(retainedLiveScore(view, { ...game(), state: 'agent_select' }), undefined);
});
test('reported match rank is not replaced by an unavailable or unrated fallback', () => {
  const p = { subject: OTHER, tier: 6, tierName: 'Bronze 1', self: false, teamId: 'Red' };
  assert.equal(
    liveRank(p, { name: 'Unranked', tier: 0, currentSeason: false }, catalog()).name,
    'Bronze 1',
  );
  assert.equal(
    liveRank(p, { name: 'Unranked', tier: 0, currentSeason: false }, catalog()).label,
    'In this match',
  );
  assert.equal(
    liveRank({ ...p, tier: undefined, tierName: undefined }, undefined, catalog()).name,
    'Not reported',
  );
  assert.equal(
    liveRank(p, { name: 'Silver 1', tier: 9, currentSeason: true, rr: 50 }, catalog()).name,
    'Silver 1',
  );
});
test('a fresh verified same-roster teammate without match IDs can supply the correct team score', () => {
  const friend = {
    subject: OTHER,
    presence: 'in_game',
    presenceSource: 'valorant',
    updatedAt: NOW,
    mapId: '/game/maps/ascent/ascent',
    queue: 'competitive',
    progress: score({ source: 'friend-presence' }),
  };
  assert.equal(ownLiveProgress(game(), undefined, true, NOW, [friend]).binding, 'roster-map');
  assert.equal(
    ownLiveProgress(game(), undefined, true, NOW, [{ ...friend, mapId: 'Bind' }]),
    undefined,
  );
  const other = game();
  other.players[1].teamId = 'Red';
  assert.equal(ownLiveProgress(other, undefined, true, NOW, [friend]), undefined);
});
test('shared owner score replaces a round-only self observation only with corroborated match context', () => {
  const raw = {
    sessionLoopState: 'INGAME',
    partyOwnerSessionLoopState: 'INGAME',
    partyId: OTHER,
    matchMap: 'Ascent',
    partyOwnerMatchMap: 'Ascent',
    partyOwnerMatchCurrentTeam: 'Red',
    queueId: 'competitive',
    partyOwnerMatchScoreAllyTeam: 12,
    partyOwnerMatchScoreEnemyTeam: 10,
  };
  const p = {
    subject: ID,
    presence: 'in_game',
    mapId: 'Ascent',
    queue: 'competitive',
    progress: { source: 'self-presence', roundNumber: 23, observedAt: NOW },
    partyProgress: sharedPartyProgress(raw, true, NOW),
  };
  const value = ownLiveProgress(game(), p, true, NOW);
  assert.equal(value.allyScore, 10);
  assert.equal(value.enemyScore, 12);
  for (const changed of [
    { partyOwnerSessionLoopState: 'MENUS' },
    { partyOwnerMatchMap: 'Bind' },
    { partyOwnerMatchCurrentTeam: 'unknown' },
  ])
    assert.equal(sharedPartyProgress({ ...raw, ...changed }, true, NOW), undefined);
});
test('deathmatch does not invent Your team and Opponents for individual competitors', () => {
  const g = game();
  g.queue = 'deathmatch';
  g.players[0].teamId = 'individual-1';
  g.players[1].teamId = 'individual-2';
  assert.equal(liveTeams(g, ID).length, 1);
  assert.equal(liveTeams(g, ID)[0].label, 'Players');
});
test('malformed score or round fields never become a user-visible counter', () => {
  assert.equal(progressLabel(score({ allyScore: -1, roundNumber: undefined }), NOW), undefined);
  assert.equal(
    progressLabel({ source: 'match', roundNumber: NaN, observedAt: NOW }, NOW),
    undefined,
  );
});
test('an old ID-less score from a previous match on the same map is not reused', () => {
  const g = { ...game(), presenceNotBefore: NOW + 1 },
    p = { subject: ID, presence: 'in_game', mapId: 'Ascent', progress: score() };
  assert.equal(ownLiveProgress(g, p, true, NOW + 2), undefined);
  assert.equal(
    ownLiveProgress(g, { ...p, progress: score({ observedAt: NOW + 2 }) }, true, NOW + 2).allyScore,
    10,
  );
});

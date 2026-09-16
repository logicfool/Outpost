const test = require('node:test'),
  assert = require('node:assert/strict');
const { valorantActivity } = require('../.test-build/presenceState.js');
const { squareCardCandidates, friendStatus } = require('../.test-build/friends.js');
const { ID } = require('./helpers.cjs');
test('presence understands case and separator variants without polling', () => {
  for (const state of ['INGAME', 'in_game', 'In Game'])
    assert.equal(valorantActivity({ sessionLoopState: state }).presence, 'in_game');
  assert.equal(
    valorantActivity({ sessionLoopState: 'PreGame', queueId: 'competitive' }).presence,
    'agent_select',
  );
});
test('another party member does not inherit the leaders game state', () => {
  assert.equal(
    valorantActivity({
      sessionLoopState: 'MENUS',
      partyOwnerSessionLoopState: 'INGAME',
      isPartyOwner: false,
    }).presence,
    'online',
  );
  assert.equal(
    valorantActivity({ partyOwnerSessionLoopState: 'INGAME', isPartyOwner: true }).presence,
    'in_game',
  );
  assert.equal(valorantActivity({}).activity, 'Online');
});
test('friend status includes queue for agent select and active matches', () => {
  assert.match(
    friendStatus({ presence: 'agent_select', presenceSource: 'valorant', queue: 'competitive' }),
    /Agent select.*Competitive/,
  );
});
test('square avatar has alternative square URLs but never banner or poster URLs', () => {
  const urls = squareCardCandidates({
    id: ID,
    canonicalId: ID,
    kind: 'card',
    image: `https://media.valorant-api.com/playercards/${ID}/largeart.png`,
    wideArt: `https://media.valorant-api.com/playercards/${ID}/wideart.png`,
  });
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => !/largeart|wideart/.test(u)));
});

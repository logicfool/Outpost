const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, catalog } = require('./helpers.cjs');
const { friendSections, friendStatus, squareCardArt } = require('../.test-build/friends.js');
const { AutoHistoryGate } = require('../.test-build/autoHistory.js');
const { hasPlayerName, playerLabel } = require('../.test-build/playerNames.js');
const { buildCatalog } = require('../.test-build/catalog.js');
const { DEFAULT_SETTINGS } = require('../.test-build/types.js');
const friend = (extra = {}) => ({
  subject: ID,
  name: 'Lumen',
  tag: 'TEST',
  jid: ID + '@ap1.pvp.net',
  presence: 'online',
  ...extra,
});
test('automatic history starts enabled for existing settings migrations', () =>
  assert.equal(DEFAULT_SETTINGS.autoChatHistory, true));
test('friends portraits use small square card art instead of wide banner crops', () => {
  const card = {
    id: ID,
    canonicalId: ID,
    kind: 'card',
    name: 'Card',
    image: 'https://media.valorant-api.com/playercards/' + ID + '/displayicon.png',
    wideArt: 'https://media.valorant-api.com/playercards/' + ID + '/wideart.png',
    smallArt: 'https://media.valorant-api.com/playercards/' + ID + '/smallart.png',
  };
  assert.equal(squareCardArt(card), card.smallArt);
  delete card.smallArt;
  assert.match(squareCardArt(card), /smallart.png$/);
});
test('public card metadata retains its distinct portrait dimension', () => {
  const c = buildCatalog({
    playercards: {
      data: [
        {
          uuid: ID,
          displayName: 'Card',
          smallArt: 'https://media.valorant-api.com/playercards/' + ID + '/smallart.png',
          wideArt: 'https://media.valorant-api.com/playercards/' + ID + '/wideart.png',
        },
      ],
    },
  });
  assert.match(c.items[ID].smallArt, /smallart.png$/);
  assert.match(c.items[ID].wideArt, /wideart.png$/);
});
test('friend directory groups VALORANT, other games and offline, not a combined chat feed', () => {
  const f = [
    friend({ presenceSource: 'valorant' }),
    friend({ subject: OTHER, presence: 'offline' }),
    friend({ subject: '33333333-3333-4333-8333-333333333333', game: 'League of Legends' }),
  ];
  assert.deepEqual(
    friendSections(f, [], true).map((g) => g.key),
    ['valorant', 'other', 'offline'],
  );
});
test('friend statuses distinguish menus, in-game map and queue without guessing other games', () => {
  assert.equal(friendStatus(friend({ presenceSource: 'valorant' })), 'In menus');
  assert.equal(
    friendStatus(
      friend({ presence: 'in_game', map: 'Lotus', game: 'VALORANT', partySize: 2, partyMax: 5 }),
    ),
    'In game · Lotus · Party 2/5',
  );
  assert.equal(friendStatus(friend({ game: 'League of Legends' })), 'League of Legends · Online');
  assert.equal(friendStatus(friend({ presence: 'queue', game: 'VALORANT' })), 'In queue');
});
test('cached friends are explicitly last seen, not fake live online presence', () => {
  const f = friend({ presence: 'in_game' }),
    groups = friendSections(
      [],
      [{ subject: ID, friend: f, lastAt: 1, count: 3, unread: 0 }],
      false,
    );
  assert.equal(groups[0].data[0].presence, 'offline');
  assert.match(friendStatus(f, false), /Last seen/);
});
test('friend search is case insensitive and UUID placeholders never become display names', () => {
  assert.equal(friendSections([friend()], [], true, 'LUMEN#test')[0].data.length, 1);
  assert.equal(hasPlayerName(ID), false);
  assert.equal(playerLabel(friend({ name: ID })), 'Name unavailable');
});
test('opening and reconnecting history shares a one-minute gate', async () => {
  const g = new AutoHistoryGate();
  let calls = 0;
  const work = async () => {
    calls++;
  };
  await g.run(ID, work, 1);
  await g.run(ID, work, 30000);
  assert.equal(calls, 1);
  await g.run(ID, work, 60001);
  assert.equal(calls, 2);
});
test('parallel history triggers never overlap for the same conversation', async () => {
  const g = new AutoHistoryGate();
  let calls = 0,
    release;
  const hold = new Promise((r) => (release = r));
  const work = async () => {
    calls++;
    await hold;
  };
  const a = g.run(ID, work, 1),
    b = g.run(ID, work, 2);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  release();
  await Promise.all([a, b]);
});
test('history failures honor a longer server cooldown', async () => {
  const g = new AutoHistoryGate();
  let calls = 0;
  const work = async () => {
    calls++;
    throw Object.assign(Error('Wait'), { retryAt: 300000 });
  };
  await assert.rejects(g.run(ID, work, 1));
  await g.run(ID, work, 70000);
  assert.equal(calls, 1);
  await assert.rejects(g.run(ID, work, 300001));
  assert.equal(calls, 2);
});
test('clearing automatic history cancels queued work before account switches', async () => {
  const g = new AutoHistoryGate();
  let calls = 0;
  const a = g.run(
    ID,
    async () => {
      calls++;
    },
    1,
  );
  g.clear();
  await a;
  assert.equal(calls, 0);
});

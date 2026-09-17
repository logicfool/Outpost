const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, code } = require('./helpers.cjs');
const {
  storedFriend,
  withCachedFriends,
  friendIdentityDue,
  observedFriend,
  FRIEND_IDENTITY_TTL,
} = require('../.test-build/friendIdentity.js');
const { FriendLookupGate } = require('../.test-build/friendLookup.js');
const { AppError } = require('../.test-build/validation.js');
const card = { id: ID, canonicalId: ID, name: 'Card', kind: 'card' };
const friend = () => ({
  subject: OTHER,
  jid: OTHER + '@ap1.pvp.net',
  name: 'Friend',
  tag: 'TEST',
  presence: 'offline',
});
test('sparse Riot client presence retains cached card but not old game status', () => {
  const old = {
    ...friend(),
    card,
    cardObservedAt: 100,
    presence: 'in_game',
    game: 'VALORANT',
    progress: { roundNumber: 9 },
  };
  const row = withCachedFriends(
    [{ ...friend(), presence: 'online', presenceSource: 'riot' }],
    [old],
    200,
  )[0];
  assert.deepEqual(row.card, card);
  assert.equal(row.presence, 'online');
  assert.equal(row.progress, undefined);
  assert.equal(row.cardObservedAt, 100);
});
test('cached portraits do not add unauthorized or removed friends to a current roster', () =>
  assert.deepEqual(withCachedFriends([], [{ ...friend(), card }]), []));
test('fresh presence replaces old card and advances its observation time', () => {
  const next = storedFriend(
    { ...friend(), card: { ...card, id: OTHER }, cardObservedAt: 200 },
    { ...friend(), card, cardObservedAt: 100 },
  );
  assert.equal(next.card.id, OTHER);
  assert.equal(next.cardObservedAt, 200);
});
test('identity refresh is due daily, not on every navigation', () => {
  const f = { ...friend(), card, cardObservedAt: 1000 };
  assert.equal(friendIdentityDue(f, 1000 + FRIEND_IDENTITY_TTL - 1), false);
  assert.equal(friendIdentityDue(f, 1000 + FRIEND_IDENTITY_TTL), true);
});
test('failed to find historical card still records completed lookup without fabricating art', () => {
  const f = observedFriend(friend(), undefined, 0, 500);
  assert.equal(f.card, undefined);
  assert.equal(f.identityCheckedAt, 500);
  assert.equal(friendIdentityDue(f, 600), false);
});
test('old match cannot overwrite a newer presence card', () => {
  const f = observedFriend(
    { ...friend(), card, cardObservedAt: 200 },
    { subject: OTHER, name: 'Friend', tag: '', card: { ...card, id: OTHER } },
    100,
    500,
  );
  assert.equal(f.card.id, ID);
  assert.equal(f.cardObservedAt, 200);
});
test('foreign or hidden profile does not replace saved portrait', () => {
  for (const player of [
    { subject: ID, name: 'Other', tag: '', card },
    { subject: OTHER, name: 'Hidden player', tag: '', card, hidden: true },
  ])
    assert.equal(observedFriend(friend(), player, 100, 200).card, undefined);
});
function gate() {
  let now = 100000,
    calls = 0;
  const map = new Map(),
    store = {
      notificationStamp: async (k) => map.get(k) || null,
      setNotificationStamp: async (k, v) => map.set(k, v),
    },
    create = () => new FriendLookupGate(store, () => now);
  return {
    create,
    advance: (ms) => (now += ms),
    map,
    get calls() {
      return calls;
    },
    work: async () => {
      calls++;
      return { observedAt: now };
    },
  };
}
test('automatic friend discovery shares a durable one-friend-per-minute limit', async () => {
  const f = gate();
  await f.create().run(ID, OTHER, f.work);
  assert.equal(await f.create().run(ID, ID, f.work), null);
  assert.equal(f.calls, 1);
  f.advance(60001);
  await f.create().run(ID, ID, f.work);
  assert.equal(f.calls, 2);
});
test('same friend is not looked up again within twenty-four hours across restarts', async () => {
  const f = gate();
  await f.create().run(ID, OTHER, f.work);
  f.advance(60001);
  assert.equal(await f.create().run(ID, OTHER, f.work), null);
  assert.equal(f.calls, 1);
  f.advance(FRIEND_IDENTITY_TTL);
  await f.create().run(ID, OTHER, f.work);
  assert.equal(f.calls, 2);
});
test('friend lookup honors Retry-After and performs no automatic network retry', async () => {
  const f = gate();
  await assert.rejects(
    f.create().run(ID, OTHER, async () => {
      throw new AppError('RATE_LIMIT', 'Wait', 900000, 429);
    }),
    code('RATE_LIMIT'),
  );
  f.advance(60001);
  assert.equal(await f.create().run(ID, ID, f.work), null);
  assert.equal(f.calls, 0);
});
test('friend identity request budgets are isolated by account', async () => {
  const f = gate();
  await f.create().run(ID, OTHER, f.work);
  await f.create().run(OTHER, ID, f.work);
  assert.equal(f.calls, 2);
});

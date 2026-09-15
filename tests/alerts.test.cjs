const test = require('node:test'),
  assert = require('node:assert/strict');
const { wishlistAlerts, chatAlertEligible, alertTarget } = require('../.test-build/alerts.js');
const { makeDemo } = require('../.test-build/demo.js');
const { ID, OTHER } = require('./helpers.cjs');
const now = Date.now();
const base = () => makeDemo(now).snapshot.store.data;
test('wishlist matcher covers daily, Night Market and bundle items with separate windows', () => {
  const store = base(),
    items = [
      store.daily[0].item.canonicalId,
      store.nightMarket.offers[0].item.canonicalId,
      store.bundles[0].offers[0].item.canonicalId,
    ];
  assert.deepEqual(
    new Set(wishlistAlerts(store, items, now).map((h) => h.source)),
    new Set(['daily', 'night', 'bundle']),
  );
});
test('expired sources do not alert and server-clock offset is respected', () => {
  const s = base(),
    id = s.daily[0].item.id;
  s.dailyExpiresAt = now + 60000;
  s.clockOffsetMs = 120000;
  assert.equal(wishlistAlerts(s, [id], now).filter((h) => h.source === 'daily').length, 0);
});
test('same source duplicate reward is coalesced and canonical IDs match aliases', () => {
  const s = base(),
    o = s.daily[0];
  s.daily = [o, { ...o, id: OTHER, item: { ...o.item, id: OTHER } }];
  assert.equal(
    wishlistAlerts(s, [o.item.canonicalId], now).filter((h) => h.source === 'daily').length,
    1,
  );
});
const message = (patch = {}) => ({
  id: 'message-fixture',
  subject: OTHER,
  body: 'hello',
  at: now,
  direction: 'incoming',
  state: 'received',
  source: 'live',
  ...patch,
});
const prefs = { reminders: false, backgroundSync: false, chatAlerts: true };
test('incoming live message alerts but not own outgoing or archive imports', () => {
  assert.equal(chatAlertEligible(message(), ID, undefined, true, prefs, now), true);
  for (const patch of [
    { source: 'riot-archive' },
    { serverStored: true },
    { direction: 'outgoing' },
    { subject: ID },
    { at: now - 121000 },
  ])
    assert.equal(chatAlertEligible(message(patch), ID, undefined, true, prefs, now), false);
});
test('active conversation is quiet; disabled alerts remain silent', () => {
  assert.equal(chatAlertEligible(message(), ID, OTHER, true, prefs, now), false);
  assert.equal(
    chatAlertEligible(message(), ID, undefined, true, { ...prefs, chatAlerts: false }, now),
    false,
  );
});
test('notification taps can only navigate to an account and a safe route', () => {
  assert.equal(alertTarget({ kind: 'buy', accountId: ID }), undefined);
  assert.equal(alertTarget({ kind: 'chat', accountId: ID, peer: '../../x' }), undefined);
  assert.deepEqual(alertTarget({ kind: 'chat', accountId: ID, peer: OTHER }), {
    kind: 'chat',
    accountId: ID,
    peer: OTHER,
  });
});

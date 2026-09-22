const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  ID,
  OTHER,
  uid,
  clone,
  bundleFixture,
  ITEM_TYPES,
  CURRENCIES,
} = require('./bundle-fixture.cjs');
const { bundleMetadata } = require('../.test-build/bundleMetadata.js');
const { quoteBundlePurchase, bundleQuoteKey } = require('../.test-build/bundlePurchase.js');
const { validatePurchaseQuote } = require('../.test-build/purchases.js');
const { ownedQuantities } = require('../.test-build/ownership.js');
const parse = (h) => bundleMetadata(h.raw, h.catalog, CURRENCIES.VP, ITEM_TYPES);
const quote = (h, now = h.store.fetchedAt) =>
  quoteBundlePurchase(h.store, h.wallet, h.bundle.id, ID, uid(200), h.owned, h.catalog, now);
test('bundle quote retains the server total and buddy quantity without multiplying the price', () => {
  const h = bundleFixture(),
    q = quote(h);
  assert.equal(q.price, 1160);
  assert.equal(q.balanceBefore, 2000);
  assert.equal(q.bundle.lines[0].quantity, 2);
  assert.equal(q.bundle.lines[0].price, 507);
  assert.equal(q.bundle.lines.length, 3);
});
for (const [label, mutate] of [
  ['missing total', (h) => delete h.raw.TotalDiscountedCost],
  ['wrong currency', (h) => (h.raw.CurrencyID = CURRENCIES.RP)],
  ['duplicate offers', (h) => h.raw.ItemOffers.push(clone(h.raw.ItemOffers[0]))],
  ['mixed prices', (h) => (h.raw.ItemOffers[0].DiscountedCost[CURRENCIES.RP] = 1)],
  ['mismatched IDs', (h) => (h.raw.ItemOffers[0].Offer.OfferID = uid(300))],
  ['mismatched reward type', (h) => (h.raw.Items[0].Item.ItemTypeID = ITEM_TYPES.skin)],
  ['mismatched amount', (h) => (h.raw.Items[0].Item.Amount = 1)],
  ['mismatched displayed price', (h) => (h.raw.Items[0].DiscountedPrice = 1)],
  ['incomplete contents', (h) => h.raw.Items.pop()],
  ['missing direct flag', (h) => delete h.raw.ItemOffers[0].Offer.IsDirectPurchase],
  [
    'ambiguous rewards',
    (h) => h.raw.ItemOffers[0].Offer.Rewards.push(clone(h.raw.ItemOffers[0].Offer.Rewards[0])),
  ],
  ['fractional price', (h) => (h.raw.ItemOffers[0].DiscountedCost[CURRENCIES.VP] = 1.5)],
  ['total mismatch', (h) => h.raw.TotalDiscountedCost[CURRENCIES.VP]++],
  [
    'unknown item',
    (h) => {
      h.catalog.items = {};
    },
  ],
  ['unbounded quantity', (h) => (h.raw.ItemOffers[0].Offer.Rewards[0].Quantity = 100)],
  ['non-direct offer', (h) => (h.raw.ItemOffers[0].Offer.IsDirectPurchase = false)],
  ['discount above base', (h) => (h.raw.ItemOffers[0].Offer.Cost[CURRENCIES.VP] = 1)],
])
  test('bundle metadata fails closed for ' + label, () => {
    const h = bundleFixture();
    mutate(h);
    assert.equal(parse(h), undefined);
  });
test('promotional zero-price bundle items stay in the reviewed batch', () => {
  const h = bundleFixture();
  h.raw.ItemOffers[0].DiscountedCost[CURRENCIES.VP] = 0;
  h.raw.Items[0].DiscountedPrice = 0;
  h.raw.TotalDiscountedCost[CURRENCIES.VP] = 653;
  h.bundle.checkout = parse(h);
  const q = quote(h);
  assert.equal(q.price, 653);
  assert.equal(q.bundle.lines.length, 3);
  assert.equal(q.bundle.lines[0].price, 0);
});
test('missing inventory, partial buddy ownership, insufficient VP and near expiry cannot produce a quote', () => {
  for (const [mutate, code] of [
    [(h) => h.owned.delete(ITEM_TYPES.card), 'BUNDLE_OWNERSHIP'],
    [(h) => h.owned.get(ITEM_TYPES.buddy).set(uid(1), 1), 'BUNDLE_OWNERSHIP'],
    [(h) => (h.wallet[0].amount = 100), 'INSUFFICIENT_VP'],
    [(h) => (h.bundle.expiresAt = h.store.fetchedAt + 1000), 'BUNDLE_EXPIRED'],
  ]) {
    const h = bundleFixture();
    mutate(h);
    assert.throws(
      () => quote(h),
      (e) => e.code === code,
    );
  }
});
test('whole-bundle offers with already owned items require the official client rather than guessed discounts', () => {
  const h = bundleFixture();
  h.owned.get(ITEM_TYPES.card).set(uid(2), 1);
  assert.throws(
    () => quote(h),
    (e) => e.code === 'BUNDLE_OFFERS',
  );
  h.bundle.checkout.wholesaleOnly = false;
  const q = quote(h);
  assert.equal(q.price, 728);
  assert.equal(q.bundle.ownedCount, 1);
  assert.equal(q.bundle.lines.length, 2);
});
test('all-owned and stale bundle quotes are refused', () => {
  const h = bundleFixture();
  for (const l of h.bundle.checkout.lines) h.owned.get(l.itemTypeId).set(l.itemId, l.quantity);
  assert.throws(
    () => quote(h),
    (e) => e.code === 'ALREADY_OWNED',
  );
  const b = bundleFixture();
  assert.throws(
    () => quote(b, b.store.fetchedAt + 60001),
    (e) => e.code === 'BUNDLE_STALE',
  );
});
test('line-level price changes are detected even if the overall bundle total is unchanged', () => {
  const h = bundleFixture(),
    q = quote(h);
  h.bundle.checkout.lines[0].price++;
  h.bundle.checkout.lines[1].price--;
  const fresh = quote(h);
  assert.throws(
    () => validatePurchaseQuote(q, fresh),
    (e) => e.code === 'PURCHASE_CHANGED',
  );
  assert.notEqual(bundleQuoteKey(q), bundleQuoteKey(fresh));
});
test('reordering the same bundle lines does not invalidate a confirmation', () => {
  const h = bundleFixture(),
    q = quote(h);
  h.bundle.checkout.lines.reverse();
  assert.doesNotThrow(() => validatePurchaseQuote(q, quote(h)));
});
test('whole-bundle checkout sends nothing until a bundle route is confirmed', async () => {
  const { RiotClient } = require('../.test-build/riot.js'),
    { HttpClient } = require('../.test-build/http.js'),
    { session, response } = require('./helpers.cjs');
  const h = bundleFixture(),
    requests = [];
  let guards = 0;
  const client = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      requests.push({ url, ...init });
      return response({});
    }),
    { version: async () => 'release-fixture' },
    h.catalog,
  );
  await assert.rejects(
    client.purchaseBundle(h.bundle.checkout.lines, 1160, async () => {
      guards++;
    }),
    (e) => e.code === 'BUNDLE_ROUTE' && e.message.includes('No request was sent'),
  );
  assert.equal(guards, 0);
  assert.equal(requests.length, 0);
});
test('conflicting ownership instances are rejected instead of counted twice', () => {
  const raw = {
    ItemTypeID: ITEM_TYPES.buddy,
    Entitlements: [
      { ItemID: uid(1), InstanceID: uid(50) },
      { ItemID: uid(2), InstanceID: uid(50) },
    ],
  };
  assert.throws(
    () => ownedQuantities(raw, ITEM_TYPES.buddy),
    (e) => e.code === 'SCHEMA',
  );
  raw.Entitlements[1].ItemID = uid(1);
  assert.equal(ownedQuantities(raw, ITEM_TYPES.buddy).get(uid(1)), 1);
  raw.Entitlements[1].InstanceID = uid(51);
  assert.equal(ownedQuantities(raw, ITEM_TYPES.buddy).get(uid(1)), 2);
});
test('anonymous inventory rows do not invent a second buddy copy', () => {
  assert.equal(
    ownedQuantities(
      { Entitlements: [{ ItemID: uid(1) }, { ItemID: uid(1) }] },
      ITEM_TYPES.buddy,
    ).get(uid(1)),
    1,
  );
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  quotePurchase,
  validatePurchaseQuote,
  orderResult,
} = require('../.test-build/purchases.js');
const { makeDemo } = require('../.test-build/demo.js');
const { ID, OTHER, code } = require('./helpers.cjs');
const now = Date.now(),
  fixture = () => {
    const s = makeDemo(now).snapshot;
    return { store: s.store.data, wallet: s.wallet.data, item: s.store.data.daily[0].item };
  };
test('only a current daily VP offer can produce a bounded quote', () => {
  const f = fixture(),
    q = quotePurchase(f.store, f.wallet, f.item.id, ID, OTHER, now);
  assert.equal(q.expiresAt, now + 45000);
  assert.equal(q.accountId, ID);
  assert.equal(q.price, 1775);
});
test('a missing offer, wrong currency or insufficient VP prevents a quote', () => {
  const f = fixture();
  assert.throws(
    () => quotePurchase(f.store, f.wallet, OTHER, ID, OTHER, now),
    code('PURCHASE_UNAVAILABLE'),
  );
  assert.throws(
    () =>
      quotePurchase(
        f.store,
        f.wallet.map((m) => ({ ...m, amount: 0 })),
        f.item.id,
        ID,
        OTHER,
        now,
      ),
    code('INSUFFICIENT_VP'),
  );
  f.store.daily[0].prices[0].currencyId = 'not-vp';
  assert.throws(
    () => quotePurchase(f.store, f.wallet, f.item.id, ID, OTHER, now),
    code('PURCHASE_PRICE'),
  );
});
test('expiring rotation and a changed price/account cannot be confirmed', () => {
  const f = fixture(),
    q = quotePurchase(f.store, f.wallet, f.item.id, ID, OTHER, now);
  for (const patch of [{ price: q.price + 1 }, { accountId: OTHER }])
    assert.throws(
      () => validatePurchaseQuote(q, { ...q, ...patch }, now),
      code('PURCHASE_CHANGED'),
    );
  assert.throws(() => validatePurchaseQuote(q, q, now + 45000), code('PURCHASE_EXPIRED'));
  f.store.dailyExpiresAt = now + 1000;
  assert.throws(
    () => quotePurchase(f.store, f.wallet, f.item.id, ID, OTHER, now),
    code('PURCHASE_EXPIRED'),
  );
});
test('order response must contain the expected ID and an understood state', () => {
  assert.deepEqual(orderResult({ OrderID: OTHER, Status: 'COMPLETE' }), {
    orderId: OTHER,
    state: 'complete',
  });
  assert.throws(() => orderResult({ OrderID: ID, Status: 'COMPLETE' }, OTHER), code('ORDER_SCOPE'));
  assert.throws(() => orderResult({ OrderID: ID, Status: 'anything' }), code('ORDER_UNKNOWN'));
});

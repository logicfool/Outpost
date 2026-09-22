const test = require('node:test');
const assert = require('node:assert/strict');
const { collectionValue } = require('../.test-build/collectionValue.js');
const { CURRENCIES } = require('../.test-build/normalize.js');

const skin = (id) => ({ id, canonicalId: id, kind: 'skin', name: id });
const offer = (item, amount, original) => ({
  id: item.id,
  item,
  prices: [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount }],
  originalPrices: original
    ? [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: original }]
    : undefined,
});

test('collection value counts each owned skin once and only uses known VP prices', () => {
  const a = skin('a'),
    b = skin('b'),
    c = skin('c');
  const result = collectionValue([a, { ...a, id: 'a-level' }, b, c], {
    daily: [offer(a, 1775), offer(b, 900, 1275)],
    dailyExpiresAt: 1,
    bundles: [],
    nightMarket: null,
    accessories: [],
    fetchedAt: 1,
    clockOffsetMs: 0,
    endpoint: 'v3',
  });
  assert.deepEqual(result, { value: 3050, priced: 2, owned: 3 });
});

test('collection value can learn a higher known price from saved store history', () => {
  const a = skin('a');
  const result = collectionValue([a], undefined, [
    {
      id: 'h',
      accountId: 'x',
      observedAt: 1,
      expiresAt: 2,
      offers: [offer(a, 875), offer(a, 1775)],
    },
  ]);
  assert.deepEqual(result, { value: 1775, priced: 1, owned: 1 });
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  ID,
  OTHER,
  SKIN,
  LEVEL,
  MATCH,
  catalog,
  session,
  storefront,
  response,
  code,
} = require('./helpers.cjs');
const { HttpClient } = require('../.test-build/http.js');
const { RiotClient } = require('../.test-build/riot.js');
const { ownedItemIds } = require('../.test-build/ownership.js');
const {
  directPurchaseBody,
  directPurchaseReply,
  quotePurchase,
} = require('../.test-build/purchases.js');
const { ITEM_TYPES, CURRENCIES, normalizeStore } = require('../.test-build/normalize.js');
function clientWith(fetcher) {
  return new RiotClient(
    session(),
    new HttpClient(fetcher),
    { version: async () => 'release-fixture' },
    catalog(),
  );
}
test('explicit empty entitlements are valid while missing results fail closed', () => {
  assert.equal(ownedItemIds({ EntitlementsByTypes: [] }, ITEM_TYPES.skin).size, 0);
  assert.equal(ownedItemIds({ Entitlements: [] }, ITEM_TYPES.skin).size, 0);
  for (const value of [
    {},
    { Entitlements: null },
    { EntitlementsByTypes: null },
    { EntitlementsByTypes: [{ ItemTypeID: ITEM_TYPES.skin }] },
  ])
    assert.throws(() => ownedItemIds(value, ITEM_TYPES.skin));
});
test('inventory UUID case normalizes without accepting another category', () => {
  assert.ok(
    ownedItemIds(
      {
        EntitlementsByTypes: [
          {
            ItemTypeID: ITEM_TYPES.skin.toUpperCase(),
            Entitlements: [{ ItemID: LEVEL.toUpperCase() }],
          },
        ],
      },
      ITEM_TYPES.skin,
    ).has(LEVEL),
  );
  assert.throws(
    () =>
      ownedItemIds(
        { EntitlementsByTypes: [{ ItemTypeID: ITEM_TYPES.chroma, Entitlements: [] }] },
        ITEM_TYPES.skin,
      ),
    code('SCHEMA'),
  );
});
test('a cosmetic ID resolves to its actual distinct OfferID for submission', () => {
  const raw = storefront();
  raw.SkinsPanelLayout.SingleItemOffers = [MATCH];
  raw.SkinsPanelLayout.SingleItemStoreOffers[0].OfferID = MATCH;
  const s = normalizeStore(raw, catalog(), Date.now(), Date.now()),
    q = quotePurchase(
      s,
      [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: 3000 }],
      SKIN,
      ID,
      OTHER,
    );
  assert.equal(q.offer.id, MATCH);
  assert.equal(q.offer.item.id, LEVEL);
  assert.equal(directPurchaseBody(q.offer.id, q.price)[0].OfferID, MATCH);
});
test('a 204 purchase reply is accepted for verification, not treated as malformed JSON', async () => {
  let posts = 0,
    checks = 0;
  const c = clientWith(async () => {
    posts++;
    return new Response(null, { status: 204 });
  });
  const r = await c.purchaseOffer(LEVEL, 1775, async () => {
    checks++;
  });
  assert.equal(r.state, 'accepted');
  assert.equal(r.httpStatus, 204);
  assert.equal(posts, 1);
  assert.equal(checks, 1);
});
test('empty/array purchase replies are not represented as delivered', () => {
  for (const value of [null, {}, [], [{ Status: 'COMPLETE' }]])
    assert.equal(directPurchaseReply(value).state, 'accepted');
  assert.throws(() => directPurchaseReply([{}, {}]), code('ORDER_UNKNOWN'));
});
test('safe rejection categories do not leak arbitrary upstream text', async () => {
  const c = clientWith(async () =>
    response({ errorCode: 'INSUFFICIENT_FUNDS', message: 'private token contents' }, 400),
  );
  await assert.rejects(
    c.purchaseOffer(LEVEL, 1775, async () => {}),
    (e) => e.code === 'INSUFFICIENT_VP' && e.status === 400 && !e.message.includes('private'),
  );
});
test('unknown rejection returns a local diagnostic rather than an upstream string', async () => {
  const c = clientWith(async () =>
    response({ errorCode: 'SECRET_USER_ID', message: 'secret session' }, 422),
  );
  await assert.rejects(
    c.purchaseOffer(LEVEL, 1775, async () => {}),
    (e) =>
      e.code === 'PURCHASE_REQUEST' &&
      !e.message.includes('SECRET') &&
      !e.message.includes('session'),
  );
});
test('unavailable direct route never probes another mutation', async () => {
  const calls = [];
  const c = clientWith(async (url, init) => {
    calls.push([url, init.method]);
    return response({}, 404);
  });
  await assert.rejects(
    c.purchaseOffer(LEVEL, 1775, async () => {}),
    code('PURCHASE_ENDPOINT'),
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].endsWith('/store/v2/purchase'));
});
test('invalid price cannot reach the network or dispatch callback', async () => {
  let calls = 0;
  const c = clientWith(async () => {
    calls++;
    return response({});
  });
  for (const price of [0, -1, 1.2, NaN, Infinity])
    await assert.rejects(
      c.purchaseOffer(LEVEL, price, async () => {
        calls++;
      }),
      code('PURCHASE_PRICE'),
    );
  assert.equal(calls, 0);
});
test('queued request rechecks consent after obtaining its HTTP permit', async () => {
  let release;
  const wait = new Promise((r) => (release = r)),
    calls = [];
  const http = new HttpClient(
    async (url) => {
      calls.push(url);
      if (calls.length === 1) await wait;
      return response({});
    },
    Date.now,
    1,
  );
  const first = http.json('https://pd.ap.a.pvp.net/fixture');
  const second = http.json(
    'https://pd.ap.a.pvp.net/store/v2/purchase',
    { method: 'POST' },
    {
      purchase: true,
      beforeDispatch: async () => {
        throw new (require('../.test-build/validation.js').AppError)(
          'ACCOUNT_CHANGED',
          'Account changed',
        );
      },
    },
  );
  const rejected = assert.rejects(second, code('ACCOUNT_CHANGED'));
  release();
  await Promise.all([first, rejected]);
  assert.equal(calls.length, 1);
});
test('HTML purchase reply remains uncertain and cannot trigger a second POST', async () => {
  let calls = 0;
  const c = clientWith(async () => {
    calls++;
    return new Response('<html>sign in</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  });
  await assert.rejects(
    c.purchaseOffer(LEVEL, 1775, async () => {}),
    code('SCHEMA'),
  );
  assert.equal(calls, 1);
});
test('legacy order reads remain available without an order-creation method', async () => {
  const calls = [];
  const c = clientWith(async (url, init) => {
    calls.push([url, init.method]);
    return response({ OrderID: OTHER, Status: 'COMPLETE' });
  });
  assert.equal((await c.getOrder(OTHER)).state, 'complete');
  assert.equal(calls[0][1], 'GET');
  assert.equal(typeof c.createOrder, 'undefined');
});

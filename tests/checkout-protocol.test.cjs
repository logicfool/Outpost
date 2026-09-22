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
const { createOrderBody, createOrderReply, quotePurchase } = require('../.test-build/purchases.js');
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
  assert.deepEqual(createOrderBody(OTHER, q.offer.id), { XID: OTHER, OfferID: MATCH });
});
test('a 204 purchase reply is accepted for verification, not treated as malformed JSON', async () => {
  let posts = 0,
    checks = 0;
  const c = clientWith(async () => {
    posts++;
    return new Response(null, { status: 204 });
  });
  const r = await c.purchaseOffer(OTHER, LEVEL, async () => {
    checks++;
  });
  assert.equal(r.state, 'accepted');
  assert.equal(r.httpStatus, 204);
  assert.equal(posts, 1);
  assert.equal(checks, 1);
});
test('order replies are never represented as delivered before entitlements confirm it', () => {
  for (const value of [null, {}, { Status: 'ACCEPTED' }, { Status: 'COMPLETE' }])
    assert.equal(createOrderReply(value).state, 'accepted');
  assert.deepEqual(createOrderReply({ OrderID: OTHER, Status: 'ACCEPTED' }), {
    state: 'accepted',
    orderId: OTHER,
  });
  assert.equal(createOrderReply({ OrderID: OTHER, Status: 'FAILED' }).state, 'failed');
  assert.throws(() => createOrderReply([{ Status: 'ACCEPTED' }]), code('ORDER_UNKNOWN'));
  assert.throws(() => createOrderReply({ Status: 'PENDING' }), code('ORDER_UNKNOWN'));
});
test('a purchase is one POST to the order route carrying only the order key and offer', async () => {
  const requests = [];
  let checks = 0;
  const c = clientWith(async (url, init) => {
    requests.push({ url, ...init });
    return response({ OrderID: MATCH, Status: 'ACCEPTED' });
  });
  const result = await c.purchaseOffer(OTHER, LEVEL, async () => {
    checks++;
  });
  assert.equal(checks, 1);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, '/store/v1/order/');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].body), { XID: OTHER, OfferID: LEVEL });
  assert.deepEqual(result, { state: 'accepted', orderId: MATCH, httpStatus: 200 });
});
test('safe rejection categories do not leak arbitrary upstream text', async () => {
  const c = clientWith(async () =>
    response({ errorCode: 'INSUFFICIENT_FUNDS', message: 'private token contents' }, 400),
  );
  await assert.rejects(
    c.purchaseOffer(OTHER, LEVEL, async () => {}),
    (e) => e.code === 'INSUFFICIENT_VP' && e.status === 400 && !e.message.includes('private'),
  );
});
test('unknown rejection returns a local diagnostic rather than an upstream string', async () => {
  const c = clientWith(async () =>
    response({ errorCode: 'SECRET_USER_ID', message: 'secret session' }, 422),
  );
  await assert.rejects(
    c.purchaseOffer(OTHER, LEVEL, async () => {}),
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
    c.purchaseOffer(OTHER, LEVEL, async () => {}),
    code('PURCHASE_ENDPOINT'),
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].endsWith('/store/v1/order/'));
});
test('an invalid order key or offer cannot reach the network or dispatch callback', async () => {
  let calls = 0;
  const c = clientWith(async () => {
    calls++;
    return response({});
  });
  for (const [key, offer] of [
    ['not-a-uuid', LEVEL],
    [OTHER, 'not-a-uuid'],
    ['', LEVEL],
  ])
    await assert.rejects(
      c.purchaseOffer(key, offer, async () => {
        calls++;
      }),
      code('INVALID_ID'),
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
    'https://pd.ap.a.pvp.net/store/v1/order/',
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
    c.purchaseOffer(OTHER, LEVEL, async () => {}),
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

const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const { ID, OTHER, code, session, response, catalog, storefront, LEVEL } = require('./helpers.cjs');
const { makeDemo } = require('../.test-build/demo.js');
const { AppError } = require('../.test-build/validation.js');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function fixture() {
  let now = Date.now(),
    n = 10,
    allowed = true,
    posts = 0,
    hold,
    error,
    status = 'accepted',
    diskFailure = false,
    dispatchWait,
    deliver = false;
  const records = new Map(),
    stamps = new Map(),
    snapshot = makeDemo(now).snapshot,
    owned = new Set();
  const repo = {
    settings: async () => ({ allowPurchases: allowed }),
    purchaseRecords: async (id) => [...records.values()].filter((r) => r.accountId === id),
    savePurchaseRecord: async (r) => {
      if (diskFailure) throw Error('disk full');
      records.set(r.id, { ...r });
    },
    snapshot: async () => null,
    notificationStamp: async (k) => stamps.get(k) ?? null,
    setNotificationStamp: async (k, v) => stamps.set(k, v),
  };
  const m = { exports: {} },
    load = (name) => {
      if (name === 'react-native') return { Platform: { OS: 'ios' } };
      if (name === './network') return { nativeFetcher: fetch };
      if (name === './chatStorage')
        return { activateChatStorage() {}, removeChatStorage: async () => {} };
      if (name === './secure')
        return {
          vault: {},
          randomHex: () => 'a'.repeat(64),
          randomId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
        };
      if (name === './storage') return { openRepository: async () => repo };
      if (name === './notifications') return {};
      if (name.startsWith('../core/'))
        return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
      throw Error(name);
    };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
  const runtime = new m.exports.Runtime(repo, () => now),
    client = {
      store: async () => snapshot.store.data,
      wallet: async () => snapshot.wallet.data,
      ownedIds: async () => owned,
      purchaseOffer: async (orderKey, offer, beforeDispatch) => {
        assert.match(orderKey, /^[0-9a-f-]{36}$/);
        assert.equal(orderKey, [...records.values()].at(-1).id, 'XID is the saved receipt id');
        if (dispatchWait) await dispatchWait;
        await beforeDispatch();
        assert.equal([...records.values()].at(-1).phase, 'dispatching');
        posts++;
        if (hold) await hold;
        if (error) throw error;
        if (deliver) owned.add(snapshot.store.data.daily.find((o) => o.id === offer).item.id);
        return { orderId: OTHER, state: status };
      },
      getOrder: async () => ({ orderId: OTHER, state: 'complete' }),
    };
  runtime.client = async () => client;
  return {
    runtime,
    records,
    snapshot,
    owned,
    client,
    deliver: () => (deliver = true),
    queue() {
      let release;
      dispatchWait = new Promise((r) => (release = r));
      return release;
    },
    get posts() {
      return posts;
    },
    quote: () => runtime.purchaseQuote(ID, snapshot.store.data.daily[0].item.id),
    advance: (ms) => (now += ms),
    disable: () => (allowed = false),
    fail: (e) => (error = e),
    diskFail: () => (diskFailure = true),
    hold() {
      let release;
      hold = new Promise((r) => (release = r));
      return release;
    },
  };
}
test('purchase persists its intent before one POST and consumes confirmation once', async () => {
  const h = fixture(),
    q = await h.quote(),
    r = await h.runtime.confirmPurchase(ID, q.id);
  assert.equal(h.posts, 1);
  assert.equal(r.state, 'accepted');
  await assert.rejects(h.runtime.confirmPurchase(ID, q.id), code('PURCHASE_CONFIRMATION'));
  assert.equal(h.posts, 1);
});
test('simultaneous confirmations cannot submit the same order twice', async () => {
  const h = fixture(),
    q = await h.quote(),
    release = h.hold();
  const first = h.runtime.confirmPurchase(ID, q.id);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(h.runtime.confirmPurchase(ID, q.id), code('PURCHASE_BUSY'));
  release();
  await first;
  assert.equal(h.posts, 1);
});
test('a timeout creates a durable unknown order and blocks automatic or manual duplicates', async () => {
  const h = fixture(),
    q = await h.quote();
  h.fail(new AppError('TIMEOUT', 'lost response'));
  assert.equal((await h.runtime.confirmPurchase(ID, q.id)).state, 'unknown');
  h.advance(60000);
  await assert.rejects(h.quote(), code('ORDER_PENDING'));
  assert.equal(h.posts, 1);
});
test('a definite API rejection is recorded without a guessed mutation fallback', async () => {
  const h = fixture(),
    q = await h.quote();
  h.fail(new AppError('ENDPOINT_UNAVAILABLE', 'No route', undefined, 404));
  assert.equal((await h.runtime.confirmPurchase(ID, q.id)).state, 'failed');
  assert.equal(h.posts, 1);
});
test('a failed durable-intent write prevents spending', async () => {
  const h = fixture(),
    q = await h.quote();
  h.diskFail();
  await assert.rejects(h.runtime.confirmPurchase(ID, q.id));
  assert.equal(h.posts, 0);
});
test('price change, disabled purchases and insufficient current VP cannot spend', async () => {
  const h = fixture(),
    q = await h.quote();
  h.snapshot.store.data.daily[0].prices[0].amount += 1;
  await assert.rejects(h.runtime.confirmPurchase(ID, q.id), code('PURCHASE_CHANGED'));
  assert.equal(h.posts, 0);
  const b = fixture(),
    qb = await b.quote();
  b.disable();
  await assert.rejects(b.runtime.confirmPurchase(ID, qb.id), code('PURCHASE_DISABLED'));
  assert.equal(b.posts, 0);
  const c = fixture(),
    qc = await c.quote();
  c.snapshot.wallet.data[0].amount = 0;
  await assert.rejects(c.runtime.confirmPurchase(ID, qc.id), code('INSUFFICIENT_VP'));
  assert.equal(c.posts, 0);
});
test('ownership acquired in another client prevents purchase', async () => {
  const h = fixture(),
    q = await h.quote();
  h.owned.add(q.offer.item.id);
  await assert.rejects(h.runtime.confirmPurchase(ID, q.id), code('ALREADY_OWNED'));
  assert.equal(h.posts, 0);
});
test('read-only order reconciliation is account scoped and rate limited', async () => {
  const h = fixture(),
    q = await h.quote();
  await h.runtime.confirmPurchase(ID, q.id);
  h.advance(60001);
  h.owned.add(q.offer.item.id);
  assert.equal((await h.runtime.checkPurchase(ID, q.id)).state, 'complete');
  await assert.rejects(h.runtime.checkPurchase(ID, q.id), code('LOCAL_COOLDOWN'));
  await assert.rejects(h.runtime.checkPurchase(OTHER, q.id), code('ORDER_SCOPE'));
  assert.equal(h.posts, 1);
});
test('RiotClient purchase creates one order for the confirmed offer', async () => {
  const { RiotClient } = require('../.test-build/riot.js'),
    { HttpClient } = require('../.test-build/http.js');
  const requests = [];
  let checks = 0;
  const client = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      requests.push({ url, ...init });
      return response({ OrderID: OTHER, Status: 'ACCEPTED' });
    }),
    { version: async () => 'release-fixture' },
    catalog(),
  );
  const result = await client.purchaseOffer(OTHER, LEVEL, async () => {
    checks++;
  });
  assert.equal(checks, 1);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, '/store/v1/order/');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].body), { XID: OTHER, OfferID: LEVEL });
  assert.equal(result.state, 'accepted');
  assert.equal(result.orderId, OTHER);
  assert.equal(result.httpStatus, 200);
});

test('expired confirmation is refused before the submit stage', async () => {
  const h = fixture(),
    q = await h.quote();
  h.advance(45001);
  await assert.rejects(h.runtime.confirmPurchase(ID, q.id), code('PURCHASE_EXPIRED'));
  assert.equal(h.posts, 0);
  assert.equal(h.records.size, 0);
});

test('delivery is confirmed by entitlement, not only an order string', async () => {
  const h = fixture();
  h.deliver();
  const q = await h.quote(),
    r = await h.runtime.confirmPurchase(ID, q.id);
  assert.equal(r.state, 'complete');
  assert.equal(r.ownershipVerified, true);
  assert.equal(h.posts, 1);
});
test('expiry while awaiting the actual dispatcher cannot spend', async () => {
  const h = fixture(),
    q = await h.quote(),
    release = h.queue();
  const work = h.runtime.confirmPurchase(ID, q.id);
  await new Promise((r) => setImmediate(r));
  h.advance(45001);
  release();
  const r = await work;
  assert.equal(r.state, 'not-submitted');
  assert.equal(r.errorCode, 'PURCHASE_EXPIRED');
  assert.equal(h.posts, 0);
});
test('an account switch before dispatch cancels the intent with no POST', async () => {
  const h = fixture(),
    q = await h.quote(),
    release = h.queue();
  let current = true;
  const work = h.runtime.confirmPurchase(ID, q.id, () => {
    if (!current) throw new AppError('ACCOUNT_CHANGED', 'Changed account');
  });
  await new Promise((r) => setImmediate(r));
  current = false;
  release();
  const r = await work;
  assert.equal(r.state, 'not-submitted');
  assert.equal(h.posts, 0);
});
test('unconfirmed legacy skin blocks itself but not a different daily skin', async () => {
  const h = fixture(),
    first = h.snapshot.store.data.daily[0],
    second = h.snapshot.store.data.daily[1];
  h.records.set(OTHER, {
    id: OTHER,
    accountId: ID,
    offerId: first.id,
    itemId: first.item.id,
    name: first.item.name,
    price: 1775,
    at: Date.now(),
    state: 'unknown',
  });
  await assert.rejects(h.quote(), code('ORDER_PENDING'));
  h.advance(15001);
  const q = await h.runtime.purchaseQuote(ID, second.item.id);
  assert.equal(q.offer.item.id, second.item.id);
  assert.equal(h.posts, 0);
});
test('a prepared-only intent is reconciled without another mutation', async () => {
  const h = fixture(),
    first = h.snapshot.store.data.daily[0];
  h.records.set(OTHER, {
    id: OTHER,
    accountId: ID,
    offerId: first.id,
    itemId: first.item.id,
    name: first.item.name,
    price: 1775,
    at: Date.now(),
    state: 'submitting',
    phase: 'prepared',
  });
  const q = await h.quote();
  assert.equal(h.records.get(OTHER).state, 'not-submitted');
  assert.equal(q.offer.item.id, first.item.id);
  assert.equal(h.posts, 0);
});
test('verification failure retains a pending receipt and never resubmits', async () => {
  const h = fixture(),
    q = await h.quote(),
    original = h.client.ownedIds;
  h.client.ownedIds = async () => {
    if (h.posts) throw new AppError('NETWORK', 'Unavailable');
    return original();
  };
  const r = await h.runtime.confirmPurchase(ID, q.id);
  assert.equal(r.state, 'accepted');
  assert.equal(h.posts, 1);
  assert.ok(r.lastCheckedAt);
});

test('receipt checking cannot race an active purchase or downgrade its result', async () => {
  const h = fixture(),
    q = await h.quote(),
    release = h.hold();
  const submit = h.runtime.confirmPurchase(ID, q.id);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(h.runtime.checkPurchase(ID, q.id), code('PURCHASE_BUSY'));
  release();
  await submit;
  assert.equal(h.posts, 1);
});
test('simultaneous receipt checks share one account-scoped read', async () => {
  const h = fixture(),
    q = await h.quote();
  await h.runtime.confirmPurchase(ID, q.id);
  h.advance(60001);
  const original = h.client.ownedIds;
  let reads = 0,
    release;
  const pending = new Promise((r) => (release = r));
  h.client.ownedIds = async () => {
    reads++;
    await pending;
    return original();
  };
  const a = h.runtime.checkPurchase(ID, q.id),
    b = h.runtime.checkPurchase(ID, q.id);
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 1);
  await assert.rejects(
    h.runtime.purchaseQuote(ID, h.snapshot.store.data.daily[1].item.id),
    code('PURCHASE_BUSY'),
  );
  release();
  const [x, y] = await Promise.all([a, b]);
  assert.equal(x.id, y.id);
  assert.equal(h.posts, 1);
});
test('read-only ownership rate limits survive in the saved purchase receipt', async () => {
  const h = fixture(),
    q = await h.quote();
  const original = h.client.ownedIds;
  const retryAt = Date.now() + 300000;
  h.client.ownedIds = async () => {
    if (h.posts) throw new AppError('RATE_LIMIT', 'Wait', retryAt, 429);
    return original();
  };
  const r = await h.runtime.confirmPurchase(ID, q.id);
  assert.equal(r.retryAt, retryAt);
  assert.equal(r.state, 'accepted');
  h.advance(60001);
  await assert.rejects(h.runtime.checkPurchase(ID, q.id), code('RATE_LIMIT'));
  assert.equal(h.posts, 1);
});

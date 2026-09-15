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
    diskFailure = false;
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
      createOrder: async (id, offer) => {
        assert.equal(records.get(id).state, 'submitting');
        posts++;
        if (hold) await hold;
        if (error) throw error;
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
  assert.equal((await h.runtime.checkPurchase(ID, q.id)).state, 'complete');
  await assert.rejects(h.runtime.checkPurchase(ID, q.id), code('LOCAL_COOLDOWN'));
  await assert.rejects(h.runtime.checkPurchase(OTHER, q.id), code('ORDER_SCOPE'));
  assert.equal(h.posts, 1);
});
test('RiotClient order request uses the reviewed endpoint and exact caller XID', async () => {
  const { RiotClient } = require('../.test-build/riot.js'),
    { HttpClient } = require('../.test-build/http.js');
  const requests = [];
  const client = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      requests.push({ url, ...init });
      return response({ OrderID: OTHER, Status: 'ACCEPTED' });
    }),
    { version: async () => 'release-fixture' },
    catalog(),
  );
  await client.createOrder(ID, LEVEL);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://pd.ap.a.pvp.net/store/v1/order/');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].body), { XID: ID, OfferID: LEVEL });
});

test('expired confirmation is refused before the submit stage', async () => {
  const h = fixture(),
    q = await h.quote();
  h.advance(45001);
  await assert.rejects(h.runtime.confirmPurchase(ID, q.id), code('PURCHASE_EXPIRED'));
  assert.equal(h.posts, 0);
  assert.equal(h.records.size, 0);
});

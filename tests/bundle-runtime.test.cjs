const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const {
  ID,
  OTHER,
  uid,
  clone,
  bundleFixture,
  ITEM_TYPES,
  CURRENCIES,
} = require('./bundle-fixture.cjs');
const { AppError } = require('../.test-build/validation.js');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function fixture() {
  let now = Date.now(),
    n = 500,
    allowed = true,
    posts = 0,
    queue,
    hold,
    error,
    diskPhase,
    delivered = [],
    inventoryFailure,
    checked = [];
  const data = bundleFixture(now),
    records = new Map(),
    stamps = new Map();
  const repository = {
    settings: async () => ({ allowPurchases: allowed }),
    purchaseRecords: async (id) => [...records.values()].filter((r) => r.accountId === id),
    savePurchaseRecord: async (r) => {
      if (diskPhase === r.phase) throw Error('disk full');
      records.set(r.id, clone(r));
    },
    snapshot: async () => null,
    notificationStamp: async (key) => stamps.get(key) ?? null,
    setNotificationStamp: async (k, v) => stamps.set(k, v),
  };
  const mod = { exports: {} };
  const load = (name) =>
    name === 'react-native'
      ? { Platform: { OS: 'android' } }
      : name === './network'
        ? {
            nativeFetcher: () => {
              throw Error('No network in fixtures');
            },
          }
        : name === './chatStorage'
          ? { activateChatStorage() {}, removeChatStorage: async () => {} }
          : name === './secure'
            ? { vault: {}, randomHex: () => 'a'.repeat(64), randomId: () => uid(++n) }
            : name === './storage'
              ? { openRepository: async () => repository }
              : name === './notifications'
                ? {}
                : name.startsWith('../core/')
                  ? require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'))
                  : (() => {
                      throw Error(name);
                    })();
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
    load,
    mod,
    mod.exports,
  );
  const runtime = new mod.exports.Runtime(repository, () => now),
    client = {
      store: async () => ({ ...data.store, fetchedAt: now }),
      wallet: async () => data.wallet,
      ownedIds: async () => new Set(data.owned.get(ITEM_TYPES.skin)?.keys() ?? []),
      ownedQuantities: async (type) => {
        checked.push(type);
        if (inventoryFailure && posts) throw inventoryFailure;
        return data.owned.get(type) ?? new Map();
      },
      purchaseBundle: async (lines, price, guard) => {
        if (queue) await queue;
        await guard();
        assert.equal([...records.values()].at(-1).phase, 'dispatching');
        posts++;
        if (hold) await hold;
        for (const line of lines)
          if (delivered.includes(line.itemId))
            data.owned.get(line.itemTypeId).set(line.itemId, line.quantity);
        if (error) throw error;
        return { state: 'accepted', httpStatus: 200 };
      },
      purchaseOffer: async () => {
        throw Error('Never fall back to individual purchases');
      },
    };
  runtime.client = async () => client;
  runtime.catalog = data.catalog;
  return {
    runtime,
    client,
    records,
    checked,
    ...data,
    get posts() {
      return posts;
    },
    get now() {
      return now;
    },
    advance: (ms) => (now += ms),
    quote: () => runtime.purchaseQuote(ID, data.bundle.id, 'bundle'),
    deliver: (...ids) => (delivered = ids),
    fail: (e) => (error = e),
    failInventory: (e) => (inventoryFailure = e),
    disable: () => (allowed = false),
    diskFail: (phase) => (diskPhase = phase),
    queue() {
      let release;
      queue = new Promise((r) => (release = r));
      return release;
    },
    hold() {
      let release;
      hold = new Promise((r) => (release = r));
      return release;
    },
  };
}
test('bundle confirmation journals one batch and checks every entitlement category', async () => {
  const h = fixture(),
    q = await h.quote();
  h.deliver(...q.bundle.lines.map((l) => l.itemId));
  const r = await h.runtime.confirmPurchase(ID, q.id);
  assert.equal(h.posts, 1);
  assert.equal(r.state, 'complete');
  assert.equal(r.ownershipVerified, true);
  assert.equal(r.bundle.delivered.length, 3);
  assert.equal(new Set(h.checked).size, 3);
  await assert.rejects(
    h.runtime.confirmPurchase(ID, q.id),
    (e) => e.code === 'PURCHASE_CONFIRMATION',
  );
  assert.equal(h.posts, 1);
});
test('partial bundle delivery remains unknown and prevents another batch for the missing items', async () => {
  const h = fixture(),
    q = await h.quote();
  h.deliver(q.bundle.lines[0].itemId);
  const r = await h.runtime.confirmPurchase(ID, q.id);
  assert.equal(r.state, 'unknown');
  assert.deepEqual(r.bundle.delivered, [q.bundle.lines[0].itemId]);
  h.advance(60000);
  h.bundle.checkout.wholesaleOnly = false;
  await assert.rejects(h.quote(), (e) => e.code === 'ORDER_PENDING');
  assert.equal(h.posts, 1);
});
test('bundle timeout or malformed server result cannot trigger retry or individual-item fallback', async () => {
  const h = fixture(),
    q = await h.quote();
  h.fail(new AppError('TIMEOUT', 'No response'));
  assert.equal((await h.runtime.confirmPurchase(ID, q.id)).state, 'unknown');
  h.advance(60000);
  await assert.rejects(h.quote(), (e) => e.code === 'ORDER_PENDING');
  assert.equal(h.posts, 1);
});
for (const phase of ['prepared', 'dispatching'])
  test('failed ' + phase + ' journal prevents a bundle purchase', async () => {
    const h = fixture(),
      q = await h.quote();
    h.diskFail(phase);
    await h.runtime.confirmPurchase(ID, q.id).catch(() => {});
    assert.equal(h.posts, 0);
  });
test('account switch and expiry while queued prevent the bundle request', async () => {
  for (const mode of ['account', 'expiry']) {
    const h = fixture(),
      q = await h.quote(),
      release = h.queue();
    let selected = true;
    const work = h.runtime.confirmPurchase(ID, q.id, () => {
      if (!selected) throw new AppError('ACCOUNT_CHANGED', 'Changed');
    });
    await new Promise((r) => setImmediate(r));
    if (mode === 'account') selected = false;
    else h.advance(46000);
    release();
    const result = await work;
    assert.equal(result.state, 'not-submitted');
    assert.equal(h.posts, 0);
  }
});
test('disabled purchases, changed line prices or inventory acquired elsewhere prevent dispatch', async () => {
  for (const [mutate, code] of [
    [(h) => h.disable(), 'PURCHASE_DISABLED'],
    [
      (h) => {
        h.bundle.checkout.lines[0].price++;
        h.bundle.checkout.lines[1].price--;
      },
      'PURCHASE_CHANGED',
    ],
    [(h) => h.owned.get(ITEM_TYPES.card).set(uid(2), 1), 'BUNDLE_OFFERS'],
  ]) {
    const h = fixture(),
      q = await h.quote();
    mutate(h);
    await assert.rejects(h.runtime.confirmPurchase(ID, q.id), (e) => e.code === code);
    assert.equal(h.posts, 0);
  }
});
test('bundle receipt verification is read-only, account scoped and rate limited', async () => {
  const h = fixture(),
    q = await h.quote(),
    record = await h.runtime.confirmPurchase(ID, q.id);
  h.advance(60001);
  for (const line of q.bundle.lines) h.owned.get(line.itemTypeId).set(line.itemId, line.quantity);
  const confirmed = await h.runtime.checkPurchase(ID, record.id);
  assert.equal(confirmed.state, 'complete');
  assert.equal(h.posts, 1);
  await assert.rejects(h.runtime.checkPurchase(ID, record.id), (e) => e.code === 'LOCAL_COOLDOWN');
  await assert.rejects(h.runtime.checkPurchase(OTHER, record.id), (e) => e.code === 'ORDER_SCOPE');
});
test('uncertain bundle blocks an overlapping skin but not an unrelated offer', async () => {
  const h = fixture(),
    q = await h.quote();
  await h.runtime.confirmPurchase(ID, q.id);
  const record = [...h.records.values()][0];
  const { unresolvedForItem } = require('../.test-build/purchases.js');
  assert.equal(unresolvedForItem(record, q.bundle.lines[0].itemId), true);
  assert.equal(unresolvedForItem(record, uid(999)), false);
});
test('concurrent confirmations send at most one bundle batch', async () => {
  const h = fixture(),
    q = await h.quote(),
    release = h.hold();
  const first = h.runtime.confirmPurchase(ID, q.id);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(h.runtime.confirmPurchase(ID, q.id), (e) => e.code === 'PURCHASE_BUSY');
  release();
  await first;
  assert.equal(h.posts, 1);
});
test('bundle inventory failures preserve the pending receipt and server deadline', async () => {
  const h = fixture(),
    q = await h.quote(),
    deadline = h.now + 300000;
  h.failInventory(new AppError('RATE_LIMIT', 'Wait', deadline, 429));
  const result = await h.runtime.confirmPurchase(ID, q.id);
  assert.equal(result.state, 'unknown');
  assert.equal(result.retryAt, deadline);
  h.advance(60001);
  await assert.rejects(h.runtime.checkPurchase(ID, result.id), (e) => e.code === 'RATE_LIMIT');
  assert.equal(h.posts, 1);
});

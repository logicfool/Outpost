const test = require('node:test'),
  assert = require('node:assert/strict');
const { session, ID, catalog } = require('./helpers.cjs');
const { RiotClient } = require('../.test-build/riot.js');
const { makeDemo } = require('../.test-build/demo.js');
const { snapshotPlan } = require('../.test-build/refreshPolicy.js');
const { CURRENCIES } = require('../.test-build/normalize.js');
test('real snapshot loader repairs only NOT_LOADED wallet without refetching guns or profile', async () => {
  const account = session();
  const saved = { ...makeDemo().snapshot, accountId: ID, demo: false };
  saved.wallet = { status: 'error', code: 'NOT_LOADED', message: 'Not loaded' };
  const c = new RiotClient(account, {}, {}, catalog());
  const requests = [];
  c.read = async (path) => {
    requests.push(path);
    assert.equal(path, `/store/v1/wallet/${ID}`);
    return {
      data: { Balances: { [CURRENCIES.VP]: 1250, [CURRENCIES.RP]: 25, [CURRENCIES.KC]: 300 } },
    };
  };
  const next = await c.snapshot(saved, snapshotPlan(saved, 'auto'));
  assert.equal(requests.length, 1);
  assert.equal(next.store, saved.store);
  assert.equal(next.rank, saved.rank);
  assert.equal(next.collection, saved.collection);
  assert.equal(next.wallet.status, 'ready');
  assert.equal(next.wallet.data.find((v) => v.symbol === 'VP').amount, 1250);
});
test('missing-only snapshots keep previously attempted errors instead of hammering their endpoint', async () => {
  const saved = { ...makeDemo().snapshot, accountId: ID, demo: false };
  saved.wallet = { status: 'error', code: 'INITIAL_SYNC_WAIT', message: 'Wait', retryAt: 1 };
  saved.rank = { status: 'error', code: 'ACCESS_DENIED', message: 'Unavailable' };
  const c = new RiotClient(session(), {}, {}, catalog());
  const requests = [];
  c.read = async (path) => {
    requests.push(path);
    return { data: { Balances: { [CURRENCIES.VP]: 10 } } };
  };
  const next = await c.snapshot(saved, snapshotPlan(saved, 'auto'));
  assert.equal(requests.length, 1);
  assert.deepEqual(next.rank, saved.rank);
  assert.equal(next.wallet.status, 'ready');
});

test('an initial retry placeholder replaces NOT_LOADED and retains the retry deadline', () => {
  const { emptySnapshot, waitingSnapshot } = require('../.test-build/refreshPolicy.js');
  const { mergeSnapshot } = require('../.test-build/snapshot.js');
  const old = emptySnapshot(ID),
    next = waitingSnapshot(ID, old, Date.now() + 60000);
  const result = mergeSnapshot(old, next);
  assert.equal(result.store.code, 'INITIAL_SYNC_WAIT');
  assert.equal(result.store.retryAt, next.store.retryAt);
  assert.equal(result.wallet.code, 'INITIAL_SYNC_WAIT');
});

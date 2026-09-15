const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  ts = require('typescript');
const { ID, OTHER, code } = require('./helpers.cjs');
const { makeDemo } = require('../.test-build/demo.js');
const { mergeSnapshot } = require('../.test-build/snapshot.js');
const { AppError } = require('../.test-build/validation.js');
const {
  DAY_MS,
  LIVE_POLL_MS,
  nextAutomaticAt,
  storeResetAt,
  snapshotPlan,
  keepCached,
} = require('../.test-build/refreshPolicy.js');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function fixture() {
  let now = Date.parse('2026-09-15T12:00:00Z');
  const snapshots = new Map(),
    gates = new Map(),
    accounts = new Set([ID, OTHER]);
  const calls = { snapshots: 0, live: 0, init: 0, metadata: 0 },
    plans = [];
  let liveError, snapshotError, hold;
  const repo = {
    snapshot: async (id) => structuredClone(snapshots.get(id) ?? null),
    saveSnapshot: async (s) =>
      snapshots.set(
        s.accountId,
        mergeSnapshot(snapshots.get(s.accountId) ?? null, structuredClone(s)),
      ),
    accounts: async () => [...accounts].map((puuid) => ({ puuid })),
    settings: async () => ({ reminders: false }),
    refreshGate: async (id, k) => structuredClone(gates.get(id + ':' + k) ?? null),
    saveRefreshGate: async (id, k, v) => {
      gates.set(id + ':' + k, structuredClone(v));
    },
    removeAccount: async (id) => {
      accounts.delete(id);
      snapshots.delete(id);
    },
    catalog: async () => null,
    saveCatalog: async () => {},
    clearCache: async () => snapshots.clear(),
  };
  const gameSnapshot = (id = ID, at = now) => {
    const value = makeDemo(at).snapshot;
    return {
      ...value,
      accountId: id,
      demo: false,
      store: {
        ...value.store,
        data: { ...value.store.data, dailyExpiresAt: at + DAY_MS, clockOffsetMs: 0 },
      },
    };
  };
  const client = {
    snapshot: async (previous, plan) => {
      calls.snapshots++;
      plans.push(plan);
      if (hold) await hold;
      if (snapshotError) throw snapshotError;
      const next = gameSnapshot(previous?.accountId ?? ID);
      if (previous && !plan.collection) next.collection = previous.collection;
      if (!plan.live)
        next.liveGame = previous?.liveGame ?? {
          status: 'error',
          code: 'NOT_LOADED',
          message: 'Not checked',
        };
      return next;
    },
    liveGame: async () => {
      calls.live++;
      if (hold) await hold;
      if (liveError) throw liveError;
      return { state: 'idle', observedAt: now };
    },
  };
  const module = { exports: {} };
  const load = (name) => {
    if (name === 'react-native') return { Platform: { OS: 'ios' } };
    if (name === './network') return { nativeFetcher: fetch };
    if (name === './chatStorage')
      return { activateChatStorage() {}, removeChatStorage: async () => {} };
    if (name === './secure')
      return { vault: { remove: async () => {} }, randomHex: () => 'a'.repeat(64) };
    if (name === './storage') return { openRepository: async () => repo };
    if (name === './notifications')
      return {
        cancelAccountNotifications: async () => {},
        updateStoreNotifications: async () => {},
      };
    if (name.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
    throw Error(name);
  };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
    load,
    module,
    module.exports,
  );
  const create = () => {
    const r = new module.exports.Runtime(repo, () => now);
    r.loadCatalog = async () => {
      calls.metadata++;
      return {};
    };
    r.client = async () => {
      calls.init++;
      return client;
    };
    return r;
  };
  return {
    runtime: create(),
    create,
    calls,
    plans,
    snapshots,
    gates,
    gameSnapshot,
    advance: (ms) => (now += ms),
    get now() {
      return now;
    },
    failLive: (e) => (liveError = e),
    failSnapshot: (e) => (snapshotError = e),
    hold() {
      let release;
      hold = new Promise((r) => (release = r));
      return () => {
        release();
        hold = undefined;
      };
    },
  };
}
test('fresh daily store means zero network on launch/resume/background checks', async () => {
  const f = fixture();
  f.snapshots.set(ID, f.gameSnapshot());
  for (let n = 0; n < 20; n++) {
    await f.runtime.sync(ID);
    f.advance(60000);
  }
  assert.equal(f.calls.snapshots, 0);
  assert.equal(f.calls.init, 0);
  assert.equal(f.calls.metadata, 0);
});
test('a new Runtime on app restart still respects the cached store expiry', async () => {
  const f = fixture();
  f.snapshots.set(ID, f.gameSnapshot());
  await f.create().sync(ID);
  assert.equal(f.calls.init, 0);
});
test('automatic reset refresh begins once after the reported reset plus propagation grace', async () => {
  const f = fixture();
  const old = f.gameSnapshot();
  f.snapshots.set(ID, old);
  f.advance(DAY_MS);
  await f.runtime.sync(ID);
  assert.equal(f.calls.snapshots, 0);
  f.advance(2001);
  await f.runtime.sync(ID);
  assert.equal(f.calls.snapshots, 1);
  for (let n = 0; n < 20; n++) await f.runtime.sync(ID);
  assert.equal(f.calls.snapshots, 1);
});
test('store expiry uses server-clock offset rather than wrong device midnight', () => {
  const f = fixture(),
    s = f.gameSnapshot();
  s.store.data.clockOffsetMs = 3 * 3600000;
  s.store.data.dailyExpiresAt = f.now + 3 * 3600000 + 120000;
  assert.equal(storeResetAt(s), f.now + 122000);
});
test('simultaneous reset and foreground checks share the same refresh', async () => {
  const f = fixture(),
    release = f.hold();
  const a = f.runtime.sync(ID),
    b = f.runtime.sync(ID);
  release();
  await Promise.all([a, b]);
  assert.equal(f.calls.snapshots, 1);
});
test('manual pull can refresh a non-expired store but repeated pulls cannot spam it', async () => {
  const f = fixture();
  f.snapshots.set(ID, f.gameSnapshot());
  await f.runtime.sync(ID, 'manual');
  assert.equal(f.calls.snapshots, 1);
  await assert.rejects(f.runtime.sync(ID, 'manual'), code('LOCAL_COOLDOWN'));
  await assert.rejects(f.create().sync(ID, 'manual'), code('LOCAL_COOLDOWN'));
  f.advance(60001);
  await f.runtime.sync(ID, 'manual');
  assert.equal(f.calls.snapshots, 2);
});
test('automatic worker never performs live polling, regardless of token age', async () => {
  const f = fixture();
  await f.runtime.sync(ID);
  assert.equal(f.plans[0].live, false);
  assert.equal(f.calls.live, 0);
});
test('automatic reset reuses collection less than a day old, while manual refresh can fetch it', () => {
  const f = fixture(),
    s = f.gameSnapshot();
  assert.equal(snapshotPlan(s, 'auto', f.now + 300000).collection, false);
  assert.equal(snapshotPlan(s, 'manual', f.now).collection, true);
  assert.equal(snapshotPlan(s, 'auto', f.now + DAY_MS).collection, true);
});
test('live discovery is sampled at most once per sixty seconds, including idle', async () => {
  const f = fixture();
  f.snapshots.set(ID, f.gameSnapshot());
  await f.runtime.live(ID);
  f.advance(59999);
  await f.runtime.live(ID);
  await f.create().live(ID);
  assert.equal(f.calls.live, 1);
  f.advance(1);
  await f.runtime.live(ID);
  assert.equal(f.calls.live, 2);
});
test('simultaneous profile/modal live calls cannot duplicate a discovery', async () => {
  const f = fixture(),
    release = f.hold();
  const a = f.runtime.live(ID),
    b = f.runtime.live(ID);
  release();
  await Promise.all([a, b]);
  assert.equal(f.calls.live, 1);
});
test('network failures are cached too; reopening screens does not reset their cooldown', async () => {
  const f = fixture();
  f.failLive(new AppError('NETWORK', 'Offline'));
  await f.runtime.live(ID);
  await f.create().live(ID);
  assert.equal(f.calls.live, 1);
  f.advance(60000);
  await f.runtime.live(ID);
  f.advance(60000);
  await f.create().live(ID);
  assert.equal(f.calls.live, 2);
});
test('Retry-After survives runtime restart and overrides sixty-second live cadence', async () => {
  const f = fixture();
  f.failLive(new AppError('RATE_LIMIT', 'Wait', f.now + 20 * 60000, 429));
  const result = await f.runtime.live(ID);
  assert.equal(result.retryAt, f.now + 20 * 60000);
  f.advance(60001);
  await f.create().live(ID);
  assert.equal(f.calls.live, 1);
});
test('sync failures keep cached offers and delay automatic retry; manual cannot bypass Retry-After', async () => {
  const f = fixture();
  const s = f.gameSnapshot();
  s.store.data.dailyExpiresAt = f.now - 1;
  f.snapshots.set(ID, s);
  f.advance(3000);
  f.failSnapshot(new AppError('RATE_LIMIT', 'Wait', f.now + 10 * 60000, 429));
  const result = await f.runtime.sync(ID);
  assert.equal(result.store.status, 'ready');
  assert.equal(result.refreshIssue.code, 'RATE_LIMIT');
  assert.ok(result.nextAutoRefreshAt >= f.now + 10 * 60000);
  f.advance(60001);
  await f.create().sync(ID);
  await assert.rejects(f.runtime.sync(ID, 'manual'), code('LOCAL_COOLDOWN'));
  assert.equal(f.calls.snapshots, 1);
});
test('a persisted in-flight reservation prevents a restart retry storm after a crash', async () => {
  const f = fixture();
  f.gates.set(ID + ':sync', {
    attemptedAt: f.now,
    notBefore: f.now + 60000,
    autoNotBefore: f.now + 300000,
    failures: 0,
  });
  await f.runtime.sync(ID);
  assert.equal(f.calls.init, 0);
  assert.equal(f.calls.snapshots, 0);
});
test('per-account live budgets remain separate', async () => {
  const f = fixture();
  await f.runtime.live(ID);
  await f.runtime.live(OTHER);
  assert.equal(f.calls.live, 2);
  await f.runtime.live(ID);
  assert.equal(f.calls.live, 2);
});
test('a foreign cached snapshot cannot appear after account switching', async () => {
  const f = fixture();
  f.snapshots.set(ID, f.gameSnapshot(OTHER));
  await assert.rejects(f.runtime.sync(ID), code('ACCOUNT_MISMATCH'));
  assert.equal(f.calls.init, 0);
});
test('a delayed live error cannot wake a store refresh earlier or block a valid store reset', () => {
  const f = fixture(),
    s = f.gameSnapshot();
  s.liveGame = {
    status: 'error',
    code: 'RATE_LIMIT',
    message: 'Wait',
    retryAt: f.now + 3 * DAY_MS,
  };
  assert.equal(nextAutomaticAt(s, null, f.now), f.now + DAY_MS + 2000);
});
test('failed data refresh preserves old values with an explicit stale warning', () => {
  const old = { status: 'ready', data: [1], fetchedAt: 10 };
  const value = keepCached(old, { status: 'error', code: 'NETWORK', message: 'Offline' });
  assert.equal(value.fetchedAt, 10);
  assert.deepEqual(value.data, [1]);
  assert.equal(value.warning.code, 'NETWORK');
});
test('not-loaded placeholders from a daily sync do not erase a concurrent live result', () => {
  const f = fixture(),
    a = f.gameSnapshot(),
    b = f.gameSnapshot();
  b.liveGame = { status: 'error', code: 'NOT_LOADED', message: 'Not checked' };
  assert.deepEqual(mergeSnapshot(a, b).liveGame, a.liveGame);
});

test('cached automatic launch restores catalog metadata without contacting a public endpoint', async () => {
  const f = fixture(),
    meta = {
      items: { card: { name: 'Cached card' } },
      maps: {},
      tiers: {},
      bundles: {},
      contracts: {},
      fetchedAt: f.now,
      schemaVersion: 5,
    };
  f.snapshots.set(ID, f.gameSnapshot());
  f.runtime.repository.catalog = async () => meta;
  await f.runtime.sync(ID);
  assert.deepEqual(f.runtime.catalog, meta);
  assert.equal(f.calls.metadata, 0);
  assert.equal(f.calls.init, 0);
});

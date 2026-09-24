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
test('visible idle discovery is sampled once per fifteen seconds across runtimes', async () => {
  const f = fixture();
  f.snapshots.set(ID, f.gameSnapshot());
  await f.runtime.live(ID);
  f.advance(14999);
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

const {
  emptySnapshot,
  waitingSnapshot,
  failedSnapshot,
  hasUnloadedSections,
  shouldFetchSection,
} = require('../.test-build/refreshPolicy.js');
test('first account cooldown exposes when it retries, then loads once without another sign-in', async () => {
  const f = fixture();
  const until = f.now + 300000;
  f.gates.set(ID + ':sync', {
    attemptedAt: f.now,
    notBefore: f.now + 60000,
    autoNotBefore: until,
    failures: 0,
  });
  const pending = await f.runtime.sync(ID);
  assert.equal(pending.store.code, 'INITIAL_SYNC_WAIT');
  assert.equal(pending.wallet.retryAt, until);
  assert.equal(pending.nextAutoRefreshAt, until);
  assert.equal(f.calls.snapshots, 0);
  f.advance(300001);
  const ready = await f.create().sync(ID);
  assert.equal(ready.store.status, 'ready');
  assert.equal(ready.wallet.status, 'ready');
  assert.equal(f.calls.snapshots, 1);
  for (let i = 0; i < 20; i++) await f.runtime.sync(ID);
  assert.equal(f.calls.snapshots, 1);
});
test('a persisted NOT_LOADED snapshot does not count as a completed daily refresh', async () => {
  const f = fixture();
  f.snapshots.set(ID, emptySnapshot(ID, f.now));
  const value = await f.runtime.sync(ID);
  assert.equal(value.store.status, 'ready');
  assert.equal(f.calls.snapshots, 1);
});
test('a fresh store cannot block initial loading of a missing wallet until tomorrow', async () => {
  const f = fixture(),
    saved = f.gameSnapshot();
  saved.wallet = { status: 'error', code: 'NOT_LOADED', message: 'Old placeholder' };
  f.snapshots.set(ID, saved);
  assert.equal(nextAutomaticAt(saved, null, f.now), f.now);
  await f.runtime.sync(ID);
  assert.equal(f.calls.snapshots, 1);
  assert.equal(f.plans[0].missingOnly, true);
  assert.equal(shouldFetchSection(true, saved.store, true), false);
  assert.equal(shouldFetchSection(true, saved.wallet, true), true);
});
test('partial snapshot recovery never overrides a stored Riot Retry-After', async () => {
  const f = fixture(),
    s = f.gameSnapshot();
  s.wallet = { status: 'error', code: 'NOT_LOADED', message: 'Missing' };
  f.snapshots.set(ID, s);
  f.gates.set(ID + ':sync', {
    attemptedAt: f.now,
    notBefore: f.now + 10 * 60000,
    autoNotBefore: f.now + 10 * 60000,
    failures: 1,
  });
  const result = await f.runtime.sync(ID);
  assert.equal(result.wallet.retryAt, f.now + 10 * 60000);
  assert.equal(f.calls.init, 0);
  await assert.rejects(f.runtime.sync(ID, 'manual'), code('LOCAL_COOLDOWN'));
  f.advance(60000);
  await f.create().sync(ID);
  assert.equal(f.calls.snapshots, 0);
});
test('a failure before account requests shows the actual reason instead of NOT_LOADED', async () => {
  const f = fixture();
  f.failSnapshot(new AppError('SESSION_EXPIRED', 'Reconnect this account.'));
  const result = await f.runtime.sync(ID);
  assert.equal(result.store.code, 'SESSION_EXPIRED');
  assert.equal(result.wallet.code, 'SESSION_EXPIRED');
  assert.equal(result.refreshIssue.code, 'SESSION_EXPIRED');
  assert.ok(result.nextAutoRefreshAt >= f.now + 300000);
  const again = await f.create().sync(ID);
  assert.equal(again.store.code, 'SESSION_EXPIRED');
  assert.equal(f.calls.snapshots, 1);
});
test('failed initial transport retains data and can recover after its bounded retry', async () => {
  const f = fixture();
  f.failSnapshot(new AppError('NETWORK', 'No connection'));
  const failed = await f.runtime.sync(ID);
  assert.equal(failed.store.code, 'NETWORK');
  f.advance(300001);
  f.failSnapshot(undefined);
  const ready = await f.runtime.sync(ID);
  assert.equal(ready.store.status, 'ready');
  assert.equal(ready.refreshIssue, undefined);
  assert.equal(f.calls.snapshots, 2);
});
test('no initial-recovery request is introduced for an already attempted field error in a fresh rotation', async () => {
  const f = fixture(),
    s = f.gameSnapshot();
  s.rank = { status: 'error', code: 'ACCESS_DENIED', message: 'Unavailable' };
  assert.equal(hasUnloadedSections(s), false);
  f.snapshots.set(ID, s);
  await f.runtime.sync(ID);
  assert.equal(f.calls.snapshots, 0);
});
test('a waiting placeholder cannot erase a separately completed wallet or live observation', () => {
  const f = fixture(),
    ready = f.gameSnapshot(),
    wait = waitingSnapshot(ID, null, f.now + 60000, f.now);
  const result = mergeSnapshot(ready, wait);
  assert.deepEqual(result.store, ready.store);
  assert.deepEqual(result.wallet, ready.wallet);
  assert.deepEqual(result.liveGame, ready.liveGame);
});

test('optional wishlist notification setup cannot hide successfully loaded store and wallet', async () => {
  const f = fixture();
  f.runtime.repository.settings = async () => ({ reminders: true, wishlistAlerts: true });
  f.runtime.repository.wishlist = async () => {
    throw new AppError('LOCAL_DATA', 'Wishlist unavailable');
  };
  const result = await f.runtime.sync(ID);
  assert.equal(result.store.status, 'ready');
  assert.equal(result.wallet.status, 'ready');
  assert.equal(f.calls.snapshots, 1);
});
test('optional notification preferences failure does not turn successful store into initial error', async () => {
  const f = fixture();
  f.runtime.repository.settings = async () => {
    throw new AppError('LOCAL_DATA', 'Preferences unavailable');
  };
  const result = await f.runtime.sync(ID);
  assert.equal(result.store.status, 'ready');
  assert.equal(result.refreshIssue, undefined);
});

test('opening a report upgrades old map metadata once without refreshing the store', async () => {
  const f = fixture();
  let publicCalls = 0;
  const old = {
    items: { card: { name: 'Cached' } },
    schemaVersion: 7,
    maps: { ascent: { name: 'Ascent' } },
    bundles: {},
    contracts: {},
    tiers: {},
    fetchedAt: f.now,
  };
  const fresh = {
    ...old,
    schemaVersion: require('../.test-build/catalog.js').CATALOG_SCHEMA_VERSION,
    maps: {
      ascent: {
        name: 'Ascent',
        minimap: 'https://media.valorant-api.com/maps/map.png',
        xMultiplier: 0.1,
        yMultiplier: 0.1,
        xScalarToAdd: 0.5,
        yScalarToAdd: 0.5,
      },
    },
  };
  f.runtime.repository.catalog = async () => old;
  f.runtime.publicClient = {
    load: async () => {
      publicCalls++;
      return fresh;
    },
  };
  const load = Object.getPrototypeOf(f.runtime).loadCatalog;
  await load.call(f.runtime, false, false);
  assert.equal(publicCalls, 0);
  await load.call(f.runtime);
  await load.call(f.runtime);
  assert.equal(publicCalls, 1);
  assert.equal(
    f.runtime.catalog.schemaVersion,
    require('../.test-build/catalog.js').CATALOG_SCHEMA_VERSION,
  );
  assert.equal(f.calls.snapshots, 0);
});
test('a weapons-only media refresh cannot mark old map metadata as migrated', async () => {
  const f = fixture();
  f.runtime.catalog = {
    items: {},
    schemaVersion: 7,
    maps: { ascent: { name: 'Ascent' } },
    weapons: {},
    bundles: {},
    contracts: {},
    tiers: {},
    fetchedAt: f.now,
  };
  f.runtime.publicClient = { weaponSkins: async () => ({ data: [] }) };
  await f.runtime.refreshMedia();
  assert.equal(f.runtime.catalog.schemaVersion, 7);
  assert.equal(f.runtime.catalog.maps.ascent.minimap, undefined);
});

test('recoverable session setup failure is retried after cooldown even with a healthy daily store', async () => {
  const f = fixture(),
    s = f.gameSnapshot();
  s.refreshIssue = { code: 'RENEWAL_WAIT', message: 'Waiting', retryAt: f.now + 60000 };
  f.snapshots.set(ID, s);
  f.gates.set(ID + ':sync', {
    attemptedAt: f.now,
    notBefore: f.now + 60000,
    autoNotBefore: f.now + 60000,
    failures: 1,
  });
  await f.runtime.sync(ID);
  assert.equal(f.calls.snapshots, 0);
  f.advance(60001);
  await f.runtime.sync(ID);
  assert.equal(f.calls.snapshots, 1);
  assert.equal(f.plans[0].missingOnly, true);
});
test('healthy cached account data stays cached during credential recovery', () => {
  const f = fixture(),
    s = f.gameSnapshot();
  s.wallet = { ...s.wallet, warning: { code: 'SESSION_EXPIRED', message: 'Expired' } };
  const p = snapshotPlan(s, 'auto', f.now);
  assert.equal(p.missingOnly, true);
  assert.equal(shouldFetchSection(true, s.store, p.missingOnly), false);
  assert.equal(shouldFetchSection(true, s.wallet, p.missingOnly), true);
});
test('interactive sign-in requirement is not a one-minute automatic login loop', () => {
  const f = fixture(),
    s = f.gameSnapshot();
  s.refreshIssue = { code: 'REAUTH_REQUIRED', message: 'Challenge' };
  assert.equal(nextAutomaticAt(s, null, f.now), s.store.data.dailyExpiresAt + 2000);
});
test('manual account refresh does not wait for or force a full public catalogue download', async () => {
  const f = fixture();
  f.snapshots.set(ID, f.gameSnapshot());
  f.runtime.catalog = makeDemo().catalog;
  f.runtime.loadCatalog = async () => {
    throw Error('A manual account refresh must reuse available metadata');
  };
  const result = await f.runtime.sync(ID, 'manual');
  assert.equal(result.store.status, 'ready');
  assert.equal(f.calls.snapshots, 1);
  assert.equal(result.refreshIssue, undefined);
});
test('in-flight optional catalogue maintenance does not block a cached account refresh', async () => {
  const f = fixture();
  f.runtime.catalog = makeDemo().catalog;
  f.snapshots.set(ID, f.gameSnapshot());
  f.runtime.catalogFlight = new Promise(() => {});
  f.runtime.loadCatalog = async () => f.runtime.catalogFlight;
  const result = await Promise.race([
    f.runtime.sync(ID, 'manual'),
    new Promise((_, reject) =>
      setTimeout(() => reject(Error('Refresh waited for metadata')), 1000),
    ),
  ]);
  assert.equal(result.wallet.status, 'ready');
  assert.equal(f.calls.snapshots, 1);
});
test('missing public metadata recovery is single-flight and records its cooldown before requesting data', async () => {
  const f = fixture(),
    s = f.gameSnapshot(),
    id = '77777777-7777-4777-8777-777777777777';
  s.loadout = {
    status: 'ready',
    fetchedAt: f.now,
    data: { guns: [], card: { id, canonicalId: id, kind: 'card', name: 'Unresolved item' } },
  };
  f.runtime.catalog = { ...makeDemo().catalog, repairAfter: undefined };
  let requests = 0,
    saved,
    release;
  const wait = new Promise((r) => (release = r));
  f.runtime.repository.saveCatalog = async (c) => {
    saved = c;
  };
  f.runtime.publicClient = {
    repair: async (previous, paths) => {
      assert.equal(saved.repairAfter, f.now + 600000);
      assert.ok(paths.includes('playercards'));
      requests++;
      await wait;
      return previous;
    },
  };
  const first = f.runtime.repairCatalog(s),
    second = f.runtime.repairCatalog(s);
  release();
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  await f.runtime.repairCatalog(s);
  assert.equal(requests, 1);
});
test('persisted metadata cooldown survives an instance restart and save failure prevents network work', async () => {
  const f = fixture(),
    s = f.gameSnapshot(),
    id = '88888888-8888-4888-8888-888888888888';
  s.loadout = {
    status: 'ready',
    fetchedAt: f.now,
    data: { guns: [], card: { id, canonicalId: id, kind: 'card', name: 'Unresolved item' } },
  };
  let calls = 0;
  f.runtime.catalog = { ...makeDemo().catalog, repairAfter: f.now + 600000 };
  f.runtime.publicClient = {
    repair: async () => {
      calls++;
      throw Error('unexpected');
    },
  };
  await f.runtime.repairCatalog(s);
  assert.equal(calls, 0);
  f.runtime.catalog = { ...f.runtime.catalog, repairAfter: undefined };
  f.runtime.repository.saveCatalog = async () => {
    throw Error('disk full');
  };
  await assert.rejects(f.runtime.repairCatalog(s), /disk full/);
  assert.equal(calls, 0);
});

test('network catalogue maintenance waits for repair while cache-only reads remain immediate', async () => {
  const f = fixture(),
    load = Object.getPrototypeOf(f.runtime).loadCatalog;
  const before = { ...makeDemo().catalog, schemaVersion: 0, fetchedAt: 0 };
  const after = { ...before, repairedMarker: true };
  f.runtime.catalog = before;
  let release,
    requests = 0;
  f.runtime.metadataRepairFlight = new Promise((resolve) => {
    release = resolve;
  }).then(() => {
    f.runtime.catalog = after;
    f.runtime.metadataRepairFlight = undefined;
    return after;
  });
  f.runtime.publicClient = {
    load: async (previous) => {
      requests++;
      assert.equal(previous.repairedMarker, true);
      return previous;
    },
  };
  const updating = load.call(f.runtime);
  await Promise.resolve();
  assert.equal(requests, 0);
  assert.equal(await load.call(f.runtime, false, false), before);
  release();
  const updated = await updating;
  assert.equal(updated.repairedMarker, true);
  assert.equal(updated.fetchedAt, after.fetchedAt);
  assert.deepEqual(updated.maps, after.maps);
  assert.equal(requests, 1);
});

test('an upstream patch change replaces a fresh daily catalogue without refreshing account data', async () => {
  const f = fixture(),
    load = Object.getPrototypeOf(f.runtime).loadCatalog;
  const version = 'release-13.06-shipping-13-5435758';
  f.runtime.catalog = {
    ...makeDemo().catalog,
    schemaVersion: 12,
    fetchedAt: f.now,
    sourceVersion: 'release-13.05-shipping-11-5350494',
  };
  let versions = 0,
    categories = 0;
  f.runtime.publicClient = {
    version: async () => {
      versions++;
      return version;
    },
    load: async (previous, sourceVersion, fresh) => {
      categories++;
      assert.equal(sourceVersion, version);
      assert.equal(fresh, true);
      return { ...previous, sourceVersion, failedPaths: [] };
    },
  };
  const next = await load.call(f.runtime);
  assert.equal(next.sourceVersion, version);
  assert.equal(versions, 1);
  assert.equal(categories, 1);
  assert.equal(f.calls.snapshots, 0);
  assert.equal(f.calls.init, 0);
  assert.equal(await load.call(f.runtime, false, false), next);
  await assert.rejects(load.call(f.runtime, true), (e) => e.code === 'CATALOG_COOLDOWN');
  assert.equal(versions, 1);
});
test('same-release maintenance checks are bounded and unavailable version checks keep cached content', async () => {
  const f = fixture(),
    load = Object.getPrototypeOf(f.runtime).loadCatalog;
  const version = 'release-13.06-shipping-13-5435758';
  f.runtime.catalog = {
    ...makeDemo().catalog,
    schemaVersion: 12,
    fetchedAt: f.now,
    sourceVersion: version,
    availableVersion: version,
  };
  let calls = 0;
  f.runtime.publicClient = {
    version: async () => {
      calls++;
      throw Error('offline');
    },
    load: async () => {
      throw Error('should not redownload');
    },
  };
  const next = await load.call(f.runtime);
  assert.ok(Object.keys(next.items).length);
  assert.equal(next.sourceVersion, version);
  for (let n = 0; n < 10; n++) await load.call(f.runtime);
  assert.equal(calls, 1);
  f.advance(15 * 60000 + 1);
  await load.call(f.runtime);
  assert.equal(calls, 2);
});
test('catalogue reservations survive restart and storage failures prevent public network work', async () => {
  const f = fixture(),
    load = Object.getPrototypeOf(f.runtime).loadCatalog;
  const catalog = {
    ...makeDemo().catalog,
    schemaVersion: 12,
    fetchedAt: f.now,
    refreshAfter: f.now + 60000,
  };
  f.runtime.repository.catalog = async () => catalog;
  let calls = 0;
  f.runtime.publicClient = {
    version: async () => {
      calls++;
      return 'new-version';
    },
    load: async () => {
      calls++;
      return catalog;
    },
  };
  assert.equal(await load.call(f.runtime), catalog);
  assert.equal(f.runtime.catalog, catalog);
  assert.equal(calls, 0);
  f.advance(60001);
  f.runtime.repository.saveCatalog = async () => {
    throw Error('storage full');
  };
  await assert.rejects(load.call(f.runtime, true), /storage full/);
  assert.equal(calls, 0);
});
test('partial release updates cannot hammer category retries while the catalogue is incomplete', async () => {
  const f = fixture(),
    load = Object.getPrototypeOf(f.runtime).loadCatalog;
  f.runtime.catalog = { ...makeDemo().catalog, schemaVersion: 12, fetchedAt: f.now };
  let calls = 0;
  f.runtime.publicClient = {
    version: async () => 'release-13.06-shipping-13-5435758',
    load: async (previous) => {
      calls++;
      return { ...previous, failedPaths: ['playercards'] };
    },
  };
  await load.call(f.runtime);
  f.advance(120000);
  await load.call(f.runtime);
  assert.equal(calls, 1);
  f.advance(180001);
  await load.call(f.runtime);
  assert.equal(calls, 2);
});

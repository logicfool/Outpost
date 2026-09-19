const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const { repositoryFixture } = require('./repository-fixture.cjs');
const { ID, OTHER, MATCH, snapshot, summary, report, clone } = require('./archive-fixture.cjs');
const { PlayerScope } = require('../.test-build/playerScope.js');
const { AppError } = require('../.test-build/validation.js');
async function fixture(t) {
  const { repo, db } = await repositoryFixture(t);
  await repo.saveSnapshot(snapshot());
  let now = Date.now(),
    state = 'in_game',
    failed = false;
  const calls = { live: 0, profile: 0, detail: 0, client: 0, history: 0 },
    scope = new PlayerScope(ID);
  const client = {
    scope,
    liveGame: async () => {
      calls.live++;
      if (failed) throw new AppError('RATE_LIMIT', 'wait', now + 120000, 429);
      return {
        state,
        matchId: state === 'in_game' ? MATCH : undefined,
        observedAt: now,
        players: [{ subject: ID, self: true, teamId: 'Blue' }],
      };
    },
    snapshot: async (previous, plan) => {
      calls.profile++;
      assert.deepEqual(plan, { store: false, account: true, collection: false, live: false });
      const next = clone(previous);
      next.matches = { status: 'ready', fetchedAt: now, data: [summary(MATCH, now)] };
      next.xp = { status: 'ready', fetchedAt: now, data: { level: 51, xp: 12 } };
      return next;
    },
    matchDetail: async () => {
      calls.detail++;
      return report().detail;
    },
    matchHistory: async () => {
      calls.history++;
      return [];
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const load = (n) => {
    if (n === 'react-native') return { Platform: { OS: 'android' } };
    if (n === './network')
      return {
        nativeFetcher: async () => {
          throw Error('No HTTP expected');
        },
      };
    if (n === './secure')
      return { vault: {}, preferencesVault: {}, randomId: () => ID, randomHex: () => '' };
    if (n === './storage') return { openRepository: async () => repo };
    if (n === './notifications') return { cancelAccountNotifications: async () => {} };
    if (n === './chatStorage') return {};
    if (n.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'));
    throw Error(n);
  };
  const mod = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(load, mod, mod.exports);
  const runtime = new mod.exports.Runtime(repo, () => now);
  runtime.client = async () => {
    calls.client++;
    return client;
  };
  return {
    runtime,
    repo,
    db,
    client,
    calls,
    advance: (ms) => {
      now += ms;
    },
    idle: () => {
      state = 'idle';
    },
    rateLimit: () => {
      failed = true;
    },
    get now() {
      return now;
    },
  };
}
test('current game polls at five seconds, while idle state remains once a minute', async (t) => {
  const h = await fixture(t),
    first = await h.runtime.live(ID);
  assert.equal(first.data.nextCheckAt - h.now, 5000);
  await h.runtime.live(ID);
  assert.equal(h.calls.live, 1);
  h.advance(5000);
  await h.runtime.live(ID);
  assert.equal(h.calls.live, 2);
  h.advance(5000);
  h.idle();
  const idle = await h.runtime.live(ID);
  assert.equal(idle.data.nextCheckAt - h.now, 60000);
  h.advance(5000);
  await h.runtime.live(ID);
  assert.equal(h.calls.live, 3);
});
test('Profile refresh is independent of store reset and preserves cached store and old history', async (t) => {
  const h = await fixture(t),
    previous = await h.repo.snapshot(ID);
  await h.runtime.profile(ID);
  const result = await h.repo.snapshot(ID);
  assert.equal(h.calls.profile, 1);
  assert.deepEqual(result.store, previous.store);
  assert.equal(result.xp.data.level, 51);
  assert.ok(result.matches.data.some((m) => m.id === MATCH));
  for (let i = 0; i < 10; i++) {
    h.advance(5000);
    await h.runtime.profile(ID);
  }
  assert.equal(h.calls.profile, 1);
  h.advance(10000);
  await h.runtime.profile(ID);
  assert.equal(h.calls.profile, 2);
});
test('failed live polling obeys Retry-After rather than continuing at five seconds', async (t) => {
  const h = await fixture(t);
  h.rateLimit();
  const result = await h.runtime.live(ID);
  assert.equal(result.status, 'error');
  assert.equal(result.retryAt - h.now, 120000);
  h.advance(5000);
  await h.runtime.live(ID);
  assert.equal(h.calls.live, 1);
});
test('a match ending queues Profile reconciliation without resetting the request budget', async (t) => {
  const h = await fixture(t);
  await h.runtime.live(ID);
  await h.runtime.profile(ID);
  const due = (await h.repo.refreshGate(ID, 'profile')).notBefore;
  h.advance(5000);
  h.idle();
  await h.runtime.live(ID);
  const gate = await h.repo.refreshGate(ID, 'profile');
  assert.equal(gate.postMatchId, MATCH);
  assert.equal(gate.notBefore, due);
  await h.runtime.profile(ID);
  assert.equal(h.calls.profile, 1);
  h.advance(60000);
  await h.runtime.profile(ID);
  assert.equal((await h.repo.refreshGate(ID, 'profile')).postMatchId, undefined);
});
test('saved completed match reports open after restart without authenticating or refetching', async (t) => {
  const h = await fixture(t);
  await h.repo.saveArchivedReport(ID, ID, report());
  h.runtime.client = async () => {
    throw Error('No authentication allowed');
  };
  const d = await h.runtime.matchReport(ID, MATCH);
  assert.equal(d.id, MATCH);
  assert.equal(h.calls.detail, 0);
  h.advance(365 * 86400000);
  assert.equal((await h.runtime.matchReport(ID, MATCH)).id, MATCH);
});
test('a new report is fetched once, saved and reused by concurrent callers', async (t) => {
  const h = await fixture(t);
  await h.repo.saveArchivedMatches(ID, ID, [summary()]);
  const values = await Promise.all([
    h.runtime.matchReport(ID, MATCH),
    h.runtime.matchReport(ID, MATCH),
  ]);
  assert.equal(values[0].id, MATCH);
  assert.equal(h.calls.detail, 1);
  await h.runtime.matchReport(ID, MATCH);
  assert.equal(h.calls.detail, 1);
  assert.ok((await h.repo.archivedMatches(ID, ID)).find((m) => m.id === MATCH).preview);
});
test('cached historical pages require no new history endpoint request', async (t) => {
  const h = await fixture(t);
  const local = await h.repo.archivedMatches(ID, ID, 0, 10);
  const page = await h.runtime.historyPage(ID, ID, 0, local.length);
  assert.equal(page.length, local.length);
  assert.equal(h.calls.history, 0);
  assert.equal(h.calls.client, 0);
});
test('profile refresh cannot resurrect data after account generation changes', async (t) => {
  const h = await fixture(t);
  h.client.snapshot = async (previous) => {
    h.runtime.generations.set(ID, 1);
    return previous;
  };
  await assert.rejects(h.runtime.profile(ID), (e) => e.code === 'ACCOUNT_CHANGED');
});
test('live sampling persists only the lightweight gate instead of rewriting the full account snapshot', async (t) => {
  const h = await fixture(t);
  let snapshots = 0;
  const save = h.repo.saveSnapshot;
  h.repo.saveSnapshot = async (value) => {
    snapshots++;
    return save(value);
  };
  await h.runtime.live(ID);
  h.advance(5000);
  await h.runtime.live(ID);
  assert.equal(snapshots, 0);
  const saved = await h.repo.snapshot(ID);
  assert.equal(saved.liveGame.data.matchId, MATCH);
  assert.equal(saved.liveGame.data.observedAt, h.now);
});
test('incomplete saved reports are rechecked after a minute and complete ones stay permanent', async (t) => {
  const h = await fixture(t),
    r = report();
  r.completed = false;
  r.detail.completed = false;
  r.savedAt = h.now;
  r.detail.result = 'UNKNOWN';
  await h.repo.saveArchivedReport(ID, ID, r);
  await h.runtime.matchReport(ID, MATCH);
  assert.equal(h.calls.detail, 0);
  let freshArg;
  h.client.matchDetail = async (_id, _subject, fresh) => {
    freshArg = fresh;
    h.calls.detail++;
    return report().detail;
  };
  h.advance(60001);
  await h.runtime.matchReport(ID, MATCH);
  assert.equal(freshArg, true);
  assert.equal(h.calls.detail, 1);
  h.advance(60001);
  await h.runtime.matchReport(ID, MATCH);
  assert.equal(h.calls.detail, 1);
});
test('history pagination does not derive the remote cursor from restored local row counts', async (t) => {
  const h = await fixture(t),
    offsets = [];
  h.client.matchHistory = async (start) => {
    offsets.push(start);
    return [summary(MATCH, h.now)];
  };
  const local = await h.repo.archivedMatches(ID, ID, 0, 100);
  await h.runtime.historyPage(ID, ID, local.length, 40);
  assert.deepEqual(offsets, [0]);
  await h.runtime.historyPage(ID, ID, local.length, 40);
  assert.deepEqual(offsets, [0]);
});
test('history endpoint Retry-After survives repeated explicit pagination', async (t) => {
  const h = await fixture(t);
  h.client.matchHistory = async () => {
    h.calls.history++;
    throw new AppError('RATE_LIMIT', 'Wait', h.now + 180000, 429);
  };
  await assert.rejects(h.runtime.historyPage(ID, ID, 100, 40));
  h.advance(60000);
  await assert.rejects(h.runtime.historyPage(ID, ID, 100, 40), (e) => e.code === 'LOCAL_COOLDOWN');
  assert.equal(h.calls.history, 1);
});
test('realistic 87-match archive appends through 20/40/80/87 without invalid ranges or duplicates', async (t) => {
  const h = await fixture(t);
  h.db.exec('DELETE FROM match_summaries');
  const rows = Array.from({ length: 87 }, (_, i) =>
      summary(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, h.now - i * 1000),
    ),
    requests = [];
  h.client.matchHistory = async (start, count) => {
    assert.equal(count, 20, 'Riot rejects the old 50-entry batch');
    requests.push([start, start + count]);
    return rows.slice(start, start + count);
  };
  await h.repo.saveArchivedMatches(ID, ID, rows.slice(0, 20));
  let visible = rows.slice(0, 20);
  for (let n = 0; n < 4; n++) {
    const next = await h.runtime.historyPage(ID, ID, visible.length);
    visible = [...new Map([...visible, ...next].map((m) => [m.id, m])).values()];
    h.advance(60001);
  }
  assert.equal(visible.length, 87);
  assert.deepEqual(
    visible.map((r) => r.id),
    rows.map((r) => r.id),
  );
  assert.deepEqual(requests, [
    [0, 20],
    [20, 40],
    [40, 60],
    [60, 80],
    [80, 100],
  ]);
  assert.equal((await h.repo.refreshGate(ID, 'history:' + ID)).historyExhausted, true);
});
test('loading older matches keeps existing previews and a failed page never marks history exhausted', async (t) => {
  const h = await fixture(t);
  await h.repo.saveArchivedReport(ID, ID, report());
  const before = await h.repo.archivedMatches(ID, ID);
  h.client.matchHistory = async () => {
    throw new AppError('HISTORY_RANGE', 'Invalid range', undefined, 400);
  };
  await assert.rejects(h.runtime.historyPage(ID, ID, before.length));
  const after = await h.repo.archivedMatches(ID, ID);
  assert.deepEqual(after, before);
  assert.notEqual((await h.repo.refreshGate(ID, 'history:' + ID)).historyExhausted, true);
});

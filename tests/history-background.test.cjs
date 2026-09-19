const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const progress = {
  status: 'running',
  total: 80,
  checked: 12,
  conversations: 4,
  messages: 100,
  empty: 8,
  failed: 0,
  skipped: 0,
  current: 'Private friend name',
};
function fixture(platform = 'android', installed = true) {
  const calls = [],
    events = new Map(),
    tasks = new Map(),
    state = { currentState: 'active' },
    options = { permission: true, alive: true, failStart: false };
  let headless, stop;
  const native = {
    async start(id) {
      calls.push(['start', id]);
      if (options.failStart) throw Error('Not allowed');
      headless = tasks.get('OutpostChatHistorySync')()({ runId: id });
      if (options.cancelOnStart)
        events.get('OutpostHistorySyncStopped')?.({ runId: id, reason: 'CANCELLED' });
      return true;
    },
    runnerReady(id) {
      calls.push(['ready', id]);
    },
    async pulse(...args) {
      calls.push(['pulse', ...args]);
      return options.alive;
    },
    async finish(id, status) {
      calls.push(['finish', id, status]);
      events.get('OutpostHistorySyncStopped')?.({ runId: id, reason: status });
    },
  };
  const react = {
    Platform: { OS: platform },
    AppState: state,
    AppRegistry: { registerHeadlessTask: (key, handler) => tasks.set(key, handler) },
    NativeModules: installed ? { OutpostHistorySync: native } : {},
    DeviceEventEmitter: {
      addListener: (key, handler) => {
        events.set(key, handler);
        return { remove: () => events.delete(key) };
      },
    },
  };
  const load = (n) =>
    n === 'react-native'
      ? react
      : n === './notifications'
        ? {
            enableNotifications: async () => {
              calls.push(['permission']);
              if (!options.permission) throw Error('denied');
            },
          }
        : n === './secure'
          ? { randomHex: () => 'a'.repeat(64) }
          : n.startsWith('../core/')
            ? require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'))
            : (() => {
                throw Error(n);
              })();
  const m = { exports: {} },
    js = ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '../src/platform/historySyncBackground.ts'), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(load, m, m.exports);
  return {
    api: m.exports,
    calls,
    options,
    state,
    tasks,
    events,
    get task() {
      return headless;
    },
    emit(reason, id = 'a'.repeat(64)) {
      events.get('OutpostHistorySyncStopped')?.({ runId: id, reason });
    },
  };
}
test('Android sync owns one Headless JS lifetime and exposes only counters to notifications', async () => {
  const h = fixture(),
    stops = [];
  const lease = await h.api.startHistoryBackground(
    () => {},
    (s) => stops.push(s),
  );
  assert.equal(lease.active(), true);
  let ended = false;
  h.task.then(() => (ended = true));
  lease.update(progress);
  await lease.check();
  assert.equal(ended, false);
  assert.ok(h.calls.some((c) => c[0] === 'ready'));
  assert.ok(!JSON.stringify(h.calls).includes('Private friend name'));
  await lease.finish('complete');
  await h.task;
  assert.equal(ended, true);
  assert.equal(lease.active(), false);
  assert.equal(h.events.size, 0);
  assert.equal(stops.length, 0);
  assert.equal(h.calls.filter((c) => c[0] === 'finish').length, 1);
  await lease.finish('complete');
  assert.equal(h.calls.filter((c) => c[0] === 'finish').length, 1);
});
test('native Stop action stops only its own sync operation', async () => {
  const h = fixture(),
    stops = [],
    lease = await h.api.startHistoryBackground(
      () => {},
      (s) => stops.push(s),
    );
  h.emit('CANCELLED', 'b'.repeat(64));
  assert.equal(stops.length, 0);
  h.emit('CANCELLED');
  assert.match(stops[0], /notification/);
  assert.equal(lease.active(), false);
  await lease.finish('cancelled');
  await h.task;
});
test('notification denial keeps foreground sync usable without creating a service', async () => {
  const h = fixture();
  h.options.permission = false;
  const lease = await h.api.startHistoryBackground(
    () => {},
    () => {},
  );
  assert.equal(lease.supported, false);
  assert.match(lease.note, /Enable notifications/);
  assert.equal(h.calls.filter((c) => c[0] === 'start').length, 0);
});
test('older native runtime and iOS use an explicit foreground-only fallback', async () => {
  for (const [platform, installed] of [
    ['android', false],
    ['ios', true],
  ]) {
    const h = fixture(platform, installed),
      lease = await h.api.startHistoryBackground(
        () => {},
        () => {},
      );
    assert.equal(lease.supported, false);
    assert.equal(h.calls.length, 0);
    assert.ok(lease.note);
  }
});
test('starting while already backgrounded is rejected before native dispatch', async () => {
  const h = fixture();
  h.state.currentState = 'background';
  await assert.rejects(
    h.api.startHistoryBackground(
      () => {},
      () => {},
    ),
    (e) => e.code === 'SYNC_NOT_VISIBLE',
  );
  assert.equal(h.calls.filter((c) => c[0] === 'start').length, 0);
});
test('native start failure tears down the pending runner and falls back without leaking a listener', async () => {
  const h = fixture();
  h.options.failStart = true;
  const lease = await h.api.startHistoryBackground(
    () => {},
    () => {},
  );
  assert.equal(lease.active(), false);
  assert.equal(h.events.size, 0);
  assert.equal(h.calls.filter((c) => c[0] === 'finish').length, 1);
});
test('account switch during native readiness cleans up the service before rejecting', async () => {
  const h = fixture();
  let checked = 0;
  await assert.rejects(
    h.api.startHistoryBackground(
      () => {
        if (++checked >= 4) throw Error('switched');
      },
      () => {},
    ),
    /switched/,
  );
  assert.equal(h.events.size, 0);
  if (h.task) await h.task;
});
test('losing native service ownership prevents the next sync request', async () => {
  const h = fixture(),
    stops = [],
    lease = await h.api.startHistoryBackground(
      () => {},
      (s) => stops.push(s),
    );
  h.options.alive = false;
  await assert.rejects(lease.check(), (e) => e.code === 'SYNC_STOPPED');
  assert.equal(lease.active(), false);
  assert.ok(stops.length > 0);
  await lease.finish('paused');
  await h.task;
});
test('disabling background continuation does not request notification permission', async () => {
  const h = fixture(),
    lease = await h.api.startHistoryBackground(
      () => {},
      () => {},
      false,
    );
  assert.equal(lease.supported, false);
  assert.deepEqual(h.calls, []);
});
test('native finish and listener cleanup remain idempotent after a time limit', async () => {
  const h = fixture(),
    stops = [],
    lease = await h.api.startHistoryBackground(
      () => {},
      (s) => stops.push(s),
    );
  h.emit('OS_TIMEOUT');
  assert.match(stops[0], /time limit/);
  await lease.finish('paused');
  await lease.finish('paused');
  await h.task;
  assert.equal(h.calls.filter((c) => c[0] === 'finish').length, 1);
  assert.equal(h.events.size, 0);
});
test('Stop during native startup cannot fall through into an uncancelled foreground scan', async () => {
  const h = fixture();
  h.options.cancelOnStart = true;
  const stops = [];
  await assert.rejects(
    h.api.startHistoryBackground(
      () => {},
      (s) => stops.push(s),
    ),
    (e) => e.code === 'SYNC_STOPPED',
  );
  assert.match(stops[0], /notification/);
  assert.equal(h.events.size, 0);
  await h.task;
  assert.equal(h.calls.filter((c) => c[0] === 'finish').length, 1);
  assert.equal(h.calls.find((c) => c[0] === 'finish')[2], 'cancelled');
});

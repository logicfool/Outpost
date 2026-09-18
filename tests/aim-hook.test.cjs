const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer'),
  { act } = Renderer;
const { ID, OTHER, document, clone } = require('./aim-helpers.cjs');
const { aimSnapshot } = require('../.test-build/aimSettings.js');
const { session } = require('./helpers.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
async function harness(t, options = {}) {
  let now = 100000,
    seq = 0,
    currentId = ID,
    revision = 1,
    ready = options.ready ?? true,
    rendered,
    renderer;
  const timers = new Map(),
    listeners = new Map(),
    syncs = [],
    accounts = [session(ID).account, session(OTHER).account];
  const native = {
    AppState: {
      currentState: options.background ? 'background' : 'active',
      addEventListener: (kind, fn) => {
        if (!listeners.has(kind)) listeners.set(kind, new Set());
        listeners.get(kind).add(fn);
        return { remove: () => listeners.get(kind).delete(fn) };
      },
    },
  };
  const repository = {
    aimState:
      options.cache ??
      (async (id) => (options.cached ? { snapshot: aimSnapshot(document(), id, 1) } : null)),
    aimPresets: options.presets ?? (async () => []),
    saveAimPreset: async () => {},
    deleteAimPreset: async () => {},
  };
  const runtime = {
    repository,
    syncAim: async (id, reason, guard) => {
      syncs.push({ id, reason });
      guard();
      return options.sync ? options.sync(id) : { snapshot: aimSnapshot(document(), id, now) };
    },
    applyAim: async () => {},
    acceptAimServerState: async () => {},
  };
  const load = (n) =>
    n === 'react'
      ? React
      : n === 'react-native'
        ? native
        : n === '../platform/runtime'
          ? { getRuntime: async () => runtime }
          : n === '../platform/secure'
            ? { randomId: () => OTHER }
            : n.startsWith('../core/')
              ? require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'))
              : (() => {
                  throw Error(n);
                })();
  const source = ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '../src/state/useAim.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText,
    m = { exports: {} };
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  vm.runInThisContext(
    '(function(require,module,exports,setTimeout,clearTimeout,Date){' + source + '\n})',
  )(
    load,
    m,
    m.exports,
    (f, ms) => {
      timers.set(++seq, { f, at: now + ms });
      return seq;
    },
    (id) => timers.delete(id),
    Clock,
  );
  function Probe() {
    rendered = m.exports.useAim(
      accounts.find((a) => a.puuid === currentId),
      ready,
      revision,
      () => ({ accountId: currentId, revision }),
    );
    return null;
  }
  const settle = async () => {
    await act(async () => {
      for (let n = 0; n < 7; n++) await tick();
    });
  };
  const render = async () => {
    await act(async () => {
      if (renderer) renderer.update(React.createElement(Probe));
      else renderer = Renderer.create(React.createElement(Probe));
    });
    await settle();
  };
  await render();
  t.after(async () => {
    await act(async () => renderer.unmount());
  });
  return {
    model: () => rendered,
    syncs,
    runtime,
    settle,
    timers,
    async advance(ms) {
      now += ms;
      await act(async () => {
        for (const [id, t] of [...timers])
          if (t.at <= now) {
            timers.delete(id);
            t.f();
          }
        await tick();
      });
      await settle();
    },
    async ready(v) {
      ready = v;
      await render();
    },
    async switch(id) {
      currentId = id;
      revision++;
      await render();
    },
    async invoke(fn) {
      let result;
      await act(async () => {
        result = await fn(rendered);
      });
      await settle();
      return result;
    },
    async foreground() {
      native.AppState.currentState = 'active';
      await act(async () => {
        for (const f of listeners.get('change') ?? []) f('active');
      });
      await settle();
    },
  };
}
test('aim auto-sync waits for initial account data and never gates login', async (t) => {
  const h = await harness(t, { ready: false });
  await h.advance(1000);
  assert.equal(h.syncs.length, 0);
  await h.ready(true);
  await h.advance(301);
  assert.equal(h.syncs.length, 1);
  assert.equal(h.model().aimState.snapshot.accountId, ID);
  await h.advance(60000);
  assert.equal(h.syncs.length, 1);
});
test('cached settings require pull refresh rather than daily or foreground polling', async (t) => {
  const h = await harness(t, { cached: true });
  await h.advance(100000);
  await h.foreground();
  assert.equal(h.syncs.length, 0);
  await h.invoke((m) => m.syncAim('manual'));
  assert.equal(h.syncs.length, 1);
});
test('first auto-sync waits for foreground when app is backgrounded', async (t) => {
  const h = await harness(t, { background: true });
  await h.advance(301);
  assert.equal(h.syncs.length, 0);
  await h.foreground();
  assert.equal(h.syncs.length, 1);
});
test('a persisted settings retry deadline is respected with one timer not repeated requests', async (t) => {
  const h = await harness(t, { cache: async () => ({ needsSync: true, nextReadAt: 105000 }) });
  await h.advance(301);
  assert.equal(h.syncs.length, 0);
  await h.advance(4699);
  assert.equal(h.syncs.length, 1);
  await h.advance(100000);
  assert.equal(h.syncs.length, 1);
});
test('late cache hydration cannot overwrite a fresher manual settings result', async (t) => {
  const pending = deferred(),
    h = await harness(t, { ready: false, cache: () => pending.promise });
  await h.invoke((m) => m.syncAim());
  assert.equal(h.model().aimState.snapshot.fetchedAt, 100000);
  pending.resolve({ snapshot: aimSnapshot(document(), ID, 1) });
  await h.settle();
  assert.equal(h.model().aimState.snapshot.fetchedAt, 100000);
});
test('late response from a previous account cannot appear in the selected account', async (t) => {
  const pending = deferred(),
    h = await harness(t, {
      sync: (id) =>
        id === ID ? pending.promise : { snapshot: aimSnapshot(document(), id, 100000) },
    });
  await h.advance(301);
  await h.switch(OTHER);
  await h.advance(301);
  pending.resolve({ snapshot: aimSnapshot(document(), ID, 100001) });
  await h.settle();
  assert.equal(h.model().aimState.snapshot.accountId, OTHER);
});
test('unreadable preset storage does not discard the available settings cache', async (t) => {
  const h = await harness(t, {
    cached: true,
    presets: async () => {
      throw Error('disk');
    },
  });
  assert.equal(h.model().aimState.snapshot.accountId, ID);
  assert.deepEqual(h.model().aimPresets, []);
  assert.equal(h.model().aimLoading, false);
});
test('optional settings network failure ends loading and shows a retryable local error', async (t) => {
  const h = await harness(t, {
    sync: () => {
      throw Error('offline');
    },
  });
  await h.advance(301);
  assert.equal(h.syncs.length, 1);
  assert.equal(h.model().aimLoading, false);
  assert.ok(h.model().aimState.error);
  await h.advance(60000);
  assert.equal(h.syncs.length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer');
const { ID, OTHER, session } = require('./helpers.cjs');
const { makeDemo } = require('../.test-build/demo.js');
const { EMPTY_CHAT } = require('../.test-build/chatTypes.js');
const { AppError } = require('../.test-build/validation.js');
const { DEFAULT_SETTINGS } = require('../.test-build/types.js');
const { emptySnapshot } = require('../.test-build/refreshPolicy.js');
const { act } = Renderer;
global.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const source = fs.readFileSync(
  process.env.OUTPOST_APP_SOURCE || path.join(__dirname, '../src/state/useApp.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
function goodSnapshot(id = ID, at = Date.now()) {
  return { ...makeDemo(at).snapshot, accountId: id, demo: false };
}
async function harness(t, options = {}) {
  const accounts = [session(ID).account, session(OTHER).account],
    counts = {
      sync: [],
      history: 0,
      accounts: 0,
      permission: 0,
      notices: 0,
      background: 0,
      chatResume: 0,
    },
    listeners = new Map(),
    stamps = new Map();
  if (options.alreadyPrompted) stamps.set('notification.permission.prompted.v1', 'true');
  let rendered, renderer;
  const prefs = {
    ...DEFAULT_SETTINGS,
    backgroundSync: false,
    reminders: false,
    wishlistAlerts: false,
    chatAlerts: false,
    ...(options.notifications
      ? { reminders: true, chatAlerts: true, wishlistAlerts: true, backgroundSync: true }
      : {}),
  };
  const repository = {
    accounts: async () => {
      counts.accounts++;
      if (options.accountsError?.(counts.accounts))
        throw new AppError('LOCAL_DATA', 'Account list unavailable');
      return accounts;
    },
    settings: async () => prefs,
    selectedAccount: async () => ID,
    selectAccount: async () => {},
    snapshot: async (id) => (options.cached ? options.cached(id) : null),
    wishlist: async () => {
      if (options.wishlistError) throw new AppError('LOCAL_DATA', 'Wishlist unavailable');
      return [];
    },
    history: async () => {
      counts.history++;
      if (options.historyError) throw new AppError('LOCAL_DATA', 'History unavailable');
      return [];
    },
    catalog: async () => {
      if (options.catalogError) throw new AppError('LOCAL_DATA', 'Catalog unavailable');
      return null;
    },
    clearCache: async () => {},
    notificationStamp: async (key) => {
      if (options.stampError) throw Error('stamp read');
      return stamps.get(key) ?? null;
    },
    setNotificationStamp: async (key, value) => {
      stamps.set(key, value);
    },
  };
  const runtime = {
    repository,
    catalog: makeDemo().catalog,
    savedAccount: async (id) => accounts.find((a) => a.puuid === id),
    sync: async (id, reason) => {
      counts.sync.push({ id, reason });
      return options.sync ? options.sync(id, reason) : goodSnapshot(id);
    },
    clearCache: async () => {},
    sessionHealth: async () => ({}),
  };
  const social = {
    resumeChat: () => {
      counts.chatResume++;
    },
    chat: { ...EMPTY_CHAT, status: 'ready' },
    connectChat: async () => {},
    disconnectChat() {},
    prepareChatRemoval: async () => {},
  };
  const native = {
    Platform: { OS: 'android' },
    AppState: {
      currentState: options.initialState ?? 'active',
      addEventListener: (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return { remove: () => listeners.get(event).delete(fn) };
      },
    },
  };
  const emit = (event, value) => {
    if (event === 'change') native.AppState.currentState = value;
    for (const fn of [...(listeners.get(event) ?? [])]) fn(value);
  };
  const notifications = {
    enableNotifications: async () => {
      counts.permission++;
      if (options.onPermission) options.onPermission({ emit, model: () => rendered });
      if (options.permission) await options.permission;
    },
    updateStoreNotifications: async () => {
      counts.notices++;
    },
    cancelResetNotifications: async () => {},
    cancelAllNotifications: async () => {},
  };
  const load = (name) => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === './useNotificationSetup') {
      const mod = { exports: {} },
        js = ts.transpileModule(
          fs.readFileSync(path.join(__dirname, '../src/state/useNotificationSetup.ts'), 'utf8'),
          {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2022,
              esModuleInterop: true,
            },
          },
        ).outputText;
      vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(
        load,
        mod,
        mod.exports,
      );
      return mod.exports;
    }
    if (name === './useAim')
      return { useAim: () => ({ aimState: {}, aimPresets: [], aimLoading: false }) };
    if (name === './useActions') return { useActions: () => ({}) };
    if (name === './useSocial') return { useSocial: () => social };
    if (name.endsWith('/runtime')) return { getRuntime: async () => runtime };
    if (name.endsWith('/artwork') && name.includes('platform'))
      return { warmArtwork() {}, clearArtworkCache: async () => {} };
    if (name.endsWith('/background'))
      return {
        configureBackground: async () => {
          counts.background++;
        },
      };
    if (name.endsWith('/notifications')) return notifications;
    if (name.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
    throw Error('Unexpected useApp dependency: ' + name);
  };
  const m = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
  function Probe() {
    rendered = m.exports.useApp();
    return null;
  }
  const settle = async () => {
    await act(async () => {
      for (let n = 0; n < 10; n++) await tick();
    });
  };
  await act(async () => {
    renderer = Renderer.create(React.createElement(Probe));
    await tick();
  });
  t.after(async () => {
    await act(async () => {
      renderer.unmount();
      await tick();
    });
  });
  await settle();
  return {
    model: () => rendered,
    counts,
    runtime,
    repository,
    accounts,
    stamps,
    settle,
    async invoke(fn) {
      await act(async () => {
        await fn(rendered);
        await tick();
      });
      await settle();
    },
    async focus(value) {
      await act(async () => {
        emit(value ? 'focus' : 'blur');
        await tick();
      });
      await settle();
    },
    async state(value) {
      await act(async () => {
        emit('change', value);
        await tick();
      });
      await settle();
    },
  };
}
test('fresh real-account selection starts one automatic load even when chat is ready', async (t) => {
  const h = await harness(t);
  assert.equal(h.model().chat.status, 'ready');
  assert.equal(h.counts.sync.length, 1);
  assert.equal(h.model().snapshot.store.status, 'ready');
});
test('unavailable local history must not prevent the initial authenticated account load', async (t) => {
  const h = await harness(t, { historyError: true });
  assert.equal(h.counts.sync.length, 1);
  assert.equal(h.model().snapshot.store.status, 'ready');
  assert.equal(h.model().snapshot.wallet.status, 'ready');
});
test('unavailable wishlist and cached catalog do not suppress the first refresh', async (t) => {
  const h = await harness(t, { wishlistError: true, catalogError: true });
  assert.equal(h.counts.sync.length, 1);
  assert.equal(h.model().snapshot.store.status, 'ready');
});
test('successful account data remains visible when ancillary account-list reload fails', async (t) => {
  const h = await harness(t, { accountsError: (n) => n > 1 });
  assert.equal(h.counts.sync.length, 1);
  assert.equal(h.model().snapshot.store.status, 'ready');
});
test('a late initial cached snapshot cannot overwrite fresher foreground results', async (t) => {
  const cache = deferred(),
    old = emptySnapshot(ID),
    fresh = goodSnapshot(ID);
  const h = await harness(t, { cached: () => cache.promise });
  await h.state('background');
  await h.state('active');
  assert.equal(h.model().snapshot.store.status, 'ready');
  await h.invoke(async () => {
    cache.resolve(old);
  });
  assert.equal(h.model().snapshot.store.status, 'ready');
});
test('switching accounts while a refresh waits never applies another accounts results', async (t) => {
  const a = deferred();
  const h = await harness(t, {
    sync: (id) => (id === ID ? a.promise : Promise.resolve(goodSnapshot(id))),
  });
  await h.invoke((m) => m.switchAccount(h.accounts[1]));
  assert.equal(h.model().active.puuid, OTHER);
  await h.invoke(async () => {
    a.resolve(goodSnapshot(ID));
  });
  assert.equal(h.model().snapshot.accountId, OTHER);
});
test('clearing game cache starts a policy-gated reload without removing the account', async (t) => {
  const h = await harness(t);
  const count = h.counts.sync.length;
  await h.invoke((m) => m.clearCache());
  assert.equal(h.model().active.puuid, ID);
  assert.ok(h.counts.sync.length > count);
  assert.equal(h.model().snapshot.store.status, 'ready');
});
test('initial auto refresh exposes a loading state while work is still pending', async (t) => {
  const work = deferred();
  const h = await harness(t, { sync: () => work.promise });
  assert.equal(h.model().busy, true);
  await h.invoke(async () => {
    work.resolve(goodSnapshot(ID));
  });
  assert.equal(h.model().busy, false);
});

test('initial cooldown is retried automatically at its deadline, not by frequent network polling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-09-17T00:00:00Z') });
  const { waitingSnapshot } = require('../.test-build/refreshPolicy.js');
  let calls = 0;
  const h = await harness(t, {
    sync: async () =>
      ++calls === 1 ? waitingSnapshot(ID, null, Date.now() + 60000) : goodSnapshot(ID),
  });
  assert.equal(h.model().snapshot.store.code, 'INITIAL_SYNC_WAIT');
  assert.equal(calls, 1);
  await act(async () => {
    t.mock.timers.tick(59999);
    await tick();
  });
  assert.equal(calls, 1);
  await act(async () => {
    t.mock.timers.tick(1);
    await tick();
  });
  await h.settle();
  assert.equal(h.model().snapshot.store.status, 'ready');
  assert.equal(calls, 2);
});
test('initial retry waits while backgrounded and reevaluates policy once on foreground', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-09-17T00:00:00Z') });
  const { waitingSnapshot } = require('../.test-build/refreshPolicy.js');
  let calls = 0;
  const h = await harness(t, {
    sync: async () =>
      ++calls === 1 ? waitingSnapshot(ID, null, Date.now() + 60000) : goodSnapshot(ID),
  });
  await h.state('background');
  await act(async () => {
    t.mock.timers.tick(180000);
    await tick();
  });
  assert.equal(calls, 1);
  await h.state('active');
  assert.equal(calls, 2);
  assert.equal(h.model().snapshot.wallet.status, 'ready');
});

test('notification onboarding waits for first store and balances instead of interrupting initialization', async (t) => {
  const work = deferred(),
    permission = deferred();
  const h = await harness(t, {
    notifications: true,
    permission: permission.promise,
    sync: () => work.promise,
  });
  assert.equal(h.model().chat.status, 'ready');
  assert.equal(h.counts.permission, 0);
  assert.equal(h.counts.background, 0);
  await h.invoke(async () => {
    work.resolve(goodSnapshot());
  });
  assert.equal(h.counts.permission, 1);
  assert.equal(h.model().snapshot.store.status, 'ready');
  assert.equal(h.model().snapshot.wallet.status, 'ready');
  await h.focus(false);
  await h.invoke(async () => {
    permission.resolve();
  });
  await h.focus(true);
  assert.equal(h.counts.sync.length, 1);
  assert.equal(h.counts.notices, 1);
  assert.equal(h.model().snapshot.store.status, 'ready');
});
test('denying notifications leaves account data ready and does not refetch the store', async (t) => {
  const permission = deferred(),
    h = await harness(t, { notifications: true, permission: permission.promise });
  await h.focus(false);
  await h.state('background');
  await h.invoke(async () => {
    permission.reject(new AppError('NOTIFICATIONS_DENIED', 'Denied'));
  });
  await h.state('active');
  await h.focus(true);
  assert.equal(h.counts.sync.length, 1);
  assert.equal(h.model().snapshot.wallet.status, 'ready');
  assert.match(h.model().message, /Your account still works/);
  assert.equal(h.stamps.get('notification.permission.prompted.v1'), 'true');
});
test('notification prompt failure cannot replace loaded data or invalidate the account', async (t) => {
  const permission = deferred(),
    h = await harness(t, { notifications: true, permission: permission.promise });
  await h.invoke(async () => {
    permission.reject(Error('permission service unavailable'));
  });
  assert.equal(h.model().active.puuid, ID);
  assert.equal(h.model().snapshot.store.status, 'ready');
  assert.equal(h.counts.sync.length, 1);
});
test('no second automatic prompt after an already-recorded allow or deny result', async (t) => {
  const h = await harness(t, { notifications: true, alreadyPrompted: true });
  await h.state('background');
  await h.state('active');
  await h.focus(false);
  await h.focus(true);
  assert.equal(h.counts.permission, 0);
  assert.equal(h.model().snapshot.wallet.status, 'ready');
  assert.equal(h.counts.sync.length, 1);
});
test('pending initial cooldown does not show the notification prompt', async (t) => {
  const { waitingSnapshot } = require('../.test-build/refreshPolicy.js');
  const h = await harness(t, {
    notifications: true,
    sync: () => waitingSnapshot(ID, null, Date.now() + 60000),
  });
  assert.equal(h.counts.permission, 0);
  assert.equal(h.counts.background, 0);
  assert.equal(h.model().snapshot.store.code, 'INITIAL_SYNC_WAIT');
});
test('Android focus-only return resumes an overdue initial load without an AppState change', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-09-17T00:00:00Z') });
  const { waitingSnapshot } = require('../.test-build/refreshPolicy.js');
  let calls = 0;
  const h = await harness(t, {
    sync: async () =>
      ++calls === 1 ? waitingSnapshot(ID, null, Date.now() + 60000) : goodSnapshot(),
  });
  await h.focus(false);
  await act(async () => {
    t.mock.timers.tick(60001);
    await tick();
  });
  assert.equal(calls, 1);
  await h.focus(true);
  assert.equal(calls, 2);
  assert.equal(h.model().snapshot.store.status, 'ready');
});
test('healthy foreground and focus events do not cause an extra API refresh', async (t) => {
  const h = await harness(t);
  for (let n = 0; n < 5; n++) {
    await h.focus(false);
    await h.state('background');
    await h.state('active');
    await h.focus(true);
  }
  assert.equal(h.counts.sync.length, 1);
  assert.equal(h.model().snapshot.store.status, 'ready');
});
test('grant completion after account switching cannot rewrite or clear the selected account', async (t) => {
  const permission = deferred(),
    h = await harness(t, { notifications: true, permission: permission.promise });
  await h.invoke((m) => m.switchAccount(h.accounts[1]));
  await h.invoke(async () => {
    permission.resolve();
  });
  assert.equal(h.model().active.puuid, OTHER);
  assert.equal(h.model().snapshot.accountId, OTHER);
  assert.equal(h.counts.permission, 1);
  assert.equal(h.counts.notices, 0);
});
test('notification stamp storage failure does not prevent store initialization', async (t) => {
  const h = await harness(t, { notifications: true, stampError: true });
  assert.equal(h.counts.permission, 0);
  assert.equal(h.model().snapshot.store.status, 'ready');
  assert.equal(h.model().snapshot.wallet.status, 'ready');
});

test('a first load completing while backgrounded defers permission until foreground', async (t) => {
  const work = deferred(),
    h = await harness(t, { notifications: true, sync: () => work.promise });
  await h.state('background');
  await h.invoke(async () => {
    work.resolve(goodSnapshot());
  });
  assert.equal(h.counts.permission, 0);
  await h.state('active');
  assert.equal(h.counts.permission, 1);
  assert.equal(h.counts.sync.length, 1);
});
test('a first load completing while Android is blurred does not prompt over another surface', async (t) => {
  const work = deferred(),
    h = await harness(t, { notifications: true, sync: () => work.promise });
  await h.focus(false);
  await h.invoke(async () => {
    work.resolve(goodSnapshot());
  });
  assert.equal(h.counts.permission, 0);
  await h.focus(true);
  assert.equal(h.counts.permission, 1);
  assert.equal(h.counts.sync.length, 1);
});
test('app opening restores chat even when every notification preference is disabled', async (t) => {
  const h = await harness(t);
  assert.equal(h.model().settings.chatAlerts, false);
  assert.ok(h.counts.chatResume >= 1);
  assert.equal(h.counts.permission, 0);
});

const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer');
const { act } = Renderer;
global.IS_REACT_ACT_ENVIRONMENT = true;
const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/state/useLivePolling.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
async function fixture(
  t,
  platform = 'android',
  interval = 5000,
  enabled = true,
  slowProfile = false,
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1700000000000 });
  const listeners = new Map(),
    app = {
      currentState: 'active',
      addEventListener: (name, fn) => {
        let set = listeners.get(name);
        if (!set) listeners.set(name, (set = new Set()));
        set.add(fn);
        return { remove: () => set.delete(fn) };
      },
    };
  const reasons = [],
    liveReasons = [];
  let calls = 0,
    profileCalls = 0,
    releaseProfile,
    renderer,
    controls;
  const waiting = new Promise((resolve) => (releaseProfile = resolve));
  const model = {
    active: { puuid: 'fixture' },
    refreshProfile: async (reason) => {
      reasons.push(reason);
      profileCalls++;
      return slowProfile ? waiting : null;
    },
    refreshLive: async (reason) => {
      liveReasons.push(reason);
      calls++;
      return { status: 'ready', data: { nextCheckAt: Date.now() + interval } };
    },
  };
  const mod = { exports: {} },
    load = (n) =>
      n === 'react'
        ? React
        : n === 'react-native'
          ? { AppState: app, Platform: { OS: platform } }
          : n === '../core/refreshPolicy'
            ? require('../.test-build/refreshPolicy.js')
            : (() => {
                throw Error(n);
              })();
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(
    load,
    mod,
    mod.exports,
  );
  function Probe() {
    controls = mod.exports.useLivePolling(model);
    return null;
  }
  await act(async () => {
    renderer = Renderer.create(
      React.createElement(
        mod.exports.LivePollingContext.Provider,
        { value: enabled },
        React.createElement(Probe),
      ),
    );
    await Promise.resolve();
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    t.mock.timers.reset();
  });
  return {
    reasons,
    liveReasons,
    get calls() {
      return calls;
    },
    async pull() {
      await act(async () => {
        controls.refresh();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });
    },
    get refreshing() {
      return controls.refreshing;
    },
    get profileCalls() {
      return profileCalls;
    },
    releaseProfile: () => releaseProfile(null),
    async advance(ms) {
      await act(async () => {
        t.mock.timers.tick(ms);
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
    },
    async emit(name, value) {
      await act(async () => {
        if (name === 'change') app.currentState = value;
        for (const fn of listeners.get(name) ?? []) fn(value);
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
    },
  };
}
for (const platform of ['android', 'ios'])
  test(platform + ': active game UI follows the five-second server deadline', async (t) => {
    const h = await fixture(t, platform);
    assert.equal(h.calls, 1);
    await h.advance(4999);
    assert.equal(h.calls, 1);
    await h.advance(1);
    assert.equal(h.calls, 2);
    await h.emit('change', 'background');
    await h.advance(20000);
    assert.equal(h.calls, 2);
    await h.emit('change', 'active');
    assert.equal(h.calls, 3);
  });
test('Android blur pauses the game loop without needing an AppState change', async (t) => {
  const h = await fixture(t);
  await h.emit('blur');
  await h.advance(30000);
  assert.equal(h.calls, 1);
  await h.emit('focus');
  assert.equal(h.calls, 2);
});
test('idle UI waits a minute and hidden screens do not poll', async (t) => {
  const h = await fixture(t, 'ios', 60000);
  await h.advance(5000);
  assert.equal(h.calls, 1);
  await h.advance(55000);
  assert.equal(h.calls, 2);
});
test('disabled polling context never starts an HTTP-triggering refresh', async (t) => {
  const h = await fixture(t, 'ios', 5000, false);
  await h.advance(60000);
  assert.equal(h.calls, 0);
});
test('a slow Profile request does not block five-second current-game samples', async (t) => {
  const h = await fixture(t, 'android', 5000, true, true);
  assert.equal(h.profileCalls, 1);
  assert.equal(h.calls, 1);
  await h.advance(5000);
  await h.advance(5000);
  assert.equal(h.calls, 3);
  assert.equal(h.profileCalls, 1);
  h.releaseProfile();
  await h.advance(0);
});
test('Profile runs once per minute while active-game samples run separately', async (t) => {
  const h = await fixture(t);
  assert.equal(h.profileCalls, 1);
  for (let i = 0; i < 11; i++) await h.advance(5000);
  assert.equal(h.profileCalls, 1);
  assert.equal(h.calls, 12);
  await h.advance(5000);
  assert.equal(h.profileCalls, 2);
  assert.equal(h.calls, 13);
});
test('pull-to-refresh invokes both independent lanes and settles the manual indicator', async (t) => {
  const h = await fixture(t);
  assert.equal(h.refreshing, false);
  await h.pull();
  assert.equal(h.calls, 2);
  assert.equal(h.profileCalls, 2);
  assert.equal(h.reasons.at(-1), 'manual');
  assert.equal(h.liveReasons.at(-1), 'manual');
  assert.equal(h.refreshing, false);
});
test('a pull during slow automatic Profile work stays pending and forwards manual intent once', async (t) => {
  const h = await fixture(t, 'android', 5000, true, true);
  await h.pull();
  assert.equal(h.refreshing, true);
  await h.pull();
  assert.equal(h.profileCalls, 1);
  h.releaseProfile();
  await h.advance(0);
  await h.advance(0);
  assert.equal(h.profileCalls, 2);
  assert.equal(h.reasons.at(-1), 'manual');
  assert.equal(h.refreshing, false);
});
test('backgrounding cancels a queued manual follow-up without discarding the current read', async (t) => {
  const h = await fixture(t, 'ios', 5000, true, true);
  await h.pull();
  await h.emit('change', 'background');
  h.releaseProfile();
  await h.advance(0);
  await h.advance(0);
  assert.equal(h.profileCalls, 1);
  assert.equal(h.refreshing, false);
});

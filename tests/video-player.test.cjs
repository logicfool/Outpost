const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer'),
  { act } = Renderer;
global.IS_REACT_ACT_ENVIRONMENT = true;
const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/ui/SkinVideo.tsx'), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  },
).outputText;
const tick = () => new Promise((r) => setImmediate(r));
function harness(autoplay = true) {
  let appState,
    renderer,
    plays = 0,
    loads = 0,
    refreshes = 0;
  const players = [];
  const app = {
    currentState: 'active',
    addEventListener(_, fn) {
      appState = fn;
      return {
        remove() {
          appState = undefined;
        },
      };
    },
  };
  const useVideoPlayer = (initial, setup) =>
    React.useMemo(() => {
      assert.equal(initial, null);
      const listeners = new Map();
      const p = {
        status: 'idle',
        playing: false,
        muted: true,
        loop: false,
        addListener(event, fn) {
          const set = listeners.get(event) ?? new Set();
          set.add(fn);
          listeners.set(event, set);
          return { remove: () => set.delete(fn) };
        },
        emit(event, data) {
          for (const fn of listeners.get(event) ?? []) fn(data);
        },
        async replaceAsync(value) {
          loads++;
          p.lastSource = value;
          p.status = 'loading';
          p.emit('statusChange', { status: 'loading' });
          await tick();
          p.status = 'readyToPlay';
          p.emit('statusChange', { status: p.status });
        },
        play() {
          assert.equal(p.status, 'readyToPlay');
          plays++;
          p.playing = true;
          p.emit('playingChange', { isPlaying: true });
        },
        pause() {
          p.playing = false;
          p.emit('playingChange', { isPlaying: false });
        },
      };
      setup(p);
      players.push(p);
      return p;
    }, []);
  const mod = { exports: {} },
    req = (n) =>
      n === 'react' || n === 'react/jsx-runtime'
        ? require(n)
        : n === 'react-native'
          ? {
              AppState: app,
              ActivityIndicator: 'Spinner',
              Platform: { OS: 'ios' },
              Text: 'Text',
              View: 'View',
            }
          : n === 'expo-video'
            ? { VideoView: 'VideoView', useVideoPlayer }
            : n === './components'
              ? { Button: (p) => React.createElement('Button', p) }
              : n === './theme'
                ? { useTheme: () => ({ C: {}, S: { row: {}, small: {} } }) }
                : n.startsWith('../core/')
                  ? require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'))
                  : (() => {
                      throw Error(n);
                    })();
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(
    req,
    mod,
    mod.exports,
  );
  const props = {
    uri: 'https://valorant.dyn.riotcdn.net/x/videos/fixture.mp4',
    autoplay,
    refresh: async () => {
      refreshes++;
    },
  };
  return {
    get player() {
      return players.at(-1);
    },
    get plays() {
      return plays;
    },
    get loads() {
      return loads;
    },
    get refreshes() {
      return refreshes;
    },
    async mount() {
      await act(async () => {
        renderer = Renderer.create(React.createElement(mod.exports.SkinVideo, props));
        await tick();
        await tick();
      });
    },
    async state(value) {
      await act(async () => {
        appState(value);
        await tick();
      });
    },
    async press(name) {
      await act(async () => {
        const b = renderer.root.findAllByType('Button').find((n) => n.props.title === name);
        assert.ok(b, name);
        b.props.onPress();
        await tick();
        await tick();
      });
    },
    async error() {
      await act(async () => {
        this.player.status = 'error';
        this.player.emit('statusChange', { status: 'error' });
        await tick();
      });
    },
    async nativePause() {
      await act(async () => {
        this.player.pause();
        await tick();
      });
    },
    async close() {
      await act(async () => {
        renderer.unmount();
        await tick();
      });
    },
  };
}
test('autoplay waits for asynchronous source readiness and starts muted', async (t) => {
  const h = harness();
  await h.mount();
  t.after(() => h.close());
  assert.ok(h.plays > 0);
  assert.equal(h.player.muted, true);
  assert.equal(h.loads, 1);
  assert.equal(h.player.lastSource.useCaching, true);
  assert.ok(!h.player.lastSource.headers.Authorization);
});
test('explicit pause survives background and return, manual play resumes', async (t) => {
  const h = harness();
  await h.mount();
  t.after(() => h.close());
  await h.press('Pause video');
  await h.state('background');
  await h.state('active');
  assert.equal(h.player.playing, false);
  await h.press('Play video');
  assert.equal(h.player.playing, true);
});
test('native control pause is retained across foreground transitions', async (t) => {
  const h = harness();
  await h.mount();
  t.after(() => h.close());
  await h.nativePause();
  await h.state('background');
  await h.state('active');
  assert.equal(h.player.playing, false);
});
test('autoplay opt-out still permits explicit play', async (t) => {
  const h = harness(false);
  await h.mount();
  t.after(() => h.close());
  assert.equal(h.plays, 0);
  await h.press('Play video');
  assert.equal(h.player.playing, true);
});
test('retry refreshes metadata once and creates a fresh player', async (t) => {
  const h = harness();
  await h.mount();
  t.after(() => h.close());
  const old = h.player;
  await h.error();
  await h.press('Retry video');
  assert.equal(h.refreshes, 1);
  assert.notEqual(old, h.player);
  assert.equal(h.loads, 2);
});

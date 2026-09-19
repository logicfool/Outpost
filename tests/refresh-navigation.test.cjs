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
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const evaluate = (source, load) => {
  const m = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(load, m, m.exports);
  return m.exports;
};
const { usePullRefresh } = evaluate(compile('src/state/usePullRefresh.ts'), (n) =>
  n === 'react' ? React : require('../.test-build/cooperative.js'),
);
const tick = () => new Promise((r) => setTimeout(r, 0));
for (const platform of ['android', 'ios'])
  test(
    platform + ': real tab navigation stays active during an unresolved screen refresh',
    async (t) => {
      let resolve,
        reject,
        renderer,
        calls = 0,
        latest;
      const wait = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      const Screen = ({ model }) => {
        const pull = usePullRefresh(model.refresh, model.active.puuid);
        return React.createElement('RefreshScreen', {
          refreshing: pull.refreshing,
          onRefresh: pull.refresh,
          busy: model.busy,
        });
      };
      const RN = {
        ActivityIndicator: 'ActivityIndicator',
        Image: 'Image',
        Pressable: 'Pressable',
        ScrollView: 'ScrollView',
        Text: 'Text',
        View: 'View',
        Appearance: { setColorScheme() {} },
        Platform: { OS: platform },
        StyleSheet: { create: (v) => v },
        useWindowDimensions: () => ({ width: 390, height: 844 }),
      };
      const C = {
        background: '#000000',
        surface: '#151515',
        ink: '#FFFFFF',
        accent: '#FF4655',
        subtle: '#777777',
        border: '#333333',
        raised: '#222222',
        gold: '#DDCC55',
      };
      const parts = {};
      const load = (n) => {
        if (n === 'react') return React;
        if (n === 'react/jsx-runtime') return require(n);
        if (n === 'react-native') return RN;
        if (n === 'react-native-safe-area-context')
          return {
            SafeAreaProvider: 'SafeAreaProvider',
            SafeAreaView: 'SafeAreaView',
            useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
          };
        if (n === 'expo-status-bar') return { StatusBar: () => null };
        if (n === '@expo/vector-icons') return { Feather: 'Icon' };
        if (n === 'expo-linear-gradient') return { LinearGradient: 'Gradient' };
        if (n.endsWith('/theme'))
          return {
            useTheme: () => ({ C, S: { page: {}, row: {}, small: {}, body: {} }, isDark: true }),
            useThemedStyles: (fn) => fn(C),
          };
        if (n.endsWith('/NavInsets')) return { NavInsetContext: React.createContext(0) };
        if (n.endsWith('/useLivePolling')) return { LivePollingContext: React.createContext(true) };
        if (n.endsWith('/screens'))
          return {
            StoreScreen: Screen,
            ProgressScreen: Screen,
            CollectionScreen: Screen,
            MatchesScreen: Screen,
            AccountScreen: Screen,
            ItemModal: () => null,
          };
        if (n.endsWith('/FriendsScreen')) return { FriendsScreen: Screen };
        if (n.endsWith('/notifications')) return { listenNotificationTaps: () => () => {} };
        if (n.endsWith('/useApp') || n.endsWith('.png')) return {};
        return new Proxy(parts, {
          get: (_, key) =>
            (parts[key] ??=
              key === 'ScreenTransition' || key === 'NavSurface'
                ? ({ children }) => React.createElement(String(key), null, children)
                : () => null),
        });
      };
      const { AppContent } = evaluate(
        compile('App.tsx') + '\nexports.AppContent=AppContent;',
        load,
      );
      const account = {
          puuid: '11111111-1111-4111-8111-111111111111',
          gameName: 'Fixture',
          tagLine: 'TEST',
          demo: true,
        },
        settings = { theme: 'dark' },
        chat = { friends: [], messages: {}, unread: {} };
      function Root() {
        const [busy, setBusy] = React.useState(false),
          refresh = React.useCallback(async () => {
            calls++;
            setBusy(true);
            try {
              await wait;
            } finally {
              setBusy(false);
            }
          }, []);
        latest = {
          active: account,
          accounts: [account],
          settings,
          chat,
          busy,
          booting: false,
          catalog: { items: {} },
          refresh,
          savedConversations: [],
        };
        return React.createElement(AppContent, { model: latest });
      }
      await act(async () => {
        renderer = Renderer.create(React.createElement(Root));
        await tick();
      });
      t.after(async () => {
        await act(async () => renderer.unmount());
      });
      const screen = () => renderer.root.findByType('RefreshScreen');
      await act(async () => {
        screen().props.onRefresh();
        screen().props.onRefresh();
        await tick();
        await tick();
      });
      assert.equal(calls, 1);
      assert.equal(screen().props.refreshing, true);
      assert.equal(latest.busy, true);
      for (const id of ['collection', 'matches', 'friends', 'account', 'progress', 'store']) {
        await act(async () =>
          renderer.root
            .findAllByType('Pressable')
            .find((v) => v.props.testID === 'tab-' + id)
            .props.onPress(),
        );
        const selected = renderer.root
          .findAllByType('Pressable')
          .find((v) => v.props.testID === 'tab-' + id);
        assert.equal(selected.props.accessibilityState.selected, true);
        assert.equal(latest.busy, true);
        assert.equal(
          screen().props.refreshing,
          false,
          "New sections must not inherit another section's native spinner",
        );
      }
      await act(async () => {
        resolve();
        await tick();
      });
      assert.equal(latest.busy, false);
    },
  );
test('failed pulls settle the indicator and do not prevent another pull', async (t) => {
  let control,
    renderer,
    calls = 0;
  function Probe() {
    control = usePullRefresh(async () => {
      calls++;
      throw Error('offline');
    }, 'account');
    return null;
  }
  await act(async () => {
    renderer = Renderer.create(React.createElement(Probe));
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
  });
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      control.refresh();
      await tick();
      await tick();
    });
    assert.equal(control.refreshing, false);
  }
  assert.equal(calls, 2);
});

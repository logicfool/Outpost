const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer');
const { ID, OTHER, session, jwt } = require('./helpers.cjs');
const { act } = Renderer;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
global.cancelAnimationFrame = clearTimeout;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function harness(options = {}) {
  const counts = {
      webMount: 0,
      webUnmount: 0,
      modalMount: 0,
      clears: 0,
      captures: 0,
      saves: 0,
      selections: [],
      closes: 0,
    },
    modules = new Map();
  const captures = options.capture ?? deferred();
  if (!options.capture) captures.resolve({ ssid: 'fixture-cookie', sub: OTHER });
  const palette = {
    accent: '#ff4655',
    background: '#101010',
    surface: '#151515',
    ink: '#eeeeee',
    subtle: '#aaaaaa',
    gold: '#bb9900',
  };
  const theme = {
    C: palette,
    S: {
      page: {},
      content: {},
      flex: {},
      h2: {},
      h3: {},
      body: {},
      small: {},
      input: {},
      row: {},
      between: {},
      card: {},
    },
    isDark: true,
  };
  let throwWeb = false;
  const NativeModal = (props) => {
    React.useEffect(() => {
      counts.modalMount++;
    }, []);
    return React.createElement(
      'Modal',
      props,
      options.platform === 'android' && !props.visible ? null : props.children,
    );
  };
  const FakeWeb = (props) => {
    React.useEffect(() => {
      counts.webMount++;
      return () => {
        counts.webUnmount++;
      };
    }, []);
    if (throwWeb) throw Error('fixture native renderer failure');
    return React.createElement('WebView', props);
  };
  const RN = {
    Platform: { OS: options.platform ?? 'ios' },
    AppState: {
      currentState: 'active',
      addEventListener() {
        return { remove() {} };
      },
    },
    Linking: {
      openURL: async () => {
        throw Error('No social browser expected in this test');
      },
    },
    Keyboard: { dismiss() {} },
    Modal: NativeModal,
    View: 'View',
    Text: 'Text',
    TextInput: 'TextInput',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator',
    Switch: 'Switch',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    FlatList: (p) =>
      React.createElement(
        'FlatList',
        p,
        p.ListHeaderComponent,
        (p.data ?? []).map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: p.keyExtractor?.(item) ?? index },
            p.renderItem({ item, index }),
          ),
        ),
      ),
  };
  const components = {
    Button: (p) => React.createElement('Button', p),
    ModalHeader: (p) => React.createElement('Header', p),
    ModalPage: (p) => React.createElement('Page', p, p.children),
    Tabs: (p) => React.createElement('Tabs', p),
  };
  const repository = { snapshot: async () => null };
  function load(name, from) {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return RN;
    if (name === 'react-native-webview') return { WebView: FakeWeb };
    if (name === 'react-native-safe-area-context')
      return { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) };
    if (name === '@expo/vector-icons') return { Feather: 'Icon' };
    if (name.endsWith('/components')) return components;
    if (name.endsWith('/theme')) return { useTheme: () => theme };
    if (name.endsWith('/PlayerAvatar')) return { PlayerAvatar: 'Avatar' };
    if (name.endsWith('/secure')) return { randomHex: () => 'a'.repeat(64) };
    if (name.endsWith('/runtime')) return { getRuntime: async () => ({ repository }) };
    if (name.endsWith('/cookies'))
      return {
        clearRiotWebCookies: async () => {
          counts.clears++;
        },
        captureRiotReauthCookies: async (expected) => {
          counts.captures++;
          assert.equal(expected, OTHER);
          return captures.promise;
        },
      };
    if (name.includes('/core/'))
      return require(path.join(__dirname, '../.test-build', name.split('/core/')[1] + '.js'));
    if (name.startsWith('.')) return compile(path.resolve(path.dirname(from), name) + '.tsx');
    throw Error('Unexpected import ' + name);
  }
  function compile(file) {
    if (modules.has(file)) return modules.get(file);
    const m = { exports: {} };
    modules.set(file, m.exports);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInThisContext(
      '(function(require,module,exports){' + js + String.fromCharCode(10) + '})',
      { filename: file },
    )((name) => load(name, file), m, m.exports);
    modules.set(file, m.exports);
    return m.exports;
  }
  const AccountsModal = compile(path.join(__dirname, '../src/ui/AccountsModal.tsx')).AccountsModal;
  const second = {
    ...session(OTHER).account,
    gameName: 'Second',
    tagLine: 'TEST',
    canReauth: true,
  };
  const model = {
    accounts: [session(ID).account],
    active: session(ID).account,
    catalog: { items: {} },
    snapshot: null,
    link: async (tokens, region, expected) => {
      counts.saves++;
      counts.savedTokens = tokens;
      counts.expected = expected;
      return options.save ? options.save(tokens) : second;
    },
    switchAccount: (a) => counts.selections.push(a.puuid),
  };
  let setRoute;
  function Root() {
    const [route, set] = React.useState(options.route ?? { type: 'picker' });
    setRoute = set;
    return React.createElement(AccountsModal, {
      route,
      model,
      onRoute: set,
      onClose: () => {
        counts.closes++;
        set(null);
      },
    });
  }
  let renderer;
  const button = (title) =>
    renderer.root.findAllByType('Button').find((n) => n.props.title === title);
  const modal = () => renderer.root.findByType('Modal');
  const web = () => renderer.root.findByType('WebView');
  const callback = () => {
    const a = new URL(web().props.source.uri);
    return (
      'https://playvalorant.com/opt_in#' +
      new URLSearchParams({
        state: a.searchParams.get('state'),
        nonce: a.searchParams.get('nonce'),
        access_token: jwt({ sub: OTHER, exp: Math.floor(Date.now() / 1000) + 3500 }),
        id_token: jwt({ sub: OTHER, nonce: a.searchParams.get('nonce') }),
        token_type: 'Bearer',
        expires_in: '3500',
      })
    );
  };
  return {
    counts,
    model,
    captures,
    button,
    modal,
    web,
    callback,
    setRoute: (r) => setRoute(r),
    throwWeb: () => {
      throwWeb = true;
    },
    root: () => renderer.root,
    async mount() {
      await act(async () => {
        renderer = Renderer.create(React.createElement(Root));
        await tick();
      });
    },
    async show() {
      await act(async () => {
        modal().props.onShow();
        await tick();
      });
    },
    async press(title) {
      await act(async () => {
        const b = button(title);
        assert.ok(b, 'Button ' + title);
        if (!b.props.disabled) b.props.onPress();
        await tick();
      });
    },
    async ready() {
      await act(async () => {
        web().props.onLoadEnd({ nativeEvent: { url: 'about:blank' } });
        await tick();
      });
    },
    async unmount() {
      await act(async () => {
        renderer.unmount();
        await tick();
      });
    },
  };
}
test('account picker transitions to login in one modal and waits for host presentation', async (t) => {
  const h = harness();
  await h.mount();
  t.after(() => h.unmount());
  assert.equal(h.counts.modalMount, 1);
  assert.equal(h.root().findAllByType('WebView').length, 0);
  await h.press('Add Riot account');
  assert.equal(h.root().findAllByType('Modal').length, 1);
  assert.equal(h.counts.modalMount, 1);
  assert.equal(h.button('Continue to Riot sign-in').props.disabled, true);
  await h.show();
  await h.press('Continue to Riot sign-in');
  assert.equal(h.counts.webMount, 1);
  assert.equal(h.counts.clears, 0);
  assert.equal(h.web().props.source.uri, undefined);
  assert.match(h.web().props.source.html, /outpost-login-bootstrap/);
  await h.ready();
  assert.equal(h.counts.clears, 1);
  assert.equal(new URL(h.web().props.source.uri).searchParams.get('prompt'), 'login');
});
test('one WebView survives duplicate callbacks and selection waits for native dismissal', async (t) => {
  const capture = deferred(),
    h = harness({ capture, route: { type: 'login' } });
  await h.mount();
  t.after(() => h.unmount());
  await h.show();
  await h.press('Continue to Riot sign-in');
  await h.ready();
  const source = h.web().props.source;
  await act(async () => {
    const url = h.callback();
    h.web().props.onShouldStartLoadWithRequest({ url, isTopFrame: true });
    h.web().props.onNavigationStateChange({ url, loading: false });
    await tick();
  });
  assert.equal(h.counts.captures, 1);
  assert.equal(h.counts.saves, 0);
  assert.equal(h.counts.webUnmount, 0);
  assert.equal(h.web().props.source, source);
  await act(async () => {
    h.modal().props.onRequestClose();
    await tick();
  });
  assert.equal(h.modal().props.visible, true);
  await act(async () => {
    capture.resolve({ ssid: 'fixture-cookie', sub: OTHER });
    await tick();
  });
  assert.equal(h.counts.saves, 1);
  assert.deepEqual(h.counts.selections, []);
  await h.press('Done - view account');
  assert.equal(h.modal().props.visible, false);
  assert.deepEqual(h.counts.selections, []);
  await act(async () => {
    h.modal().props.onDismiss();
    await tick();
  });
  assert.deepEqual(h.counts.selections, [OTHER]);
  assert.equal(h.counts.closes, 1);
  await act(async () => {
    h.modal().props.onDismiss();
    await tick();
  });
  assert.deepEqual(h.counts.selections, [OTHER]);
});
test('native browser termination becomes a retry screen, not an account deletion', async (t) => {
  const h = harness({ route: { type: 'login' } });
  await h.mount();
  t.after(() => h.unmount());
  await h.show();
  await h.press('Continue to Riot sign-in');
  await h.ready();
  const stale = h.web().props;
  await act(async () => {
    stale.onContentProcessDidTerminate();
    await tick();
  });
  assert.ok(h.button('Continue to Riot sign-in'));
  assert.equal(h.counts.saves, 0);
  await h.press('Continue to Riot sign-in');
  await h.ready();
  assert.equal(h.counts.webMount, 2);
  assert.equal(h.counts.clears, 2);
  await act(async () => {
    stale.onRenderProcessGone();
    await tick();
  });
  assert.equal(h.root().findAllByType('WebView').length, 1);
});
test('preparing renderer failure cancels readiness rather than clearing a later browser', async (t) => {
  const h = harness({ route: { type: 'login' } });
  await h.mount();
  t.after(() => h.unmount());
  await h.show();
  await h.press('Continue to Riot sign-in');
  const stale = h.web().props;
  await act(async () => {
    stale.onRenderProcessGone();
    await tick();
  });
  assert.equal(h.counts.clears, 0);
  await h.press('Continue to Riot sign-in');
  await act(async () => {
    stale.onLoadEnd({ nativeEvent: { url: 'about:blank' } });
    await tick();
  });
  assert.equal(h.counts.clears, 0);
  await h.ready();
  assert.equal(h.counts.clears, 1);
});
test('rapid repeated account-sheet open/close never mounts a second native presenter', async (t) => {
  const h = harness();
  await h.mount();
  t.after(() => h.unmount());
  for (let i = 0; i < 12; i++) {
    await h.show();
    await act(async () => {
      h.modal().props.onRequestClose();
      await tick();
    });
    await act(async () => {
      h.modal().props.onDismiss();
      await tick();
    });
    await act(async () => {
      h.setRoute({ type: 'picker' });
      await tick();
    });
  }
  assert.equal(h.counts.modalMount, 1);
  assert.equal(h.counts.webMount, 0);
  assert.equal(h.counts.saves, 0);
});
test('Android selects a saved account after the nonanimated host closes', async (t) => {
  const h = harness({ platform: 'android' });
  await h.mount();
  t.after(() => h.unmount());
  await h.show();
  const row = h
    .root()
    .findAllByType('Pressable')
    .find((n) => n.props.accessibilityLabel?.startsWith('Switch to'));
  await act(async () => {
    row.props.onPress();
    await tick();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(h.counts.selections.length, 1);
  assert.equal(h.counts.selections[0], ID);
});
test('callback arriving during modal dismissal cannot add an account after cancellation', async (t) => {
  const h = harness({ route: { type: 'login' } });
  await h.mount();
  t.after(() => h.unmount());
  await h.show();
  await h.press('Continue to Riot sign-in');
  await h.ready();
  const callback = h.callback(),
    stale = h.web().props;
  await act(async () => {
    h.modal().props.onRequestClose();
    await tick();
  });
  assert.equal(h.modal().props.visible, false);
  await act(async () => {
    stale.onShouldStartLoadWithRequest({ url: callback, isTopFrame: true });
    stale.onNavigationStateChange({ url: callback, loading: false });
    await tick();
  });
  assert.equal(h.counts.captures, 0);
  assert.equal(h.counts.saves, 0);
  assert.deepEqual(h.counts.selections, []);
  await act(async () => {
    h.modal().props.onDismiss();
    await tick();
  });
});

test('native-view render errors stay inside account dialog recovery', async (t) => {
  const h = harness({ route: { type: 'login' } });
  await h.mount();
  t.after(() => h.unmount());
  await h.show();
  h.throwWeb();
  await h.press('Continue to Riot sign-in');
  assert.ok(h.button('Retry sign-in screen'));
  assert.equal(h.counts.saves, 0);
  assert.equal(h.counts.modalMount, 1);
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, React, Renderer, act, settle } = require('./loading-harness.cjs');
const { jwt, OTHER, session } = require('./helpers.cjs');
const provider =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: 'fixture-client',
    redirect_uri: 'https://authenticate.riotgames.com/redirects/google',
    state: 'fixture-provider-state',
  });
async function fixture(t, os) {
  const opens = [],
    scripts = [],
    linked = [],
    calls = { clear: 0, cookies: 0, close: 0 };
  let active = true,
    n = 0,
    tree;
  const WebView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(
      ref,
      () => ({
        injectJavaScript: (script) => scripts.push(script),
        reload: () => scripts.push('native-reload'),
        stopLoading: () => {},
      }),
      [],
    );
    return React.createElement('WebView', props);
  });
  const h = harness({
    os,
    overrides: {
      'react-native-webview': { WebView },
      '../platform/secure': { randomHex: () => String(++n).repeat(64) },
      '../platform/cookies': {
        clearRiotWebCookies: async () => {
          calls.clear++;
        },
        captureRiotReauthCookies: async (expected) => {
          calls.cookies++;
          return { ssid: 'synthetic-cookie', sub: expected };
        },
      },
      './components': {
        Button: (props) => React.createElement('Button', props),
        ModalHeader: (props) => React.createElement('Header', props),
        ModalPage: (props) => React.createElement('Page', null, props.children),
        Tabs: (props) => React.createElement('Tabs', props),
      },
    },
  });
  h.native.Linking = {
    openURL: async (url) => {
      opens.push(url);
    },
  };
  const Login = h.load('src/ui/Login.tsx').default;
  await act(async () => {
    tree = Renderer.create(
      React.createElement(Login, {
        presented: true,
        isActive: () => active,
        expectedId: OTHER,
        onClose: () => calls.close++,
        onComplete() {},
        onLink: async (...args) => {
          linked.push(args);
          return session(OTHER).account;
        },
      }),
    );
    await settle();
  });
  t.after(() => act(() => tree.unmount()));
  const button = (title) => tree.root.findAllByType('Button').find((n) => n.props.title === title);
  const web = () => tree.root.findByType('WebView');
  await act(async () => {
    button('Continue to Riot sign-in').props.onPress();
    await settle();
  });
  assert.ok(web().props.source.html);
  await act(async () => {
    web().props.onLoadEnd({ nativeEvent: { url: 'about:blank' } });
    await settle();
  });
  const authorization = web().props.source.uri;
  await act(() =>
    web().props.onNavigationStateChange({
      url: 'https://authenticate.riotgames.com/?client_id=fixture',
      loading: false,
    }),
  );
  return {
    h,
    tree,
    web,
    opens,
    scripts,
    linked,
    calls,
    authorization,
    setActive: (v) => (active = v),
    async google() {
      await act(async () => {
        assert.equal(
          web().props.onShouldStartLoadWithRequest({ url: provider, isTopFrame: true }),
          false,
        );
        await settle();
      });
    },
  };
}
for (const os of ['android', 'ios'])
  test(
    os +
      ': Google opens externally, preserves the original attempt and completes only through Riot',
    async (t) => {
      const h = await fixture(t, os);
      await h.google();
      assert.equal(h.opens.length, 1);
      assert.equal(h.calls.clear, 1);
      assert.equal(h.calls.cookies, 0);
      assert.equal(h.linked.length, 0);
      assert.equal(h.web().props.source.uri, h.authorization);
      assert.equal(h.web().props.sharedCookiesEnabled, false);
      assert.equal(h.web().props.javaScriptCanOpenWindowsAutomatically, false);
      await act(async () => {
        h.h.emit('change', 'active');
        await settle();
      });
      const probe = h.scripts.at(-1),
        id = /id="(\d+:\d+)"/.exec(probe)[1],
        key = /const key="([a-f0-9]+)"/.exec(probe)[1];
      await act(() =>
        h.web().props.onMessage({
          nativeEvent: {
            url: 'https://authenticate.riotgames.com/',
            data: JSON.stringify({
              type: 'outpost-social-status',
              key,
              id,
              status: 'success',
              url: 'https://auth.riotgames.com/login-token?login_token=fixture',
            }),
          },
        }),
      );
      assert.ok(h.scripts.at(-1).includes('auth.riotgames.com/login-token'));
      assert.equal(h.linked.length, 0);
      const auth = new URL(h.authorization),
        callback =
          'https://playvalorant.com/opt_in#' +
          new URLSearchParams({
            state: auth.searchParams.get('state'),
            access_token: jwt({ sub: OTHER, exp: Date.now() / 1000 + 3600 }),
            id_token: jwt({ sub: OTHER, nonce: auth.searchParams.get('nonce') }),
            expires_in: '3600',
            token_type: 'Bearer',
          });
      await act(async () => {
        h.web().props.onShouldStartLoadWithRequest({ url: callback, isTopFrame: true });
        await settle();
      });
      assert.equal(h.linked.length, 1);
      assert.equal(h.linked[0][2], OTHER);
      assert.equal(h.calls.cookies, 1);
      assert.equal(h.calls.clear, 1);
    },
  );
for (const os of ['android', 'ios'])
  test(
    os +
      ': popup and direct redirects cannot launch duplicate browsers or accept foreign bridge messages',
    async (t) => {
      const h = await fixture(t, os);
      await act(async () => {
        h.web().props.onOpenWindow({ nativeEvent: { targetUrl: provider } });
        await settle();
      });
      await h.google();
      assert.equal(h.opens.length, 1);
      await act(() =>
        h.web().props.onMessage({
          nativeEvent: {
            url: 'https://evil.test/',
            data: JSON.stringify({
              type: 'outpost-social-popup',
              key: '1'.repeat(64),
              url: provider,
            }),
          },
        }),
      );
      assert.equal(h.opens.length, 1);
      h.setActive(false);
      await act(() => h.h.emit('change', 'active'));
      assert.equal(h.scripts.length, 0);
      assert.equal(h.linked.length, 0);
    },
  );
test('a Riot popup is prepared in the original cookie context before a provider opens', async (t) => {
  const h = await fixture(t, 'android');
  await act(() =>
    h.web().props.onOpenWindow({
      nativeEvent: { targetUrl: 'https://authenticate.riotgames.com/login?method=google' },
    }),
  );
  assert.equal(h.opens.length, 0);
  assert.ok(h.scripts.at(-1).includes('authenticate.riotgames.com/login?method=google'));
  assert.equal(h.calls.clear, 1);
});
for (const os of ['android', 'ios'])
  test(os + ': a provider navigation event fallback opens externally once', async (t) => {
    const h = await fixture(t, os);
    await act(async () => {
      h.web().props.onNavigationStateChange({ url: provider, loading: true });
      await settle();
    });
    assert.equal(h.opens.length, 1);
    assert.equal(h.linked.length, 0);
    await act(async () => {
      h.web().props.onOpenWindow({ nativeEvent: { targetUrl: provider } });
      await settle();
    });
    assert.equal(h.opens.length, 1);
    assert.equal(new URL(h.web().props.source.uri).origin, 'https://authenticate.riotgames.com');
  });
test('an empty native popup shows recovery feedback instead of silently doing nothing', async (t) => {
  const h = await fixture(t, 'android');
  await act(() => h.web().props.onOpenWindow({ nativeEvent: { targetUrl: 'about:blank' } }));
  assert.equal(h.opens.length, 0);
  assert.ok(
    h.tree.root
      .findAllByType('Text')
      .some(
        (node) =>
          typeof node.props.children === 'string' &&
          node.props.children.includes('empty sign-in window'),
      ),
  );
  assert.equal(h.calls.clear, 1);
});
for (const os of ['android', 'ios'])
  test(os + ': a social URL from an embedded subframe never launches a browser', async (t) => {
    const h = await fixture(t, os);
    await act(async () => {
      assert.equal(
        h.web().props.onShouldStartLoadWithRequest({ url: provider, isTopFrame: false }),
        false,
      );
      await settle();
    });
    assert.equal(h.opens.length, 0);
    assert.equal(h.linked.length, 0);
    assert.equal(h.calls.clear, 1);
  });
for (const os of ['android', 'ios'])
  test(
    os + ': extra Riot verification resumes the original cookie context without saving an account',
    async (t) => {
      const h = await fixture(t, os);
      await h.google();
      await act(async () => {
        h.h.emit('change', 'active');
        await settle();
      });
      const probe = h.scripts.at(-1),
        id = /id="(\d+:\d+)"/.exec(probe)[1],
        key = /const key="([a-f0-9]+)"/.exec(probe)[1];
      await act(async () => {
        h.web().props.onMessage({
          nativeEvent: {
            url: 'https://authenticate.riotgames.com/',
            data: JSON.stringify({
              type: 'outpost-social-status',
              key,
              id,
              status: 'interaction',
              http: 200,
            }),
          },
        });
        await settle();
      });
      assert.equal(new URL(h.web().props.source.uri).origin, 'https://authenticate.riotgames.com');
      assert.equal(h.calls.clear, 1);
      assert.equal(h.calls.cookies, 0);
      assert.equal(h.linked.length, 0);
    },
  );
test('the original Riot callback state is checked even after the provider browser opens', async (t) => {
  const h = await fixture(t, 'android');
  await h.google();
  const auth = new URL(h.authorization);
  const callback =
    'https://playvalorant.com/opt_in#' +
    new URLSearchParams({
      state: 'wrong',
      access_token: jwt({ sub: OTHER, exp: Date.now() / 1000 + 3600 }),
      id_token: jwt({ sub: OTHER, nonce: auth.searchParams.get('nonce') }),
      expires_in: '3600',
      token_type: 'Bearer',
    });
  await act(async () => {
    h.web().props.onShouldStartLoadWithRequest({ url: callback, isTopFrame: true });
    await settle();
  });
  assert.equal(h.calls.cookies, 0);
  assert.equal(h.linked.length, 0);
  assert.ok(h.tree.root.findAllByType('Text').some((n) => n.props.children === 'AUTH_STATE'));
});
test('successive Android redirect events restore Riot rather than reload the provider page', async (t) => {
  const h = await fixture(t, 'android');
  for (const url of [provider, provider.replace('/o/oauth2/v2/auth', '/v3/signin/identifier')]) {
    await act(async () => {
      h.web().props.onNavigationStateChange({ url, loading: true });
      await settle();
    });
  }
  assert.equal(h.opens.length, 1);
  assert.equal(h.calls.clear, 1);
  assert.equal(h.linked.length, 0);
  assert.ok(!h.scripts.includes('native-reload'));
  assert.ok(
    h.scripts.some((script) =>
      script.includes('window.location.replace("https://authenticate.riotgames.com/'),
    ),
  );
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  socialAuthorization,
  loginDocument,
  riotSocialCompletion,
} = require('../.test-build/socialLogin.js');
const { SocialHandoff } = require('../.test-build/socialHandoff.js');
const { LoginFlow } = require('../.test-build/loginFlow.js');
const { jwt, OTHER, session } = require('./helpers.cjs');
const source = 'https://authenticate.riotgames.com/?client_id=play-valorant-web-prod';
const provider = (host = 'accounts.google.com', path = '/o/oauth2/v2/auth') =>
  'https://' +
  host +
  path +
  '?' +
  new URLSearchParams({
    client_id: 'fixture-riot-client',
    redirect_uri: 'https://authenticate.riotgames.com/redirects/google',
    state: 'synthetic-provider-state',
  });
const tick = () => new Promise((r) => setImmediate(r));
for (const [host, path, name] of [
  ['accounts.google.com', '/o/oauth2/v2/auth', 'Google'],
  ['appleid.apple.com', '/auth/authorize', 'Apple'],
  ['www.facebook.com', '/v20.0/dialog/oauth', 'Facebook'],
  ['login.live.com', '/oauth20_authorize.srf', 'Microsoft / Xbox'],
  ['ca.account.sony.com', '/api/authz/v3/oauth/authorize', 'PlayStation'],
])
  test(name + ' opens only a provider authorization returning to Riot', () => {
    const url = provider(host, path);
    assert.equal(socialAuthorization(url)?.provider, name);
    assert.equal(socialAuthorization(url)?.url, new URL(url).toString());
    assert.equal(loginDocument(url), false);
  });
test('social routing rejects spoofed hosts, side-effect paths, credentials and duplicated parameters', () => {
  for (const url of [
    provider().replace('accounts.google.com', 'accounts.google.com.evil.test'),
    provider().replace('https:', 'http:'),
    provider().replace('/o/oauth2/v2/auth', '/Logout'),
    provider() + '&state=other',
    provider() + '&access_token=secret',
    provider().replace('accounts.google.com', 'user@accounts.google.com'),
    provider().replace('accounts.google.com', 'accounts.google.com:444'),
    provider().replace('authenticate.riotgames.com', 'evil.test'),
    'javascript:alert(1)',
  ])
    assert.equal(socialAuthorization(url), undefined, url);
  assert.equal(loginDocument('https://auth.riotgames.com.evil.test/'), false);
});
test('nested Google account chooser preserves its Riot redirect instead of allowing arbitrary continue URLs', () => {
  const url =
    'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(provider());
  assert.equal(socialAuthorization(url)?.provider, 'Google');
  assert.equal(
    socialAuthorization(
      url.replace(encodeURIComponent(provider()), encodeURIComponent('https://evil.test/')),
    ),
    undefined,
  );
});
function harness(t, options = {}) {
  let current = true,
    now = 100000;
  const opened = [],
    probes = [],
    continued = [],
    states = [],
    codes = [];
  const controller = new SocialHandoff({
    current: () => current,
    openBrowser: async (url) => {
      opened.push(url);
      if (options.openError) throw Error('private details');
    },
    probe: (id) => probes.push(id),
    continueRiot: (url) => continued.push(url),
    emit: (value) => states.push(value),
    diagnostic: (value) => codes.push(value),
    now: () => now,
  });
  t.after(() => controller.dispose());
  return {
    controller,
    opened,
    probes,
    continued,
    states,
    codes,
    setCurrent: (v) => (current = v),
    advance: (n) => (now += n),
  };
}
test('system browser launch is deduplicated and is not mistaken for authenticated success', async (t) => {
  const h = harness(t);
  await h.controller.open(provider(), source);
  await h.controller.open(provider(), source);
  assert.equal(h.opened.length, 1);
  assert.equal(h.controller.snapshot.status, 'waiting');
  assert.equal(h.continued.length, 0);
  h.controller.check();
  h.controller.check();
  assert.equal(h.probes.length, 1);
  h.controller.result({ id: h.probes[0], status: 'pending' });
  assert.equal(h.controller.snapshot.status, 'waiting');
  assert.equal(h.continued.length, 0);
});
test('only the matching check can resume the trusted Riot completion route', async (t) => {
  const h = harness(t);
  await h.controller.open(provider(), source);
  h.controller.check();
  h.controller.result({
    id: 'stale:9',
    status: 'success',
    url: 'https://auth.riotgames.com/login-token?login_token=fixture',
  });
  assert.equal(h.continued.length, 0);
  h.controller.result({
    id: h.probes[0],
    status: 'success',
    url: 'https://auth.riotgames.com/login-token?login_token=fixture',
  });
  assert.equal(h.continued.length, 1);
  assert.equal(h.controller.snapshot.status, 'continuing');
});
test('untrusted completion URLs, declined browser opens and foreign sources remain visible errors', async (t) => {
  const h = harness(t);
  await h.controller.open(provider(), 'https://evil.test');
  assert.equal(h.opened.length, 0);
  await h.controller.open(provider(), source);
  h.controller.check();
  h.controller.result({ id: h.probes[0], status: 'success', url: 'https://evil.test/redirect' });
  assert.equal(h.continued.length, 0);
  assert.equal(h.controller.snapshot.code, 'SOCIAL_RETURN_REJECTED');
  const failed = harness(t, { openError: true });
  await failed.controller.open(provider(), source);
  assert.equal(failed.controller.snapshot.code, 'SOCIAL_BROWSER_UNAVAILABLE');
  assert.ok(!JSON.stringify(failed.states).includes('private details'));
});
test('rate limits, expiry and per-handoff check bounds cannot trigger a retry storm', async (t) => {
  const h = harness(t);
  await h.controller.open(provider(), source);
  h.controller.check();
  h.controller.result({ id: h.probes[0], status: 'unavailable', http: 429, retrySeconds: 120 });
  h.advance(119000);
  h.controller.check();
  assert.equal(h.probes.length, 1);
  h.advance(1000);
  h.controller.check();
  assert.equal(h.probes.length, 2);
  h.controller.result({ id: h.probes[1], status: 'pending' });
  h.advance(600001);
  h.controller.check();
  assert.equal(h.controller.snapshot.code, 'SOCIAL_EXPIRED');
  assert.equal(h.probes.length, 2);
});
test('closing or switching account makes old browser and check results inert', async (t) => {
  const h = harness(t);
  await h.controller.open(provider(), source);
  h.controller.check();
  h.setCurrent(false);
  h.controller.result({
    id: h.probes[0],
    status: 'success',
    url: 'https://auth.riotgames.com/login-token?login_token=fixture',
  });
  assert.equal(h.continued.length, 0);
  h.controller.dispose();
  h.setCurrent(true);
  h.controller.result({
    id: h.probes[0],
    status: 'success',
    url: 'https://auth.riotgames.com/login-token?login_token=fixture',
  });
  assert.equal(h.continued.length, 0);
});
test('social completion still requires the original Riot state, nonce and reusable cookies', async (t) => {
  const attempt = { state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: Date.now() },
    calls = [];
  const flow = new LoginFlow({
    attempt: () => attempt,
    clearBrowser: async () => calls.push('clear'),
    captureCookies: async () => {
      calls.push('cookies');
      return { ssid: 'synthetic-cookie' };
    },
    save: async () => {
      calls.push('save');
      return session(OTHER).account;
    },
    emit() {},
  });
  await flow.begin();
  const original = flow.snapshot.url;
  const h = harness(t);
  h.controller.deps.continueRiot = (url) => flow.navigate(url);
  await h.controller.open(provider(), source);
  assert.equal(flow.snapshot.url, original);
  assert.deepEqual(calls, ['clear']);
  h.controller.check();
  const callback =
    'https://playvalorant.com/opt_in#' +
    new URLSearchParams({
      state: attempt.state,
      access_token: jwt({ sub: OTHER, exp: Date.now() / 1000 + 3600 }),
      id_token: jwt({ sub: OTHER, nonce: attempt.nonce }),
      token_type: 'Bearer',
      expires_in: '3600',
    });
  h.controller.result({ id: h.probes[0], status: 'success', url: callback });
  await tick();
  assert.deepEqual(calls, ['clear', 'cookies', 'save']);
  assert.equal(flow.snapshot.phase, 'success');
  flow.navigate(callback);
  await tick();
  assert.equal(calls.filter((c) => c === 'save').length, 1);
});
test('a provider page cannot authorize an arbitrary Riot callback or bypass cookie capture failure', async (t) => {
  const attempt = { state: 'c'.repeat(64), nonce: 'd'.repeat(64), createdAt: Date.now() };
  let saves = 0;
  const flow = new LoginFlow({
    attempt: () => attempt,
    clearBrowser: async () => {},
    captureCookies: async () => ({}),
    save: async () => {
      saves++;
      return session(OTHER).account;
    },
    emit() {},
  });
  await flow.begin();
  const h = harness(t);
  h.controller.deps.continueRiot = (url) => flow.navigate(url);
  await h.controller.open(provider(), source);
  h.controller.check();
  const callback =
    'https://playvalorant.com/opt_in#' +
    new URLSearchParams({
      state: attempt.state,
      access_token: jwt({ sub: OTHER, exp: Date.now() / 1000 + 3600 }),
      id_token: jwt({ sub: OTHER, nonce: attempt.nonce }),
      token_type: 'Bearer',
      expires_in: '3600',
    });
  h.controller.result({ id: h.probes[0], status: 'success', url: callback });
  await tick();
  assert.equal(saves, 0);
  assert.equal(flow.snapshot.code, 'REAUTH_COOKIE');
  assert.equal(
    riotSocialCompletion('https://auth.riotgames.com.evil.test/login-token?login_token=x'),
    false,
  );
});
test('Google final identifier redirects keep the original Riot authorization parameters', () => {
  const url =
    provider('accounts.google.com', '/v3/signin/identifier') + '&response_type=code&scope=openid';
  assert.equal(socialAuthorization(url)?.url, new URL(url).href);
  assert.equal(socialAuthorization(url + '&STATE=other'), undefined);
  assert.equal(
    riotSocialCompletion(
      'https://auth.riotgames.com/login-token?login_token=fixture&redirect_uri=https://evil.test',
    ),
    false,
  );
});
test('a status success arriving after expiry cannot complete sign-in', async (t) => {
  const h = harness(t);
  await h.controller.open(provider(), source);
  h.controller.check();
  h.advance(600001);
  h.controller.result({
    id: h.probes[0],
    status: 'success',
    url: 'https://auth.riotgames.com/login-token?login_token=fixture',
  });
  assert.equal(h.continued.length, 0);
  assert.equal(h.controller.snapshot.code, 'SOCIAL_EXPIRED');
});
test('Riot verification prompts return to the original page instead of being called successful login', async (t) => {
  const h = harness(t);
  let resumed = 0;
  h.controller.deps.resumeRiot = () => resumed++;
  await h.controller.open(provider(), source);
  h.controller.check();
  h.controller.result({ id: h.probes[0], status: 'interaction', http: 200 });
  assert.equal(resumed, 1);
  assert.equal(h.continued.length, 0);
  assert.equal(h.controller.snapshot.code, 'SOCIAL_RIOT_VERIFICATION');
});
test('429 cooldown cannot be bypassed by opening a new provider window', async (t) => {
  const h = harness(t);
  await h.controller.open(provider(), source);
  h.controller.check();
  h.controller.result({ id: h.probes[0], status: 'unavailable', http: 429, retrySeconds: 7200 });
  await h.controller.open(provider(), source);
  assert.equal(h.opened.length, 1);
  assert.equal(h.controller.snapshot.retryAt, 100000 + 7200000);
  h.controller.cancel();
  await h.controller.open(provider(), source);
  assert.equal(h.opened.length, 1);
  assert.equal(h.controller.snapshot.code, 'SOCIAL_RATE_LIMIT');
});
test('a contradictory HTTP error cannot masquerade as a successful social response', async (t) => {
  const h = harness(t);
  await h.controller.open(provider(), source);
  h.controller.check();
  h.controller.result({
    id: h.probes[0],
    status: 'success',
    http: 403,
    url: 'https://auth.riotgames.com/login-token?login_token=fixture',
  });
  assert.equal(h.continued.length, 0);
});
test('Google wrapper validation rejects conflicting outer parameters', () => {
  const params = new URLSearchParams({
    client_id: 'fixture-client',
    redirect_uri: 'https://example.test/return',
    state: 'fixture-state',
  });
  params.set('continue', provider());
  assert.equal(
    socialAuthorization('https://accounts.google.com/AccountChooser?' + params),
    undefined,
  );
  params.delete('redirect_uri');
  assert.equal(
    socialAuthorization('https://accounts.google.com/AccountChooser?' + params),
    undefined,
  );
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  preferenceAuthorizationUrl,
  parsePreferenceCallback,
  authorizePreferences,
} = require('../.test-build/preferenceAuthorization.js');
const { authorizationUrl } = require('../.test-build/auth.js');
const { ID, OTHER, jwt } = require('./helpers.cjs');
const attempt = () => ({ state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: Date.now() });
function callback(a, change = {}) {
  return (
    'http://localhost/redirect#' +
    new URLSearchParams({
      state: a.state,
      access_token: jwt({
        sub: ID,
        client_id: 'riot-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
      id_token: jwt({
        sub: ID,
        aud: 'riot-client',
        nonce: a.nonce,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
      expires_in: '3600',
      token_type: 'Bearer',
      ...change,
    })
  );
}
test('preference client request is separate from main web login and requests no offline refresh grant', () => {
  const a = attempt(),
    p = new URL(preferenceAuthorizationUrl(a)),
    web = new URL(authorizationUrl(a));
  assert.equal(p.origin, 'https://auth.riotgames.com');
  assert.equal(p.searchParams.get('client_id'), 'riot-client');
  assert.equal(web.searchParams.get('client_id'), 'play-valorant-web-prod');
  assert.equal(p.searchParams.get('prompt'), 'none');
  assert.ok(!p.searchParams.get('scope').includes('offline_access'));
});
test('settings callback validates identity, audience nonce expiry and state', () => {
  const a = attempt();
  const value = parsePreferenceCallback(callback(a), a, ID);
  assert.ok(value.expiresAt > Date.now() + 30000);
});
for (const [name, change] of [
  ['state', { state: 'other' }],
  ['nonce', { id_token: jwt({ sub: ID, aud: 'riot-client', nonce: 'other' }) }],
  ['client', { id_token: jwt({ sub: ID, aud: 'play-valorant-web-prod', nonce: 'b'.repeat(64) }) }],
  ['account', { id_token: jwt({ sub: OTHER, aud: 'riot-client', nonce: 'b'.repeat(64) }) }],
  ['expiry', { expires_in: '0' }],
  ['type', { token_type: 'Basic' }],
])
  test('rejects preference callback with mismatched ' + name, () => {
    const a = attempt();
    assert.throws(() => parsePreferenceCallback(callback(a, change), a, ID));
  });
for (const address of [
  'https://evil.example/redirect',
  'http://localhost.evil.example/redirect',
  'http://localhost/other',
  'http://localhost:8080/redirect',
  'http://localhost/redirect?x=1',
])
  test('rejects unexpected callback ' + address, () => {
    const a = attempt();
    assert.throws(() =>
      parsePreferenceCallback(callback(a).replace('http://localhost/redirect', address), a, ID),
    );
  });
test('duplicate callback credential fields and expired attempts are rejected', () => {
  const a = attempt();
  assert.throws(() => parsePreferenceCallback(callback(a) + '&state=' + a.state, a, ID));
  assert.throws(() =>
    parsePreferenceCallback(callback(a), { ...a, createdAt: Date.now() - 700000 }, ID),
  );
});
test('Android unfollowed redirect is accepted without any localhost request', async () => {
  const a = attempt(),
    calls = [],
    saved = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const r = new Response(null, {
      status: 302,
      headers: { Location: callback(a), 'Set-Cookie': 'ssid=rotated-fixture-cookie; Secure' },
    });
    Object.defineProperties(r, { url: { value: url }, redirected: { value: true } });
    return r;
  };
  await authorizePreferences(
    { ssid: 'old-fixture-cookie' },
    ID,
    a,
    f,
    async (c) => saved.push(c),
    'expo-android',
  );
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).protocol, 'https:');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(saved[0].ssid, 'rotated-fixture-cookie');
});
test('iOS accepts the ordinary manual redirect and rejects a followed one', async () => {
  const a = attempt();
  const make = (redirected) => async (url) => {
    const r = new Response(null, { status: 302, headers: { Location: callback(a) } });
    Object.defineProperties(r, { url: { value: url }, redirected: { value: redirected } });
    return r;
  };
  await authorizePreferences(
    { ssid: 'fixture-cookie' },
    ID,
    a,
    make(false),
    async () => {},
    'fetch-standard',
  );
  await assert.rejects(
    authorizePreferences(
      { ssid: 'fixture-cookie' },
      ID,
      a,
      make(true),
      async () => {},
      'fetch-standard',
    ),
    (e) => e.code === 'AUTH_REDIRECT',
  );
});
test('cookie rotation is checkpointed before a declined callback and never destroys the main grant', async () => {
  const a = attempt(),
    saved = [];
  const f = async () =>
    new Response(null, {
      status: 302,
      headers: {
        Location: callback(a, { error: 'login_required' }),
        'Set-Cookie': 'ssid=new-fixture-cookie; Secure',
      },
    });
  await assert.rejects(
    authorizePreferences(
      { ssid: 'old-fixture-cookie' },
      ID,
      a,
      f,
      async (c) => saved.push(c),
      'fetch-standard',
    ),
    (e) => e.code === 'AIM_AUTH_REQUIRED',
  );
  assert.equal(saved[0].ssid, 'new-fixture-cookie');
});
test('authorization respects Retry-After and does not start a request loop', async () => {
  let count = 0;
  const now = Date.now();
  await assert.rejects(
    authorizePreferences(
      { ssid: 'fixture-cookie' },
      ID,
      attempt(),
      async () => {
        count++;
        return new Response('', { status: 429, headers: { 'retry-after': '180' } });
      },
      async () => {},
      'fetch-standard',
    ),
    (e) => e.code === 'RATE_LIMIT' && e.retryAt >= now + 180000,
  );
  assert.equal(count, 1);
});
test('missing reusable cookies send no authorization request', async () => {
  let count = 0;
  await assert.rejects(
    authorizePreferences(
      {},
      ID,
      attempt(),
      async () => {
        count++;
        throw Error('not expected');
      },
      async () => {},
      'fetch-standard',
    ),
    (e) => e.code === 'AIM_AUTH_REQUIRED',
  );
  assert.equal(count, 0);
});
test('a cookie checkpoint failure aborts before token acceptance', async () => {
  const a = attempt();
  await assert.rejects(
    authorizePreferences(
      { ssid: 'fixture-cookie' },
      ID,
      a,
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: callback(a), 'set-cookie': 'ssid=fixture-new-cookie' },
        }),
      async () => {
        throw Error('disk failure');
      },
      'fetch-standard',
    ),
    /disk failure/,
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ID, OTHER, jwt, code } = require('./helpers.cjs');
const { authorizationUrl, reauthenticateWithCookies } = require('../.test-build/auth.js');
const {
  validateManualAuthorizationEnvelope: validate,
} = require('../.test-build/authResponseEnvelope.js');
const attempt = () => ({ state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: Date.now() });
const request = () => ({
  url: authorizationUrl(attempt()),
  method: 'GET',
  redirect: 'manual',
  credentials: 'omit',
});
const envelope = (r, changes = {}) => ({ status: 302, redirected: true, url: r.url, ...changes });
function callback(a, changes = {}) {
  return (
    'https://playvalorant.com/opt_in#' +
    new URLSearchParams({
      access_token: jwt({ sub: ID, exp: Math.floor(Date.now() / 1000) + 3500 }),
      id_token: jwt({ sub: ID, nonce: a.nonce }),
      expires_in: '3600',
      token_type: 'Bearer',
      state: a.state,
      ...changes,
    })
  );
}
function reply(url, a, opts = {}) {
  const r = new Response(null, {
    status: opts.status ?? 302,
    headers: {
      location: opts.location ?? callback(a),
      'set-cookie': opts.cookies ?? 'ssid=rotated-fixture; Path=/; Secure; HttpOnly',
      ...(opts.headers ?? {}),
    },
  });
  Object.defineProperties(r, {
    url: { value: opts.url ?? url },
    redirected: { value: opts.redirected ?? true },
  });
  return r;
}
test('old guard rejects the exact unfollowed Android 302; narrow Android envelope accepts it', () => {
  const r = request(),
    e = envelope(r);
  assert.equal(e.redirected || new URL(e.url).origin !== 'https://auth.riotgames.com', true);
  assert.equal(validate(r, e, 'expo-android'), 'expo-android-unfollowed-redirect');
});
for (const status of [301, 302, 303, 307, 308])
  test(`Android manual ${status} requires the original authorization URL`, () => {
    const r = request();
    assert.equal(
      validate(r, envelope(r, { status }), 'expo-android'),
      'expo-android-unfollowed-redirect',
    );
  });
for (const status of [200, 204, 400, 401, 403, 429, 500])
  test(`Android redirected=true does not exempt status ${status}`, () => {
    const r = request();
    assert.throws(
      () => validate(r, envelope(r, { status }), 'expo-android'),
      code('AUTH_REDIRECT'),
    );
  });
for (const url of [
  '',
  'https://attacker.invalid/',
  'http://auth.riotgames.com/authorize',
  'https://auth.riotgames.com.evil.test/authorize',
  'https://auth.riotgames.com/other',
  'https://auth.riotgames.com:8443/authorize',
  'not-a-url',
]) {
  test(`Android does not trust a missing or changed response URL: ${url || '(empty)'}`, () => {
    const r = request();
    assert.throws(() => validate(r, envelope(r, { url }), 'expo-android'), code('AUTH_REDIRECT'));
  });
}
test('same origin with modified OAuth state is rejected, even with redirected=false', () => {
  const r = request(),
    u = new URL(r.url);
  u.searchParams.set('state', 'wrong');
  for (const redirected of [true, false])
    assert.throws(
      () => validate(r, envelope(r, { url: u.href, redirected }), 'expo-android'),
      code('AUTH_REDIRECT'),
    );
});
for (const patch of [
  { method: 'POST' },
  { redirect: 'follow' },
  { credentials: 'include' },
  { url: 'https://attacker.invalid/authorize' },
]) {
  test(`only the isolated manual GET may use compatibility: ${JSON.stringify(patch)}`, () => {
    const r = { ...request(), ...patch };
    assert.throws(() => validate(r, envelope(r), 'expo-android'), code('AUTH_REDIRECT'));
  });
}
test('iOS/standard Fetch still rejects the same redirected flag', () => {
  const r = request();
  assert.throws(() => validate(r, envelope(r)), code('AUTH_REDIRECT'));
  assert.equal(validate(r, envelope(r, { redirected: false })), 'standard');
});
test('response and request objects are never rewritten by compatibility validation', () => {
  const r = Object.freeze(request()),
    e = Object.freeze(envelope(r));
  validate(r, e, 'expo-android');
  assert.equal(e.redirected, true);
});
test('actual renewal parses Android callback and checkpoints the rotated cookie', async () => {
  const a = attempt(),
    calls = [],
    writes = [];
  const tokens = await reauthenticateWithCookies(
    { ssid: 'old', unrelated: 'excluded' },
    a,
    async (url, init) => {
      calls.push({ url, init });
      return reply(url, a);
    },
    async (c) => writes.push(c),
    'expo-android',
  );
  assert.equal(tokens.reauthCookies.ssid, 'rotated-fixture');
  assert.equal(calls.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.headers.Cookie, 'ssid=old');
});
for (const [label, changes, expected] of [
  ['state mismatch', { state: 'wrong' }, 'AUTH_STATE'],
  ['nonce mismatch', { id_token: jwt({ sub: ID, nonce: 'wrong' }) }, 'AUTH_NONCE'],
  ['expired token', { expires_in: '0' }, 'AUTH_EXPIRY'],
  ['wrong token type', { token_type: 'Basic' }, 'AUTH_TOKEN'],
  ['denied login', { error: 'access_denied' }, 'AUTH_DENIED'],
])
  test(`Android compatibility cannot bypass callback ${label}`, async () => {
    const a = attempt();
    await assert.rejects(
      reauthenticateWithCookies(
        { ssid: 'old' },
        a,
        async (url) => reply(url, a, { location: callback(a, changes) }),
        undefined,
        'expo-android',
      ),
      code(expected),
    );
  });
test('duplicate callback state is still rejected for Android', async () => {
  const a = attempt();
  await assert.rejects(
    reauthenticateWithCookies(
      { ssid: 'old' },
      a,
      async (url) => reply(url, a, { location: callback(a) + '&state=' + a.state }),
      undefined,
      'expo-android',
    ),
    code('AUTH_REDIRECT'),
  );
});
test('foreign redirect response cannot checkpoint cookies or make another request', async () => {
  let calls = 0,
    writes = 0;
  const a = attempt();
  await assert.rejects(
    reauthenticateWithCookies(
      { ssid: 'old' },
      a,
      async (url) => {
        calls++;
        return reply(url, a, { url: 'https://attacker.invalid/' });
      },
      async () => writes++,
      'expo-android',
    ),
    code('AUTH_REDIRECT'),
  );
  assert.equal(calls, 1);
  assert.equal(writes, 0);
});
test('foreign Location is not followed even for an otherwise matching Android envelope', async () => {
  let calls = 0;
  const a = attempt();
  await assert.rejects(
    reauthenticateWithCookies(
      { ssid: 'old' },
      a,
      async (url) => {
        calls++;
        return reply(url, a, { location: 'https://attacker.invalid/' });
      },
      undefined,
      'expo-android',
    ),
    code('REAUTH_REQUIRED'),
  );
  assert.equal(calls, 1);
});
test('standard iOS-shaped renewal completes with no Android exception', async () => {
  const a = attempt();
  const result = await reauthenticateWithCookies({ ssid: 'old' }, a, async (url) =>
    reply(url, a, { redirected: false }),
  );
  assert.equal(result.reauthCookies.ssid, 'rotated-fixture');
});
test('Android rate limits preserve Retry-After and checkpoint rotated cookies without retry', async () => {
  const a = attempt(),
    before = Date.now();
  let calls = 0,
    saved;
  await assert.rejects(
    reauthenticateWithCookies(
      { ssid: 'old' },
      a,
      async (url) => {
        calls++;
        return reply(url, a, { status: 429, redirected: false, headers: { 'retry-after': '120' } });
      },
      async (c) => {
        saved = c;
      },
      'expo-android',
    ),
    (e) => e.code === 'RATE_LIMIT' && e.retryAt >= before + 120000,
  );
  assert.equal(saved.ssid, 'rotated-fixture');
  assert.equal(calls, 1);
});
test('installed Expo Android source matches the semantics covered by these fixtures', () => {
  const dir = path.join(__dirname, '../node_modules/expo/android/src/main/java/expo/modules/fetch');
  const response = fs.readFileSync(path.join(dir, 'NativeResponse.kt'), 'utf8'),
    req = fs.readFileSync(path.join(dir, 'NativeRequest.kt'), 'utf8');
  assert.match(response, /val redirected = response\.isRedirect/);
  assert.match(response, /val url = response\.request\.url\.toString\(\)/);
  assert.match(
    req,
    /if \(requestInit\.redirect != NativeRequestRedirect\.FOLLOW\)\s*\{\s*clientBuilder\.followRedirects\(false\)\s*clientBuilder\.followSslRedirects\(false\)/,
  );
  assert.match(req, /clientBuilder\.cookieJar\(CookieJar\.NO_COOKIES\)/);
});

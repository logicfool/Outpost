const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, jwt, code } = require('./helpers.cjs');
const { reauthenticateWithCookies, rotatedCookies } = require('../.test-build/auth.js');
const attempt = () => ({ state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: Date.now() });
function callback(a, extra = {}) {
  const params = new URLSearchParams({
    access_token: jwt({ sub: ID, exp: Math.floor(Date.now() / 1000) + 3500 }),
    id_token: jwt({ sub: ID, nonce: a.nonce }),
    expires_in: '3600',
    token_type: 'Bearer',
    state: a.state,
    ...extra,
  });
  return 'https://playvalorant.com/opt_in#' + params;
}
test('silent renewal validates callback state and nonce and uses isolated manual redirects', async () => {
  const a = attempt();
  let observed;
  const result = await reauthenticateWithCookies(
    { ssid: 'old-cookie', attacker: 'never-sent' },
    a,
    async (url, init) => {
      observed = { url, init };
      return new Response(null, {
        status: 302,
        headers: {
          location: callback(a),
          'set-cookie': 'ssid=new-cookie; Secure; HttpOnly; Path=/, tdid=device-cookie; Secure',
        },
      });
    },
  );
  assert.equal(observed.init.credentials, 'omit');
  assert.equal(observed.init.redirect, 'manual');
  assert.equal(observed.init.headers.Cookie, 'ssid=old-cookie');
  const request = new URL(observed.url);
  assert.equal(request.searchParams.get('state'), a.state);
  assert.equal(request.searchParams.get('nonce'), a.nonce);
  assert.equal(result.reauthCookies.ssid, 'new-cookie');
  assert.equal(result.reauthCookies.tdid, 'device-cookie');
  assert.ok(result.expiresAt <= Date.now() + 3600000);
});
test('incorrect reauthentication state is rejected', async () => {
  const a = attempt();
  await assert.rejects(
    reauthenticateWithCookies(
      { ssid: 'cookie' },
      a,
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: callback(a, { state: 'attacker' }) },
        }),
    ),
    code('AUTH_STATE'),
  );
});
test('incorrect reauthentication nonce is rejected', async () => {
  const a = attempt();
  await assert.rejects(
    reauthenticateWithCookies(
      { ssid: 'cookie' },
      a,
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: callback(a, { id_token: jwt({ sub: ID, nonce: 'wrong' }) }) },
        }),
    ),
    code('AUTH_NONCE'),
  );
});
test('login challenge returns reauth required instead of guessing a token', async () => {
  await assert.rejects(
    reauthenticateWithCookies(
      { ssid: 'cookie' },
      attempt(),
      async () => new Response('<html>login</html>', { status: 200 }),
    ),
    code('REAUTH_REQUIRED'),
  );
});
test('redirect to arbitrary host never supplies credentials to another request', async () => {
  let calls = 0;
  await assert.rejects(
    reauthenticateWithCookies({ ssid: 'cookie' }, attempt(), async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.invalid/' },
      });
    }),
    code('REAUTH_REQUIRED'),
  );
  assert.equal(calls, 1);
});
test('native transport following a redirect unexpectedly fails closed', async () => {
  const a = attempt();
  await assert.rejects(
    reauthenticateWithCookies({ ssid: 'cookie' }, a, async () => {
      const r = new Response(null, { status: 302, headers: { location: callback(a) } });
      Object.defineProperty(r, 'redirected', { value: true });
      return r;
    }),
    code('AUTH_REDIRECT'),
  );
});
test('reauth respects Riot cooldown and does not retry', async () => {
  const before = Date.now();
  await assert.rejects(
    reauthenticateWithCookies(
      { ssid: 'cookie' },
      attempt(),
      async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } }),
    ),
    (error) => error.code === 'RATE_LIMIT' && error.retryAt >= before + 120000,
  );
});
test('session-cookie rotation honors deletion and excludes unrelated cookies', () => {
  const headers = new Headers();
  headers.append('set-cookie', 'ssid=; Max-Age=0; Secure');
  headers.append('set-cookie', 'other=ignore');
  headers.append('set-cookie', 'tdid=next; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Secure');
  assert.deepEqual(rotatedCookies({ ssid: 'old', did: 'retained' }, headers), {
    did: 'retained',
    tdid: 'next',
  });
});
test('missing reusable cookie cannot attempt background renewal', async () => {
  let called = false;
  await assert.rejects(
    reauthenticateWithCookies({}, attempt(), async () => {
      called = true;
      return new Response();
    }),
    code('REAUTH_UNAVAILABLE'),
  );
  assert.equal(called, false);
});
test('reauth network errors cannot leak cookie or arbitrary upstream text', async () => {
  await assert.rejects(
    reauthenticateWithCookies({ ssid: 'private' }, attempt(), async () => {
      throw Error('private');
    }),
    (e) => e.code === 'NETWORK' && !e.message.includes('private'),
  );
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const { PreferenceSession } = require('../.test-build/preferenceSession.js');
const { SessionVault } = require('../.test-build/vault.js');
const { HttpClient } = require('../.test-build/http.js');
const { CredentialQueue } = require('../.test-build/credentialQueue.js');
const { AppError } = require('../.test-build/validation.js');
const { ID, OTHER, session, jwt, response } = require('./helpers.cjs');
const clone = (value) => structuredClone(value);
function makeVault(prefix, storage) {
  let serial = 0;
  return new SessionVault(
    {
      get: async (key) => storage.get(prefix + key) ?? null,
      set: async (key, value) => {
        storage.set(prefix + key, value);
      },
      remove: async (key) => {
        storage.delete(prefix + key);
      },
    },
    () => String(++serial).padStart(32, '0'),
  );
}
async function fixture(options = {}) {
  const storage = new Map(),
    main = makeVault('main-', storage),
    scoped = makeVault('aim-', storage),
    gates = new Map(),
    calls = [];
  const original = session(ID);
  original.reauth = {
    cookies: { ssid: 'original-fixture-cookie', sub: ID },
    capturedAt: Date.now(),
  };
  await main.write(original);
  const now = Date.now();
  const attempt = () => ({ state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: Date.now() });
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (options.onRequest) await options.onRequest(url, init, { main, scoped, calls });
    if (url.includes('/authorize')) {
      const a = attempt(),
        params = new URLSearchParams({
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
        });
      return new Response(null, {
        status: 302,
        headers: {
          Location: 'http://localhost/redirect#' + params,
          'set-cookie': 'ssid=rotated-fixture-cookie; Secure',
        },
      });
    }
    if (url.endsWith('/userinfo')) {
      if (options.userinfoError) throw new AppError('NETWORK', 'Fixture verification unavailable.');
      return response({
        sub: options.wrongUser ? OTHER : ID,
        acct: { game_name: 'Fixture', tag_line: 'TEST' },
      });
    }
    if (url.includes('entitlements'))
      return response({ entitlements_token: 'scoped-entitlements-fixture-token' });
    throw Error('Unexpected test request ' + url);
  };
  const auth = new PreferenceSession(
    main,
    scoped,
    {
      read: async (id) => gates.get(id) ?? null,
      save: async (id, gate) => {
        gates.set(id, clone(gate));
      },
    },
    new HttpClient(fetcher),
    fetcher,
    attempt,
    'fetch-standard',
    () => now,
  );
  return { storage, main, scoped, gates, calls, auth, original };
}
test('settings credentials use a separate journal and preserve the working main token', async () => {
  const h = await fixture(),
    value = await h.auth.get(ID, () => {}),
    main = await h.main.read(ID);
  assert.notEqual(value.accessToken, h.original.accessToken);
  assert.equal(main.accessToken, h.original.accessToken);
  assert.equal(main.entitlementsToken, h.original.entitlementsToken);
  assert.equal(main.reauth.cookies.ssid, 'rotated-fixture-cookie');
  assert.equal(value.reauth, undefined);
  assert.ok([...h.storage.keys()].some((k) => k.startsWith('aim-')));
  assert.equal(h.calls.length, 3);
  assert.equal(new URL(h.calls[0].url).searchParams.get('client_id'), 'riot-client');
  const userinfo = h.calls.find((c) => c.url.endsWith('/userinfo'));
  assert.equal(userinfo.init.headers.Authorization, 'Bearer ' + value.accessToken);
  assert.equal(userinfo.init.headers.Cookie, undefined);
});
test('verified cached preference credentials need no new authorization or userinfo requests', async () => {
  const h = await fixture(),
    first = await h.auth.get(ID, () => {});
  const count = h.calls.length;
  const second = await h.auth.get(ID, () => {});
  assert.equal(second.accessToken, first.accessToken);
  assert.equal(h.calls.length, count);
});
test('rotated cookie is saved before userinfo failure and survives process restart', async () => {
  const h = await fixture({ userinfoError: true });
  await assert.rejects(h.auth.get(ID, () => {}));
  const saved = await h.main.read(ID);
  assert.equal(saved.reauth.cookies.ssid, 'rotated-fixture-cookie');
  assert.equal(saved.accessToken, h.original.accessToken);
  assert.equal(await h.scoped.read(ID), null);
  const count = h.calls.length;
  await assert.rejects(
    h.auth.get(ID, () => {}),
    (e) => e.code === 'AIM_AUTH_WAIT',
  );
  assert.equal(h.calls.length, count);
});
test('wrong authenticated subject rejects the scoped grant without invalidating main account', async () => {
  const h = await fixture({ wrongUser: true });
  await assert.rejects(
    h.auth.get(ID, () => {}),
    (e) => e.code === 'ACCOUNT_MISMATCH',
  );
  assert.equal(await h.scoped.read(ID), null);
  assert.equal((await h.main.read(ID)).accessToken, h.original.accessToken);
});
test('removal during entitlement verification cannot resurrect settings credentials', async () => {
  let valid = true;
  const h = await fixture({
    onRequest: async (url) => {
      if (url.endsWith('/userinfo')) valid = false;
    },
  });
  await assert.rejects(
    h.auth.get(ID, () => {
      if (!valid) throw new AppError('SESSION_REMOVED', 'Removed.');
    }),
    (e) => e.code === 'SESSION_REMOVED',
  );
  assert.equal(await h.scoped.read(ID), null);
});
test('per-account credential queue serializes web and Aim exchanges but not other accounts', async () => {
  const q = new CredentialQueue(),
    events = [];
  let release;
  const held = new Promise((r) => (release = r));
  const first = q.run(ID, async () => {
    events.push('web-start');
    await held;
    events.push('web-end');
  });
  const second = q.run(ID, async () => events.push('aim'));
  await q.run(OTHER, async () => events.push('other'));
  assert.deepEqual(events, ['web-start', 'other']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['web-start', 'other', 'web-end', 'aim']);
});
test('failed credential work does not permanently block later work', async () => {
  const q = new CredentialQueue();
  await assert.rejects(
    q.run(ID, async () => {
      throw Error('failure');
    }),
  );
  assert.equal(await q.run(ID, async () => 42), 42);
});
test('ordinary names, rank or preference responses never modify the main session schema', async () => {
  const h = await fixture();
  await h.auth.get(ID, () => {});
  const saved = await h.main.read(ID);
  assert.deepEqual(Object.keys(saved).sort(), [
    'accessToken',
    'account',
    'entitlementsToken',
    'reauth',
    'version',
  ]);
});

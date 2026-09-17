const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  crypto = require('node:crypto');
const ts = require('typescript');
const { ID, OTHER, session, jwt, response, catalog, code } = require('./helpers.cjs');
const { SessionVault } = require('../.test-build/vault.js');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
async function fixture(os = 'android') {
  let now = Date.now(),
    failExchange = false,
    wrongAccount = false,
    badState = false,
    badUrl = false,
    rateLimit = false,
    androidFlag = os === 'android';
  const values = new Map(),
    accounts = new Map(),
    trace = [],
    requests = [];
  const vault = new SessionVault(
    {
      get: async (k) => values.get(k) ?? null,
      set: async (k, v) => values.set(k, v),
      remove: async (k) => values.delete(k),
    },
    crypto.randomUUID,
  );
  for (const id of [ID, OTHER]) {
    const s = session(id);
    s.account.expiresAt = now - 1000;
    s.reauth = { cookies: { ssid: 'old-' + id, sub: id }, capturedAt: now };
    s.renewalFailure = { code: 'AUTH_REDIRECT', retryAt: now - 1 };
    await vault.write(s);
    accounts.set(id, s.account);
  }
  const write = vault.write.bind(vault);
  vault.write = async (s) => {
    trace.push(['save', s.account.puuid, s.reauth?.cookies.ssid]);
    return write(s);
  };
  const fetcher = async (url, init) => {
    requests.push({ url, method: init.method });
    const u = new URL(url),
      headers = new Headers(init.headers);
    if (u.origin === 'https://auth.riotgames.com' && u.pathname === '/authorize') {
      assert.equal(init.redirect, 'manual');
      assert.equal(init.credentials, 'omit');
      const id = /(?:^|; )sub=([^;]+)/.exec(headers.get('cookie'))?.[1];
      assert.ok([ID, OTHER].includes(id));
      assert.match(headers.get('cookie'), new RegExp('ssid=(?:old|rotated)-' + id));
      trace.push(['authorize', id]);
      const sub = wrongAccount ? ID : id;
      const location =
        'https://playvalorant.com/opt_in#' +
        new URLSearchParams({
          state: badState ? 'bad-state' : u.searchParams.get('state'),
          token_type: 'Bearer',
          expires_in: '3500',
          access_token: jwt({ sub, exp: Math.floor(Date.now() / 1000) + 3500 }),
          id_token: jwt({ sub, nonce: u.searchParams.get('nonce') }),
        });
      const r = new Response(null, {
        status: rateLimit ? 429 : 302,
        headers: {
          location,
          'set-cookie': 'ssid=rotated-' + id + '; Secure; HttpOnly',
          'retry-after': '120',
        },
      });
      Object.defineProperties(r, {
        url: { value: badUrl ? 'https://attacker.invalid/' : url },
        redirected: { value: !rateLimit && androidFlag },
      });
      return r;
    }
    const access = headers.get('authorization')?.slice(7),
      id = JSON.parse(Buffer.from(access.split('.')[1], 'base64url')).sub;
    assert.equal(headers.has('cookie'), false);
    const kind =
      u.pathname === '/userinfo'
        ? 'userinfo'
        : u.hostname === 'entitlements.auth.riotgames.com'
          ? 'entitlement'
          : undefined;
    assert.ok(kind, 'Unexpected network request');
    trace.push([kind, id]);
    if (failExchange && kind === 'entitlement') throw Error('synthetic network outage');
    return response(
      kind === 'userinfo'
        ? { sub: id, acct: { game_name: 'Fixture', tag_line: 'TEST' } }
        : { entitlements_token: 'entitlements-fixture-' + id },
    );
  };
  const repo = {
    accounts: async () => [...accounts.values()],
    saveAccount: async (a) => accounts.set(a.puuid, { ...a }),
    catalog: async () => catalog(),
    snapshot: async () => null,
    saveCatalog: async () => {},
  };
  function create() {
    const m = { exports: {} },
      load = (name) => {
        if (name === 'react-native') return { Platform: { OS: os } };
        if (name === './network') return { nativeFetcher: fetcher };
        if (name === './chatStorage')
          return { activateChatStorage() {}, removeChatStorage: async () => {} };
        if (name === './secure')
          return {
            vault,
            randomHex: () => crypto.randomBytes(32).toString('hex'),
            randomId: crypto.randomUUID,
          };
        if (name === './storage') return { openRepository: async () => repo };
        if (name === './notifications') return {};
        if (name.startsWith('../core/'))
          return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
        throw Error('Unexpected module ' + name);
      };
    vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
      load,
      m,
      m.exports,
    );
    const r = new m.exports.Runtime(repo, () => now);
    r.catalog = catalog();
    r.publicClient = { version: async () => 'fixture-1', load: async () => catalog() };
    return r;
  }
  return {
    create,
    vault,
    accounts,
    trace,
    requests,
    advance: (ms) => (now += ms),
    fail: (v) => (failExchange = v),
    wrong: () => (wrongAccount = true),
    badState: () => (badState = true),
    badUrl: () => (badUrl = true),
    rateLimit: (v) => (rateLimit = v),
    androidFlag: () => (androidFlag = true),
  };
}
for (const os of ['android', 'ios'])
  test(`${os}: real renewal implementation plus Runtime verifies and saves two separate accounts`, async () => {
    const h = await fixture(os),
      r = h.create();
    const [a, b] = await Promise.all([r.client(ID), r.client(OTHER)]);
    assert.equal(a.isActive(), true);
    assert.equal(b.isActive(), true);
    for (const id of [ID, OTHER]) {
      const saved = await h.vault.read(id);
      assert.equal(saved.reauth.cookies.ssid, 'rotated-' + id);
      assert.equal(saved.renewalFailure, undefined);
      const firstVerify = h.trace.findIndex((v) => v[0] === 'userinfo' && v[1] === id);
      assert.ok(
        h.trace
          .slice(0, firstVerify)
          .some((v) => v[0] === 'save' && v[1] === id && v[2] === 'rotated-' + id),
      );
    }
    const count = h.requests.length;
    await h.create().client(ID);
    await h.create().client(OTHER);
    assert.equal(h.requests.length, count);
  });
test('Android: old AUTH_REDIRECT cooldown survives update, then renewal succeeds without relinking', async () => {
  const h = await fixture(),
    s = await h.vault.read(OTHER);
  s.renewalFailure.retryAt = Date.now() + 120000;
  await h.vault.write(s);
  await assert.rejects(h.create().client(OTHER), code('RENEWAL_WAIT'));
  assert.equal(h.requests.length, 0);
  h.advance(121000);
  assert.equal((await h.create().client(OTHER)).isActive(), true);
  assert.equal(h.accounts.size, 2);
});
test('Android: a temporary exchange failure keeps rotation and resumes once after restart', async () => {
  const h = await fixture();
  h.fail(true);
  await assert.rejects(h.create().client(OTHER), code('NETWORK'));
  const s = await h.vault.read(OTHER);
  assert.equal(s.reauth.cookies.ssid, 'rotated-' + OTHER);
  assert.equal(s.renewalPending, true);
  const authCalls = h.trace.filter((v) => v[0] === 'authorize').length;
  await assert.rejects(h.create().client(OTHER), code('RENEWAL_WAIT'));
  h.advance(61000);
  h.fail(false);
  assert.equal((await h.create().client(OTHER)).isActive(), true);
  assert.equal(h.trace.filter((v) => v[0] === 'authorize').length, authCalls);
});
test('Android: valid envelope cannot save another accounts tokens', async () => {
  const h = await fixture(),
    first = await h.vault.read(ID),
    second = await h.vault.read(OTHER);
  h.wrong();
  await assert.rejects(h.create().client(OTHER), code('ACCOUNT_MISMATCH'));
  assert.deepEqual(await h.vault.read(ID), first);
  assert.equal((await h.vault.read(OTHER)).accessToken, second.accessToken);
  assert.equal(
    h.trace.some((v) => v[0] === 'userinfo'),
    false,
  );
});
test('Android: invalid state never reaches entitlement or userinfo verification', async () => {
  const h = await fixture();
  h.badState();
  await assert.rejects(h.create().client(OTHER), code('AUTH_STATE'));
  assert.equal(
    h.trace.some((v) => v[0] === 'userinfo' || v[0] === 'entitlement'),
    false,
  );
});
test('Android: untrusted reported response URL cannot replace a saved cookie', async () => {
  const h = await fixture();
  h.badUrl();
  await assert.rejects(h.create().client(OTHER), code('AUTH_REDIRECT'));
  assert.equal((await h.vault.read(OTHER)).reauth.cookies.ssid, 'old-' + OTHER);
});
test('iOS Runtime never opts into the Android redirected-flag exception', async () => {
  const h = await fixture('ios');
  h.androidFlag();
  await assert.rejects(h.create().client(OTHER), code('AUTH_REDIRECT'));
  assert.equal((await h.vault.read(OTHER)).reauth.cookies.ssid, 'old-' + OTHER);
});
test('Android Runtime preserves server Retry-After and other accounts after update-style restart', async () => {
  const h = await fixture();
  h.rateLimit(true);
  await assert.rejects(h.create().client(OTHER), code('RATE_LIMIT'));
  h.rateLimit(false);
  h.advance(61000);
  await assert.rejects(h.create().client(OTHER), code('RENEWAL_WAIT'));
  assert.equal(h.trace.filter((v) => v[0] === 'authorize').length, 1);
  assert.equal((await h.create().client(ID)).isActive(), true);
});

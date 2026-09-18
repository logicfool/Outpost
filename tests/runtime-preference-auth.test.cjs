const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const { ID, session, jwt, response, catalog } = require('./helpers.cjs'),
  { document } = require('./aim-helpers.cjs');
const { encodeAimDocument } = require('../.test-build/aimCodec.js');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function fixture(platform = 'android') {
  let now = Date.now(),
    denied = 0;
  const states = new Map(),
    gates = new Map(),
    calls = [],
    original = session(ID);
  original.reauth = { cookies: { ssid: 'old-runtime-cookie', sub: ID }, capturedAt: now };
  const mainMap = new Map([[ID, structuredClone(original)]]),
    aimMap = new Map();
  const vault = (m) => ({
    read: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
    write: async (s) => {
      m.set(s.account.puuid, structuredClone(s));
    },
    remove: async (id) => {
      m.delete(id);
    },
  });
  const main = vault(mainMap),
    scoped = vault(aimMap);
  const repo = {
    accounts: async () => [original.account],
    catalog: async () => catalog(),
    saveCatalog: async () => {},
    saveAccount: async () => {},
    aimState: async (id) => states.get(id) ?? null,
    saveAimState: async (id, s) => states.set(id, structuredClone(s)),
    refreshGate: async (id, p) => gates.get(id + p) ?? null,
    saveRefreshGate: async (id, p, v) => gates.set(id + p, structuredClone(v)),
  };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/authorize')) {
      const u = new URL(url),
        p = u.searchParams;
      const location =
        'http://localhost/redirect#' +
        new URLSearchParams({
          state: p.get('state'),
          token_type: 'Bearer',
          expires_in: '3600',
          access_token: jwt({
            sub: ID,
            client_id: 'riot-client',
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
          id_token: jwt({
            sub: ID,
            aud: 'riot-client',
            nonce: p.get('nonce'),
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        });
      const r = new Response(null, {
        status: 302,
        headers: { Location: location, 'set-cookie': 'ssid=new-runtime-cookie; Secure' },
      });
      if (platform === 'android')
        Object.defineProperties(r, { redirected: { value: true }, url: { value: url } });
      return r;
    }
    if (url.endsWith('/userinfo'))
      return response({ sub: ID, acct: { game_name: 'Fixture', tag_line: 'TEST' } });
    if (url.includes('entitlements'))
      return response({ entitlements_token: 'runtime-scoped-entitlements-fixture' });
    if (url.includes('/playerPref/')) {
      if (denied) return new Response('denied', { status: denied });
      return response(encodeAimDocument(document().data));
    }
    throw Error('Unexpected fixture URL ' + url);
  };
  const load = (name) => {
    if (name === 'react-native') return { Platform: { OS: platform } };
    if (name === './network') return { nativeFetcher: fetcher };
    if (name === './secure')
      return {
        vault: main,
        preferencesVault: scoped,
        randomHex: () => 'b'.repeat(64),
        randomId: () => ID,
      };
    if (name === './chatStorage')
      return { activateChatStorage() {}, removeChatStorage: async () => {} };
    if (name === './storage') return { openRepository: async () => repo };
    if (name === './notifications')
      return {
        cancelAccountNotifications: async () => {},
        updateStoreNotifications: async () => {},
      };
    if (name.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
    throw Error(name);
  };
  const m = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
  const runtime = new m.exports.Runtime(repo, () => now);
  runtime.catalog = catalog();
  runtime.publicClient = { version: async () => 'release-fixture', clear() {} };
  return {
    runtime,
    calls,
    mainMap,
    aimMap,
    original,
    states,
    deny: (status) => {
      denied = status;
    },
    advance: () => {
      now += 61000;
    },
  };
}
for (const platform of ['android', 'ios'])
  test(`${platform}: Runtime Aim request uses its own grant and retains the live main client`, async () => {
    const h = fixture(platform),
      main = await h.runtime.client(ID),
      result = await h.runtime.syncAim(ID, 'manual');
    assert.ok(result.snapshot);
    assert.equal(await h.runtime.client(ID), main);
    assert.equal(h.mainMap.get(ID).accessToken, h.original.accessToken);
    assert.equal(h.mainMap.get(ID).reauth.cookies.ssid, 'new-runtime-cookie');
    const request = h.calls.find((c) => c.url.includes('/playerPref/'));
    assert.equal(request.init.headers.Authorization, 'Bearer ' + h.aimMap.get(ID).accessToken);
    assert.notEqual(request.init.headers.Authorization, 'Bearer ' + h.original.accessToken);
    assert.ok(request.init.headers['X-Riot-ClientPlatform']);
    assert.equal(request.init.headers['X-Riot-ClientVersion'], 'release-fixture');
    assert.equal(request.init.headers.Cookie, undefined);
  });
test('a preference 401 invalidates only the scoped grant and respects the saved read deadline', async () => {
  const h = fixture(),
    main = await h.runtime.client(ID);
  h.deny(401);
  const result = await h.runtime.syncAim(ID, 'manual');
  assert.equal(result.error.code, 'AIM_AUTH');
  assert.equal(h.aimMap.get(ID).accessRejected, true);
  assert.equal(h.mainMap.get(ID).accessRejected, undefined);
  assert.equal(await h.runtime.client(ID), main);
  const count = h.calls.length;
  await h.runtime.syncAim(ID, 'manual');
  assert.equal(h.calls.length, count);
  h.advance();
  h.deny(0);
  assert.ok((await h.runtime.syncAim(ID, 'manual')).snapshot);
  assert.equal(h.calls.filter((c) => c.url.includes('/authorize')).length, 2);
});
test('a settings 403 cannot expire the main token or authorize repeatedly during cooldown', async () => {
  const h = fixture();
  h.deny(403);
  await h.runtime.syncAim(ID, 'manual');
  const count = h.calls.length;
  await h.runtime.syncAim(ID, 'manual');
  assert.equal(h.calls.length, count);
  assert.equal(h.mainMap.get(ID).accessRejected, undefined);
  assert.equal(h.aimMap.get(ID).accessRejected, undefined);
});

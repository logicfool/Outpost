const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  crypto = require('node:crypto');
const { ID, OTHER, session, jwt, response, catalog, code } = require('./helpers.cjs');
const { SessionVault } = require('../.test-build/vault.js'),
  { HttpClient } = require('../.test-build/http.js'),
  { AppError } = require('../.test-build/validation.js');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
async function fixture() {
  let now = Date.now(),
    networkError,
    reauthError,
    wrong = false,
    metadataError = false;
  const values = new Map(),
    accounts = new Map(),
    events = [];
  const renewals = new Map();
  const vault = new SessionVault(
    {
      get: async (k) => values.get(k) ?? null,
      set: async (k, v) => values.set(k, v),
      remove: async (k) => {
        values.delete(k);
      },
    },
    crypto.randomUUID,
  );
  for (const id of [ID, OTHER]) {
    const s = session(id);
    s.account.expiresAt = now - 1;
    s.reauth = { cookies: { ssid: 'cookie-' + id, sub: id }, capturedAt: now };
    await vault.write(s);
    accounts.set(id, { ...s.account, canReauth: false });
  }
  const repo = {
    accounts: async () => [...accounts.values()],
    saveAccount: async (a) => {
      if (metadataError) throw Error('metadata unavailable');
      accounts.set(a.puuid, { ...a });
    },
    catalog: async () => catalog(),
    snapshot: async () => null,
    saveCatalog: async () => {},
  };
  const auth = {
    ...require('../.test-build/auth.js'),
    reauthenticateWithCookies: async (cookies) => {
      const id = cookies.sub;
      events.push(['renew', id]);
      renewals.set(id, (renewals.get(id) ?? 0) + 1);
      if (reauthError) throw reauthError;
      const sub = wrong ? ID : id;
      return {
        accessToken: jwt({ sub, exp: Math.floor(Date.now() / 1000) + 3500, fresh: true }),
        expiresAt: Date.now() + 3400000,
        reauthCookies: { ssid: 'rotated-' + id, sub },
      };
    },
  };
  function create() {
    const m = { exports: {} };
    const load = (name) => {
      if (name === 'react-native') return { Platform: { OS: 'ios' } };
      if (name === './network') return { nativeFetcher: fetch };
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
      if (name === '../core/auth') return auth;
      if (name.startsWith('../core/'))
        return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
      throw Error(name);
    };
    vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
      load,
      m,
      m.exports,
    );
    const r = new m.exports.Runtime(repo, () => now);
    r.catalog = catalog();
    r.publicClient = { version: async () => 'fixture-1', load: async () => catalog() };
    r.http = new HttpClient(async (url, init) => {
      const access = new Headers(init.headers).get('Authorization').slice(7),
        id = JSON.parse(Buffer.from(access.split('.')[1], 'base64url')).sub;
      events.push([url.includes('userinfo') ? 'userinfo' : 'entitlement', id]);
      if (networkError && url.includes('entitlements.')) throw networkError;
      return response(
        url.includes('userinfo')
          ? { sub: id, acct: { game_name: id === ID ? 'First' : 'Second', tag_line: 'TEST' } }
          : { entitlements_token: 'entitlement-' + id },
      );
    });
    return r;
  }
  return {
    create,
    vault,
    repo,
    accounts,
    events,
    renewals,
    advance: (ms) => (now += ms),
    fail: (e) => (networkError = e),
    reauthFail: (e) => (reauthError = e),
    wrong: () => (wrong = true),
    metadataFail: (v) => (metadataError = v),
  };
}
test('two expired accounts renew with only their own cookies and remain separate after restart', async () => {
  const h = await fixture(),
    r = h.create();
  const [a, b] = await Promise.all([r.client(ID), r.client(OTHER)]);
  assert.equal(a.isActive(), true);
  assert.equal(b.isActive(), true);
  assert.equal(h.renewals.get(ID), 1);
  assert.equal(h.renewals.get(OTHER), 1);
  const fresh = h.create();
  await fresh.client(OTHER);
  await fresh.client(ID);
  assert.equal(h.renewals.get(OTHER), 1);
  assert.equal((await h.vault.read(ID)).reauth.cookies.sub, ID);
  assert.equal((await h.vault.read(OTHER)).reauth.cookies.sub, OTHER);
});
test('second-account entitlement failure preserves rotation and resumes without another browser/auth request', async () => {
  const h = await fixture(),
    r = h.create(),
    first = await h.vault.read(ID);
  h.fail(new Error('network failed'));
  await assert.rejects(r.client(OTHER), code('NETWORK'));
  const staged = await h.vault.read(OTHER);
  assert.equal(staged.renewalPending, true);
  assert.equal(staged.reauth.cookies.ssid, 'rotated-' + OTHER);
  await assert.rejects(h.create().client(OTHER), code('RENEWAL_WAIT'));
  assert.equal(h.renewals.get(OTHER), 1);
  h.advance(61000);
  h.fail(null);
  assert.equal((await h.create().client(OTHER)).isActive(), true);
  assert.equal(h.renewals.get(OTHER), 1);
  assert.equal((await h.vault.read(OTHER)).renewalPending, undefined);
  assert.deepEqual(await h.vault.read(ID), first);
});
test('wrong-account renewal cannot replace the second account with first-account tokens', async () => {
  const h = await fixture(),
    before = await h.vault.read(OTHER);
  h.wrong();
  await assert.rejects(h.create().client(OTHER), code('ACCOUNT_MISMATCH'));
  const after = await h.vault.read(OTHER);
  assert.equal(after.accessToken, before.accessToken);
  assert.equal(after.reauth.cookies.ssid, before.reauth.cookies.ssid);
  assert.equal(after.account.puuid, OTHER);
});
test('rate-limit cooldown persists independently for each account across process restart', async () => {
  const h = await fixture();
  h.reauthFail(new AppError('RATE_LIMIT', 'Wait', Date.now() + 600000, 429));
  await assert.rejects(h.create().client(OTHER), code('RATE_LIMIT'));
  h.reauthFail(null);
  assert.equal((await h.create().client(ID)).isActive(), true);
  h.advance(61000);
  await assert.rejects(h.create().client(OTHER), code('RENEWAL_WAIT'));
  assert.equal(h.renewals.get(OTHER), 1);
});
test('temporary authentication network failure keeps the existing cookie and does not log out either account', async () => {
  const h = await fixture();
  h.reauthFail(new AppError('NETWORK', 'Offline'));
  await assert.rejects(h.create().client(OTHER), code('NETWORK'));
  assert.equal((await h.vault.read(OTHER)).reauth.cookies.ssid, 'cookie-' + OTHER);
  assert.equal(h.accounts.size, 2);
  await assert.rejects(h.create().client(OTHER), code('RENEWAL_WAIT'));
  assert.equal(h.renewals.get(OTHER), 1);
});
test('late metadata save failure cannot discard fresh credentials or force a second renewal', async () => {
  const h = await fixture();
  h.metadataFail(true);
  await assert.rejects(h.create().client(OTHER));
  const saved = await h.vault.read(OTHER);
  assert.equal(saved.renewalPending, undefined);
  assert.equal(saved.reauth.cookies.ssid, 'rotated-' + OTHER);
  h.metadataFail(false);
  const r = h.create();
  assert.equal((await r.client(OTHER)).isActive(), true);
  assert.equal(h.renewals.get(OTHER), 1);
  const repaired = await r.savedAccount(OTHER);
  assert.equal(repaired.canReauth, true);
  assert.equal(h.accounts.get(OTHER).expiresAt, saved.account.expiresAt);
});
test('manual token accounts remain explicitly nonrenewable and do not borrow another cookie', async () => {
  const h = await fixture(),
    second = await h.vault.read(OTHER);
  delete second.reauth;
  await h.vault.write(second);
  await assert.rejects(h.create().client(OTHER), code('SESSION_EXPIRED'));
  assert.equal(h.renewals.has(OTHER), false);
  assert.ok((await h.vault.read(ID)).reauth.cookies.ssid);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { ID, OTHER, session, response, catalog, code } = require('./helpers.cjs');
const { HttpClient } = require('../.test-build/http.js');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function harness() {
  let secret = session(),
    renewals = 0,
    hold,
    writes = 0;
  secret.reauth = { cookies: { ssid: 'fixture-cookie-not-real' }, capturedAt: Date.now() };
  const accounts = new Map([[ID, secret.account]]),
    snapshots = new Map();
  const vault = {
    read: async () => (secret ? structuredClone(secret) : null),
    write: async (s) => {
      writes++;
      secret = structuredClone(s);
    },
    remove: async () => {
      secret = null;
    },
  };
  const repo = {
    accounts: async () => [...accounts.values()],
    saveAccount: async (a) => {
      accounts.set(a.puuid, a);
    },
    removeAccount: async (id) => {
      accounts.delete(id);
      snapshots.delete(id);
    },
    catalog: async () => catalog(),
    saveCatalog: async () => {},
    clearCache: async () => {},
    snapshot: async (id) => snapshots.get(id) ?? null,
    saveSnapshot: async (s) => snapshots.set(s.accountId, s),
  };
  const auth = {
    ...require('../.test-build/auth.js'),
    reauthenticateWithCookies: async () => {
      renewals++;
      if (hold) await hold;
      const fresh = session();
      return {
        accessToken: fresh.accessToken,
        expiresAt: fresh.account.expiresAt,
        reauthCookies: { ssid: 'rotated-fixture-cookie' },
      };
    },
  };
  const customRequire = (name) => {
    if (name === 'react-native') return { Platform: { OS: 'ios' } };
    if (name === './chatStorage')
      return { activateChatStorage() {}, removeChatStorage: async () => {} };
    if (name === './network') return { nativeFetcher: fetch };
    if (name === './secure') return { vault, randomHex: () => 'f'.repeat(32) };
    if (name === './storage') return { openRepository: async () => repo };
    if (name === './notifications')
      return {
        cancelAccountNotifications: async () => {},
        updateStoreNotifications: async () => {},
      };
    if (name === '../core/auth') return auth;
    if (name.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
    throw Error('Unexpected module ' + name);
  };
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
    customRequire,
    module,
    module.exports,
  );
  const runtime = new module.exports.Runtime(repo);
  runtime.catalog = catalog();
  runtime.publicClient = {
    version: async () => 'release-fixture-1',
    clear() {},
    load: async () => catalog(),
  };
  runtime.http = new HttpClient(async (url) =>
    response(
      url.includes('userinfo')
        ? { sub: ID, acct: { game_name: 'Fixture', tag_line: 'TEST' } }
        : { entitlements_token: session().entitlementsToken },
    ),
  );
  return {
    runtime,
    repo,
    snapshots,
    get renewals() {
      return renewals;
    },
    get writes() {
      return writes;
    },
    get secret() {
      return secret;
    },
    expire() {
      secret.account.expiresAt = Date.now() - 1;
      const client = runtime.clients.get(ID);
      if (client) client.session.account.expiresAt = Date.now() - 1;
    },
    noCookies() {
      delete secret.reauth;
    },
    holdRenewal() {
      let release;
      hold = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}
test('expired cached client renews once and retains observed-player scope', async () => {
  const h = harness(),
    first = await h.runtime.client(ID);
  first.scope.remember({ subject: OTHER, name: 'Rival', tag: 'TEST' });
  h.expire();
  const [next, parallel] = await Promise.all([h.runtime.client(ID), h.runtime.client(ID)]);
  assert.notEqual(next, first);
  assert.equal(next, parallel);
  assert.equal(next.isActive(), true);
  assert.equal(h.renewals, 1);
  assert.equal(next.scope.player(OTHER).player.name, 'Rival');
  assert.equal(h.secret.reauth.cookies.ssid, 'rotated-fixture-cookie');
});
test('a server-rejected token is renewed before its local expiry', async () => {
  const h = harness(),
    first = await h.runtime.client(ID);
  first.http = new HttpClient(async () => response({}, 401));
  await assert.rejects(first.store(), code('SESSION_EXPIRED'));
  assert.notEqual(await h.runtime.client(ID), first);
  assert.equal(h.renewals, 1);
});
test('403 access denial is not treated as an expired token', async () => {
  const h = harness(),
    first = await h.runtime.client(ID);
  first.http = new HttpClient(async () => response({}, 403));
  await assert.rejects(first.store(), code('ACCESS_DENIED'));
  assert.equal(first.needsReauth(), false);
  assert.equal(await h.runtime.client(ID), first);
  assert.equal(h.renewals, 0);
});
test('chat bootstrap 401 marks the cached token for renewal', async () => {
  const h = harness(),
    first = await h.runtime.client(ID);
  first.http = new HttpClient(async () => response({}, 401));
  await assert.rejects(first.chatBootstrap(), code('SESSION_EXPIRED'));
  assert.equal(first.needsReauth(), true);
});
test('expired session without a reusable cookie requires reconnect', async () => {
  const h = harness();
  h.noCookies();
  h.expire();
  await assert.rejects(h.runtime.client(ID), code('SESSION_EXPIRED'));
  assert.equal(h.renewals, 0);
});
test('removing an account during renewal cannot resurrect its session', async () => {
  const h = harness();
  await h.runtime.client(ID);
  h.expire();
  const release = h.holdRenewal();
  const pending = h.runtime.client(ID),
    rejection = assert.rejects(pending, code('SESSION_REMOVED'));
  await new Promise((resolve) => setImmediate(resolve));
  const removal = h.runtime.remove(ID);
  release();
  await Promise.all([rejection, removal]);
  assert.equal(h.secret, null);
  assert.equal(h.writes, 0);
  assert.deepEqual(await h.repo.accounts(), []);
});
test('verified identity updates persist to the account snapshot', async () => {
  const h = harness(),
    client = await h.runtime.client(ID),
    data = { guns: [], version: 6 };
  h.snapshots.set(ID, {
    accountId: ID,
    demo: false,
    loadout: { status: 'ready', data: { guns: [], version: 5 }, fetchedAt: 1 },
  });
  client.saveIdentity = async () => data;
  assert.equal(await h.runtime.saveIdentity(ID, {}), data);
  assert.equal(h.snapshots.get(ID).loadout.data.version, 6);
});

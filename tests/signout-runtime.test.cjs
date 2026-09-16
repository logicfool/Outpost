const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const { ID, OTHER, session, code } = require('./helpers.cjs');
const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;
function harness(reply = { status: 200, body: "You've been signed out" }) {
  let requests = 0,
    now = Date.now(),
    release;
  const cookies = (id) => ({
    ...session(id),
    reauth: { cookies: { ssid: `fixture-${id}`, sub: id }, capturedAt: now },
  });
  const secrets = new Map([
      [ID, cookies(ID)],
      [OTHER, cookies(OTHER)],
    ]),
    accounts = new Map([...secrets].map(([id, s]) => [id, s.account])),
    stamps = new Map(),
    removedChats = [];
  const repo = {
    accounts: async () => [...accounts.values()],
    removeAccount: async (id) => accounts.delete(id),
    notificationStamp: async (k) => stamps.get(k) ?? null,
    setNotificationStamp: async (k, v) => stamps.set(k, v),
  };
  let hold;
  const nativeFetcher = async (url, init) => {
    requests++;
    assert.equal(url, 'https://auth.riotgames.com/logout');
    assert.equal(init.redirect, 'manual');
    assert.match(init.headers.Cookie, new RegExp(`fixture-${ID}`));
    assert.ok(!init.headers.Cookie.includes(OTHER));
    if (hold) await hold;
    return new Response(reply.body, { status: reply.status, headers: reply.headers });
  };
  const mod = { exports: {} };
  const load = (n) => {
    if (n === 'react-native') return { Platform: { OS: 'ios' } };
    if (n === './network') return { nativeFetcher };
    if (n === './secure')
      return {
        vault: {
          read: async (id) => secrets.get(id) ?? null,
          remove: async (id) => secrets.delete(id),
        },
      };
    if (n === './chatStorage')
      return { activateChatStorage() {}, removeChatStorage: async (id) => removedChats.push(id) };
    if (n === './storage') return { openRepository: async () => repo };
    if (n === './notifications') return { cancelAccountNotifications: async () => {} };
    if (n.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'));
    throw Error(n);
  };
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(
    load,
    mod,
    mod.exports,
  );
  const runtime = new mod.exports.Runtime(repo, () => now);
  return {
    runtime,
    secrets,
    accounts,
    removedChats,
    stamps,
    get requests() {
      return requests;
    },
    advance: (ms) => (now += ms),
    hold() {
      hold = new Promise((r) => (release = r));
      return () => release();
    },
  };
}
test('confirmed Riot sign-out removes only that accounts secrets and local history', async () => {
  const h = harness();
  await h.runtime.signOut(ID);
  assert.equal(h.requests, 1);
  assert.equal(h.secrets.has(ID), false);
  assert.equal(h.secrets.has(OTHER), true);
  assert.equal(h.accounts.has(OTHER), true);
  assert.deepEqual(h.removedChats, [ID]);
});
test('ambiguous response preserves account and blocks immediate retry without another request', async () => {
  const h = harness({ status: 200, body: 'Sign in' });
  await assert.rejects(h.runtime.signOut(ID), code('LOGOUT_UNCONFIRMED'));
  assert.equal(h.secrets.has(ID), true);
  assert.equal(h.accounts.has(ID), true);
  assert.deepEqual(h.removedChats, []);
  await assert.rejects(h.runtime.signOut(ID), code('LOCAL_COOLDOWN'));
  assert.equal(h.requests, 1);
});
test('concurrent sign-out taps share one remote request', async () => {
  const h = harness(),
    finish = h.hold();
  const a = h.runtime.signOut(ID),
    b = h.runtime.signOut(ID);
  await new Promise((r) => setImmediate(r));
  assert.equal(h.requests, 1);
  finish();
  await Promise.all([a, b]);
  assert.equal(h.requests, 1);
});
test('Riot retry-after is retained on disk for this account', async () => {
  const h = harness({ status: 429, body: 'Wait', headers: { 'retry-after': '300' } });
  const start = Date.now();
  await assert.rejects(
    h.runtime.signOut(ID),
    (e) => e.code === 'RATE_LIMIT' && e.retryAt >= start + 299000,
  );
  assert.ok(Number(h.stamps.get(`notice.${ID}.logout.notBefore`)) >= start + 299000);
  assert.equal(h.secrets.has(ID), true);
});

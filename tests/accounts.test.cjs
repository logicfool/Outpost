const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const { ID, OTHER, session, jwt, response, catalog, code } = require('./helpers.cjs');
const { LoginFlow } = require('../.test-build/loginFlow.js');
const { AppError } = require('../.test-build/validation.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function flowFixture(options = {}) {
  const attempt = { state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: Date.now() };
  const records = [],
    actions = [];
  let saved = 0;
  const account = session(OTHER).account;
  const flow = new LoginFlow({
    attempt: () => attempt,
    clearBrowser: async () => {
      actions.push('clear');
      if (options.resetFailure) throw new AppError('COOKIE_RESET', 'Reset failed');
    },
    captureCookies: async () => {
      actions.push('cookies');
      if (options.cookieFailure) throw new Error('cookie service unavailable');
      return { ssid: 'fixture' };
    },
    save: async (tokens) => {
      actions.push('save');
      saved++;
      if (options.saveFailure) throw new AppError('ACCOUNT_ALREADY_LINKED', 'Already linked');
      return account;
    },
    emit: (value) => records.push(value),
  });
  const callback = () =>
    'https://playvalorant.com/opt_in#' +
    new URLSearchParams({
      state: attempt.state,
      access_token: jwt({ sub: OTHER, exp: Date.now() / 1000 + 3600 }),
      id_token: jwt({ sub: OTHER, nonce: attempt.nonce }),
      token_type: 'Bearer',
      expires_in: '3600',
    });
  return {
    flow,
    records,
    actions,
    callback,
    get saved() {
      return saved;
    },
  };
}
test('second-account browser starts fresh and forces a login prompt', async () => {
  const h = flowFixture();
  await h.flow.begin();
  assert.deepEqual(h.actions, ['clear']);
  assert.equal(h.flow.snapshot.phase, 'browser');
  assert.equal(new URL(h.flow.snapshot.url).searchParams.get('prompt'), 'login');
});
test('duplicate callback events save the account once and show a receipt', async () => {
  const h = flowFixture();
  await h.flow.begin();
  h.flow.navigate(h.callback());
  h.flow.navigate(h.callback());
  h.flow.browserError('cancelled old load');
  await tick();
  assert.equal(h.saved, 1);
  assert.equal(h.flow.snapshot.phase, 'success');
  assert.equal(h.flow.snapshot.account.puuid, OTHER);
});
test('a cookie-capture error does not discard the login or replay its save', async () => {
  const h = flowFixture({ cookieFailure: true });
  await h.flow.begin();
  h.flow.navigate(h.callback());
  await tick();
  assert.equal(h.saved, 1);
  assert.equal(h.flow.snapshot.phase, 'success');
});
test('account-save errors remain visible and do not retry through the cookie catch', async () => {
  const h = flowFixture({ saveFailure: true });
  await h.flow.begin();
  h.flow.navigate(h.callback());
  await tick();
  assert.equal(h.saved, 1);
  assert.equal(h.flow.snapshot.code, 'ACCOUNT_ALREADY_LINKED');
  assert.equal(h.flow.snapshot.phase, 'start');
});
test('failed browser reset stops reuse of an old Riot session', async () => {
  const h = flowFixture({ resetFailure: true });
  await h.flow.begin();
  assert.equal(h.flow.snapshot.phase, 'start');
  assert.equal(h.saved, 0);
});
test('mismatched login state is rejected before persistence', async () => {
  const h = flowFixture();
  await h.flow.begin();
  h.flow.navigate(h.callback().replace('state=' + 'a'.repeat(64), 'state=wrong'));
  await tick();
  assert.equal(h.saved, 0);
  assert.equal(h.flow.snapshot.code, 'AUTH_STATE');
});
test('disposed callback cannot save an account', async () => {
  const h = flowFixture();
  await h.flow.begin();
  h.flow.dispose();
  h.flow.navigate(h.callback());
  await tick();
  assert.equal(h.saved, 0);
});
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function runtimeFixture() {
  const accounts = new Map(),
    sessions = new Map();
  let failSave = false;
  const repo = {
    accounts: async () => [...accounts.values()],
    saveAccount: async (a) => {
      if (failSave) throw Error('disk full');
      accounts.set(a.puuid, a);
    },
    removeAccount: async (id) => accounts.delete(id),
  };
  const vault = {
    read: async (id) => sessions.get(id) ?? null,
    write: async (s) => sessions.set(s.account.puuid, s),
    remove: async (id) => sessions.delete(id),
  };
  const module = { exports: {} },
    load = (name) => {
      if (name === 'react-native') return { Platform: { OS: 'ios' } };
      if (name === './network') return { nativeFetcher: fetch };
      if (name === './chatStorage') return { removeChatStorage: async () => {} };
      if (name === './secure') return { vault, randomHex: () => 'd'.repeat(64) };
      if (name === './storage') return { openRepository: async () => repo };
      if (name === './notifications') return { cancelAccountNotifications: async () => {} };
      if (name.startsWith('../core/'))
        return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
      throw Error(name);
    };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
    load,
    module,
    module.exports,
  );
  const rt = new module.exports.Runtime(repo);
  const { HttpClient } = require('../.test-build/http.js');
  rt.http = new HttpClient(async (url, init) => {
    const token = new Headers(init.headers).get('Authorization').slice(7);
    const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
    return response(
      url.includes('userinfo')
        ? { sub, acct: { game_name: sub === ID ? 'First' : 'Second', tag_line: 'TEST' } }
        : { entitlements_token: 'fixture-entitlement-not-real' },
    );
  });
  return {
    rt,
    accounts,
    sessions,
    fail() {
      failSave = true;
    },
  };
}
const input = (id) => ({ accessToken: session(id).accessToken, expiresAt: Date.now() + 3600000 });
test('two sequential logins create independent accounts and session entries', async () => {
  const h = runtimeFixture();
  await h.rt.link(input(ID), 'ap');
  const second = await h.rt.link(input(OTHER), 'eu');
  assert.equal(h.accounts.size, 2);
  assert.equal(h.sessions.size, 2);
  assert.equal(second.puuid, OTHER);
  assert.equal(h.sessions.get(ID).account.region, 'ap');
});
test('duplicate add shows already-linked instead of pretending another account was added', async () => {
  const h = runtimeFixture();
  await h.rt.link(input(ID), 'ap');
  await assert.rejects(h.rt.link(input(ID), 'ap'), code('ACCOUNT_ALREADY_LINKED'));
  assert.equal(h.accounts.size, 1);
});
test('reconnecting the wrong account never changes either saved session', async () => {
  const h = runtimeFixture();
  await h.rt.link(input(ID), 'ap');
  await assert.rejects(h.rt.link(input(OTHER), 'ap', ID), code('ACCOUNT_MISMATCH'));
  assert.equal(h.sessions.size, 1);
});
test('a failed new-account write rolls back only the new secure session', async () => {
  const h = runtimeFixture();
  await h.rt.link(input(ID), 'ap');
  const first = h.sessions.get(ID);
  h.fail();
  await assert.rejects(h.rt.link(input(OTHER), 'ap'));
  assert.equal(h.sessions.get(ID), first);
  assert.equal(h.sessions.has(OTHER), false);
});
test('a failed reconnect restores the original secure session', async () => {
  const h = runtimeFixture();
  await h.rt.link(input(ID), 'ap');
  const first = h.sessions.get(ID);
  h.fail();
  await assert.rejects(h.rt.link(input(ID), 'ap', ID));
  assert.equal(h.sessions.get(ID), first);
});

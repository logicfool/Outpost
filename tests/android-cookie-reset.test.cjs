const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { LoginFlow } = require('../.test-build/loginFlow.js');
const { code, ID, OTHER } = require('./helpers.cjs');
const { clearDiagnostics, requestDiagnostics } = require('../.test-build/diagnostics.js');

const source = fs.readFileSync(
  process.env.OUTPOST_RESET_SOURCE || path.join(__dirname, '../src/platform/cookies.ts'),
  'utf8',
);
function harness(options = {}) {
  const calls = [],
    vault = new Map([
      [ID, 'first-saved-session'],
      [OTHER, 'second-saved-session'],
    ]);
  const messages = new Map([
    [ID, ['first-chat']],
    [OTHER, ['second-chat']],
  ]);
  let nextRead = 0;
  const manager = {
    clearAll: async (wk) => {
      calls.push(['clear', wk]);
      if (options.clearError) throw options.clearError;
      return options.clearResult === undefined ? false : options.clearResult;
    },
    flush: async () => {
      calls.push(['flush']);
      if (options.flushError) throw options.flushError;
    },
    get: async (url, wk) => {
      calls.push(['get', url, wk]);
      if (options.readError) throw options.readError;
      return options.jars ? options.jars[nextRead++] : {};
    },
    getAll: async () => {
      throw Error('Android must not call unsupported getAll');
    },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const load = (name) => {
    if (name === '@react-native-cookies/cookies') return manager;
    if (name === 'react-native') return { Platform: { OS: options.os || 'android' } };
    if (name.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
    throw Error(
      'Unexpected dependency (reset may not import a vault, chat database, or network client): ' +
        name,
    );
  };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
    load,
    module,
    module.exports,
  );
  const flow = new LoginFlow({
    attempt: () => ({ state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: Date.now() }),
    clearBrowser: () => module.exports.clearRiotWebCookies(),
    captureCookies: async () => {
      throw Error('No login credentials were submitted');
    },
    save: async () => {
      throw Error('No account should be written during browser preparation');
    },
    emit() {},
  });
  return { ...module.exports, calls, manager, vault, messages, flow };
}

test('Android empty cookie jar returns false and must still open Riot sign-in', async () => {
  const h = harness();
  await h.flow.begin();
  assert.equal(h.flow.snapshot.phase, 'browser', JSON.stringify(h.flow.snapshot));
  assert.equal(new URL(h.flow.snapshot.url).searchParams.get('prompt'), 'login');
  assert.deepEqual([...h.vault.values()], ['first-saved-session', 'second-saved-session']);
  assert.deepEqual([...h.messages.values()], [['first-chat'], ['second-chat']]);
});
test('Android populated cookie jar returns true and proceeds after flush and verification', async () => {
  const h = harness({ clearResult: true });
  await h.clearRiotWebCookies();
  assert.deepEqual(h.calls.slice(0, 2), [['clear', false], ['flush']]);
  assert.deepEqual(h.calls.slice(2), [
    ['get', 'https://auth.riotgames.com/authorize', false],
    ['get', 'https://authenticate.riotgames.com/api/v1/login', false],
    ['get', 'https://login.riotgames.com/', false],
  ]);
});
test('repeated resets of an already empty Android jar remain successful', async () => {
  const h = harness();
  for (let i = 0; i < 4; i++) await h.clearRiotWebCookies();
  assert.equal(h.calls.filter((c) => c[0] === 'clear').length, 4);
  assert.equal(h.calls.filter((c) => c[0] === 'flush').length, 4);
});
test('genuine native rejection remains a visible error and does not open Riot', async () => {
  const h = harness({ clearError: Error('sensitive-cookie-value') });
  await h.flow.begin();
  assert.equal(h.flow.snapshot.phase, 'start');
  assert.equal(h.flow.snapshot.code, 'COOKIE_RESET');
  assert.equal(h.flow.snapshot.url, undefined);
  assert.ok(!h.flow.snapshot.error.includes('sensitive-cookie-value'));
  assert.deepEqual(h.calls, [['clear', false]]);
});
test('flush failure cannot be mistaken for an empty-jar success', async () => {
  const h = harness({ flushError: Error('disk-error-secret') });
  await assert.rejects(h.clearRiotWebCookies(), code('COOKIE_RESET'));
  assert.deepEqual(h.calls, [['clear', false], ['flush']]);
});
test('unexpected native return type fails closed', async () => {
  for (const value of [null, 0, 'false', {}]) {
    const h = harness({ clearResult: value });
    await assert.rejects(h.clearRiotWebCookies(), code('COOKIE_RESET'));
  }
});
test('stale Riot cookies after native completion block the login redirect', async () => {
  for (const jars of [
    [{ ssid: { value: 'prior' } }, {}, {}],
    [{}, { sub: { value: OTHER } }, {}],
    [{}, {}, { session: { value: 'prior' } }],
  ]) {
    const h = harness({ jars });
    await h.flow.begin();
    assert.equal(h.flow.snapshot.phase, 'start');
    assert.equal(h.flow.snapshot.code, 'COOKIE_RESET');
  }
});
test('malformed or unreadable cookie verification never treats it as an empty jar', async () => {
  for (const value of [undefined, null, [], false, '', 12]) {
    const h = harness({ jars: [value] });
    await assert.rejects(h.clearRiotWebCookies(), code('COOKIE_RESET'));
  }
  await assert.rejects(
    harness({ readError: Error('native-read-failed') }).clearRiotWebCookies(),
    code('COOKIE_RESET'),
  );
});
test('Android reset waits for callback completion before flush and verification', async () => {
  const h = harness();
  let release;
  h.manager.clearAll = async () => {
    h.calls.push(['clear-start']);
    await new Promise((resolve) => {
      release = resolve;
    });
    h.calls.push(['clear-done']);
    return false;
  };
  const work = h.clearRiotWebCookies();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.calls, [['clear-start']]);
  release();
  await work;
  assert.deepEqual(h.calls.slice(0, 3), [['clear-start'], ['clear-done'], ['flush']]);
});
test('reset diagnostics contain status only, never cookie values', async () => {
  clearDiagnostics();
  const h = harness();
  await h.clearRiotWebCookies();
  assert.ok(requestDiagnostics().some((r) => r.code === 'ANDROID_COOKIE_RESET_VERIFIED'));
  const bad = harness({ jars: [{ ssid: { value: 'never-log-this-value' } }] });
  await assert.rejects(bad.clearRiotWebCookies());
  assert.ok(!JSON.stringify(requestDiagnostics()).includes('never-log-this-value'));
});
test('the pinned Android cookie bridge forwards whether cookies were removed, not an operation-success flag', () => {
  const java = fs.readFileSync(
    path.join(
      __dirname,
      '../node_modules/@react-native-cookies/cookies/android/src/main/java/com/reactnativecommunity/cookies/CookieManagerModule.java',
    ),
    'utf8',
  );
  const clear = java.slice(
    java.indexOf('public void clearAll('),
    java.indexOf('private void addCookies('),
  );
  assert.match(clear, /removeAllCookies\(new ValueCallback<Boolean>/);
  assert.match(clear, /onReceiveValue\(Boolean value\)[\s\S]*promise\.resolve\(value\)/);
  assert.match(clear, /promise\.reject\(e\)/);
});

test('concurrent reset requests share the same native flight', async () => {
  const h = harness();
  let release;
  h.manager.clearAll = async () => {
    h.calls.push(['clear']);
    await new Promise((r) => {
      release = r;
    });
    return false;
  };
  const a = h.clearRiotWebCookies(),
    b = h.clearRiotWebCookies();
  assert.equal(a, b);
  assert.equal(h.calls.length, 1);
  release();
  await Promise.all([a, b]);
  assert.equal(h.calls.filter((c) => c[0] === 'flush').length, 1);
});
test('a cancelled login cannot open after delayed native reset completion', async () => {
  const h = harness();
  let release;
  h.manager.clearAll = async () => {
    await new Promise((r) => {
      release = r;
    });
    return false;
  };
  const waiting = h.flow.begin();
  h.flow.dispose();
  release();
  await waiting;
  assert.notEqual(h.flow.snapshot.phase, 'browser');
});
test('the next explicit reset can run after a real native failure', async () => {
  const h = harness();
  h.manager.clearAll = async () => {
    throw Error('temporary');
  };
  await assert.rejects(h.clearRiotWebCookies(), code('COOKIE_RESET'));
  h.manager.clearAll = async () => false;
  await h.clearRiotWebCookies();
});
test('iOS reset still uses the original two browser jars', async () => {
  const h = harness({ os: 'ios', clearResult: true });
  await h.clearRiotWebCookies();
  assert.deepEqual(h.calls, [
    ['clear', false],
    ['clear', true],
  ]);
});

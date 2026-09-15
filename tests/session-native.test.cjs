const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const { ID, OTHER, code } = require('./helpers.cjs');
const source = fs.readFileSync(path.join(__dirname, '../src/platform/cookies.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(os = 'ios', responses = []) {
  const calls = [];
  let i = 0;
  const manager = {
    getAll: async (webkit) => {
      calls.push(['getAll', webkit]);
      return responses[Math.min(i++, responses.length - 1)] ?? {};
    },
    get: async (url, webkit) => {
      calls.push(['get', url, webkit]);
      return responses[Math.min(i++, responses.length - 1)] ?? {};
    },
    clearAll: async (webkit) => {
      calls.push(['clear', webkit]);
      return true;
    },
    flush: async () => {
      calls.push(['flush']);
    },
  };
  const m = { exports: {} };
  const load = (name) =>
    name === '@react-native-cookies/cookies'
      ? manager
      : name === 'react-native'
        ? { Platform: { OS: os } }
        : require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
  return { ...m.exports, calls };
}
const jar = (id) => ({
  ssid: { name: 'ssid', domain: '.auth.riotgames.com', path: '/', value: 'fixture-' + id },
  sub: { name: 'sub', domain: '.auth.riotgames.com', path: '/', value: id },
});
test('native iOS reads only the mounted WK store, not a shared first-account fallback', async () => {
  const h = fixture('ios', [jar(OTHER)]),
    cookie = await h.captureRiotReauthCookies(OTHER);
  assert.equal(cookie.sub, OTHER);
  assert.deepEqual(h.calls, [['getAll', true]]);
});
test('delayed cookie persistence gets bounded local settling reads, never HTTP', async () => {
  const h = fixture('ios', [{}, jar(OTHER)]);
  assert.equal((await h.captureRiotReauthCookies(OTHER)).sub, OTHER);
  assert.equal(h.calls.length, 2);
});
test('wrong-account cookie is rejected immediately instead of merging jars', async () => {
  const h = fixture('ios', [jar(ID), jar(OTHER)]);
  await assert.rejects(h.captureRiotReauthCookies(OTHER), code('REAUTH_ACCOUNT_MISMATCH'));
  assert.equal(h.calls.length, 1);
});
test('Android snapshots only the authorization URL cookie scope', async () => {
  const h = fixture('android', [{ ssid: { name: 'ssid', value: 'android' } }]);
  assert.equal((await h.captureRiotReauthCookies(OTHER)).ssid, 'android');
  assert.deepEqual(h.calls, [['get', 'https://auth.riotgames.com/authorize', false]]);
});
test('browser reset touches browser jars only, not secure account storage', async () => {
  const h = fixture();
  await h.clearRiotWebCookies();
  assert.deepEqual(h.calls, [
    ['clear', false],
    ['clear', true],
  ]);
});
test('login retains its WebView through exchange, waits for initial mounting, and does not sync the native cookie jar', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../src/ui/Login.tsx'), 'utf8');
  assert.match(ui, /hasBrowser && \(?\s*<View/);
  assert.match(ui, /sharedCookiesEnabled=\{false\}/);
  assert.match(ui, /bounded\(\s*ready\.promise/);
  assert.doesNotMatch(ui, /WebView key=\{state\.url\}/);
  assert.match(ui, /onLoadEnd=/);
});

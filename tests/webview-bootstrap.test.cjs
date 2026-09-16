const test = require('node:test'),
  assert = require('node:assert/strict');
const { loginWebSource } = require('../.test-build/loginBootstrap.js');
const { authorizationUrl } = require('../.test-build/auth.js');
const { patchWebViewSource, before, after } = require('../scripts/patch-webview-source.cjs');
const fs = require('node:fs'),
  path = require('node:path');
test('the first native login source is static HTML, never an about/file URI', () => {
  const source = loginWebSource();
  assert.equal('uri' in source, false);
  assert.match(source.html, /^<!doctype html>/);
  assert.match(source.html, /outpost-login-bootstrap/);
  assert.doesNotMatch(source.html, /<script|<iframe|<img|https?:|file:/i);
});
test('the initialized browser transitions only to a trusted Riot login URL', () => {
  const url = authorizationUrl({
    state: 'a'.repeat(64),
    nonce: 'b'.repeat(64),
    createdAt: Date.now(),
  });
  assert.deepEqual(loginWebSource(url), { uri: url });
  for (const blocked of [
    'about:blank',
    'file:///etc/passwd',
    'data:text/html,hi',
    'javascript:alert(1)',
    'https://evil.invalid/',
    'https://auth.riotgames.com.evil.invalid/',
    'https://playvalorant.com/opt_in#access_token=not-a-token',
  ])
    assert.throws(() => loginWebSource(blocked));
});
test('native file loader dispatch uses URL scheme, not presence of a hostname', () => {
  const source =
    '// fixture' + String.fromCharCode(10) + before + String.fromCharCode(10) + '// end';
  const fixed = patchWebViewSource(source);
  assert.ok(fixed.includes(after));
  assert.ok(!fixed.includes(before));
  assert.equal(patchWebViewSource(fixed), fixed);
});
test('native dependency patch fails closed on unexpected upstream code', () => {
  assert.throws(() => patchWebViewSource('unexpected source'));
  assert.throws(() => patchWebViewSource(before + before));
  assert.throws(() =>
    patchWebViewSource('// OUTPOST_WEBVIEW_FILE_SCHEME' + String.fromCharCode(10) + 'partial'),
  );
});
test('installed native WebView includes the guard used by cloud postinstall', () => {
  const native = fs.readFileSync(
    path.join(__dirname, '../node_modules/react-native-webview/apple/RNCWebViewImpl.m'),
    'utf8',
  );
  assert.ok(native.includes(after));
  assert.ok(!native.includes(before));
});

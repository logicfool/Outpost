const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm');
const {
  socialPopupBridge,
  socialStatusProbe,
  parseSocialBridgeMessage,
} = require('../.test-build/socialBridge.js');
const key = 'c'.repeat(64),
  source = 'https://authenticate.riotgames.com/?client_id=fixture';
function browser(url = source, fetcher) {
  const messages = [],
    location = new URL(url),
    window = { ReactNativeWebView: { postMessage: (value) => messages.push(JSON.parse(value)) } };
  window.top = window;
  const sandbox = {
    window,
    location,
    URL,
    Object,
    JSON,
    String,
    setTimeout,
    clearTimeout,
    AbortController,
    TextDecoder,
    fetch: fetcher,
  };
  return { messages, window, run: (script) => vm.runInNewContext(script, sandbox) };
}
test('popup bridge supports direct and delayed about:blank window navigation without reading credentials', () => {
  const h = browser();
  h.run(socialPopupBridge(key));
  const popup = h.window.open('about:blank');
  assert.equal(h.messages.length, 0);
  popup.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?fixture=1';
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].key, key);
  assert.equal(popup.closed, false);
  popup.close();
  assert.equal(popup.closed, true);
  h.window.open('/login?method=apple');
  assert.equal(h.messages[1].url, 'https://authenticate.riotgames.com/login?method=apple');
});
test('the popup bridge is inert on providers, other origins and subframes', () => {
  for (const url of [
    'https://accounts.google.com/',
    'http://authenticate.riotgames.com/',
    'https://authenticate.riotgames.com.evil.test/',
  ]) {
    const h = browser(url);
    h.run(socialPopupBridge(key));
    assert.equal(h.window.open, undefined);
  }
  const h = browser();
  h.window.top = {};
  h.run(socialPopupBridge(key));
  assert.equal(h.window.open, undefined);
});
test('native message parsing rejects wrong document, nonce, type, size and stale-message shapes', () => {
  const message = {
    type: 'outpost-social-status',
    key,
    id: '1:1',
    status: 'success',
    url: 'https://auth.riotgames.com/login-token?login_token=fixture',
  };
  assert.equal(parseSocialBridgeMessage(JSON.stringify(message), source, key).status, 'success');
  assert.equal(
    parseSocialBridgeMessage(JSON.stringify(message), 'https://accounts.google.com/', key),
    undefined,
  );
  assert.equal(
    parseSocialBridgeMessage(JSON.stringify(message), source, 'd'.repeat(64)),
    undefined,
  );
  assert.equal(parseSocialBridgeMessage('x'.repeat(50000), source, key), undefined);
  assert.equal(
    parseSocialBridgeMessage(JSON.stringify({ ...message, status: 'arbitrary' }), source, key),
    undefined,
  );
});
test('resume check only reads the originating Riot session and reports its trusted completion', async () => {
  const requests = [],
    h = browser(source, async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({
          type: 'success',
          success: {
            redirect_url: 'https://auth.riotgames.com/login-token?login_token=fixture',
            login_token: 'not-reported-separately',
          },
        }),
      );
    });
  h.run(socialStatusProbe(key, '2:1'));
  await new Promise((r) => setImmediate(r));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/v1/login');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(h.messages[0].status, 'success');
  assert.ok(!JSON.stringify(h.messages).includes('not-reported-separately'));
});
test('rate limiting and malformed responses report no response content', async () => {
  const limited = browser(
    source,
    async () => new Response('fixture denial', { status: 429, headers: { 'retry-after': '90' } }),
  );
  limited.run(socialStatusProbe(key, '1:1'));
  await new Promise((r) => setImmediate(r));
  assert.equal(limited.messages[0].http, 429);
  assert.equal(limited.messages[0].retrySeconds, 90);
  assert.ok(!JSON.stringify(limited.messages).includes('fixture denial'));
  const malformed = browser(source, async () => new Response('fixture invalid JSON'));
  malformed.run(socialStatusProbe(key, '1:2'));
  await new Promise((r) => setImmediate(r));
  assert.equal(malformed.messages[0].status, 'unavailable');
  assert.ok(!JSON.stringify(malformed.messages).includes('fixture invalid JSON'));
});
test('Riot status checks reject oversized streams while reading', async () => {
  let sent = 0,
    cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      sent++;
      controller.enqueue(new Uint8Array(32768));
    },
    cancel() {
      cancelled = true;
    },
  });
  const h = browser(source, async () => new Response(stream));
  h.run(socialStatusProbe(key, '1:3'));
  await new Promise((r) => setImmediate(r));
  assert.equal(h.messages[0].status, 'unavailable');
  assert.equal(cancelled, true);
  assert.ok(sent <= 5);
});
test('status checks cannot run inside a provider or another origin', async () => {
  let requests = 0;
  const h = browser('https://accounts.google.com/', async () => {
    requests++;
    return new Response('{}');
  });
  h.run(socialStatusProbe(key, '1:4'));
  await new Promise((r) => setImmediate(r));
  assert.equal(requests, 0);
  assert.equal(h.messages[0].status, 'unavailable');
});
test('verification prompts ask native code to show Riot without exposing the prompt payload', async () => {
  const h = browser(
    source,
    async () =>
      new Response(
        JSON.stringify({ type: 'multifactor', multifactor: { email: 'fixture@example.test' } }),
      ),
  );
  h.run(socialStatusProbe(key, '5:1'));
  await new Promise((r) => setImmediate(r));
  assert.equal(h.messages[0].status, 'interaction');
  assert.ok(!JSON.stringify(h.messages).includes('fixture@example.test'));
});
test('status replies require the exact authenticated Riot origin', () => {
  const message = JSON.stringify({
    type: 'outpost-social-status',
    key,
    id: '5:2',
    status: 'pending',
    http: 200,
  });
  assert.equal(parseSocialBridgeMessage(message, 'https://auth.riotgames.com/', key), undefined);
  assert.equal(
    parseSocialBridgeMessage(message, 'https://authenticate.riotgames.com/login?method=google', key)
      ?.status,
    'pending',
  );
  assert.equal(
    parseSocialBridgeMessage(message, 'https://authenticate.riotgames.com.evil.test/', key),
    undefined,
  );
  assert.equal(parseSocialBridgeMessage(message, source, key)?.status, 'pending');
  for (const http of [-1, 0, 999, 200.5])
    assert.equal(
      parseSocialBridgeMessage(JSON.stringify({ ...JSON.parse(message), http }), source, key),
      undefined,
    );
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const { RiotClient } = require('../.test-build/riot.js'),
  { HttpClient } = require('../.test-build/http.js'),
  { EMPTY_CATALOG } = require('../.test-build/types.js');
const { encodeAimDocument } = require('../.test-build/aimCodec.js');
const { requestDiagnostics, clearDiagnostics } = require('../.test-build/diagnostics.js');
const { session } = require('./helpers.cjs'),
  { ID, OTHER, document } = require('./aim-helpers.cjs');
function fixture(handler) {
  let rejected = 0;
  const calls = [],
    s = session(ID),
    http = new HttpClient(async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    });
  return {
    client: new RiotClient(
      s,
      http,
      { version: async () => 'release-test' },
      EMPTY_CATALOG,
      undefined,
      async () => {
        rejected++;
      },
    ),
    calls,
    rejected: () => rejected,
    session: s,
  };
}
test('cloud preferences use only the selected account headers on the fixed regional origin', async () => {
  const h = fixture(
    () =>
      new Response(JSON.stringify(encodeAimDocument(document().data)), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const d = await h.client.readAimDocument();
  assert.deepEqual(d.data, document().data);
  assert.equal(h.calls.length, 1);
  const c = h.calls[0];
  assert.match(
    c.url,
    /^https:\/\/player-preferences-(apse1|euc1|usw2|apne1)\.pp\.sgp\.pvp\.net\/playerPref\/v3\/getPreference\/Ares.PlayerSettings$/,
  );
  assert.equal(c.init.credentials, 'omit');
  assert.equal(c.init.redirect, 'error');
  assert.equal(c.init.headers.Authorization, 'Bearer ' + h.session.accessToken);
  assert.equal(c.init.headers.Cookie, undefined);
});
test('saving settings accepts an empty success response and invokes the final guard once', async () => {
  const h = fixture(() => new Response(null, { status: 204 }));
  let guards = 0;
  await h.client.writeAimDocument(document().data, () => {
    guards++;
  });
  assert.equal(guards, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].init.method, 'PUT');
  assert.match(h.calls[0].url, /\/savePreference$/);
  assert.equal(JSON.parse(h.calls[0].init.body).type, 'Ares.PlayerSettings');
});
test('a rejected final account guard prevents the preference PUT', async () => {
  const h = fixture(() => {
    throw Error('must not run');
  });
  await assert.rejects(
    h.client.writeAimDocument(document().data, () => {
      throw Error('selection changed');
    }),
  );
  assert.equal(h.calls.length, 0);
});
test('optional aim service HTTP 401 cannot invalidate a working store or chat session', async () => {
  const h = fixture(() => new Response('{}', { status: 401 }));
  await assert.rejects(h.client.readAimDocument(), (e) => e.code === 'AIM_AUTH');
  assert.equal(h.rejected(), 0);
  assert.equal(h.client.needsReauth(), false);
  assert.equal(h.client.isActive(), true);
});
test('settings-specific HTTP 403 does not invalidate an otherwise valid account session', async () => {
  const h = fixture(() => new Response('{}', { status: 403 }));
  await assert.rejects(h.client.readAimDocument(), (e) => e.code === 'AIM_ACCESS');
  assert.equal(h.rejected(), 0);
  assert.equal(h.client.isActive(), true);
});
test('mismatched account identity and redirected preference responses are rejected', async () => {
  const h = fixture(
    () => new Response(JSON.stringify({ ...encodeAimDocument(document().data), Subject: OTHER })),
  );
  await assert.rejects(h.client.readAimDocument(), (e) => e.code === 'ACCOUNT_MISMATCH');
  const r = fixture(() => {
    const value = new Response('{}');
    Object.defineProperty(value, 'redirected', { value: true });
    return value;
  });
  await assert.rejects(r.client.readAimDocument(), (e) => e.code === 'NETWORK_POLICY');
});
test('settings response size and diagnostics remain bounded without logging configuration or credentials', async () => {
  clearDiagnostics();
  const h = fixture(() => new Response('x'.repeat(600000)));
  await assert.rejects(h.client.readAimDocument());
  const logs = JSON.stringify(requestDiagnostics());
  assert.match(logs, /Aim settings/);
  assert.doesNotMatch(logs, /Bearer|Ares.PlayerSettings|floatSettings|ssid/);
});

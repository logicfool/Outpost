const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  DiagnosticRedactor,
  REDACTED,
  TRACE_BODY_LIMIT,
} = require('../.test-build/diagnosticRedaction.js');
const { encodeAimDocument, decodeAimDocument } = require('../.test-build/aimCodec.js');
const { jwt, ID } = require('./helpers.cjs');
const safe = (value) => JSON.stringify(new DiagnosticRedactor().value(value));
test('diagnostics keep account IDs, region, names, errors and response trace IDs', () => {
  const value = {
    sub: ID,
    name: 'Void',
    region: 'ap',
    code: 'AIM_RBAC',
    status: 403,
    message: 'RBAC: access denied',
    headers: { 'x-riot-edge-trace-id': 'trace-example', 'cf-ray': 'ray-example' },
  };
  assert.deepEqual(JSON.parse(safe(value)), value);
});
for (const key of [
  'Authorization',
  'Cookie',
  'Set-Cookie',
  'access_token',
  'idToken',
  'refresh_token',
  'entitlements_token',
  'X-Riot-Entitlements-JWT',
  'password',
  'code_verifier',
  'client_secret',
  'pas_token',
])
  test('redacts credential field ' + key, () => {
    assert.ok(
      !safe({ [key]: 'fixture-sensitive-value', normal: 'keep' }).includes(
        'fixture-sensitive-value',
      ),
    );
  });
test('learned tokens cannot leak through echoed text or JSON errors', () => {
  const r = new DiagnosticRedactor();
  r.headers({ Authorization: 'Bearer fixture-sensitive-secret' });
  const out = JSON.stringify(r.body('{"error":"echo fixture-sensitive-secret"}'));
  assert.ok(!out.includes('fixture-sensitive-secret'));
  assert.match(out, /REDACTED/);
});
test('Cookie redaction does not erase the service domain or account ID elsewhere', () => {
  const r = new DiagnosticRedactor();
  const headers = r.headers({
    'set-cookie': `ssid=fixture-cookie; Domain=riotgames.com; Path=/; Secure, sub=${ID}; Path=/`,
  });
  assert.equal(headers['set-cookie'], REDACTED);
  assert.equal(r.value({ sub: ID, host: 'riotgames.com' }).sub, ID);
  assert.equal(r.value({ host: 'riotgames.com' }).host, 'riotgames.com');
});
test('callback URL hides state nonce code and tokens but keeps client and endpoint', () => {
  const r = new DiagnosticRedactor(),
    url = r.url(
      'https://auth.riotgames.com/authorize?client_id=riot-client&state=fixture-state&nonce=fixture-nonce#access_token=fixture-token&code=fixture-code',
    );
  assert.match(url, /client_id=riot-client/);
  for (const secret of ['fixture-state', 'fixture-nonce', 'fixture-token', 'fixture-code'])
    assert.ok(!url.includes(secret));
});
test('JWT hints expose audience and expiry without raw signed token', () => {
  const r = new DiagnosticRedactor(),
    value = jwt({ aud: 'riot-client', sub: ID, exp: 2000000000 }),
    out = r.tokenClaims({ Authorization: 'Bearer ' + value });
  assert.equal(out.accessClaims.claims.aud, 'riot-client');
  assert.equal(out.accessClaims.claims.sub, ID);
  assert.equal(out.accessClaims.signatureVerified, false);
  assert.ok(!JSON.stringify(out).includes(value));
});
test('compressed Ares payload retains ordinary settings and removes embedded credentials', () => {
  const r = new DiagnosticRedactor(),
    original = {
      floatSettings: [],
      stringSettings: [],
      account: ID,
      password: 'fixture-compressed-secret',
    },
    envelope = encodeAimDocument(original);
  const out = r.value(envelope);
  assert.equal(out.decodedData.account, ID);
  assert.equal(out.decodedData.password, REDACTED);
  assert.equal(decodeAimDocument(out).data.password, REDACTED);
  assert.notEqual(out.data, envelope.data);
});
test('ordinary compressed preferences keep the exact returned encoded payload', () => {
  const envelope = encodeAimDocument({ floatSettings: [], stringSettings: [], setting: 'normal' }),
    out = new DiagnosticRedactor().value(envelope);
  assert.equal(out.data, envelope.data);
  assert.equal(out.decodedData.setting, 'normal');
});
test('JSON inside a string or base64 is inspected recursively', () => {
  const raw = JSON.stringify({ access_token: 'fixture-nested-secret', name: 'Player' }),
    r = new DiagnosticRedactor();
  assert.ok(!r.value(raw).includes('fixture-nested-secret'));
  const encoded = r.value(Buffer.from(raw).toString('base64'));
  assert.ok(!Buffer.from(encoded, 'base64').toString().includes('fixture-nested-secret'));
});
test('XMPP auth payloads are hidden while whisper text remains available', () => {
  const r = new DiagnosticRedactor();
  assert.ok(
    !r
      .text('<auth mechanism="X-Riot-RSO-PAS"><rso_token>fixture-chat-secret</rso_token></auth>')
      .includes('fixture-chat-secret'),
  );
  const out = r.value({ name: 'rso_token', text: 'fixture-chat-secret', children: [] });
  assert.equal(out.text, REDACTED);
  assert.equal(
    r.text('<message><body>Hello friend</body></message>'),
    '<message><body>Hello friend</body></message>',
  );
});
test('raw HTML challenge retains HTML but hides token-bearing input values', () => {
  const r = new DiagnosticRedactor(),
    out = r.body(
      '<html><input value="fixture-csrf-secret" name="csrf_token"><h1>Denied</h1></html>',
    );
  assert.ok(!out.text.includes('fixture-csrf-secret'));
  assert.match(out.text, /<h1>Denied<\/h1>/);
});
test('oversize and recursively structured bodies report omissions rather than partial secrets', () => {
  const r = new DiagnosticRedactor(),
    out = r.body('x'.repeat(TRACE_BODY_LIMIT + 1));
  assert.equal(out.representation, 'omitted');
  assert.equal(out.text, undefined);
  const cycle = {};
  cycle.next = cycle;
  assert.match(JSON.stringify(r.value(cycle)), /OMITTED/);
});
test('a plain PAS response is treated as a credential even without JWT syntax', () => {
  const r = new DiagnosticRedactor(),
    out = r.body(
      'fixture-opaque-token',
      'https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat',
    );
  assert.equal(out.text, REDACTED);
});
test('cookie and token containers are removed without hiding ordinary account fields', () => {
  const out = JSON.parse(
    safe({
      reauthCookies: { ssid: 'fixture-secret-cookie' },
      tokens: ['fixture-private-token'],
      name: 'Void',
      sensitivity: 0.25,
    }),
  );
  assert.equal(out.reauthCookies, REDACTED);
  assert.equal(out.tokens, REDACTED);
  assert.equal(out.name, 'Void');
  assert.equal(out.sensitivity, 0.25);
});
test('oversize arrays declare their omitted entry count', () => {
  const out = new DiagnosticRedactor().value(Array.from({ length: 20001 }, (_, i) => i));
  assert.equal(out.length, 20001);
  assert.match(out.at(-1).diagnosticOmission, /1 array entries/);
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const { DiagnosticRedactor } = require('../.test-build/diagnosticRedaction.js');

const fixture = 'synthetic-credential-for-redaction-test';
const absent = (value) =>
  assert.ok(!JSON.stringify(value).includes(fixture), 'Credential fixture must not reach export');
test('plain-text Cookie response headers are redacted', () => {
  const r = new DiagnosticRedactor();
  absent(r.body('Cookie: arbitrary_session=' + fixture + '\nRBAC: access denied'));
});
test('authorization code aliases are redacted from plain text', () => {
  const r = new DiagnosticRedactor();
  absent(r.body('auth_code=' + fixture));
});
test('secret objects cannot escape through a reflected error', () => {
  const r = new DiagnosticRedactor();
  absent(r.value({ cookies: { nested: { value: fixture } }, message: 'echo ' + fixture }));
});
test('XMPP authentication text is learned before an echoed denial', () => {
  const r = new DiagnosticRedactor();
  r.text('<auth mechanism="X-Riot-RSO-PAS"><rso_token>' + fixture + '</rso_token></auth>');
  absent(r.body('error ' + fixture));
});
test('form-encoded nested authentication callbacks are redacted', () => {
  const r = new DiagnosticRedactor();
  absent(
    r.body(
      'location=' + encodeURIComponent('https://example.test/callback#access_token=' + fixture),
    ),
  );
});
test('JSON credential redaction preserves non-credential text', () => {
  const r = new DiagnosticRedactor(),
    out = r.body(
      JSON.stringify({
        access_token: fixture,
        error: 'echo ' + fixture,
        reason: 'RBAC: access denied',
      }),
    );
  absent(out);
  assert.equal(out.parsed.reason, 'RBAC: access denied');
});
test('compressed settings learn nested secrets before preserving reflected non-secret fields', () => {
  const { encodeAimDocument, decodeAimDocument } = require('../.test-build/aimCodec.js');
  const r = new DiagnosticRedactor(),
    envelope = encodeAimDocument({
      floatSettings: [],
      stringSettings: [],
      echo: fixture,
      password: fixture,
    });
  const output = r.value(envelope);
  absent(output.decodedData);
  absent(decodeAimDocument(output).data);
});
test('a settings envelope without type is inspected based on its request route', () => {
  const { encodeAimDocument, decodeAimDocument } = require('../.test-build/aimCodec.js');
  const r = new DiagnosticRedactor(),
    envelope = encodeAimDocument({
      floatSettings: [],
      stringSettings: [],
      password: fixture,
      keep: 'Riot',
    });
  const output = r.body(
    JSON.stringify({ data: envelope.data }),
    'https://example.test/playerPref/v3/getPreference/Ares.PlayerSettings',
  );
  absent(output.parsed.decodedData);
  assert.equal(decodeAimDocument(output.parsed).data.password, '[REDACTED]');
  assert.equal(output.parsed.decodedData.keep, 'Riot');
});
test('short secrets on preference envelopes are masked by field semantics', () => {
  const { encodeAimDocument } = require('../.test-build/aimCodec.js');
  const r = new DiagnosticRedactor(),
    out = r.value({
      ...encodeAimDocument({ floatSettings: [], stringSettings: [] }),
      password: 'abc',
    });
  assert.equal(out.password, '[REDACTED]');
});

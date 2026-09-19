const test = require('node:test'),
  assert = require('node:assert/strict');
const d = require('../.test-build/detailedDiagnostics.js');
const { HttpClient } = require('../.test-build/http.js');
const { requestDiagnostics, clearDiagnostics } = require('../.test-build/diagnostics.js');
const { jwt, ID } = require('./helpers.cjs');
const pause = () => new Promise((resolve) => setImmediate(resolve));
test.beforeEach(() => clearDiagnostics());
test('capture off does not clone bodies or retain requests', async () => {
  let cloned = 0;
  const res = new Response('ordinary');
  res.clone = () => {
    cloned++;
    throw Error('not called');
  };
  const value = await d.diagnosticFetcher(async () => res)('https://example.test', {});
  assert.equal(value, res);
  assert.equal(cloned, 0);
  assert.equal(d.detailedDiagnosticReport({}, []).events.length, 0);
});
test('plain 403 is exported with headers, body, request and timing without credentials', async () => {
  d.startDetailedDiagnostics();
  const auth = jwt({ sub: ID, aud: 'play-valorant-web-prod', exp: 2000000000 });
  let calls = 0;
  const fetcher = d.diagnosticFetcher(async () => {
    calls++;
    return new Response('RBAC: access denied', {
      status: 403,
      headers: {
        'content-type': 'text/plain',
        'x-riot-edge-trace-id': 'fixture-trace',
        'set-cookie': 'ssid=fixture-cookie; Secure',
      },
    });
  });
  const http = new HttpClient(fetcher);
  await assert.rejects(
    http.json(
      'https://player-preferences-apse1.pp.sgp.pvp.net/playerPref/v3/getPreference/Ares.PlayerSettings',
      { headers: { Authorization: 'Bearer ' + auth, Cookie: 'ssid=fixture-request-cookie' } },
      { aimSettings: true },
    ),
    (e) => e.code === 'AIM_RBAC',
  );
  await d.flushDetailedDiagnostics();
  const report = d.detailedDiagnosticReport({ accountId: ID }, requestDiagnostics()),
    json = JSON.stringify(report);
  assert.equal(calls, 1);
  assert.match(json, /RBAC: access denied/);
  assert.match(json, /fixture-trace/);
  assert.match(json, /play-valorant-web-prod/);
  assert.match(json, /durationMs/);
  for (const secret of [auth, 'fixture-cookie', 'fixture-request-cookie'])
    assert.ok(!json.includes(secret));
});
test('response body is still fully readable by the application', async () => {
  d.startDetailedDiagnostics();
  const raw = JSON.stringify({ values: Array.from({ length: 2000 }, (_, i) => i) }),
    res = new Response(raw, { headers: { 'content-type': 'application/json' } });
  const result = await d.diagnosticFetcher(async () => res)('https://example.test', {});
  assert.equal(result, res);
  assert.equal(await result.text(), raw);
  await d.flushDetailedDiagnostics();
  assert.ok(d.detailedDiagnosticReport({}, []).events.some((e) => e.kind === 'http-body'));
});
test('transport failures retain the error stack but scrub credential echoes', async () => {
  d.startDetailedDiagnostics();
  const error = new Error('Bad fixture-private-key');
  const fetcher = d.diagnosticFetcher(async () => {
    throw error;
  });
  await assert.rejects(
    fetcher('https://example.test', { headers: { Authorization: 'Bearer fixture-private-key' } }),
    (e) => e === error,
  );
  const report = JSON.stringify(d.detailedDiagnosticReport({}, []));
  assert.match(report, /http-error/);
  assert.match(report, /stack/);
  assert.ok(!report.includes('fixture-private-key'));
});
test('clear invalidates an in-flight capture so another account cannot inherit its data', async () => {
  d.startDetailedDiagnostics();
  let release;
  const res = new Promise((r) => (release = r));
  const request = d.diagnosticFetcher(async () => res)('https://example.test/old-account', {});
  d.clearDetailedDiagnostics();
  d.startDetailedDiagnostics();
  release(new Response('old account'));
  await request;
  await d.flushDetailedDiagnostics();
  assert.ok(!JSON.stringify(d.detailedDiagnosticReport({}, [])).includes('old-account'));
});
test('ring limits drop old records with explicit counts', () => {
  d.startDetailedDiagnostics();
  for (let i = 0; i < 350; i++) d.detailedDiagnosticEvent('fixture', { index: i });
  const s = d.diagnosticCaptureStatus();
  assert.equal(s.count, 300);
  assert.equal(s.droppedRecords, 50);
});
test('oversize bodies and media have an omission reason', async () => {
  d.startDetailedDiagnostics();
  const f = d.diagnosticFetcher(
    async () =>
      new Response('tiny', {
        headers: { 'content-length': String(3 * 1024 * 1024), 'content-type': 'application/json' },
      }),
  );
  const result = await f('https://example.test', {});
  assert.equal(await result.text(), 'tiny');
  await d.flushDetailedDiagnostics();
  assert.match(JSON.stringify(d.detailedDiagnosticReport({}, [])), /2 MiB/);
});
test('a redaction exception cannot turn a successful response into a request failure', async () => {
  d.startDetailedDiagnostics();
  const res = new Response('ok');
  Object.defineProperty(res, 'url', {
    get() {
      throw Error('broken diagnostic accessor');
    },
  });
  assert.equal(await d.diagnosticFetcher(async () => res)('https://example.test', {}), res);
  assert.ok(d.diagnosticCaptureStatus().captureFailures > 0);
});
test('stop prevents subsequent captures without deleting already captured evidence', async () => {
  d.startDetailedDiagnostics();
  d.detailedDiagnosticEvent('fixture', { retained: true });
  d.stopDetailedDiagnostics();
  d.detailedDiagnosticEvent('fixture', { notRetained: true });
  const report = JSON.stringify(d.detailedDiagnosticReport({}, []));
  assert.match(report, /retained/);
  assert.ok(!report.includes('notRetained'));
});
test('a 403 is classified as a challenge only with the explicit provider header', async () => {
  const { aimAccessError } = require('../.test-build/aimAccess.js');
  assert.equal(
    aimAccessError(new Headers({ 'cf-mitigated': 'challenge' }), 'denied').code,
    'AIM_CHALLENGE',
  );
  assert.equal(
    aimAccessError(new Headers({ 'server': 'cloudflare' }), 'denied').code,
    'AIM_ACCESS',
  );
});
test('capture expires after twenty minutes without a network poll', () => {
  d.startDetailedDiagnostics();
  const original = Date.now,
    until = d.diagnosticCaptureStatus().expiresAt;
  try {
    Date.now = () => until + 1;
    d.detailedDiagnosticEvent('fixture', { shouldNotCapture: true });
    assert.equal(d.diagnosticCaptureStatus().active, false);
    assert.equal(d.diagnosticCaptureStatus().count, 0);
  } finally {
    Date.now = original;
  }
});
test('HTTP phases carry one correlation ID without consuming empty response bodies', async () => {
  d.startDetailedDiagnostics();
  const res = await d.diagnosticFetcher(async () => new Response(null, { status: 204 }))(
    'https://example.test',
    {},
  );
  assert.equal(res.status, 204);
  await d.flushDetailedDiagnostics();
  const events = d.detailedDiagnosticReport({}, []).events.filter((e) => e.kind.startsWith('http'));
  const ids = events.map((e) => e.data.request.requestId);
  assert.equal(new Set(ids).size, 1);
  assert.equal(events.find((e) => e.kind === 'http-body').data.body.bytes, 0);
});
test('concurrent requests have separate trace identifiers and non-secret fetch modes', async () => {
  d.startDetailedDiagnostics();
  const fetcher = d.diagnosticFetcher(async () => new Response('ordinary response'));
  const replies = await Promise.all([
    fetcher('https://example.test/a', { credentials: 'omit' }),
    fetcher('https://example.test/a', { credentials: 'omit' }),
  ]);
  for (const reply of replies) assert.equal(await reply.text(), 'ordinary response');
  await d.flushDetailedDiagnostics();
  const report = d.detailedDiagnosticReport({}, []);
  const requests = report.events.filter((e) => e.kind === 'http-request');
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].data.requestId, requests[1].data.requestId);
  for (const request of requests) {
    assert.equal(request.data.request.credentialsMode, 'omit');
    assert.ok(
      report.events.some(
        (e) => e.kind === 'http-body' && e.data.requestId === request.data.requestId,
      ),
    );
  }
  assert.match(report.coverage.bodies, /explicitly marked/);
});
test('clearing capture during cooperative body redaction discards the entire old body', async () => {
  d.startDetailedDiagnostics();
  const { DiagnosticRedactor } = require('../.test-build/diagnosticRedaction.js'),
    original = DiagnosticRedactor.prototype.bodyAsync;
  let entered, release;
  const started = new Promise((r) => (entered = r)),
    blocked = new Promise((r) => (release = r));
  DiagnosticRedactor.prototype.bodyAsync = async function (...args) {
    entered();
    await blocked;
    return original.apply(this, args);
  };
  try {
    const request = await d.diagnosticFetcher(
      async () =>
        new Response(
          JSON.stringify({ password: 'synthetic-old-secret', record: 'previous account detail' }),
          { headers: { 'content-type': 'application/json' } },
        ),
    )('https://example.test/previous-account', {});
    await request.text();
    await started;
    d.clearDetailedDiagnostics();
    d.startDetailedDiagnostics();
    release();
    await d.flushDetailedDiagnostics();
    const output = JSON.stringify(d.detailedDiagnosticReport({}, []));
    assert.ok(!output.includes('previous account detail'));
    assert.ok(!output.includes('synthetic-old-secret'));
    assert.equal(d.diagnosticCaptureStatus().count, 0);
  } finally {
    release?.();
    DiagnosticRedactor.prototype.bodyAsync = original;
  }
});

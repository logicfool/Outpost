const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { createRequire } = require('node:module');
test('response metadata is redacted before it reaches the diagnostic ring', async () => {
  const file = path.join(__dirname, '../.test-build/detailedDiagnostics.js'),
    m = { exports: {} };

  const code = fs.readFileSync(file, 'utf8') + '\nexports.recordsForTest=()=>entries;';
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(
    createRequire(file),
    m,
    m.exports,
  );
  const d = m.exports,
    fixture = 'synthetic-status-value-not-real';
  d.startDetailedDiagnostics();
  try {
    const reply = await d.diagnosticFetcher(
      async () =>
        new Response('normal body', {
          status: 200,
          statusText: 'Echo ' + fixture,
          headers: { 'content-type': 'text/plain' },
        }),
    )('https://example.test', { headers: { authorization: 'Bearer ' + fixture } });
    assert.equal(await reply.text(), 'normal body');
    await d.flushDetailedDiagnostics();
    const records = d.recordsForTest();
    assert.ok(records.some((e) => e.kind === 'http-body'));
    assert.ok(!JSON.stringify(records).includes(fixture));
  } finally {
    d.clearDetailedDiagnostics();
  }
});
test('diagnostic processing failure leaves the response usable and records a redacted omission', async () => {
  const { DiagnosticRedactor } = require('../.test-build/diagnosticRedaction.js'),
    d = require('../.test-build/detailedDiagnostics.js');
  const old = DiagnosticRedactor.prototype.bodyAsync,
    secret = 'synthetic-diagnostic-failure-secret';
  DiagnosticRedactor.prototype.bodyAsync = async () => {
    throw Error('Inspection failed: ' + secret);
  };
  d.clearDetailedDiagnostics();
  d.startDetailedDiagnostics();
  try {
    const result = await d.diagnosticFetcher(async () => new Response('ordinary response'))(
      'https://example.test',
      { headers: { authorization: 'Bearer ' + secret } },
    );
    assert.equal(await result.text(), 'ordinary response');
    await d.flushDetailedDiagnostics();
    const report = d.detailedDiagnosticReport({}, []),
      entry = report.events.find((e) => e.kind === 'http-body');
    assert.match(entry.data.body.omitted, /Inspection failed/);
    assert.ok(!JSON.stringify(report).includes(secret));
  } finally {
    DiagnosticRedactor.prototype.bodyAsync = old;
    d.clearDetailedDiagnostics();
  }
});

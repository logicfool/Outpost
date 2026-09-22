const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { uiCrash } = require('../.test-build/crashReport.js');

test('UI crash reports retain the error and component stack needed for diagnosis', () => {
  const error = new TypeError('RNCTabView is unavailable');
  error.stack = 'TypeError: RNCTabView is unavailable\n at NativeTabs';
  const report = uiCrash(error, '\n at NativeTabs\n at AppContent');
  assert.equal(report.name, 'TypeError');
  assert.equal(report.message, 'RNCTabView is unavailable');
  assert.match(report.stack, /NativeTabs/);
  assert.match(report.componentStack, /AppContent/);
  assert.ok(report.at > 0);
});

test('UI crash reports safely bound unexpected values', () => {
  const report = uiCrash('x'.repeat(5000), 'y'.repeat(40000));
  assert.equal(report.name, 'UnknownError');
  assert.equal(report.message.length, 4000);
  assert.equal(report.componentStack.length, 32000);
});

test('the app crash boundary exports diagnostics and can retry the failed render', () => {
  const source = fs.readFileSync('App.tsx', 'utf8');
  assert.match(source, /componentDidCatch\(error: unknown, info: React\.ErrorInfo\)/);
  assert.match(source, /<Boundary model=\{model\}>/);
  assert.match(source, /saveDiagnosticFile\(JSON\.stringify\(report\), filename\)/);
  assert.match(source, /Export diagnostics \(JSON\)/);
  assert.match(source, /title="Try again"/);
});

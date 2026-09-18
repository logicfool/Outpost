const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const d = require('../.test-build/detailedDiagnostics.js');

function expoResponse(status, text) {
  class NativeResponse {
    get _rawHeaders() {
      return [
        ['content-type', 'text/plain'],
        ['x-riot-edge-trace-id', 'fixture-trace'],
      ];
    }
    get status() {
      return status;
    }
    get statusText() {
      return status === 403 ? 'Forbidden' : 'OK';
    }
    get url() {
      return 'https://example.test/response';
    }
    get redirected() {
      return status === 302;
    }
    addListener() {
      return { remove() {} };
    }
    removeListener() {}
    removeAllListeners() {}
    async startStreaming() {
      return new TextEncoder().encode(text);
    }
    cancelStreaming() {}
    async text() {
      return text;
    }
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer;
    }
  }
  const source = fs.readFileSync(
    path.join(__dirname, '../node_modules/expo/src/winter/fetch/FetchResponse.ts'),
    'utf8',
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const load = (n) =>
    n === './ExpoFetchModule'
      ? { ExpoFetchModule: { NativeResponse } }
      : n === './createBlob'
        ? { isReactNativeBlobGlobal: () => false }
        : (() => {
            throw Error(n);
          })();
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(load, mod, mod.exports);
  return new mod.exports.FetchResponse(() => {});
}
for (const status of [200, 302, 403])
  test('Expo response ' + status + ' diagnostics do not consume the application body', async () => {
    d.clearDetailedDiagnostics();
    d.startDetailedDiagnostics();
    const text = status === 403 ? 'RBAC: access denied' : 'ordinary response';
    const original = expoResponse(status, text),
      result = await d.diagnosticFetcher(async () => original)('https://example.test/response', {});
    assert.equal(result, original);
    assert.equal(result.bodyUsed, false);
    assert.equal(await result.text(), text);
    await d.flushDetailedDiagnostics();
    const body = d.detailedDiagnosticReport({}, []).events.find((e) => e.kind === 'http-body');
    assert.equal(body.data.body.text, text);
    assert.equal(body.data.response.status, status);
    assert.ok(body.data.requestId);
    d.clearDetailedDiagnostics();
  });

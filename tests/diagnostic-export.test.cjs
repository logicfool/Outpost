const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  ts = require('typescript');
const { AppError } = require('../.test-build/validation.js');
const source = fs.readFileSync(path.join(__dirname, '../src/platform/diagnosticExport.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness(platform, options = {}) {
  const calls = [],
    files = new Map();
  const filesystem = {
    EncodingType: { UTF8: 'utf8' },
    cacheDirectory: 'file:///cache/',
    StorageAccessFramework: {
      requestDirectoryPermissionsAsync: async () => {
        calls.push('picker');
        return options.permission ?? { granted: true, directoryUri: 'content://chosen/' };
      },
      createFileAsync: async (dir, name, type) => {
        calls.push(['create', dir, name, type]);
        files.set('content://new-file', '');
        return 'content://new-file';
      },
    },
    writeAsStringAsync: async (uri, value) => {
      calls.push(['write', uri, value]);
      files.set(uri, value);
      if (options.failWrite) throw Error('disk full');
    },
    deleteAsync: async (uri) => {
      calls.push(['delete', uri]);
      files.delete(uri);
    },
    makeDirectoryAsync: async () => {},
    readDirectoryAsync: async () => [],
  };
  const native = {
    Platform: { OS: platform },
    Share: {
      dismissedAction: 'dismissed',
      share: async (content) => {
        calls.push(['share', content]);
        if (options.onShare) await options.onShare(content, files);
        return { action: options.cancelShare ? 'dismissed' : 'shared' };
      },
    },
  };
  const module = { exports: {} };
  const load = (name) =>
    name === 'react-native'
      ? native
      : name === 'expo-file-system/legacy'
        ? filesystem
        : name === '../core/validation'
          ? { AppError }
          : (() => {
              throw Error(name);
            })();
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(
    load,
    module,
    module.exports,
  );
  return { ...module.exports, calls, files };
}
const name = 'Outpost-diagnostics-test.json',
  json = JSON.stringify({ body: 'full response data', accountId: 'test-account' });
test('Android export writes the complete JSON to the user-selected folder', async () => {
  const h = harness('android');
  await h.saveDiagnosticFile(json, name);
  assert.equal(h.files.get('content://new-file'), json);
  assert.deepEqual(
    h.calls.find((x) => Array.isArray(x) && x[0] === 'create'),
    ['create', 'content://chosen/', name.replace(/\.json$/, ''), 'application/json'],
  );
});
test('Android picker cancellation creates no file and does not delete existing data', async () => {
  const h = harness('android', { permission: { granted: false } });
  assert.match(await h.saveDiagnosticFile(json, name), /cancelled/i);
  assert.deepEqual(h.calls, ['picker']);
});
test('account change while picker is open prevents file creation', async () => {
  const h = harness('android');
  let n = 0;
  await assert.rejects(
    h.saveDiagnosticFile(json, name, () => {
      if (++n > 1) throw new AppError('ACCOUNT_CHANGED', 'changed');
    }),
  );
  assert.equal(h.files.size, 0);
});
test('partial Android export is removed on write failure', async () => {
  const h = harness('android', { failWrite: true });
  await assert.rejects(h.saveDiagnosticFile(json, name));
  assert.equal(h.files.size, 0);
  assert.ok(h.calls.some((c) => c[0] === 'delete'));
});
test('iOS shares a real temporary JSON file and removes it after the share sheet completes', async () => {
  const h = harness('ios', {
    onShare: async (content, files) => {
      assert.equal(files.get(content.url), json);
      assert.match(content.url, /\.json$/);
    },
  });
  await h.saveDiagnosticFile(json, name);
  assert.equal(h.files.size, 0);
});
test('iOS cancellation also cleans its temporary export', async () => {
  const h = harness('ios', { cancelShare: true });
  assert.match(await h.saveDiagnosticFile(json, name), /cancelled/i);
  assert.equal(h.files.size, 0);
});
test('invalid export names are rejected before filesystem access', async () => {
  const h = harness('android');
  await assert.rejects(h.saveDiagnosticFile(json, '../private.txt'));
  assert.equal(h.calls.length, 0);
});

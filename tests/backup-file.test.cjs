const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  crypto = require('node:crypto');
const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/backupFile.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function fixture(platform = 'android') {
  const calls = [],
    options = { canceled: false, size: 7, text: '{"a":1}', granted: true };
  const File = {
    pickFileAsync: async (settings) => {
      calls.push(['pick', settings]);
      return {
        canceled: options.canceled,
        result: {
          size: options.size,
          readableStream: () =>
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode(options.text));
                c.close();
              },
            }),
        },
      };
    },
  };
  const Legacy = {
    cacheDirectory: 'file:///cache/',
    EncodingType: { UTF8: 'utf8' },
    StorageAccessFramework: {
      requestDirectoryPermissionsAsync: async () => ({
        granted: options.granted,
        directoryUri: 'content://chosen-folder',
      }),
      createFileAsync: async (...args) => {
        calls.push(['create', ...args]);
        return 'content://chosen-folder/backup.json';
      },
    },
    writeAsStringAsync: async (...args) => calls.push(['write', ...args]),
    deleteAsync: async (uri) => calls.push(['delete', uri]),
    makeDirectoryAsync: async (uri) => calls.push(['mkdir', uri]),
  };
  const Share = {
    dismissedAction: 'dismissed',
    share: async (payload) => {
      calls.push(['share', payload]);
      return { action: 'shared' };
    },
  };
  const load = (n) =>
    n === 'react-native'
      ? { Platform: { OS: platform }, Share }
      : n === 'expo-file-system'
        ? { File, Paths: {} }
        : n === 'expo-file-system/legacy'
          ? Legacy
          : n === 'expo-crypto'
            ? {
                CryptoDigestAlgorithm: { SHA256: 'sha256' },
                digestStringAsync: async (_, s) =>
                  crypto.createHash('sha256').update(s).digest('hex'),
              }
            : n.startsWith('../core/')
              ? require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'))
              : (() => {
                  throw Error(n);
                })();
  const mod = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(
    load,
    mod,
    mod.exports,
  );
  return { api: mod.exports, calls, options };
}
for (const platform of ['android', 'ios'])
  test(platform + ': backup picker reads only the chosen bounded local file', async () => {
    const h = fixture(platform);
    assert.equal(await h.api.selectBackupFile(() => {}), h.options.text);
    assert.equal(h.calls.filter((c) => c[0] === 'pick').length, 1);
    assert.equal(h.calls.filter((c) => c[0] === 'write').length, 0);
  });
test('cancelling backup selection causes no restore or writes', async () => {
  const h = fixture();
  h.options.canceled = true;
  assert.equal(await h.api.selectBackupFile(() => {}), null);
  assert.equal(h.calls.length, 1);
});
test('oversize selected file is rejected before reading its body', async () => {
  const h = fixture();
  h.options.size = 65 * 1024 * 1024;
  await assert.rejects(
    h.api.selectBackupFile(() => {}),
    (e) => e.code === 'BACKUP_SIZE',
  );
});
test('Android backup export writes to the user selected folder without storage permissions', async () => {
  const h = fixture();
  await h.api.saveBackupFile('{"fixture":true}', 'Outpost-backup-fixture.json', () => {});
  assert.deepEqual(
    h.calls.find((c) => c[0] === 'create'),
    ['create', 'content://chosen-folder', 'Outpost-backup-fixture', 'application/json'],
  );
  assert.equal(h.calls.find((c) => c[0] === 'write')[2], '{"fixture":true}');
  assert.ok(!h.calls.some((c) => c[0] === 'share'));
});
test('Android folder permission denial does not create a backup', async () => {
  const h = fixture();
  h.options.granted = false;
  assert.match(
    await h.api.saveBackupFile('{}', 'Outpost-backup-fixture.json', () => {}),
    /cancelled/,
  );
  assert.equal(h.calls.length, 0);
});
test('iOS shares a temporary backup and then removes that temporary copy', async () => {
  const h = fixture('ios');
  await h.api.saveBackupFile('{}', 'Outpost-backup-fixture.json', () => {});
  const shared = h.calls.find((c) => c[0] === 'share')[1].url;
  assert.equal(shared, 'file:///cache/outpost-backup-export/Outpost-backup-fixture.json');
  assert.ok(h.calls.some((c) => c[0] === 'delete' && c[1] === shared));
});
test('account change after picking a file prevents returning its content', async () => {
  const h = fixture();
  let checks = 0;
  await assert.rejects(
    h.api.selectBackupFile(() => {
      if (++checks === 2) throw Error('account changed');
    }),
    /account changed/,
  );
  assert.ok(!h.calls.some((c) => c[0] === 'write'));
});
test('invalid export names cannot write outside the selected location', async () => {
  const h = fixture();
  await assert.rejects(h.api.saveBackupFile('{}', '../elsewhere.json', () => {}));
  assert.equal(h.calls.length, 0);
});

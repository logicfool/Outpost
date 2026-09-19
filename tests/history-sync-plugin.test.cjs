const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
function fixture() {
  const hooks = {},
    copies = [];
  const plugin = {
    withAndroidManifest: (c, fn) => {
      hooks.manifest = fn;
      return c;
    },
    withMainApplication: (c, fn) => {
      hooks.main = fn;
      return c;
    },
    withDangerousMod: (c, [name, fn]) => {
      hooks.files = fn;
      return c;
    },
  };
  const load = (n) =>
    n === 'expo/config-plugins'
      ? plugin
      : n === 'node:path'
        ? path
        : n === 'node:fs/promises'
          ? { mkdir: async () => {}, copyFile: async (a, b) => copies.push([a, b]) }
          : (() => {
              throw Error(n);
            })();
  const source = fs.readFileSync(path.join(__dirname, '../plugins/with-history-sync.cjs'), 'utf8'),
    m = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(load, m, m.exports);
  m.exports({});
  return { hooks, copies };
}
test('foreground service prebuild configuration is idempotent and not exported', () => {
  const { hooks } = fixture(),
    c = {
      modResults: {
        manifest: {
          'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }],
          application: [{ $: {}, service: [] }],
        },
      },
    };
  hooks.manifest(c);
  hooks.manifest(c);
  const m = c.modResults.manifest;
  assert.equal(m['uses-permission'].length, 5);
  assert.equal(m.application[0].service.length, 1);
  assert.deepEqual(m.application[0].service[0].$, {
    'android:name': 'app.outpost.historysync.OutpostHistorySyncService',
    'android:exported': 'false',
    'android:foregroundServiceType': 'dataSync',
    'android:stopWithTask': 'true',
  });
});
test('native package registration is added once and never changes app initialization logic', () => {
  const { hooks } = fixture(),
    source = 'PackageList(this).packages.apply {\n // other packages\n}',
    c = { modResults: { contents: source } };
  hooks.main(c);
  hooks.main(c);
  assert.equal(c.modResults.contents.split('OutpostHistorySyncPackage.install(this)').length, 2);
  assert.ok(c.modResults.contents.includes('// other packages'));
  assert.throws(
    () => hooks.main({ modResults: { contents: 'unsupported template' } }),
    /Unsupported/,
  );
});
test('prebuild copies only the four source-controlled Java files into the app namespace', async () => {
  const { hooks, copies } = fixture();
  await hooks.files({
    modRequest: { projectRoot: '/project', platformProjectRoot: '/project/android' },
  });
  assert.equal(copies.length, 4);
  for (const [a, b] of copies) {
    assert.ok(a.startsWith('/project/native/history-sync/android/'));
    assert.ok(b.startsWith('/project/android/app/src/main/java/app/outpost/historysync/'));
    assert.ok(b.endsWith('.java'));
  }
});

const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { execFileSync } = require('node:child_process'),
  crypto = require('node:crypto'),
  ts = require('typescript');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'docs/validation-0.7.2');
const { ID, jwt } = require('../tests/helpers.cjs');
const patched = require('../.test-build/auth.js');
const oldSource = execFileSync(
  'git',
  ['show', 'a6983617e931ce230703c3fd212605dcb59ec429:valorantTracker/src/core/auth.ts'],
  { cwd: root, encoding: 'utf8' },
);
const js = ts.transpileModule(oldSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = { exports: {} };
vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(
  (name) => require(path.join(root, '.test-build', name.slice(2) + '.js')),
  m,
  m.exports,
);
async function replay(auth) {
  const a = { state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: Date.now() };
  let requests = 0,
    checkpoints = 0;
  try {
    const result = await auth.reauthenticateWithCookies(
      { ssid: 'synthetic-session' },
      a,
      async (url) => {
        requests++;
        const location =
          'https://playvalorant.com/opt_in#' +
          new URLSearchParams({
            state: a.state,
            token_type: 'Bearer',
            expires_in: '3500',
            access_token: jwt({ sub: ID, exp: Math.floor(Date.now() / 1000) + 3500 }),
            id_token: jwt({ sub: ID, nonce: a.nonce }),
          });
        const r = new Response(null, {
          status: 302,
          headers: { location, 'set-cookie': 'ssid=synthetic-rotation; Secure; HttpOnly' },
        });
        Object.defineProperties(r, { url: { value: url }, redirected: { value: true } });
        return r;
      },
      async () => {
        checkpoints++;
      },
      'expo-android',
    );
    return {
      result: 'callback-validated',
      requests,
      checkpoints,
      rotationReturned: result.reauthCookies.ssid === 'synthetic-rotation',
    };
  } catch (e) {
    return { result: e.code, requests, checkpoints };
  }
}
(async () => {
  const original = await replay(m.exports),
    corrected = await replay(patched);
  if (
    original.result !== 'AUTH_REDIRECT' ||
    original.checkpoints !== 0 ||
    corrected.result !== 'callback-validated' ||
    corrected.checkpoints !== 1
  )
    throw Error('Reproduction did not match');
  const nativeSources = {};
  for (const filename of ['NativeRequest.kt', 'NativeResponse.kt']) {
    nativeSources[filename] = crypto
      .createHash('sha256')
      .update(
        fs.readFileSync(
          path.join(root, 'node_modules/expo/android/src/main/java/expo/modules/fetch', filename),
        ),
      )
      .digest('hex');
  }
  const record = {
    originalCommit: 'a6983617e931ce230703c3fd212605dcb59ec429',
    expoVersion: require('expo/package.json').version,
    original,
    corrected,
    nativeSources,
    physicalDeviceTest: false,
    realNetworkRequests: 0,
    testedAt: new Date().toISOString(),
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, 'android-renewal-reproduction.json'),
    JSON.stringify(record, null, 2) + '\n',
  );
  console.log(JSON.stringify(record, null, 2));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

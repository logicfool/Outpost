const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer');
const { act } = Renderer;
const { PALETTES } = require('../.test-build/theme.js');
global.IS_REACT_ACT_ENVIRONMENT = true;
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/ui/components.tsx'), 'utf8'),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
const load = (name) => {
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'react-native')
    return {
      ActivityIndicator: 'Spinner',
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      Text: 'Text',
      View: 'View',
      StyleSheet: { create: (s) => s },
    };
  if (name === 'react-native-safe-area-context')
    return { SafeAreaProvider: 'Provider', SafeAreaView: 'SafeArea' };
  if (name === '@expo/vector-icons') return { Feather: 'Icon', Ionicons: 'Icon' };
  if (name === 'expo-linear-gradient') return { LinearGradient: 'Gradient' };
  if (name === './Skeleton') return { Skeleton: 'Skeleton', resourceSkeleton: () => 'store' };
  if (name === '../state/useArtworkReadiness') return { ARTWORK_WAIT_MS: 8000 };
  if (name === './CachedImage') return { Image: 'Image' };
  if (name === './ArtworkRevision') return { useArtworkRevision: () => '' };
  if (name === './theme')
    return {
      useTheme: () => ({ C: PALETTES.navy, S: {}, isDark: true }),
      useThemedStyles: (f) => f(PALETTES.navy),
    };
  if (name.startsWith('../core/'))
    return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
  throw Error(name);
};
const m = { exports: {} };
vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
async function render(t, section, loading = false) {
  let r;
  await act(async () => {
    r = Renderer.create(
      React.createElement(m.exports.Resource, { section, title: 'Store', loading }, (data) =>
        React.createElement('Loaded', null, JSON.stringify(data)),
      ),
    );
  });
  t.after(async () => {
    await act(async () => r.unmount());
  });
  return r;
}
test('initial account refresh shows loading rather than unavailable or NOT_LOADED', async (t) => {
  const r = await render(
    t,
    { status: 'error', code: 'NOT_LOADED', message: 'Old placeholder' },
    true,
  );
  const json = JSON.stringify(r.toJSON());
  assert.equal(r.root.findByType('Skeleton').props.label, 'Loading store');
  assert.doesNotMatch(json, /unavailable|NOT_LOADED/);
  assert.equal(r.root.findAllByType('Spinner').length, 0);
});
test('persisted initial cooldown shows a local automatic retry countdown, not a Riot failure', async (t) => {
  const r = await render(t, {
    status: 'error',
    code: 'INITIAL_SYNC_WAIT',
    message: 'Wait',
    retryAt: Date.now() + 60000,
  });
  const json = JSON.stringify(r.toJSON());
  assert.match(json, /Retrying automatically in/);
  assert.doesNotMatch(json, /unavailable|NOT_LOADED|INITIAL_SYNC_WAIT/);
  assert.equal(r.root.findAllByType('Spinner').length, 0);
});
test('a real service error is still visible after loading ends', async (t) => {
  const r = await render(t, {
    status: 'error',
    code: 'ACCESS_DENIED',
    message: 'Permission denied',
  });
  const json = JSON.stringify(r.toJSON());
  assert.match(json, /ACCESS_DENIED/);
  assert.match(json, /Permission denied/);
});
test('ready account values stay visible during a manual refresh', async (t) => {
  const r = await render(t, { status: 'ready', data: { offers: 4 }, fetchedAt: 1 }, true);
  assert.equal(r.root.findAllByType('Loaded').length, 1);
  assert.equal(r.root.findAllByType('Spinner').length, 0);
});

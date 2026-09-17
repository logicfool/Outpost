const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function fixture({
  api = true,
  compiled = true,
  reduced = false,
  dark = true,
  throwApi = false,
} = {}) {
  const listeners = new Map(),
    calls = [];
  const load = (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native')
      return {
        View: 'View',
        StyleSheet: {
          absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
        },
        AccessibilityInfo: {
          isReduceTransparencyEnabled: async () => reduced,
          addEventListener: (name, fn) => {
            listeners.set(name, fn);
            return { remove: () => listeners.delete(name) };
          },
        },
      };
    if (name === 'expo-glass-effect')
      return {
        GlassView: 'GlassView',
        isGlassEffectAPIAvailable: () => {
          calls.push('api');
          if (throwApi) throw Error('unsupported');
          return api;
        },
        isLiquidGlassAvailable: () => compiled,
      };
    if (name === './theme')
      return { useTheme: () => ({ C: { surface: '#171717' }, isDark: dark }) };
    throw Error(name);
  };
  const src = fs.readFileSync(path.join(__dirname, '../src/ui/NavSurface.ios.tsx'), 'utf8'),
    js = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    m = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(load, m, m.exports);
  return { ...m.exports, listeners, calls };
}
async function mount(f) {
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(
        f.NavSurface,
        { testID: 'nav' },
        React.createElement('Tab', { name: 'Store' }),
      ),
    );
  });
  return tree;
}
test('supported iOS mounts native Liquid Glass behind exactly one set of tabs', async () => {
  const f = fixture(),
    tree = await mount(f);
  assert.equal(tree.root.findAllByType('GlassView').length, 1);
  assert.equal(tree.root.findAllByType('Tab').length, 1);
  assert.equal(tree.root.findByType('GlassView').props.glassEffectStyle, 'regular');
  await Renderer.act(() => tree.unmount());
});
test('older or incomplete iOS APIs use a regular view instead of crashing', async () => {
  for (const opts of [{ api: false }, { compiled: false }, { throwApi: true }]) {
    const tree = await mount(fixture(opts));
    assert.equal(tree.root.findAllByType('GlassView').length, 0);
    await Renderer.act(() => tree.unmount());
  }
});
test('Reduce Transparency removes glass immediately and can re-enable it', async () => {
  const f = fixture(),
    tree = await mount(f);
  await Renderer.act(() => f.listeners.get('reduceTransparencyChanged')(true));
  assert.equal(tree.root.findAllByType('GlassView').length, 0);
  await Renderer.act(() => f.listeners.get('reduceTransparencyChanged')(false));
  assert.equal(tree.root.findAllByType('GlassView').length, 1);
  await Renderer.act(() => tree.unmount());
  assert.equal(f.listeners.size, 0);
});
test('glass follows app light and dark themes', async () => {
  for (const dark of [true, false]) {
    const tree = await mount(fixture({ dark }));
    assert.equal(tree.root.findByType('GlassView').props.colorScheme, dark ? 'dark' : 'light');
    await Renderer.act(() => tree.unmount());
  }
});
test('Android and web surface never imports the iOS glass native module', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/ui/NavSurface.tsx'), 'utf8');
  assert.equal(source.includes('expo-glass-effect'), false);
  assert.match(source, /<View/);
});

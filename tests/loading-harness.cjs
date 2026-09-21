const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
function harness({ os = 'android', reduced = true, overrides = {} } = {}) {
  const listeners = new Map(),
    animations = [],
    loops = [],
    cache = new Map();
  const subscribe = (name, fn) => {
    const rows = listeners.get(name) ?? new Set();
    rows.add(fn);
    listeners.set(name, rows);
    return { remove: () => rows.delete(fn) };
  };
  class Value {
    constructor(n) {
      this.value = n;
    }
    setValue(n) {
      this.value = n;
    }
    stopAnimation() {}
    interpolate() {
      return this;
    }
  }
  const native = {
    View: 'View',
    Text: 'Text',
    TextInput: 'TextInput',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    RefreshControl: 'RefreshControl',
    ActivityIndicator: 'Spinner',
    StyleSheet: { create: (x) => x },
    Platform: { OS: os },
    useColorScheme: () => 'dark',
    AccessibilityInfo: { isReduceMotionEnabled: async () => reduced, addEventListener: subscribe },
    AppState: { currentState: 'active', addEventListener: subscribe },
    Animated: {
      Value,
      View: 'AnimatedView',
      timing: (value, config) => {
        animations.push(config);
        return { start() {}, stop() {} };
      },
      sequence: (x) => x,
      loop: (steps) => {
        const loop = {
          steps,
          started: false,
          stopped: false,
          start() {
            this.started = true;
          },
          stop() {
            this.stopped = true;
          },
        };
        loops.push(loop);
        return loop;
      },
    },
  };
  const content = (value) => (typeof value === 'function' ? React.createElement(value) : value);
  native.FlatList = (props) =>
    React.createElement(
      'List',
      props,
      content(props.ListHeaderComponent),
      props.data?.length
        ? props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: index }, props.renderItem({ item, index })),
          )
        : content(props.ListEmptyComponent),
      content(props.ListFooterComponent),
    );
  const polling = {
    LivePollingContext: React.createContext(true),
    useLivePolling: () => ({ busy: false, refreshing: false, refresh() {} }),
  };
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const lookup = (name) => {
      if (name in overrides) return overrides[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return native;
      if (name === 'expo-image') return { Image: 'NativeImage' };
      if (name === '@expo/vector-icons') return { Feather: 'Icon', Ionicons: 'Icon' };
      if (name === 'expo-linear-gradient') return { LinearGradient: 'Gradient' };
      if (name === 'react-native-safe-area-context')
        return { SafeAreaProvider: 'SafeProvider', SafeAreaView: 'SafeView' };
      if (name.endsWith('useLivePolling')) return polling;
      if (name === './profileViews') return { PlayerCover: 'Cover' };
      if (name.startsWith('../core/'))
        return require(path.join(root, '.test-build', name.slice(8) + '.js'));
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(file), name);
        return load(fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts');
      }
      throw Error('Unexpected loading-test dependency ' + name);
    };
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
      lookup,
      mod,
      mod.exports,
    );
    return mod.exports;
  }
  const emit = (name, value) => {
    if (name === 'change') native.AppState.currentState = value;
    for (const fn of listeners.get(name) ?? []) fn(value);
  };
  return { load, native, polling, animations, loops, listeners, emit };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
module.exports = { harness, deferred, settle, React, Renderer, act: Renderer.act };

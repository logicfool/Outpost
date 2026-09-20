const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer'),
  { act } = Renderer;
global.IS_REACT_ACT_ENVIRONMENT = true;
const { document, ID } = require('./aim-helpers.cjs'),
  { aimSnapshot } = require('../.test-build/aimSettings.js');
const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/ui/AimPanel.tsx'), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const text = (value) => ({
  hipfire: String(value?.hipfire ?? ''),
  ads: String(value?.ads ?? ''),
  scoped: String(value?.scoped ?? ''),
});
const nextSnapshot = (sensitivity, at = Date.now()) => {
  const d = document();
  d.data.floatSettings[0].value = sensitivity;
  return aimSnapshot(d, ID, at);
};
async function harness(t, platform) {
  let cloud = nextSnapshot(0.25),
    hold,
    error,
    renderer,
    closed = 0;
  const calls = [];
  const model = {
    active: { puuid: ID, gameName: 'Fixture', tagLine: 'TEST' },
    aimState: { snapshot: cloud },
    aimPresets: [{ id: 'saved-preset', name: 'Keep' }],
    aimLoading: false,
    syncAim: async (reason) => {
      calls.push(reason);
      if (hold) await hold;
      const result = error
        ? { ...model.aimState, error: { code: 'RATE_LIMIT', message: 'Wait for Riot' } }
        : { snapshot: cloud };
      model.aimState = result;
      if (renderer) renderer.update(view());
      return result;
    },
  };
  const components = {
    Button: (p) => React.createElement('Button', p),
    Tabs: (p) => React.createElement('Tabs', p),
    Badge: (p) => React.createElement('Badge', p),
    Empty: (p) => React.createElement('Empty', p),
    ModalHeader: (p) => React.createElement('Header', p),
    ModalPage: (p) => React.createElement('Page', null, p.children),
  };
  const FlatList = (p) =>
    React.createElement(
      'List',
      null,
      p.refreshControl,
      p.ListHeaderComponent,
      (p.data ?? []).map((item) =>
        React.createElement(React.Fragment, { key: p.keyExtractor(item) }, p.renderItem({ item })),
      ),
      p.data?.length ? null : p.ListEmptyComponent,
    );
  const load = (n) =>
    n === 'react'
      ? React
      : n === 'react/jsx-runtime'
        ? require(n)
        : n === 'react-native'
          ? {
              FlatList,
              Pressable: 'Pressable',
              RefreshControl: 'Refresh',
              ScrollView: 'ScrollView',
              Switch: 'Switch',
              Text: 'Text',
              TextInput: 'TextInput',
              View: 'View',
              Platform: { OS: platform },
            }
          : n === '@expo/vector-icons'
            ? { Feather: 'Icon' }
            : n === './components'
              ? components
              : n === './Skeleton'
                ? { Skeleton: 'Skeleton' }
                : n === './CrosshairPreview'
                  ? { CrosshairPreview: 'Preview' }
                  : n === './theme'
                    ? { useTheme: () => ({ C: {}, S: {} }) }
                    : n === './AimEditor'
                      ? {
                          SensitivityFields: (p) => React.createElement('Sensitivity', p),
                          CrosshairFields: (p) => React.createElement('Crosshair', p),
                          sensitivityText: text,
                          readSensitivity: (v) =>
                            Object.fromEntries(
                              Object.entries(v).map(([k, value]) => [k, Number(value)]),
                            ),
                        }
                      : n.startsWith('../core/')
                        ? require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'))
                        : (() => {
                            throw Error(n);
                          })();
  const m = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(load, m, m.exports);
  const view = () =>
    React.createElement(m.exports.AimPanel, {
      model,
      initialTab: 'sensitivity',
      onBack: () => closed++,
    });
  await act(async () => {
    renderer = Renderer.create(view());
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
  });
  const settle = async (action) => {
    await act(async () => {
      action?.();
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    });
  };
  return {
    model,
    calls,
    get value() {
      return renderer.root.findByType('Sensitivity').props.value.hipfire;
    },
    get json() {
      return JSON.stringify(renderer.toJSON());
    },
    cloud(value) {
      cloud = nextSnapshot(value);
    },
    async automatic(value) {
      cloud = nextSnapshot(value);
      model.aimState = { snapshot: cloud };
      await settle(() => renderer.update(view()));
    },
    async edit(value) {
      await settle(() =>
        renderer.root.findByType('Sensitivity').props.onChange({
          ...renderer.root.findByType('Sensitivity').props.value,
          hipfire: value,
        }),
      );
    },
    async pull() {
      await settle(() => renderer.root.findByType('Refresh').props.onRefresh());
    },
    async press(title) {
      await settle(() =>
        renderer.root
          .findAllByType('Button')
          .find((n) => n.props.title === title)
          .props.onPress(),
      );
    },
    block() {
      let release;
      hold = new Promise((r) => (release = r));
      return async () => {
        await settle(() => {
          hold = undefined;
          release();
        });
      };
    },
    fail() {
      error = true;
    },
  };
}
for (const platform of ['android', 'ios']) {
  test(
    platform + ': explicit Aim pull displays the newly returned server sensitivity',
    async (t) => {
      const h = await harness(t, platform);
      assert.equal(h.value, '0.25');
      h.cloud(0.63);
      await h.pull();
      assert.equal(h.value, '0.63');
      assert.equal(h.calls.at(-1), 'manual');
      assert.equal(h.model.aimPresets[0].name, 'Keep');
    },
  );
  test(
    platform + ': unsaved sensitivity needs confirmation before refresh discards it',
    async (t) => {
      const h = await harness(t, platform);
      await h.edit('0.9');
      await h.automatic(0.41);
      assert.equal(h.value, '0.9');
      const count = h.calls.length;
      await h.pull();
      assert.ok(h.json.includes('Refresh from Riot?'));
      assert.equal(h.calls.length, count);
      await h.press('Keep editing sensitivity');
      assert.equal(h.value, '0.9');
      h.cloud(0.52);
      await h.pull();
      await h.press('Discard edits and refresh');
      assert.equal(h.value, '0.52');
      assert.ok(!h.json.includes('Unsaved sensitivity edits'));
    },
  );
  test(
    platform + ': typing while a refresh is in flight cannot lose the newer draft',
    async (t) => {
      const h = await harness(t, platform);
      const release = h.block();
      h.cloud(0.62);
      await h.pull();
      await h.edit('0.8');
      await release();
      assert.equal(h.value, '0.8');
      assert.equal(h.model.aimState.snapshot.sensitivity.hipfire, 0.62);
    },
  );
  test(
    platform + ': a failed refresh keeps the cached sensitivity and exposes the denial',
    async (t) => {
      const h = await harness(t, platform);
      h.fail();
      await h.pull();
      assert.equal(h.value, '0.25');
      assert.ok(h.json.includes('Wait for Riot'));
    },
  );
}

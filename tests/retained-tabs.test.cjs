const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, React, Renderer, act } = require('./loading-harness.cjs');
for (const platform of ['ios', 'android'])
  test(
    platform + ': visited tabs preserve local state but stop hidden effects and isolate accounts',
    async (t) => {
      const h = harness({ os: platform }),
        { RetainedTabs } = h.load('src/ui/RetainedTabs.tsx');
      let tree,
        active = 'store',
        account = 'first';
      const starts = {},
        stops = {},
        renders = {};
      function Scene({ id }) {
        const [count, setCount] = React.useState(0);
        renders[id] = (renders[id] ?? 0) + 1;
        React.useEffect(() => {
          starts[id] = (starts[id] ?? 0) + 1;
          return () => {
            stops[id] = (stops[id] ?? 0) + 1;
          };
        }, []);
        return React.createElement('FixtureScene', {
          id,
          count,
          increment: () => setCount((n) => n + 1),
        });
      }
      const element = () =>
        React.createElement(RetainedTabs, {
          key: account,
          active,
          interactive: true,
          render: (id) => React.createElement(Scene, { id }),
        });
      await act(() => {
        tree = Renderer.create(element());
      });
      t.after(() => act(() => tree.unmount()));
      assert.deepEqual(Object.keys(starts), ['store']);
      await act(() => tree.root.findByType('FixtureScene').props.increment());
      active = 'matches';
      await act(() => tree.update(element()));
      assert.equal(stops.store, 1);
      assert.equal(starts.matches, 1);
      active = 'store';
      await act(() => tree.update(element()));
      const store = tree.root.findAllByType('FixtureScene').find((n) => n.props.id === 'store');
      assert.equal(store.props.count, 1);
      assert.equal(starts.store, 2);
      assert.equal(stops.matches, 1);
      account = 'second';
      await act(() => tree.update(element()));
      assert.equal(tree.root.findByType('FixtureScene').props.count, 0);
      assert.equal(tree.root.findAllByType('FixtureScene').length, 1);
    },
  );
test('the installed React Native renderer has an Activity implementation', () => {
  const fs = require('node:fs'),
    path = require('node:path');
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '../node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js',
    ),
    'utf8',
  );
  assert.match(source, /REACT_ACTIVITY_TYPE/);
  assert.ok(React.Activity);
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, React, Renderer, act } = require('./loading-harness.cjs');
async function setup(t, options = {}, count = 1) {
  const h = harness(options),
    { Skeleton, SkeletonProvider } = h.load('src/ui/Skeleton.tsx');
  let tree;
  const children = () =>
    Array.from({ length: count }, (_, key) =>
      React.createElement(Skeleton, { key, kind: 'match', label: 'Loading match' }),
    );
  await act(async () => {
    tree = Renderer.create(React.createElement(SkeletonProvider, null, children()));
  });
  t.after(async () => act(() => tree.unmount()));
  return { ...h, tree, empty: () => tree.update(React.createElement(SkeletonProvider)) };
}
for (const os of ['android', 'ios'])
  test(`${os}: many skeleton rows share one native non-interaction animation`, async (t) => {
    const h = await setup(t, { os, reduced: false }, 6);
    assert.equal(h.loops.filter((l) => l.started).length, 1);
    assert.ok(h.animations.every((a) => a.useNativeDriver && a.isInteraction === false));
    await act(() => h.empty());
    assert.ok(h.loops.every((l) => l.stopped));
  });
test('Reduce Motion keeps static placeholders and toggling it stops the current pulse', async (t) => {
  const h = await setup(t, { reduced: true });
  assert.equal(h.loops.length, 0);
  await act(() => h.emit('reduceMotionChanged', false));
  assert.equal(h.loops.length, 1);
  await act(() => h.emit('reduceMotionChanged', true));
  assert.equal(h.loops[0].stopped, true);
});
test('backgrounding stops skeleton animation without hiding the loading layout', async (t) => {
  const h = await setup(t, { reduced: false });
  await act(() => h.emit('change', 'background'));
  assert.equal(h.loops[0].stopped, true);
  assert.equal(h.tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 1);
});
test('loading shapes are not focusable controls and carry a readable busy label', async (t) => {
  const h = await setup(t);
  const group = h.tree.root.findByProps({ accessibilityRole: 'progressbar' });
  assert.equal(group.props.accessible, true);
  assert.equal(group.props.accessibilityLabel, 'Loading match');
  assert.equal(group.props.accessibilityState.busy, true);
  assert.equal(h.tree.root.findAllByType('Pressable').length, 0);
});
test('every resource uses a layout skeleton and cached values win during refresh', async (t) => {
  const h = harness(),
    { Resource } = h.load('src/ui/components.tsx');
  let tree;
  await act(async () => {
    tree = Renderer.create(
      React.createElement(Resource, { title: 'Store', loading: true }, () =>
        React.createElement('Loaded'),
      ),
    );
  });
  t.after(async () => act(() => tree.unmount()));
  assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 1);
  assert.equal(tree.root.findAllByType('Spinner').length, 0);
  await act(() =>
    tree.update(
      React.createElement(
        Resource,
        { title: 'Store', loading: true, section: { status: 'ready', data: {}, fetchedAt: 1 } },
        () => React.createElement('Loaded'),
      ),
    ),
  );
  assert.equal(tree.root.findAllByType('Loaded').length, 1);
  assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 0);
});

test('Android focus-only system dialogs stop and resume the shared skeleton clock', async (t) => {
  const h = await setup(t, { os: 'android', reduced: false });
  await act(() => h.emit('blur'));
  assert.equal(h.loops[0].stopped, true);
  await act(() => h.emit('focus'));
  assert.equal(h.loops.length, 2);
  assert.equal(h.loops[1].started, true);
});
test('late accessibility query cannot undo a newer Reduce Motion setting', async (t) => {
  const h = harness();
  let resolve;
  h.native.AccessibilityInfo.isReduceMotionEnabled = () => new Promise((r) => (resolve = r));
  const { SkeletonProvider, Skeleton } = h.load('src/ui/Skeleton.tsx');
  let tree;
  await act(() => {
    tree = Renderer.create(
      React.createElement(SkeletonProvider, null, React.createElement(Skeleton)),
    );
  });
  t.after(async () => act(() => tree.unmount()));
  await act(() => h.emit('reduceMotionChanged', true));
  await act(() => resolve(false));
  assert.equal(h.loops.length, 0);
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, React, Renderer, act } = require('./loading-harness.cjs');
function setup(t, options = {}) {
  const h = harness(options),
    { useArtworkReadiness } = h.load('src/state/useArtworkReadiness.ts');
  let value, tree;
  function Probe(props) {
    value = useArtworkReadiness(props.id, props.urls);
    return React.createElement('Readiness', value);
  }
  t.after(async () => {
    if (tree) await act(() => tree.unmount());
  });
  return {
    h,
    get value() {
      return value;
    },
    async render(id, urls) {
      await act(() => {
        const element = React.createElement(Probe, { id, urls });
        if (tree) tree.update(element);
        else tree = Renderer.create(element);
      });
    },
  };
}
test('a match stays loading until map, agent and rank images all settle', async (t) => {
  const f = setup(t);
  await f.render('match', ['map', 'agent', 'rank']);
  assert.equal(f.value.ready, false);
  await act(() => f.value.settle('map'));
  assert.equal(f.value.ready, false);
  await act(() => f.value.settle('agent'));
  assert.equal(f.value.ready, false);
  await act(() => f.value.settle('rank'));
  assert.equal(f.value.ready, true);
});
test('missing image URLs do not create phantom loading requirements', async (t) => {
  const f = setup(t);
  await f.render('match', [undefined, '']);
  assert.equal(f.value.ready, true);
});
test('one failed image settles the card with a stable fallback, not an infinite skeleton', async (t) => {
  const f = setup(t);
  await f.render('match', ['map', 'agent']);
  await act(() => {
    f.value.settle('map', true);
    f.value.settle('agent');
  });
  assert.equal(f.value.ready, true);
  assert.equal(f.value.failed.has('map'), true);
});
test('image loading has an eight-second ceiling and late images cannot pop into a released card', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup(t);
  await f.render('match', ['map', 'agent']);
  await act(() => f.value.settle('agent'));
  await act(() => t.mock.timers.tick(7999));
  assert.equal(f.value.ready, false);
  await act(() => t.mock.timers.tick(1));
  assert.equal(f.value.ready, true);
  assert.equal(f.value.failed.has('map'), true);
  await act(() => f.value.settle('map'));
  assert.equal(f.value.failed.has('map'), true);
});
test('changing match or source ignores the previous image callbacks', async (t) => {
  const f = setup(t);
  await f.render('first', ['old']);
  const settleOld = f.value.settle;
  await f.render('second', ['new']);
  await act(() => settleOld('old'));
  assert.equal(f.value.ready, false);
  await act(() => f.value.settle('new'));
  assert.equal(f.value.ready, true);
});
test('same-source rerenders and duplicate events do not restart loading', async (t) => {
  const f = setup(t);
  await f.render('match', ['map', 'map']);
  await act(() => f.value.settle('map'));
  const settled = f.value;
  await f.render('match', ['map', 'map']);
  assert.equal(f.value.ready, true);
  await act(() => f.value.settle('map', true));
  assert.equal(f.value.failed.size, 0);
});
test('image wrapper reports real load completion and ignores callbacks for a recycled image', async (t) => {
  const h = harness(),
    { Image } = h.load('src/ui/CachedImage.tsx');
  let loads = 0,
    errors = 0,
    tree;
  const image = (uri) =>
    React.createElement(Image, { source: { uri }, onLoad: () => loads++, onError: () => errors++ });
  await act(() => {
    tree = Renderer.create(image('first'));
  });
  t.after(async () => act(() => tree.unmount()));
  const old = tree.root.findByType('NativeImage').props;
  await act(() => tree.update(image('second')));
  await act(() => {
    old.onLoad({});
    old.onError({});
  });
  assert.equal(loads, 0);
  assert.equal(errors, 0);
  await act(() => tree.root.findByType('NativeImage').props.onLoad({}));
  assert.equal(loads, 1);
});
test('card content is hidden and not interactive until all mounted images settle', async (t) => {
  const h = harness(),
    { ArtworkBoundary } = h.load('src/ui/ArtworkBoundary.tsx'),
    { Image } = h.load('src/ui/CachedImage.tsx');
  let tree;
  await act(() => {
    tree = Renderer.create(
      React.createElement(
        ArtworkBoundary,
        { identity: 'm', urls: ['map', 'agent'], placeholder: React.createElement('Placeholder') },
        React.createElement(
          'Card',
          null,
          React.createElement(Image, { source: { uri: 'map' } }),
          React.createElement(Image, { source: { uri: 'agent' } }),
        ),
      ),
    );
  });
  t.after(async () => act(() => tree.unmount()));
  assert.equal(tree.root.findAllByType('Placeholder').length, 1);
  await act(() => tree.root.findAllByType('NativeImage')[0].props.onLoad({}));
  assert.equal(tree.root.findAllByType('Placeholder').length, 1);
  await act(() => tree.root.findAllByType('NativeImage')[1].props.onError({}));
  assert.equal(tree.root.findAllByType('Placeholder').length, 0);
  assert.equal(tree.root.findAllByType('NativeImage').length, 1);
});

test('item artwork has a total deadline, then an explicit retry rather than a permanent skeleton', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(),
    { ItemArt } = h.load('src/ui/components.tsx');
  let tree;
  const item = {
    id: 'one',
    canonicalId: 'one',
    kind: 'skin',
    name: 'Test skin',
    image: 'https://media.valorant-api.com/test.png',
  };
  await act(() => {
    tree = Renderer.create(React.createElement(ItemArt, { item }));
  });
  t.after(async () => act(() => tree.unmount()));
  assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 1);
  await act(() => t.mock.timers.tick(8000));
  assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 0);
  const retry = tree.root
    .findAllByType('Pressable')
    .find((n) => n.props.accessibilityLabel === 'Retry artwork for Test skin');
  assert.ok(retry);
  await act(() => retry.props.onPress());
  assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 1);
  await act(() => tree.root.findByType('NativeImage').props.onLoad({}));
  assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 0);
});
test('item without artwork is an unavailable state, not a fake loading task', async (t) => {
  const h = harness(),
    { ItemArt } = h.load('src/ui/components.tsx');
  let tree;
  await act(() => {
    tree = Renderer.create(
      React.createElement(ItemArt, {
        item: { id: 'x', canonicalId: 'x', kind: 'title', name: 'Title' },
      }),
    );
  });
  t.after(async () => act(() => tree.unmount()));
  assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 0);
});
test('failed artwork from a recycled item cannot fail the next item', async (t) => {
  const h = harness(),
    { ItemArt } = h.load('src/ui/components.tsx');
  let tree;
  const item = (n) => ({
    id: n,
    canonicalId: n,
    kind: 'spray',
    name: n,
    image: `https://media.valorant-api.com/${n}.png`,
  });
  await act(() => {
    tree = Renderer.create(React.createElement(ItemArt, { item: item('a') }));
  });
  t.after(async () => act(() => tree.unmount()));
  const old = tree.root.findByType('NativeImage').props;
  await act(() => tree.update(React.createElement(ItemArt, { item: item('b') })));
  await act(() => old.onError({}));
  assert.match(tree.root.findByType('NativeImage').props.source.uri, /b.png$/);
  await act(() => tree.root.findByType('NativeImage').props.onLoad({}));
  assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 0);
});

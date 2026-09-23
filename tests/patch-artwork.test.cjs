const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, React, Renderer, act } = require('./loading-harness.cjs');
const { MATCH, OTHER } = require('./helpers.cjs');
for (const os of ['ios', 'android'])
  test(
    os + ': a slow cover remains mounted and displays after the skeleton deadline',
    async (t) => {
      require('../.test-build/artworkMemory.js').clearArtworkMemory();
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const h = harness({ os }),
        { ArtworkImage } = h.load('src/ui/ArtworkImage.tsx');
      let tree;
      await act(() => {
        tree = Renderer.create(
          React.createElement(ArtworkImage, {
            candidates: ['https://media.valorant-api.com/late.png'],
            label: 'Late cover',
            style: { width: 300, height: 100 },
          }),
        );
      });
      t.after(() => act(() => tree.unmount()));
      assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 1);
      await act(() => t.mock.timers.tick(8000));
      assert.equal(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 0);
      assert.equal(tree.root.findAllByType('NativeImage').length, 1);
      await act(() => tree.root.findByType('NativeImage').props.onLoad({}));
      assert.equal(
        tree.root.findByType('NativeImage').props.source.uri,
        'https://media.valorant-api.com/late.png',
      );
    },
  );
for (const os of ['ios', 'android'])
  test(
    os + ': failed banner tries same-card alternate artwork and offers a local retry',
    async (t) => {
      const h = harness({ os }),
        { ArtworkImage } = h.load('src/ui/ArtworkImage.tsx');
      const urls = [
        'https://media.valorant-api.com/wide.png',
        'https://media.valorant-api.com/full.png',
      ];
      let tree;
      await act(() => {
        tree = Renderer.create(
          React.createElement(ArtworkImage, {
            candidates: urls,
            label: 'Card',
            style: { width: 300, height: 100 },
          }),
        );
      });
      t.after(() => act(() => tree.unmount()));
      const first = tree.root.findByType('NativeImage').props;
      await act(() => first.onError({}));
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, urls[1]);
      await act(() => first.onError({}));
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, urls[1]);
      await act(() => tree.root.findByType('NativeImage').props.onError({}));
      assert.equal(tree.root.findAllByType('NativeImage').length, 0);
      const retry = tree.root
        .findAllByType('Pressable')
        .find((n) => n.props.accessibilityLabel === 'Retry artwork for Card');
      assert.ok(retry);
      await act(() => retry.props.onPress());
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, urls[0]);
    },
  );
for (const os of ['ios', 'android'])
  test(
    os + ': changing account resets the avatar candidate without showing the prior account',
    async (t) => {
      const h = harness({ os }),
        { PlayerAvatar } = h.load('src/ui/PlayerAvatar.tsx');
      let tree;
      const card = (id) => ({ id, canonicalId: id, name: 'Card', kind: 'card' });
      await act(() => {
        tree = Renderer.create(React.createElement(PlayerAvatar, { card: card(MATCH) }));
      });
      t.after(() => act(() => tree.unmount()));
      const old = tree.root.findByType('NativeImage').props;
      await act(() => old.onError({}));
      assert.match(tree.root.findByType('NativeImage').props.source.uri, /smallart/);
      await act(() => tree.update(React.createElement(PlayerAvatar, { card: card(OTHER) })));
      const expected = `https://media.valorant-api.com/playercards/${OTHER}/displayicon.png`;
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, expected);
      await act(() => old.onError({}));
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, expected);
    },
  );
test('late accessory artwork replaces the retry overlay without requiring another fetch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(),
    { ItemArt } = h.load('src/ui/components.tsx');
  let tree;
  await act(() => {
    tree = Renderer.create(
      React.createElement(ItemArt, {
        item: {
          id: MATCH,
          canonicalId: MATCH,
          kind: 'card',
          name: 'Accessory',
          image: 'https://media.valorant-api.com/accessory.png',
        },
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const initial = tree.root.findByType('NativeImage').props;
  await act(() => t.mock.timers.tick(8000));
  assert.equal(tree.root.findAllByType('NativeImage').length, 1);
  assert.ok(
    tree.root
      .findAllByType('Pressable')
      .some((n) => n.props.accessibilityLabel === 'Retry artwork for Accessory'),
  );
  await act(() => initial.onLoad({}));
  assert.equal(
    tree.root
      .findAllByType('Pressable')
      .filter((n) => n.props.accessibilityLabel === 'Retry artwork for Accessory').length,
    0,
  );
});

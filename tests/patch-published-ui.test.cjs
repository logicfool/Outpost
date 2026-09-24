const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, React, Renderer, act } = require('./loading-harness.cjs');
const { buildCatalog } = require('../.test-build/catalog.js');
const f = require('./patch-published-fixture.cjs');
for (const os of ['ios', 'android']) {
  test(
    os + ': failed avatar retries the same URL after metadata publication, not mere version probes',
    async (t) => {
      const h = harness({ os }),
        { PlayerAvatar } = h.load('src/ui/PlayerAvatar.tsx');
      const catalog = { ...buildCatalog(f.responses), metadataUpdatedAt: 10 };
      const props = { card: catalog.items[f.CARD], catalog };
      let tree;
      await act(() => {
        tree = Renderer.create(React.createElement(PlayerAvatar, props));
      });
      t.after(() => act(() => tree.unmount()));
      const first = tree.root.findByType('NativeImage').props;
      await act(() => first.onError({}));
      await act(() => tree.root.findByType('NativeImage').props.onError({}));
      const fallback = tree.root.findByType('NativeImage').props.source.uri;
      assert.notEqual(fallback, first.source.uri);
      await act(() =>
        tree.update(
          React.createElement(PlayerAvatar, {
            ...props,
            catalog: { ...catalog, versionCheckedAt: 20 },
          }),
        ),
      );
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, fallback);
      await act(() =>
        tree.update(
          React.createElement(PlayerAvatar, {
            ...props,
            catalog: { ...catalog, metadataUpdatedAt: 30 },
          }),
        ),
      );
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, first.source.uri);
      await act(() => first.onError({}));
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, first.source.uri);
    },
  );
}
for (const os of ['ios', 'android'])
  for (const kind of ['banner', 'item']) {
    test(`${os}: failed ${kind} remounts after a metadata refresh even when its URL is unchanged`, async (t) => {
      const h = harness({ os });
      const { ArtworkRevisionProvider } = h.load('src/ui/ArtworkRevision.tsx');
      const Component =
        kind === 'banner'
          ? h.load('src/ui/ArtworkImage.tsx').ArtworkImage
          : h.load('src/ui/components.tsx').ItemArt;
      const uri = f.responses.playercards.data[0].wideArt;
      const props =
        kind === 'banner'
          ? { candidates: [uri], label: 'Card', style: { height: 90 } }
          : { item: { id: f.CARD, canonicalId: f.CARD, kind: 'card', name: 'Card', image: uri } };
      const render = (at) =>
        React.createElement(
          ArtworkRevisionProvider,
          { catalog: { ...buildCatalog({}), metadataUpdatedAt: at } },
          React.createElement(Component, props),
        );
      let tree;
      await act(() => {
        tree = Renderer.create(render(10));
      });
      t.after(() => act(() => tree.unmount()));
      const old = tree.root.findByType('NativeImage').props;
      await act(() => old.onError({}));
      assert.equal(tree.root.findAllByType('NativeImage').length, 0);
      await act(() => tree.update(render(20)));
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, uri);
      await act(() => old.onError({}));
      assert.equal(tree.root.findByType('NativeImage').props.source.uri, uri);
    });
  }
for (const os of ['ios', 'android']) {
  test(
    os + ': game-data refresh stays independent of account writes and reports pending work',
    async (t) => {
      const h = harness({ os }),
        { GameDataPanel } = h.load('src/ui/GameDataPanel.tsx');
      let release,
        calls = 0;
      const wait = new Promise((r) => {
        release = r;
      });
      const model = {
        active: { puuid: 'own', demo: false },
        catalog: { ...buildCatalog(f.responses), sourceVersion: f.version },
        refreshCatalog: async () => {
          calls++;
          await wait;
          return { failedPaths: [] };
        },
        refresh: () => {
          throw Error('must not refresh Riot account');
        },
      };
      let tree;
      await act(() => {
        tree = Renderer.create(React.createElement(GameDataPanel, { model }));
      });
      t.after(() => act(() => tree.unmount()));
      const button = () => tree.root.findByType('Pressable');
      assert.match(JSON.stringify(tree.toJSON()), /Patch 13.06/);
      await act(() => {
        button().props.onPress();
      });
      assert.equal(button().props.disabled, true);
      assert.match(JSON.stringify(tree.toJSON()), /Refreshing game data/);
      await act(() => {
        release();
      });
      assert.equal(button().props.disabled, false);
      assert.equal(calls, 1);
      assert.match(JSON.stringify(tree.toJSON()), /Account and store timers are unchanged/);
    },
  );
}
test('game-data panel reports partial updates, cooldowns and demo restrictions without a success claim', async (t) => {
  const h = harness(),
    { GameDataPanel } = h.load('src/ui/GameDataPanel.tsx');
  const { AppError } = require('../.test-build/validation.js');
  const model = {
    active: { puuid: 'own' },
    catalog: buildCatalog(f.responses),
    refreshCatalog: async () => ({ failedPaths: ['playercards'] }),
  };
  let tree;
  await act(() => {
    tree = Renderer.create(React.createElement(GameDataPanel, { model }));
  });
  t.after(() => act(() => tree.unmount()));
  await act(() => tree.root.findByType('Pressable').props.onPress());
  assert.match(JSON.stringify(tree.toJSON()), /Saved data is retained/);
  model.refreshCatalog = async () => {
    throw new AppError('CATALOG_COOLDOWN', 'Wait before retrying');
  };
  await act(() => tree.update(React.createElement(GameDataPanel, { model: { ...model } })));
  await act(() => tree.root.findByType('Pressable').props.onPress());
  assert.match(JSON.stringify(tree.toJSON()), /Wait before retrying/);
  await act(() =>
    tree.update(
      React.createElement(GameDataPanel, {
        model: { ...model, active: { puuid: 'demo', demo: true } },
      }),
    ),
  );
  assert.equal(tree.root.findByType('Pressable').props.disabled, true);
});

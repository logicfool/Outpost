const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, deferred, settle, React, Renderer, act } = require('./loading-harness.cjs');
const { ID } = require('./helpers.cjs');
const card = (n) => ({
  id: String(n),
  canonicalId: String(n),
  kind: 'card',
  name: 'Card ' + n,
  wideArt: 'https://media.valorant-api.com/' + n + '.png',
});
async function setup(t, cached = false) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(),
    { IdentityPanel } = h.load('src/ui/IdentityPanel.tsx');
  const request = deferred(),
    old = { version: 1, card: card(1), guns: [] };
  let calls = 0,
    backs = 0,
    saved,
    tree;
  const model = {
    active: { puuid: ID, gameName: 'Test', tagLine: 'TEST', demo: true },
    busy: false,
    catalog: { items: { '1': card(1), '2': card(2) } },
    snapshot: {
      loadout: cached ? { status: 'ready', data: old } : { status: 'error', code: 'NOT_LOADED' },
      collection: { status: 'ready', data: [card(1), card(2)] },
    },
    freshLoadout: () => {
      calls++;
      return request.promise;
    },
    saveIdentity: async (edit) => {
      saved = edit;
      return { ...old, version: 3, card: card(2) };
    },
  };
  await act(() => {
    tree = Renderer.create(React.createElement(IdentityPanel, { model, onBack: () => backs++ }));
  });
  t.after(async () => act(() => tree.unmount()));
  const button = (label) =>
    tree.root.findAllByType('Pressable').find((n) => n.props.accessibilityLabel === label);
  return {
    tree,
    model,
    request,
    old,
    button,
    get calls() {
      return calls;
    },
    get backs() {
      return backs;
    },
    get saved() {
      return saved;
    },
    async tick(ms) {
      await act(async () => {
        t.mock.timers.tick(ms);
        await settle();
      });
    },
  };
}
test('cold identity navigation mounts the destination and skeleton before starting any read', async (t) => {
  const f = await setup(t);
  assert.ok(f.button('Back from identity editor'));
  assert.equal(f.calls, 0);
  assert.ok(f.tree.root.findAllByProps({ testID: 'identity-skeleton' }).length);
  await f.tick(0);
  assert.equal(f.calls, 1);
});
test('a ten-second identity read stays visibly loading and can be closed', async (t) => {
  const f = await setup(t);
  await f.tick(10000);
  assert.equal(f.calls, 1);
  assert.ok(f.tree.root.findAllByProps({ testID: 'identity-skeleton' }).length);
  await act(() => f.button('Back from identity editor').props.onPress());
  assert.equal(f.backs, 1);
});
test('cached banner stays visible while fresh loadout is being checked', async (t) => {
  const f = await setup(t, true);
  assert.equal(f.tree.root.findByType('Cover').props.player.card.id, '1');
  assert.equal(f.tree.root.findAllByProps({ testID: 'identity-skeleton' }).length, 0);
  await f.tick(0);
  assert.equal(f.button('Apply to demo').props.disabled, true);
});
test('selecting a cached card survives the background read and uses its verified version', async (t) => {
  const f = await setup(t, true);
  await f.tick(0);
  await act(() => f.button('Select Card 2').props.onPress());
  await act(() => f.request.resolve({ ...f.old, version: 2 }));
  assert.equal(f.tree.root.findByType('Cover').props.player.card.id, '2');
  assert.equal(f.button('Apply to demo').props.disabled, false);
  await act(async () => {
    f.button('Apply to demo').props.onPress();
    await settle();
  });
  assert.equal(f.saved.cardId, '2');
  assert.equal(f.saved.expectedVersion, 2);
  assert.equal(f.saved.expectedCardId, '1');
});
test('failed identity read becomes a retry state instead of an endless skeleton', async (t) => {
  const f = await setup(t);
  await f.tick(0);
  await act(() => f.request.reject(Error('offline')));
  assert.equal(f.tree.root.findAllByProps({ testID: 'identity-skeleton' }).length, 0);
  assert.ok(f.button('Retry identity'));
});

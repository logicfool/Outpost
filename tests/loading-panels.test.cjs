const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, deferred, settle, React, Renderer, act } = require('./loading-harness.cjs');
const { ID } = require('./helpers.cjs');
const button = (tree, label) =>
  tree.root.findAllByType('Pressable').find((n) => n.props.accessibilityLabel === label);
test('cancelling a slow preset read preserves the independently loading preset directory', async (t) => {
  const h = harness(),
    { PresetsPanel } = h.load('src/ui/PresetsPanel.tsx'),
    directory = deferred(),
    editor = deferred();
  let tree,
    reads = 0,
    backs = 0;
  const model = {
    active: { puuid: ID },
    catalog: { items: {} },
    listPresets: () => directory.promise,
    editLoadout: () => {
      reads++;
      return editor.promise;
    },
  };
  await act(() => {
    tree = Renderer.create(React.createElement(PresetsPanel, { model, onBack: () => backs++ }));
  });
  t.after(async () => act(() => tree.unmount()));
  await act(() => button(tree, 'Create loadout').props.onPress());
  assert.equal(reads, 1);
  assert.ok(button(tree, 'Cancel preset editing'));
  await act(() => button(tree, 'Cancel preset editing').props.onPress());
  await act(() => directory.resolve([{ id: 'p', name: 'Existing', weapons: [] }]));
  assert.ok(button(tree, 'Edit Existing'));
  await act(() => editor.resolve({ current: [], ownedLevels: [], ownedChromas: [] }));
  assert.equal(tree.root.findAllByType('TextInput').length, 0);
  assert.ok(button(tree, 'Back from loadouts'));
  await act(() => button(tree, 'Back from loadouts').props.onPress());
  assert.equal(backs, 1);
});
test('live cosmetics first load is a skeleton and a failed refresh preserves known weapons', async (t) => {
  const h = harness({ overrides: { './MatchVisuals': { AgentPortrait: 'Agent' } } }),
    { LiveEquipmentPanel } = h.load('src/ui/LiveEquipmentPanel.tsx');
  const first = deferred(),
    next = deferred();
  let tree,
    calls = 0;
  const model = {
    active: { puuid: ID },
    catalog: { items: {} },
    snapshot: {
      liveGame: {
        status: 'ready',
        data: { matchId: 'm', players: [{ subject: ID, name: 'You' }] },
      },
    },
    liveEquipment: () => (++calls === 1 ? first.promise : next.promise),
  };
  await act(() => {
    tree = Renderer.create(
      React.createElement(LiveEquipmentPanel, { model, matchId: 'm', onBack() {} }),
    );
  });
  t.after(async () => act(() => tree.unmount()));
  assert.ok(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length);
  await act(() =>
    first.resolve({
      status: 'ready',
      fetchedAt: 1,
      data: {
        matchId: 'm',
        observedAt: 1,
        players: [{ subject: ID, weapons: [{ weaponId: 'w', weapon: 'Vandal' }] }],
      },
    }),
  );
  assert.equal(tree.root.findByType('List').props.data.length, 1);
  await act(() => tree.root.findByType('List').props.refreshControl.props.onRefresh());
  await act(() => next.resolve({ status: 'error', code: 'NETWORK', message: 'Offline' }));
  assert.equal(tree.root.findByType('List').props.data[0].weapon, 'Vandal');
  assert.equal(calls, 2);
});

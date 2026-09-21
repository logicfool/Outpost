const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, deferred, settle, React, Renderer, act } = require('./loading-harness.cjs');
const { LiveMatchMemory } = require('../.test-build/livePresentation.js');
const { ID, OTHER, MATCH, SKIN, catalog } = require('./helpers.cjs');
const renderedText = (tree) =>
  tree.root
    .findAllByType('Text')
    .flatMap((node) =>
      node.children.filter((child) => typeof child === 'string' || typeof child === 'number'),
    )
    .join(' ');
const h = () =>
  harness({
    overrides: {
      '../state/useLivePolling': {
        useLivePolling: () => ({ refreshing: false, busy: false, refresh() {} }),
      },
    },
  });
function fixture() {
  let calls = 0,
    rankCalls = 0;
  const self = { subject: ID, self: true, teamId: 'Blue', name: 'You' },
    peer = {
      subject: OTHER,
      self: false,
      teamId: 'Red',
      name: 'Other',
      tag: 'TEST',
      tier: 9,
      tierName: 'Silver 1',
      agent: 'Sage',
    };
  const game = { state: 'in_game', matchId: MATCH, players: [self, peer] };
  const model = {
    active: { puuid: ID },
    catalog: catalog(),
    chat: { status: 'ready', friends: [peer] },
    snapshot: { liveGame: { status: 'ready', data: game } },
    playerRank: async () => {
      rankCalls++;
      return { tier: 0, name: 'Unranked', currentSeason: false, career: [] };
    },
    liveEquipment: async () => {
      calls++;
      return {
        status: 'ready',
        fetchedAt: Date.now(),
        data: {
          matchId: MATCH,
          observedAt: Date.now(),
          players: [{ subject: OTHER, weapons: [{ weaponId: SKIN, weapon: 'Vandal' }] }],
        },
      };
    },
  };
  const view = new LiveMatchMemory().forMatch(ID, MATCH);
  return {
    model,
    view,
    game,
    peer,
    get calls() {
      return calls;
    },
    get rankCalls() {
      return rankCalls;
    },
  };
}
for (const platform of ['android', 'ios'])
  test(
    platform +
      ': live player shows observed rank and inline equipment without historical profile requests',
    async (t) => {
      const f = fixture(),
        helper = harness({
          os: platform,
          overrides: {
            '../state/useLivePolling': {
              useLivePolling: () => ({ refreshing: false, busy: false, refresh() {} }),
            },
          },
        });
      const { LivePlayerPanel } = helper.load('src/ui/LivePlayerPanel.tsx');
      let tree;
      await act(async () => {
        tree = Renderer.create(
          React.createElement(LivePlayerPanel, {
            ...f,
            matchId: MATCH,
            subject: OTHER,
            onBack() {},
            onNavigate() {},
          }),
        );
        await settle();
      });
      t.after(() => act(() => tree.unmount()));
      assert.equal(tree.root.findByType('List').props.data[0].weapon, 'Vandal');
      assert.equal(f.calls, 1);
      assert.equal(f.rankCalls, 1);
      assert.equal(
        tree.root.findByProps({ testID: 'live-player-rank' }).props.children,
        'Silver 1',
      );
      assert.ok(
        tree.root
          .findAllByType('Pressable')
          .some((p) => p.props.accessibilityLabel === 'View full player profile'),
      );
    },
  );
test('opening another player reuses shared cosmetics without choosing a different player on missing data', async (t) => {
  const f = fixture(),
    { LivePlayerPanel } = h().load('src/ui/LivePlayerPanel.tsx');
  let tree;
  await act(async () => {
    tree = Renderer.create(
      React.createElement(LivePlayerPanel, {
        ...f,
        matchId: MATCH,
        subject: OTHER,
        onBack() {},
        onNavigate() {},
      }),
    );
    await settle();
  });
  await act(() => tree.unmount());
  await act(async () => {
    tree = Renderer.create(
      React.createElement(LivePlayerPanel, {
        ...f,
        matchId: MATCH,
        subject: ID,
        onBack() {},
        onNavigate() {},
      }),
    );
    await settle();
  });
  t.after(() => act(() => tree.unmount()));
  assert.equal(f.calls, 1);
  assert.equal(tree.root.findByType('List').props.data.length, 0);
  assert.ok(renderedText(tree).includes('Loadout not reported'));
});
test('stale player route cannot show the next matches loadout', async (t) => {
  const f = fixture(),
    { LivePlayerPanel } = h().load('src/ui/LivePlayerPanel.tsx');
  f.model.snapshot.liveGame.data = { ...f.game, matchId: SKIN };
  let tree;
  await act(async () => {
    tree = Renderer.create(
      React.createElement(LivePlayerPanel, {
        ...f,
        matchId: MATCH,
        subject: OTHER,
        onBack() {},
        onNavigate() {},
      }),
    );
    await settle();
  });
  t.after(() => act(() => tree.unmount()));
  assert.equal(f.calls, 0);
  assert.equal(f.rankCalls, 0);
  assert.equal(tree.root.findByType('List').props.data.length, 0);
  assert.ok(renderedText(tree).includes('This match is no longer current'));
});
test('hidden current-roster player never gains a selectable profile or equipment list', async (t) => {
  const f = fixture(),
    { LivePlayerPanel } = h().load('src/ui/LivePlayerPanel.tsx');
  f.peer.hidden = true;
  let tree;
  await act(async () => {
    tree = Renderer.create(
      React.createElement(LivePlayerPanel, {
        ...f,
        matchId: MATCH,
        subject: OTHER,
        onBack() {},
        onNavigate() {},
      }),
    );
    await settle();
  });
  t.after(() => act(() => tree.unmount()));
  assert.equal(f.rankCalls, 0);
  assert.equal(tree.root.findByType('List').props.data.length, 0);
  assert.ok(renderedText(tree).includes('Player unavailable'));
});

test('the match-wide loadout selector keeps the selected participant across subpage navigation', async (t) => {
  const f = fixture(),
    { LivePlayerPanel } = h().load('src/ui/LivePlayerPanel.tsx');
  let tree;
  const props = { ...f, matchId: MATCH, allowSwitch: true, onBack() {}, onNavigate() {} };
  await act(async () => {
    tree = Renderer.create(React.createElement(LivePlayerPanel, props));
    await settle();
  });
  const selector = tree.root
    .findAllByType('Pressable')
    .find(
      (node) =>
        node.props.accessibilityRole === 'tab' &&
        node.findAllByType('Text').some((text) => text.props.children === 'Other'),
    );
  assert.ok(selector);
  await act(async () => {
    selector.props.onPress();
    await settle();
  });
  assert.equal(f.view.loadoutSubject, OTHER);
  assert.equal(tree.root.findByType('List').props.data[0].weapon, 'Vandal');
  await act(() => tree.unmount());
  await act(async () => {
    tree = Renderer.create(React.createElement(LivePlayerPanel, props));
    await settle();
  });
  t.after(() => act(() => tree.unmount()));
  assert.equal(tree.root.findByProps({ testID: 'live-player-rank' }).props.children, 'Silver 1');
  assert.equal(tree.root.findByType('List').props.data[0].weapon, 'Vandal');
  assert.equal(f.calls, 1);
});

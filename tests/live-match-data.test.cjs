const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, React, Renderer, act, deferred } = require('./loading-harness.cjs');
const { LiveMatchMemory } = require('../.test-build/livePresentation.js');
const { ID, OTHER, MATCH, catalog } = require('./helpers.cjs');
const { AppError } = require('../.test-build/validation.js');
const flush = () => new Promise((r) => setImmediate(r));
const base = () => ({
  active: { puuid: ID },
  catalog: catalog(),
  chat: { status: 'ready', friends: [] },
  snapshot: {
    liveGame: {
      status: 'ready',
      data: {
        state: 'in_game',
        matchId: MATCH,
        mapId: 'Ascent',
        players: [{ subject: ID, self: true, teamId: 'Blue' }],
      },
    },
  },
});
test('cached score is last-reported after disconnect even with a fresh round counter', async (t) => {
  const h = harness(),
    hooks = h.load('src/state/useLiveMatchData.ts'),
    view = new LiveMatchMemory().forMatch(ID, MATCH);
  let model = base(),
    result,
    tree;
  model.chat.selfPresence = {
    subject: ID,
    presence: 'in_game',
    mapId: 'ascent',
    progress: { allyScore: 10, enemyScore: 12, source: 'self-presence', observedAt: Date.now() },
  };
  function Probe() {
    result = hooks.useLiveScore(model, view);
    return null;
  }
  await act(() => {
    tree = Renderer.create(React.createElement(Probe));
  });
  t.after(() => act(() => tree.unmount()));
  assert.equal(result.live, true);
  const original = result.progress.observedAt;
  model = {
    ...model,
    chat: { status: 'disconnected', friends: [] },
    snapshot: {
      liveGame: {
        status: 'ready',
        data: {
          ...model.snapshot.liveGame.data,
          progress: { roundNumber: 23, source: 'match', observedAt: Date.now() },
        },
      },
    },
  };
  await act(() => tree.update(React.createElement(Probe)));
  assert.equal(result.live, false);
  assert.equal(result.progress.allyScore, 10);
  assert.equal(result.progress.observedAt, original);
});
test('match loadouts are reused when navigating between participants', async (t) => {
  const h = harness(),
    hooks = h.load('src/state/useLiveMatchData.ts'),
    view = new LiveMatchMemory().forMatch(ID, MATCH);
  let calls = 0,
    tree,
    result;
  const model = {
    ...base(),
    liveEquipment: async () => {
      calls++;
      return {
        status: 'ready',
        fetchedAt: Date.now(),
        data: { matchId: MATCH, observedAt: Date.now(), players: [] },
      };
    },
  };
  function Probe() {
    result = hooks.useLiveLoadout(model, MATCH, view);
    return null;
  }
  await act(async () => {
    tree = Renderer.create(React.createElement(Probe));
    await flush();
  });
  assert.equal(calls, 1);
  await act(() => tree.unmount());
  await act(async () => {
    tree = Renderer.create(React.createElement(Probe));
    await flush();
  });
  t.after(() => act(() => tree.unmount()));
  assert.equal(calls, 1);
  assert.equal(result.data.status, 'ready');
});
test('rank rate limits stop further player requests and are retained across navigation', async (t) => {
  const h = harness(),
    hooks = h.load('src/state/useLiveMatchData.ts'),
    view = new LiveMatchMemory().forMatch(ID, MATCH);
  let calls = 0,
    tree;
  const model = {
    ...base(),
    playerRank: async () => {
      calls++;
      throw new AppError('RATE_LIMIT', 'Wait', Date.now() + 180000, 429);
    },
  };
  const players = [
    { subject: ID, name: 'You' },
    { subject: OTHER, name: 'Teammate' },
  ];
  function Probe() {
    hooks.useLiveRanks(model, players, view, true);
    return null;
  }
  await act(async () => {
    tree = Renderer.create(React.createElement(Probe));
    await flush();
  });
  assert.equal(calls, 1);
  await act(() => tree.unmount());
  await act(async () => {
    tree = Renderer.create(React.createElement(Probe));
    await flush();
  });
  t.after(() => act(() => tree.unmount()));
  assert.equal(calls, 1);
});
test('changing account while cosmetics load prevents their delayed publication', async (t) => {
  const h = harness(),
    hooks = h.load('src/state/useLiveMatchData.ts'),
    view = new LiveMatchMemory().forMatch(ID, MATCH),
    wait = deferred();
  let result,
    tree,
    model = { ...base(), liveEquipment: () => wait.promise };
  function Probe() {
    result = hooks.useLiveLoadout(model, MATCH, view);
    return null;
  }
  await act(() => {
    tree = Renderer.create(React.createElement(Probe));
  });
  t.after(() => act(() => tree.unmount()));
  model = { ...model, active: { puuid: OTHER } };
  await act(() => tree.update(React.createElement(Probe)));
  await act(() =>
    wait.resolve({
      status: 'ready',
      fetchedAt: Date.now(),
      data: { matchId: MATCH, players: [{ subject: ID, weapons: [] }] },
    }),
  );
  assert.equal(result.data, undefined);
  assert.equal(view.equipment, undefined);
});

for (const os of ['android', 'ios'])
  test(`${os}: replacing the account view cannot publish the previous account's loadout`, async (t) => {
    const h = harness({ os }),
      hooks = h.load('src/state/useLiveMatchData.ts');
    const memory = new LiveMatchMemory(),
      wait = deferred();
    let view = memory.forMatch(ID, MATCH),
      result,
      tree,
      seen = [];
    let model = {
      ...base(),
      liveEquipment: async () => ({
        status: 'ready',
        fetchedAt: Date.now(),
        data: { matchId: MATCH, observedAt: Date.now(), players: [{ subject: ID, weapons: [] }] },
      }),
    };
    function Probe() {
      result = hooks.useLiveLoadout(model, MATCH, view);
      seen.push(result.data);
      return null;
    }
    await act(async () => {
      tree = Renderer.create(React.createElement(Probe));
      await flush();
    });
    t.after(() => act(() => tree.unmount()));
    assert.equal(result.data.data.players[0].subject, ID);
    view = memory.forMatch(OTHER, MATCH);
    model = { ...base(), active: { puuid: OTHER }, liveEquipment: () => wait.promise };
    model.snapshot.liveGame.data.players = [{ subject: OTHER, self: true, teamId: 'Blue' }];
    seen = [];
    await act(() => tree.update(React.createElement(Probe)));
    assert.ok(
      seen.every((value) => value === undefined),
      'Old equipment must not appear even for one render',
    );
    await act(() =>
      wait.resolve({
        status: 'ready',
        fetchedAt: Date.now(),
        data: {
          matchId: MATCH,
          observedAt: Date.now(),
          players: [{ subject: OTHER, weapons: [] }],
        },
      }),
    );
    assert.equal(result.data.data.players[0].subject, OTHER);
  });

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
const { ID, OTHER, catalog } = require('./helpers.cjs');
const { normalizeLive } = require('../.test-build/live.js');
const { normalizeLiveStats, freshLiveStats } = require('../.test-build/liveStats.js');
const MATCH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const stats = () => ({
  kills: 0,
  deaths: 2,
  assists: 3,
  observedAt: Date.now(),
  source: 'current-match',
});
const game = () => ({
  state: 'in_game',
  matchId: MATCH,
  map: 'Abyss',
  players: [
    { subject: ID, self: true, teamId: 'Blue', name: 'Self', tag: 'T', agent: 'Jett', level: 50 },
    {
      subject: OTHER,
      self: false,
      teamId: 'Red',
      name: 'Opponent',
      tag: 'T',
      agent: 'Sage',
      level: 40,
    },
  ],
});
test('an empty optional Stats object cannot mask a complete MatchStats record', () => {
  assert.equal(
    normalizeLiveStats({ Stats: {}, MatchStats: { Kills: 2, Deaths: 1, Assists: 0 } }, true).kills,
    2,
  );
});
test('duplicate team roster entries preserve explicitly returned KDA within the same response', () => {
  const raw = {
    MatchID: MATCH,
    MapID: 'Abyss',
    Players: [{ Subject: ID, TeamID: 'Blue', Stats: { Kills: 6, Deaths: 4, Assists: 8 } }],
    Teams: [{ TeamID: 'Blue', Players: [{ Subject: ID, PlayerIdentity: { Subject: ID } }] }],
  };
  assert.equal(normalizeLive(raw, 'in_game', MATCH, ID, catalog()).players[0].stats.kills, 6);
  const next = { ...raw, Players: [] };
  assert.equal(normalizeLive(next, 'in_game', MATCH, ID, catalog()).players[0].stats, undefined);
});
test('invalid, partial, historical and stale counters do not become live KDA', () => {
  assert.equal(normalizeLiveStats({ Stats: { Kills: 4, Deaths: 0 } }, true), undefined);
  assert.equal(normalizeLiveStats({ SeasonalBadgeInfo: { NumberOfWins: 22 } }, true), undefined);
  assert.equal(freshLiveStats({ ...stats(), observedAt: Date.now() - 180001 }), undefined);
  assert.equal(freshLiveStats({ ...stats(), kills: -1 }), undefined);
  assert.equal(freshLiveStats({ ...stats(), source: 'history' }), undefined);
});
function components(platform) {
  const load = (n) =>
    n === 'react'
      ? React
      : n === 'react/jsx-runtime'
        ? require(n)
        : n === 'react-native'
          ? { Text: 'Text', View: 'View', Pressable: 'Pressable', Platform: { OS: platform } }
          : n === '@expo/vector-icons'
            ? { Feather: 'Icon' }
            : n === 'expo-linear-gradient'
              ? { LinearGradient: 'Gradient' }
              : n === './CachedImage'
                ? { Image: 'Image' }
                : n === './Skeleton'
                  ? { Bone: 'Bone', SkeletonGroup: 'Skeleton' }
                  : n === './theme'
                    ? {
                        useTheme: () => ({
                          C: {
                            ink: '#FFFFFF',
                            surface: '#121212',
                            border: '#333333',
                            raised: '#191919',
                            mint: '#99EEDD',
                            accent: '#FF6677',
                            subtle: '#999999',
                            muted: '#BBBBBB',
                          },
                          S: { small: {}, h3: {} },
                        }),
                      }
                    : n.startsWith('../core/')
                      ? require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'))
                      : (() => {
                          throw Error(n);
                        })();
  const m = { exports: {} },
    code = ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '../src/ui/LiveMatchView.tsx'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(load, m, m.exports);
  return m.exports;
}
for (const platform of ['android', 'ios'])
  test(
    platform + ': unavailable live statistics do not produce repeated empty KDA rows',
    async () => {
      const { LiveRoster, LiveMatchHero } = components(platform);
      let tree;
      await act(async () => {
        tree = Renderer.create(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(LiveMatchHero, { game: game() }),
            React.createElement(LiveRoster, { game: game(), ownId: ID, onPlayer() {} }),
          ),
        );
      });
      assert.equal(tree.root.findAll((n) => n.props?.testID === 'live-kda-value').length, 0);
      assert.equal(
        tree.root.findAll((n) => n.props?.testID === 'live-stats-unavailable').length,
        1,
      );
      assert.ok(!JSON.stringify(tree.toJSON()).includes('K/D/A -'));
      assert.equal(
        tree.root.findAll((n) => n.props?.accessibilityLabel === 'Kills deaths assists columns')
          .length,
        0,
      );
      await act(async () => tree.unmount());
    },
  );
test('reported zero kills render in aligned columns while missing peers stay explicitly unavailable', async () => {
  const { LiveRoster } = components('android'),
    g = game();
  g.players[0].stats = stats();
  let tree;
  await act(async () => {
    tree = Renderer.create(React.createElement(LiveRoster, { game: g, ownId: ID, onPlayer() {} }));
  });
  assert.equal(tree.root.findAll((n) => n.props?.testID === 'live-kda-value').length, 1);
  assert.equal(
    tree.root.findAll((n) => n.props?.accessibilityLabel === 'Live kills 0, deaths 2, assists 3')
      .length,
    1,
  );
  await act(async () => tree.unmount());
});
test('agent selection suppresses all combat stats and hidden identities cannot open profiles', async () => {
  const { LiveRoster } = components('android'),
    g = game();
  g.state = 'agent_select';
  g.players[0].stats = stats();
  g.players[1].hidden = true;
  let tree;
  await act(async () => {
    tree = Renderer.create(React.createElement(LiveRoster, { game: g, ownId: ID, onPlayer() {} }));
  });
  assert.equal(tree.root.findAll((n) => n.props?.testID === 'live-kda-value').length, 0);
  await act(() =>
    tree.root
      .findByProps({ accessibilityLabel: 'Opponents', accessibilityRole: 'tab' })
      .props.onPress(),
  );
  assert.equal(tree.root.findByProps({ testID: 'live-player-' + OTHER }).props.disabled, true);
  await act(async () => tree.unmount());
});

test('team tabs expose their selected state to web and native accessibility', async (t) => {
  const { LiveRoster } = components('android');
  let tree;
  await act(() => {
    tree = Renderer.create(
      React.createElement(LiveRoster, { game: game(), ownId: ID, onPlayer() {} }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const tab = (label) =>
    tree.root.findByProps({ accessibilityLabel: label, accessibilityRole: 'tab' });
  assert.equal(tab('Your team').props['aria-selected'], true);
  assert.equal(tab('Your team').props.accessibilityState.selected, true);
  assert.equal(tab('Opponents').props['aria-selected'], false);
  await act(() => tab('Opponents').props.onPress());
  assert.equal(tab('Your team').props['aria-selected'], false);
  assert.equal(tab('Opponents').props['aria-selected'], true);
  assert.equal(tab('Opponents').props.accessibilityState.selected, true);
});

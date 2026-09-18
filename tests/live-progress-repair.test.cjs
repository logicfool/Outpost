const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const {
  ownLiveProgress,
  progressLabel,
  presenceProgress,
  matchProgress,
} = require('../.test-build/liveProgress.js');
const { normalizeLiveStats } = require('../.test-build/liveStats.js');
const { ID, OTHER } = require('./helpers.cjs');
const M = '00000000-0000-4000-8000-000000000011',
  NEXT = '00000000-0000-4000-8000-000000000012',
  NOW = 1000000;
const game = () => ({
  state: 'in_game',
  matchId: M,
  mapId: 'Split',
  players: [
    { subject: ID, self: true, teamId: 'Blue' },
    { subject: OTHER, self: false, teamId: 'Blue' },
  ],
});
const presence = () => ({
  subject: ID,
  presence: 'in_game',
  mapId: 'Split',
  queue: 'competitive',
  progress: {
    allyScore: 7,
    enemyScore: 4,
    roundNumber: 12,
    source: 'friend-presence',
    observedAt: NOW,
  },
});
test('self presence supplies progress when current-game response does not include QueueID', () => {
  const value = ownLiveProgress(game(), presence(), true, NOW);
  assert.equal(value.allyScore, 7);
  assert.equal(value.source, 'self-presence');
});
test('a new presence score wins over an older current-game score', () => {
  const g = game();
  g.progress = { allyScore: 6, enemyScore: 4, source: 'match', observedAt: NOW - 50000 };
  assert.equal(ownLiveProgress(g, presence(), true, NOW).allyScore, 7);
});
test('same-match teammate can supply team score but not an opponent or unrelated friend', () => {
  const f = { ...presence(), subject: OTHER, matchId: M };
  assert.equal(ownLiveProgress(game(), undefined, true, NOW, [f]).source, 'teammate-presence');
  for (const change of [
    { matchId: NEXT },
    { matchId: undefined },
    { presence: 'online' },
    { subject: 'unknown' },
  ])
    assert.equal(ownLiveProgress(game(), undefined, true, NOW, [{ ...f, ...change }]), undefined);
  const g = game();
  g.players[1].teamId = 'Red';
  assert.equal(ownLiveProgress(g, undefined, true, NOW, [f]), undefined);
});
test('stale, wrong-account, conflicting-match and disconnected presence cannot masquerade as live data', () => {
  for (const p of [
    { ...presence(), subject: OTHER },
    { ...presence(), matchId: NEXT },
    { ...presence(), progress: { ...presence().progress, observedAt: NOW - 180001 } },
    { ...presence(), matchId: M, progress: { ...presence().progress, matchId: NEXT } },
  ])
    assert.equal(ownLiveProgress(game(), p, true, NOW), undefined);
  assert.equal(ownLiveProgress(game(), presence(), false, NOW), undefined);
  assert.equal(progressLabel({ ...presence().progress, observedAt: NOW + 60001 }, NOW), undefined);
});
test('Version counters, badge wins and missing fields never become a round or kill count', () => {
  assert.equal(matchProgress({ Version: 30, MatchID: M }, 'Blue', 'competitive', NOW), undefined);
  assert.equal(
    normalizeLiveStats({ SeasonalBadgeInfo: { NumberOfWins: 8 } }, true, NOW),
    undefined,
  );
  assert.equal(normalizeLiveStats({ Stats: { Kills: 4, Deaths: 2 } }, true, NOW), undefined);
});
test('explicit current-match KDA validates nonnegative integers and never displays before the match', () => {
  const p = { Stats: { Kills: 8, Deaths: 3, Assists: 5 } };
  assert.deepEqual(normalizeLiveStats(p, true, NOW), {
    kills: 8,
    deaths: 3,
    assists: 5,
    observedAt: NOW,
    source: 'current-match',
  });
  assert.equal(normalizeLiveStats(p, false, NOW), undefined);
  for (const v of [-1, 1.5, Infinity, '4', null])
    assert.equal(
      normalizeLiveStats({ Stats: { Kills: v, Deaths: 3, Assists: 1 } }, true, NOW),
      undefined,
    );
});
test('the real Profile memo comparator responds to chat-only score updates', () => {
  const text = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8'),
    file = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let comparator;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === 'ScreenSlot' &&
      ts.isCallExpression(node.initializer)
    )
      comparator = node.initializer.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(comparator);
  const body = ts.createPrinter().printNode(ts.EmitHint.Expression, comparator, file),
    js = ts.transpileModule('module.exports=' + body, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    m = { exports: {} };
  vm.runInThisContext('(function(module){' + js + '})')(m);
  const shared = { status: 'ready', friends: [], selfPresence: presence() },
    model = { chat: shared },
    props = { tab: 'matches', model };
  assert.equal(m.exports(props, props), true);
  assert.equal(
    m.exports(props, {
      ...props,
      model: {
        ...model,
        chat: {
          ...shared,
          selfPresence: { ...presence(), progress: { ...presence().progress, allyScore: 8 } },
        },
      },
    }),
    false,
  );
  assert.equal(
    m.exports(
      { ...props, tab: 'store' },
      { ...props, tab: 'store', model: { ...model, chat: { ...shared } } },
    ),
    true,
  );
});

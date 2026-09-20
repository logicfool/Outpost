const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  applyMatchFilter,
  matchFilterOptions,
  activeFilterCount,
  reconcileFilter,
  matchAgent,
  matchResult,
  EMPTY_FILTER,
} = require('../.test-build/matchFilters.js');

const match = (n, queue, map, extra = {}) => ({
  id: `match-${n}`,
  startedAt: n,
  queue,
  map,
  ...extra,
});
const history = () => [
  match(1, 'competitive', 'Ascent', { preview: { agent: 'Jett', result: 'WIN' } }),
  match(2, 'competitive', 'Bind', { preview: { agent: 'Sova', result: 'LOSS' } }),
  match(3, 'unrated', 'Ascent', { preview: { agent: 'Jett', result: 'LOSS' } }),
  match(4, 'swiftplay', 'Open match details'),
  match(5, 'unknown', 'Haven'),
];
const details = {
  'match-4': { agent: 'Omen', result: 'DRAW' },
  'match-5': { agent: 'Jett', result: 'UNKNOWN' },
};

test('no active filter returns the original list unchanged', () => {
  const all = history();
  assert.equal(applyMatchFilter(all, EMPTY_FILTER, {}), all);
  assert.equal(activeFilterCount(EMPTY_FILTER), 0);
});
test('each dimension filters independently', () => {
  assert.deepEqual(
    applyMatchFilter(history(), { ...EMPTY_FILTER, queue: 'competitive' }, details).map(
      (m) => m.id,
    ),
    ['match-1', 'match-2'],
  );
  assert.deepEqual(
    applyMatchFilter(history(), { ...EMPTY_FILTER, map: 'Ascent' }, details).map((m) => m.id),
    ['match-1', 'match-3'],
  );
  assert.deepEqual(
    applyMatchFilter(history(), { ...EMPTY_FILTER, agent: 'Jett' }, details).map((m) => m.id),
    ['match-1', 'match-3', 'match-5'],
  );
  assert.deepEqual(
    applyMatchFilter(history(), { ...EMPTY_FILTER, result: 'LOSS' }, details).map((m) => m.id),
    ['match-2', 'match-3'],
  );
});
test('filters combine rather than replace one another', () => {
  const filter = { queue: 'competitive', map: 'all', agent: 'Jett', result: 'WIN' };
  assert.equal(activeFilterCount(filter), 3);
  assert.deepEqual(
    applyMatchFilter(history(), filter, details).map((m) => m.id),
    ['match-1'],
  );
  assert.deepEqual(applyMatchFilter(history(), { ...filter, result: 'LOSS' }, details), []);
});
test('a loaded report supplies the agent and result for matches without a preview', () => {
  assert.equal(matchAgent(history()[3], details), 'Omen');
  assert.deepEqual(
    applyMatchFilter(history(), { ...EMPTY_FILTER, agent: 'Omen' }, details).map((m) => m.id),
    ['match-4'],
  );
  assert.deepEqual(applyMatchFilter(history(), { ...EMPTY_FILTER, agent: 'Omen' }, {}), []);
});
test('an unknown result is never offered or matched as a real outcome', () => {
  assert.equal(matchResult(history()[4], details), undefined);
  assert.equal(matchFilterOptions(history(), details).result.includes('UNKNOWN'), false);
});
test('options only contain values the loaded history actually has', () => {
  const options = matchFilterOptions(history(), details);
  assert.deepEqual(options.queue, ['competitive', 'swiftplay', 'unrated']);
  assert.deepEqual(options.map, ['Ascent', 'Bind', 'Haven']);
  assert.deepEqual(options.agent, ['Jett', 'Omen', 'Sova']);
  assert.deepEqual(options.result, ['WIN', 'LOSS', 'DRAW']);
});
test('placeholder queues and map names are not offered as filters', () => {
  const options = matchFilterOptions(history(), details);
  assert.equal(options.queue.includes('unknown'), false);
  assert.equal(options.map.includes('Open match details'), false);
});
test('every offered option selects at least one match', () => {
  const all = history(),
    options = matchFilterOptions(all, details);
  for (const key of ['queue', 'map', 'agent', 'result']) {
    for (const value of options[key])
      assert.ok(
        applyMatchFilter(all, { ...EMPTY_FILTER, [key]: value }, details).length > 0,
        `${key}=${value}`,
      );
  }
});
test('selections that a reloaded history no longer contains are dropped', () => {
  const options = matchFilterOptions([match(1, 'competitive', 'Ascent')], {});
  assert.deepEqual(
    reconcileFilter({ queue: 'competitive', map: 'Bind', agent: 'Jett', result: 'WIN' }, options),
    { queue: 'competitive', map: 'all', agent: 'all', result: 'all' },
  );
});
test('an empty history yields no options and no selection', () => {
  const options = matchFilterOptions([], {});
  assert.deepEqual(options, { queue: [], map: [], agent: [], result: [] });
  assert.deepEqual(
    reconcileFilter({ queue: 'competitive', map: 'all', agent: 'all', result: 'all' }, options),
    EMPTY_FILTER,
  );
});

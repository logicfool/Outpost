const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, deferred, settle, React, Renderer, act } = require('./loading-harness.cjs');
const { AppError } = require('../.test-build/validation.js');
async function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  const h = harness(),
    { useMatchPreviews } = h.load('src/state/useMatchPreviews.ts');
  const requests = [],
    model = {
      active: { puuid: 'account-a' },
      matchDetail: (id, subject) => {
        const task = deferred();
        requests.push({ id, subject, ...task });
        return task.promise;
      },
    };
  let value, tree;
  function Probe(props) {
    value = useMatchPreviews(props.model, props.subject);
    return React.createElement('Preview', value);
  }
  const render = async (m = model, subject, enabled = true) =>
    act(() => {
      const view = React.createElement(
        h.polling.LivePollingContext.Provider,
        { value: enabled },
        React.createElement(Probe, { model: m, subject }),
      );
      if (tree) tree.update(view);
      else tree = Renderer.create(view);
    });
  await render();
  t.after(async () => act(() => tree.unmount()));
  return {
    ...h,
    model,
    requests,
    render,
    get value() {
      return value;
    },
    visible: async (ids) =>
      act(() =>
        value.onViewableItemsChanged({
          viewableItems: ids.map((id) => ({ isViewable: true, item: { id } })),
        }),
      ),
    tick: async (ms) =>
      act(async () => {
        t.mock.timers.tick(ms);
        await settle();
      }),
  };
}
test('no visible rows means no automatic match requests', async (t) => {
  const f = await setup(t);
  await f.tick(5000);
  assert.equal(f.requests.length, 0);
});
test('visible cards fetch serially and publish complete details per row', async (t) => {
  const f = await setup(t);
  await f.visible(['first', 'second']);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.value.details, {});
  await act(() => f.requests[0].resolve({ id: 'first', map: 'Ascent', agentImage: 'agent' }));
  assert.equal(f.value.details.first.map, 'Ascent');
  assert.equal(f.value.details.second, undefined);
  await f.tick(199);
  assert.equal(f.requests.length, 1);
  await f.tick(1);
  assert.equal(f.requests.length, 2);
});
test('only six visible rows are selected, not every report in the history', async (t) => {
  const f = await setup(t);
  await f.visible(Array.from({ length: 40 }, (_, n) => String(n)));
  for (let n = 0; n < 6; n++) {
    assert.equal(f.requests[n].id, String(n));
    await act(() => f.requests[n].resolve({ id: String(n) }));
    await f.tick(200);
  }
  assert.equal(f.requests.length, 6);
});
test('scrolling reprioritizes pending rows without interrupting the active report', async (t) => {
  const f = await setup(t);
  await f.visible(['first', 'second']);
  await f.visible(['third']);
  assert.equal(f.requests.length, 1);
  await act(() => f.requests[0].resolve({ id: 'first' }));
  await f.tick(200);
  assert.equal(f.requests[1].id, 'third');
});
test('a rate limit shows an error and resumes only at Retry-After without another scroll', async (t) => {
  const f = await setup(t);
  await f.visible(['first']);
  await act(() => f.requests[0].reject(new AppError('RATE_LIMIT', 'Wait', Date.now() + 120000)));
  assert.equal(f.value.issue.code, 'RATE_LIMIT');
  await f.tick(119999);
  assert.equal(f.requests.length, 1);
  await f.tick(1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.value.issue, undefined);
});
test('ordinary failures enforce the existing one-minute minimum', async (t) => {
  const f = await setup(t);
  await f.visible(['first']);
  await act(() => f.requests[0].reject(new AppError('NETWORK', 'Offline')));
  await f.tick(59999);
  assert.equal(f.requests.length, 1);
  await f.tick(1);
  assert.equal(f.requests.length, 2);
});
test('a covered profile never starts the next queued report', async (t) => {
  const f = await setup(t);
  await f.visible(['first', 'second']);
  await f.render(f.model, undefined, false);
  await act(() => f.requests[0].resolve({ id: 'first' }));
  await f.tick(60000);
  assert.equal(f.requests.length, 1);
  await f.render();
  assert.equal(f.requests.length, 2);
});
test('backgrounding pauses the queue and foreground resumes under its cooldown', async (t) => {
  const f = await setup(t);
  await f.visible(['first', 'second']);
  await act(() => f.emit('change', 'background'));
  await act(() => f.requests[0].resolve({ id: 'first' }));
  await f.tick(60000);
  assert.equal(f.requests.length, 1);
  await act(() => f.emit('change', 'active'));
  assert.equal(f.requests.length, 2);
});
test('account switching cannot publish a delayed report from the previous account', async (t) => {
  const f = await setup(t);
  await f.visible(['first']);
  await f.render({ ...f.model, active: { puuid: 'account-b' } });
  await act(() => f.requests[0].resolve({ id: 'first', map: 'Private old account' }));
  assert.deepEqual(f.value.details, {});
});
test('known match details remain visible while a later row fails', async (t) => {
  const f = await setup(t);
  await f.visible(['first', 'second']);
  await act(() => f.requests[0].resolve({ id: 'first' }));
  await f.tick(200);
  await act(() => f.requests[1].reject(new AppError('NETWORK', 'Offline')));
  assert.equal(f.value.details.first.id, 'first');
  assert.ok(f.value.issue);
});

const test = require('node:test'),
  assert = require('node:assert/strict');
const { MemoizedRead } = require('../.test-build/memoizedRead.js');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test('parallel public catalogue reads share one parse and subsequent reads reuse its object', async () => {
  const cache = new MemoizedRead(),
    value = { items: {} },
    slow = deferred();
  let reads = 0;
  const load = () => {
    reads++;
    return slow.promise;
  };
  const a = cache.read(load),
    b = cache.read(load);
  assert.equal(a, b);
  slow.resolve(value);
  assert.equal(await a, value);
  assert.equal(await cache.read(load), value);
  assert.equal(reads, 1);
});
test('failed reads can be retried, while invalidation prevents an old read poisoning new data', async () => {
  const cache = new MemoizedRead();
  await assert.rejects(
    cache.read(async () => {
      throw Error('disk');
    }),
  );
  const slow = deferred(),
    old = cache.read(() => slow.promise);
  const fresh = { revision: 2 };
  cache.replace(fresh);
  slow.resolve({ revision: 1 });
  await old;
  assert.equal(await cache.read(async () => null), fresh);
  cache.clear();
  assert.equal(await cache.read(async () => null), null);
  assert.equal(await cache.read(async () => ({ unexpected: true })), null);
});

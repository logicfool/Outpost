const test = require('node:test'),
  assert = require('node:assert/strict');
const { restoreProgressively } = require('../.test-build/progressiveCache.js');
const { sameScreenModel } = require('../.test-build/screenInputs.js');
const { sharedViewStyles } = require('../.test-build/viewCache.js');
const { catalogueBrowse, ownedBrowse } = require('../.test-build/catalogBrowse.js');
const {
  rememberArtwork,
  forgetArtwork,
  clearArtworkMemory,
  wasArtworkReady,
} = require('../.test-build/artworkMemory.js');
const { catalog, ID } = require('./helpers.cjs');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const flush = () => new Promise((r) => setImmediate(r));
test('cached screen publishes before optional work, while a stuck secondary read cannot block refresh', async () => {
  const order = [],
    slow = deferred();
  const run = restoreProgressively({
    snapshot: async () => ({ cached: true }),
    publish: () => order.push('visible'),
    current: () => true,
    yield: async () => {
      order.push('frame');
    },
    resume: async () => order.push('refresh'),
    optional: [
      () => {
        order.push('secondary');
        return slow.promise;
      },
    ],
    failed: () => order.push('error'),
  });
  await flush();
  assert.equal(order[0], 'visible');
  assert.ok(order.indexOf('frame') < order.indexOf('secondary'));
  assert.ok(order.includes('refresh'));
  slow.resolve();
  await run;
});
test('failed cache never suppresses initial refresh; stale account work never publishes', async () => {
  let refreshed = 0,
    published = 0,
    failed = 0;
  await restoreProgressively({
    snapshot: async () => {
      throw Error('disk');
    },
    publish: () => published++,
    current: () => true,
    yield: async () => {},
    resume: async () => refreshed++,
    optional: [
      async () => {
        throw Error('optional');
      },
    ],
    failed: () => failed++,
  });
  assert.equal(refreshed, 1);
  assert.equal(published, 0);
  assert.ok(failed > 0);
  let current = true;
  const slow = deferred();
  const run = restoreProgressively({
    snapshot: () => slow.promise,
    publish: () => published++,
    current: () => current,
    resume: async () => refreshed++,
    optional: [],
    failed() {},
  });
  current = false;
  slow.resolve({});
  await run;
  assert.equal(published, 0);
  assert.equal(refreshed, 1);
});
test('theme styles are built once per factory and palette rather than once per row', () => {
  let builds = 0;
  const factory = (p) => {
      builds++;
      return { ink: p.ink };
    },
    dark = { ink: 'white' },
    light = { ink: 'black' };
  const first = sharedViewStyles(factory, dark);
  for (let i = 0; i < 1000; i++) assert.equal(sharedViewStyles(factory, dark), first);
  assert.equal(builds, 1);
  assert.equal(sharedViewStyles(factory, light).ink, 'black');
  assert.equal(builds, 2);
});
test('unrelated live ticks and chat messages do not invalidate Store or Collection', () => {
  const store = { status: 'ready', data: {} },
    collection = { status: 'ready', data: [] };
  const a = {
    snapshot: { accountId: ID, store, collection, liveGame: { status: 'ready' } },
    chat: { status: 'ready', friends: [], selfPresence: {} },
  };
  const b = { ...a, snapshot: { ...a.snapshot, liveGame: { status: 'ready', newScore: 1 } } };
  assert.equal(sameScreenModel('store', a, b), true);
  assert.equal(sameScreenModel('collection', a, b), true);
  assert.equal(sameScreenModel('matches', a, b), false);
  const chat = { ...a, chat: { ...a.chat, messages: { new: 'message' } } };
  assert.equal(sameScreenModel('matches', a, chat), true);
  assert.equal(sameScreenModel('friends', a, chat), false);
  assert.equal(sameScreenModel('store', a, { ...a, wishlist: ['changed'] }), false);
  assert.equal(
    sameScreenModel('matches', a, { ...a, chat: { ...a.chat, selfPresence: { changed: true } } }),
    false,
  );
});
test('owned browsing does not enumerate the whole catalogue and repeated browsing reuses sorted projections', () => {
  const c = catalog(),
    item = Object.values(c.items)[0];
  let scans = 0;
  c.items = new Proxy(c.items, {
    ownKeys(target) {
      scans++;
      return Reflect.ownKeys(target);
    },
  });
  const owned = [item];
  const first = ownedBrowse(owned, c);
  assert.equal(scans, 0);
  assert.equal(ownedBrowse(owned, c), first);
  const all = catalogueBrowse(c);
  assert.equal(scans, 1);
  assert.equal(catalogueBrowse({ ...c, fetchedAt: 1 }), all);
  assert.equal(scans, 1);
  assert.notEqual(catalogueBrowse({ ...c, items: { ...c.items } }), all);
});
test('only actually loaded artwork skips repeated skeletons; failure and clearing revoke readiness', () => {
  clearArtworkMemory();
  assert.equal(wasArtworkReady('fixture', 100), false);
  rememberArtwork('fixture', 100);
  assert.equal(wasArtworkReady('fixture', 101), true);
  forgetArtwork('fixture');
  assert.equal(wasArtworkReady('fixture', 101), false);
  rememberArtwork('fixture', 100);
  assert.equal(wasArtworkReady('fixture', 300101), false);
  for (let i = 0; i < 300; i++) rememberArtwork('fixture-' + i, 100);
  assert.equal(wasArtworkReady('fixture-0', 101), false);
  assert.equal(wasArtworkReady('fixture-299', 101), true);
  clearArtworkMemory();
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCatalog, CatalogClient } = require('../.test-build/catalog.js');
const { HttpClient, SingleFlightCache } = require('../.test-build/http.js');
const { ID, MATCH, SKIN, response } = require('./helpers.cjs');
const bundleId = '77777777-7777-4777-8777-777777777777';
const weaponData = {
  data: [
    {
      uuid: ID,
      displayName: 'Vandal',
      skins: [
        {
          uuid: SKIN,
          displayName: 'Test Vandal',
          themeUuid: MATCH,
          assetPath: 'ShooterGame/Content/Equippables/Guns/Rifles/Vandal/TestTheme/Test',
          levels: [],
          chromas: [],
        },
      ],
    },
  ],
};
const bundleData = {
  data: [
    {
      uuid: bundleId,
      displayName: 'Test Theme',
      assetPath: 'ShooterGame/Content/StorefrontItem_TestTheme_ThemeBundle_DataAsset',
      displayIcon: 'https://media.valorant-api.com/bundle.png',
    },
  ],
};
function previousCatalog() {
  return buildCatalog(
    {
      weapons: weaponData,
      bundles: bundleData,
      themes: { data: [{ uuid: MATCH, displayName: 'Test Theme' }] },
    },
    1234,
  );
}
test('bundle-only repair preserves historical theme membership without inventing members', async () => {
  const previous = previousCatalog();
  assert.deepEqual(previous.bundles[bundleId].itemIds, [SKIN]);
  const client = new CatalogClient(new HttpClient(async () => response(bundleData)));
  const fresh = await client.repair(previous, ['bundles']);
  assert.deepEqual(fresh.bundles[bundleId].itemIds, [SKIN]);
  assert.equal(fresh.bundles[bundleId].membershipSource, 'catalog-theme');
  assert.equal(fresh.fetchedAt, previous.fetchedAt);
});
test('weapons-only repair retains theme labels when themes were not requested', async () => {
  const previous = previousCatalog();
  const client = new CatalogClient(new HttpClient(async () => response(weaponData)));
  const fresh = await client.repair(previous, ['weapons']);
  assert.equal(fresh.items[SKIN].collectionName, 'Test Theme');
});
test('a normal catalogue load cannot undo a successful targeted repair with older cached data', async () => {
  let updated = false,
    now = 1000,
    cardRequests = 0;
  const client = new CatalogClient(
    new HttpClient(async (url) => {
      const path = new URL(url).pathname.split('/').pop();
      if (path !== 'playercards') return response({ data: [] });
      cardRequests++;
      return response({
        data: [
          {
            uuid: MATCH,
            displayName: updated ? 'Published Card' : 'Old Card',
            wideArt: updated ? 'https://media.valorant-api.com/new-wide.png' : null,
          },
        ],
      });
    }),
  );
  client.cache = new SingleFlightCache(() => now);
  const previous = await client.load();
  updated = true;
  const repaired = await client.repair(previous, ['playercards']);
  assert.equal(repaired.items[MATCH].name, 'Published Card');
  const immediate = await client.load(repaired);
  assert.equal(immediate.items[MATCH].name, 'Published Card');
  now += 31000;
  const later = await client.load(repaired);
  assert.equal(later.items[MATCH].name, 'Published Card');
  assert.equal(cardRequests, 2, 'reuse repaired public metadata without another request');
});
test('priming a category prevents a late older load from replacing repaired data', async () => {
  const cache = new SingleFlightCache(() => 0);
  let release;
  const old = cache.get(
    'category',
    60000,
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  cache.prime('category', 60000, 'repaired');
  release('old');
  assert.equal(await old, 'old');
  assert.equal(await cache.get('category', 60000, async () => 'unexpected'), 'repaired');
});
test('invalidating an aggregate retires its old in-flight cache write', async () => {
  const cache = new SingleFlightCache(() => 0);
  let release;
  const old = cache.get(
    'catalog',
    60000,
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  cache.invalidate('catalog');
  assert.equal(await cache.get('catalog', 60000, async () => 'new'), 'new');
  release('old');
  await old;
  assert.equal(await cache.get('catalog', 60000, async () => 'unexpected'), 'new');
});
test('changed theme keys do not retain the previous inferred membership or labels', () => {
  const { mergeCatalog } = require('../.test-build/catalog.js');
  const previous = previousCatalog(),
    fresh = previousCatalog();
  fresh.items[SKIN] = {
    ...fresh.items[SKIN],
    collectionName: undefined,
    collectionKey: 'different',
  };
  fresh.bundles[bundleId] = { name: 'Other theme', collectionKey: 'different', itemIds: [] };
  const merged = mergeCatalog(previous, fresh);
  assert.equal(merged.items[SKIN].collectionName, undefined);
  assert.deepEqual(merged.bundles[bundleId].itemIds, []);
});
test('clearing during a repair prevents its late response from repopulating current caches', async () => {
  let old = true,
    release,
    started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const client = new CatalogClient(
    new HttpClient(async (url) => {
      if (!url.includes('/playercards')) return response({ data: [] });
      if (old) {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
        return response({ data: [{ uuid: MATCH, displayName: 'Retired response' }] });
      }
      return response({ data: [{ uuid: MATCH, displayName: 'Current response' }] });
    }),
  );
  const retired = client.repair(previousCatalog(), ['playercards']);
  await ready;
  client.clear();
  old = false;
  const current = await client.load();
  release();
  await retired;
  const next = await client.load(current);
  assert.equal(next.items[MATCH].name, 'Current response');
});

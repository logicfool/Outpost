const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, MATCH, LEVEL, SKIN, catalog, response } = require('./helpers.cjs');
const {
  buildCatalog,
  catalogItem,
  hydrateItem,
  mergeCatalog,
  CatalogClient,
} = require('../.test-build/catalog.js');
const {
  mapMetadata,
  hydrateMatchSummary,
  hydrateMatchDetail,
  GAUNTLET_OVERVIEW,
} = require('../.test-build/maps.js');
const {
  normalizeMatches,
  normalizeMatchDetail,
  normalizeStore,
  ITEM_TYPES,
  CURRENCIES,
} = require('../.test-build/normalize.js');
const { rememberBundles, bundleContents } = require('../.test-build/bundles.js');
const {
  missingCatalogPaths,
  hydrateSnapshotMetadata,
} = require('../.test-build/catalogRecovery.js');
const { cardArtworkCandidates } = require('../.test-build/playerCardArt.js');
const { safeImage } = require('../.test-build/validation.js');
const { HttpClient } = require('../.test-build/http.js');
const { makeDemo, demoMatch } = require('../.test-build/demo.js');
const { bundleFixture } = require('./bundle-fixture.cjs');
const gauntlet = '/Game/Maps/AbilityDraft/AbilityDraftArena';
test('13.06 AbilityDraftArena resolves without confusing it with TDM Glitch', () => {
  const c = {
    ...catalog(),
    maps: {
      '/Game/Maps/HURM/HURM_HighTide/HURM_HighTide': {
        name: 'Glitch',
        image: 'https://media.valorant-api.com/tdm.png',
      },
    },
  };
  for (const id of [gauntlet, gauntlet.toLowerCase(), 'AbilityDraftArena']) {
    assert.equal(mapMetadata(c, id).name, 'Gauntlet: Glitched');
    assert.equal(mapMetadata(c, id).image, GAUNTLET_OVERVIEW);
    assert.equal(mapMetadata(c, id).minimap, undefined);
  }
  assert.equal(mapMetadata(c, '/game/maps/hurm/hurm_hightide/hurm_hightide').name, 'Glitch');
  assert.equal(mapMetadata(c, '/Game/Maps/Unrelated/Unrelated'), undefined);
  assert.equal(safeImage(GAUNTLET_OVERVIEW), GAUNTLET_OVERVIEW);
  assert.equal(safeImage('https://cmsassets.rgpub.io/unreviewed.png'), undefined);
});
test('match history uses its explicit map ID even without a ranked update', () => {
  const rows = normalizeMatches(
    {
      History: [{ MatchID: MATCH, MapID: gauntlet, QueueID: 'abilitydraft', GameStartTime: 1000 }],
    },
    { Matches: [] },
    catalog(),
  );
  assert.equal(rows[0].map, 'Gauntlet: Glitched');
  assert.equal(rows[0].mapId, gauntlet);
});
test('saved Gauntlet summaries and previews repair locally without changing scores or timestamps', () => {
  const before = {
    id: MATCH,
    map: 'Unknown map',
    queue: 'abilitydraft',
    startedAt: 1000,
    preview: {
      map: 'Unknown map',
      agent: 'KAY/O',
      score: '3 - 2',
      result: 'WIN',
      kills: 9,
      deaths: 2,
      assists: 1,
    },
  };
  const after = hydrateMatchSummary(catalog(), before);
  assert.equal(after.map, 'Gauntlet: Glitched');
  assert.equal(after.preview.map, 'Gauntlet: Glitched');
  assert.equal(after.preview.score, before.preview.score);
  assert.equal(after.startedAt, 1000);
  assert.equal(before.map, 'Unknown map');
  assert.equal(
    hydrateMatchSummary(catalog(), { ...before, queue: 'competitive' }).map,
    'Unknown map',
  );
  assert.equal(
    hydrateMatchSummary(catalog(), { ...before, mapId: '/Game/Maps/Other/Other' }).map,
    'Unknown map',
  );
});
test('a new card UUID has safe artwork paths while remaining unresolved for metadata and purchases', () => {
  const item = catalogItem(catalog(), MATCH, 'card');
  assert.match(item.name, /^Unresolved/);
  assert.match(item.wideArt, new RegExp(MATCH + '/wideart.png$'));
  assert.ok(
    cardArtworkCandidates(item, 'square').every((url) =>
      /\/(smallart|displayicon)\.png$/.test(url),
    ),
  );
  assert.ok(cardArtworkCandidates(item, 'wide').includes(item.wideArt));
  assert.deepEqual(
    cardArtworkCandidates(catalogItem(catalog(), '../../unsafe', 'card'), 'wide'),
    [],
  );
  const old = { ...item, image: undefined, wideArt: undefined, smallArt: undefined };
  assert.ok(hydrateItem(catalog(), old).wideArt);
});
test('bundle banner variants and case-insensitive IDs survive the catalogue build', () => {
  const c = buildCatalog({
    bundles: {
      data: [
        {
          uuid: MATCH.toUpperCase(),
          displayName: 'Updated Bundle',
          displayIcon: null,
          displayIcon2: 'https://media.valorant-api.com/bundles/secondary.png',
        },
      ],
    },
  });
  assert.equal(c.bundles[MATCH].image, 'https://media.valorant-api.com/bundles/secondary.png');
  assert.equal(bundleContents(c, MATCH.toUpperCase()).name, 'Updated Bundle');
});
test('new bundle members stay visible and are remembered even before their metadata is published', () => {
  const h = bundleFixture(),
    c = { ...h.catalog, items: {}, bundles: {} };
  const raw = {
    SkinsPanelLayout: { SingleItemOffers: [], SingleItemOffersRemainingDurationInSeconds: 3600 },
    FeaturedBundle: { Bundles: [h.raw] },
  };
  const store = normalizeStore(raw, c, 1000, 1000, 'v3'),
    b = store.bundles[0];
  assert.equal(b.offers.length, 3);
  assert.deepEqual(
    b.offers.map((o) => o.item.kind),
    ['buddy', 'card', 'spray'],
  );
  assert.ok(b.offers[1].item.wideArt);
  assert.equal(b.checkout, undefined);
  const remembered = rememberBundles(c, store.bundles);
  assert.deepEqual(
    remembered.bundles[b.catalogId].itemIds,
    b.offers.map((o) => o.item.canonicalId),
  );
  const archived = bundleContents(remembered, b.catalogId);
  assert.equal(archived.items.length, 3);
  assert.equal(archived.source, 'store');
  assert.equal(archived.items[1].kind, 'card');
  assert.ok(archived.items[1].wideArt);
});
test('fresh bundle labels replace stale placeholders but never replace observed membership with a theme guess', () => {
  const h = bundleFixture(),
    b = {
      ...h.bundle,
      name: 'Featured collection',
      image: undefined,
      offers: h.raw.ItemOffers.map((row) => ({
        id: row.Offer.OfferID,
        item: h.catalog.items[row.Offer.Rewards[0].ItemID],
        prices: [],
      })),
    };
  let c = rememberBundles({ ...h.catalog, bundles: {} }, [b]);
  c = mergeCatalog(c, {
    ...h.catalog,
    bundles: {
      [b.catalogId]: {
        name: 'Published name',
        image: 'https://media.valorant-api.com/banner.png',
        itemIds: [SKIN],
        membershipSource: 'catalog-theme',
      },
    },
  });
  const active = bundleContents(c, b.id, { ...h.store, bundles: [b] }),
    archived = bundleContents(c, b.catalogId);
  assert.equal(active.name, 'Published name');
  assert.equal(active.image, 'https://media.valorant-api.com/banner.png');
  assert.equal(archived.items.length, 3);
  assert.equal(archived.source, 'store');
  assert.equal(active.active, b);
  assert.equal(b.name, 'Featured collection');
});
test('public metadata repairs target only missing categories, preserve schema/age and never use Riot credentials', async () => {
  const seen = [],
    previous = catalog();
  previous.schemaVersion = 7;
  previous.fetchedAt = 100;
  const client = new CatalogClient(
    new HttpClient(async (url, init) => {
      seen.push({ url, init });
      return response({
        data: [
          {
            uuid: MATCH,
            displayName: 'New Card',
            wideArt: 'https://media.valorant-api.com/new-wide.png',
          },
        ],
      });
    }),
  );
  const next = await client.repair(previous, ['playercards']);
  assert.equal(next.items[MATCH].name, 'New Card');
  assert.equal(next.schemaVersion, 7);
  assert.equal(next.fetchedAt, 100);
  await client.repair(previous, ['playercards']);
  assert.equal(seen.length, 1);
  assert.equal(new URL(seen[0].url).pathname, '/v1/playercards');
  assert.equal(new Headers(seen[0].init.headers).get('Authorization'), null);
});
test('metadata hydration does not extend personal-data freshness or change any store prices/offer IDs', () => {
  const demo = makeDemo(),
    snapshot = demo.snapshot,
    old = structuredClone(snapshot);
  const next = hydrateSnapshotMetadata(demo.catalog, snapshot);
  assert.equal(next.fetchedAt, snapshot.fetchedAt);
  assert.equal(next.store.fetchedAt, snapshot.store.fetchedAt);
  assert.equal(next.loadout.fetchedAt, snapshot.loadout.fetchedAt);
  assert.deepEqual(
    next.store.data.daily.map((o) => [o.id, o.prices]),
    snapshot.store.data.daily.map((o) => [o.id, o.prices]),
  );
  assert.deepEqual(snapshot, old);
});
test('current stored reports retain their evidence while gaining a repaired map label', () => {
  const detail = {
    ...demoMatch(MATCH),
    map: 'Unknown map',
    mapId: gauntlet,
    queue: 'abilitydraft',
  };
  const next = hydrateMatchDetail(catalog(), detail);
  assert.equal(next.map, 'Gauntlet: Glitched');
  assert.equal(next.score, detail.score);
  assert.equal(next.kills, detail.kills);
  assert.equal(next.players, detail.players);
  assert.equal(next.startedAt, detail.startedAt);
  const wrongOldMap = {
    ...detail,
    analysis: {
      ...detail.analysis,
      minimap: { name: 'Glitch', minimap: 'https://media.valorant-api.com/tdm-minimap.png' },
    },
  };
  assert.equal(hydrateMatchDetail(catalog(), wrongOldMap).analysis.minimap, undefined);
});

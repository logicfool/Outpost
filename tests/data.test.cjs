const { test } = require('node:test');
const assert = require('node:assert/strict');
const n = require('../.test-build/normalize.js');
const c = require('../.test-build/catalog.js');
const { makeDemo, demoMatch } = require('../.test-build/demo.js');
const { ID, OTHER, SKIN, LEVEL, MATCH, catalog, storefront, code } = require('./helpers.cjs');
test('daily offer preserves actual price and canonical skin', () => {
  const s = n.normalizeStore(storefront(), catalog(), 100000, 90000);
  assert.equal(s.daily[0].prices[0].amount, 1775);
  assert.equal(s.daily[0].item.canonicalId, SKIN);
  assert.equal(s.clockOffsetMs, 10000);
  assert.equal(s.dailyExpiresAt, 3700000);
});
test('missing store panel is not an empty successful store', () =>
  assert.throws(() => n.normalizeStore({}, catalog(), 0, 0), code('SCHEMA')));
test('negative store duration is rejected', () => {
  const s = storefront();
  s.SkinsPanelLayout.SingleItemOffersRemainingDurationInSeconds = -1;
  assert.throws(() => n.normalizeStore(s, catalog(), 0, 0), code('SCHEMA'));
});
test('legacy price fallback resolves daily items', () => {
  const s = storefront(),
    prices = s.SkinsPanelLayout.SingleItemStoreOffers;
  delete s.SkinsPanelLayout.SingleItemStoreOffers;
  const output = n.normalizeStore(s, catalog(), 0, 0, 'v2', { Offers: prices });
  assert.equal(output.daily[0].prices[0].amount, 1775);
});
test('missing price stays unavailable, never free', () => {
  const s = storefront();
  delete s.SkinsPanelLayout.SingleItemStoreOffers;
  assert.deepEqual(n.normalizeStore(s, catalog(), 0, 0).daily[0].prices, []);
});
test('absence of Night Market is explicit null', () =>
  assert.equal(n.normalizeStore(storefront(), catalog(), 0, 0).nightMarket, null));
test('Night Market uses returned discounted price, not recalculation', () => {
  const s = storefront();
  s.BonusStore = {
    BonusStoreRemainingDurationInSeconds: 99,
    BonusStoreOffers: [
      {
        BonusOfferID: 'offer',
        DiscountPercent: 37,
        DiscountCosts: { [n.CURRENCIES.VP]: 1119 },
        Offer: s.SkinsPanelLayout.SingleItemStoreOffers[0],
      },
    ],
  };
  const b = n.normalizeStore(s, catalog(), 0, 0).nightMarket;
  assert.equal(b.offers[0].prices[0].amount, 1119);
  assert.equal(b.offers[0].originalPrices[0].amount, 1775);
  assert.equal(b.expiresAt, 99000);
});
test('malformed present market fails section instead of invented offers', () => {
  const s = storefront();
  s.BonusStore = {};
  assert.throws(() => n.normalizeStore(s, catalog(), 0, 0), code('SCHEMA'));
});
test('featured Bundle and Bundles are deduplicated', () => {
  const s = storefront(),
    b = { ID: 'bundle', TotalDiscountedCost: { [n.CURRENCIES.VP]: 7100 } };
  s.FeaturedBundle = { Bundle: b, Bundles: [b] };
  assert.equal(n.normalizeStore(s, catalog(), 0, 0).bundles.length, 1);
});
test('wallet missing balances fails; valid zero remains zero', () => {
  assert.throws(() => n.normalizeWallet({}), code('SCHEMA'));
  assert.equal(n.normalizeWallet({ Balances: { [n.CURRENCIES.VP]: 0 } })[0].amount, 0);
});
test('bad amounts are not rendered as numbers', () =>
  assert.deepEqual(n.money({ bad: -1, invalid: '3', infinity: Infinity }), []));
test('active ranked season is selected explicitly, never lexical UUID order', () => {
  const data = {
    QueueSkills: {
      competitive: {
        SeasonalInfoBySeasonID: {
          z: { CompetitiveTier: 24, RankedRating: 99 },
          a: { CompetitiveTier: 20, RankedRating: 50 },
        },
      },
    },
  };
  const cat = catalog();
  cat.currentSeasonId = 'a';
  assert.equal(n.normalizeRank(data, cat).rr, 50);
  assert.equal(n.normalizeRank(data, cat).currentSeason, true);
});
test('old ranked update does not pretend to be current act', () => {
  const data = { QueueSkills: {}, LatestCompetitiveUpdate: { SeasonID: 'old' } };
  assert.equal(n.normalizeRank(data, catalog()).currentSeason, false);
});
test('inventory collapses duplicate skin levels', () => {
  const data = {
    EntitlementsByTypes: [
      { ItemTypeID: n.ITEM_TYPES.skin, Entitlements: [{ ItemID: LEVEL }, { ItemID: SKIN }] },
    ],
  };
  assert.equal(n.normalizeCollection(data, catalog()).length, 1);
});
test('malformed inventory is not a successful empty collection', () =>
  assert.throws(() => n.normalizeCollection({}, catalog()), code('SCHEMA')));
test('unknown catalog item remains visibly unresolved', () =>
  assert.match(c.catalogItem(catalog(), OTHER).name, /Unresolved/));
test('prototype property is not treated as catalog metadata', () =>
  assert.equal(c.catalogItem(catalog(), 'constructor').kind, 'unknown'));
test('catalog levels share canonical skin and external images are excluded', () => {
  const cat = c.buildCatalog({
    weapons: {
      data: [
        {
          displayName: 'Vandal',
          skins: [
            {
              uuid: SKIN,
              displayName: 'Fixture',
              displayIcon: 'https://evil.invalid/x',
              levels: [{ uuid: LEVEL }],
              chromas: [],
            },
          ],
        },
      ],
    },
  });
  assert.equal(cat.items[LEVEL].canonicalId, SKIN);
  assert.equal(cat.items[LEVEL].image, undefined);
});
test('current season resolved from actual start and end times', () => {
  const now = Date.now(),
    cat = c.buildCatalog(
      {
        seasons: {
          data: [
            {
              uuid: 'past',
              parentUuid: 'episode',
              startTime: new Date(now - 2000).toISOString(),
              endTime: new Date(now - 1000).toISOString(),
            },
            {
              uuid: 'current',
              parentUuid: 'episode',
              startTime: new Date(now - 500).toISOString(),
              endTime: new Date(now + 2000).toISOString(),
            },
          ],
        },
      },
      now,
    );
  assert.equal(cat.currentSeasonId, 'current');
});
test('unknown contract XP curve remains unknown', () => {
  const p = n.normalizeProgression(
    {
      Contracts: [
        {
          ContractDefinitionID: OTHER,
          ProgressionLevelReached: 3,
          ProgressionTowardsNextLevel: 999,
        },
      ],
      Missions: [],
    },
    catalog(),
  );
  assert.equal(p.contracts[0].nextLevelXp, undefined);
  assert.equal(p.contracts[0].currentBattlepass, false);
});
test('countdown accounts for clock offset and stops at zero', () => {
  assert.equal(n.remainingSeconds(100000, 80000, 10000), 10);
  assert.equal(n.countdown(100000, 100001), 'Refresh available');
  assert.equal(n.countdown(3661000, 0), '01:01:01');
});
test('wishlist resolves skin-level offers through canonical parent', () =>
  assert.equal(n.wishlistHits(n.normalizeStore(storefront(), catalog(), 0, 0), [SKIN]).length, 1));
test('history rotation signature ignores harmless clock jitter', () => {
  const a = n.normalizeStore(storefront(), catalog(), 0, 0),
    b = { ...a, dailyExpiresAt: a.dailyExpiresAt + 1000 };
  assert.equal(n.historyEntry(ID, a).id, n.historyEntry(ID, b).id);
});
const match = () => ({
  matchInfo: {
    matchId: MATCH,
    isCompleted: true,
    mapId: 'ascent',
    queueID: 'competitive',
    gameStartMillis: 1000,
  },
  players: [
    {
      subject: ID,
      teamId: 'Blue',
      characterId: OTHER,
      stats: { kills: 24, deaths: 15, assists: 6, score: 5800, roundsPlayed: 20 },
    },
    { subject: OTHER, teamId: 'Red', stats: { kills: 100 } },
  ],
  teams: [
    { teamId: 'Blue', won: true, roundsWon: 13 },
    { teamId: 'Red', won: false, roundsWon: 7 },
  ],
  roundResults: [
    {
      playerStats: [
        { subject: ID, damage: [{ headshots: 3, bodyshots: 6, legshots: 1 }] },
        { subject: OTHER, damage: [{ headshots: 900 }] },
      ],
    },
  ],
});
test('match report calculates self ACS and self hit-based headshot rate', () => {
  const data = n.normalizeMatchDetail(match(), ID, catalog());
  assert.equal(data.acs, 290);
  assert.equal(data.headshotPct, 30);
  assert.equal(data.kills, 24);
  assert.equal(data.result, 'WIN');
});
test('match without own account is rejected', () =>
  assert.throws(() => n.normalizeMatchDetail(match(), SKIN, catalog()), code('ACCOUNT_MISMATCH')));
test('missing hit data remains unknown, not 0%', () => {
  const m = match();
  delete m.roundResults;
  assert.equal(n.normalizeMatchDetail(m, ID, catalog()).headshotPct, null);
});
test('uncompleted match does not fabricate a win', () => {
  const m = match();
  m.matchInfo.isCompleted = false;
  assert.equal(n.normalizeMatchDetail(m, ID, catalog()).result, 'UNKNOWN');
});
test('demo snapshots stay explicitly marked and reports reflect selected map', () => {
  const demo = makeDemo();
  assert.equal(demo.snapshot.demo, true);
  assert.equal(demo.snapshot.store.data.endpoint, 'demo');
  const m = demo.snapshot.matches.data[1];
  assert.equal(demoMatch(m.id).map, m.map);
  assert.equal(demoMatch(m.id).result, 'LOSS');
});

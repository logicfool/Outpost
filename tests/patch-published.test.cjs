const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./patch-published-fixture.cjs');
const { ID, OTHER, MATCH, response } = require('./helpers.cjs');
const {
  buildCatalog,
  catalogItem,
  CatalogClient,
  CATALOG_PATHS,
} = require('../.test-build/catalog.js');
const { HttpClient, SingleFlightCache } = require('../.test-build/http.js');
const { mapMetadata, hydrateMatchSummary, hydrateMatchDetail } = require('../.test-build/maps.js');
const {
  normalizeMatchDetail,
  normalizeStore,
  ITEM_TYPES,
  CURRENCIES,
} = require('../.test-build/normalize.js');
const {
  hydrateSnapshotMetadata,
  missingCatalogPaths,
} = require('../.test-build/catalogRecovery.js');
const { rememberBundles, bundleContents } = require('../.test-build/bundles.js');
const { cardArtworkCandidates } = require('../.test-build/playerCardArt.js');
const { makeDemo, demoMatch } = require('../.test-build/demo.js');
const { liveWeaponCategory } = require('../.test-build/liveLoadoutView.js');

test('published Gauntlet map metadata replaces all earlier aliases without mapping TDM Glitch', () => {
  const c = buildCatalog(f.responses);
  c.maps['tdm'] = { name: 'Glitch', image: 'https://media.valorant-api.com/tdm.png' };
  for (const id of [
    f.MAP,
    'AbilityDraftArena',
    'Gauntlet: Glitched',
    '/Game/Maps/AbilityDraft/AbilityDraftArena',
    '/game/maps/abilitydraft/abilitydraft',
  ]) {
    const map = mapMetadata(c, id);
    assert.equal(map.name, 'Gauntlet');
    assert.equal(map.image, f.responses.maps.data[0].splash);
    assert.equal(map.minimap, undefined);
  }
  assert.equal(mapMetadata(c, 'Glitch').image, c.maps.tdm.image);
  assert.equal(mapMetadata(c, '/Game/Maps/Other/AbilityDraft'), undefined);
});
test('saved Gauntlet history gains the published map art and drops an unrelated old minimap', () => {
  const c = buildCatalog(f.responses),
    d = { ...demoMatch(MATCH), map: 'Unknown map', mapId: undefined, queue: 'abilitydraftarena' };
  d.analysis = {
    ...d.analysis,
    minimap: { name: 'Wrong', minimap: 'https://media.valorant-api.com/wrong.png' },
  };
  const updated = hydrateMatchDetail(c, d);
  assert.equal(updated.map, 'Gauntlet');
  assert.equal(updated.analysis.minimap, undefined);
  assert.equal(updated.score, d.score);
  assert.equal(updated.startedAt, d.startedAt);
  assert.equal(
    hydrateMatchSummary(c, {
      id: MATCH,
      map: 'Gauntlet: Glitched',
      queue: 'abilitydraftarena',
      startedAt: 100,
    }).map,
    'Gauntlet',
  );
});
test('published cosmetic IDs resolve across levels, variants, avatars and current bundle membership', () => {
  const c = buildCatalog(f.responses);
  assert.equal(catalogItem(c, f.LEVEL).canonicalId, f.SKIN);
  assert.equal(catalogItem(c, f.CHROMA).kind, 'chroma');
  assert.equal(c.weapons[f.WEAPON].name, 'Warden');
  assert.equal(c.weapons[f.WEAPON].category, 'Rifle');
  assert.equal(catalogItem(c, f.CARD, 'card').name, 'Warden Card');
  assert.ok(
    cardArtworkCandidates(c.items[f.CARD], 'wide', c).includes(
      f.responses.playercards.data[0].wideArt,
    ),
  );
  assert.equal(bundleContents(c, f.BUNDLE).name, 'Warden Launch');
  assert.equal(bundleContents(c, f.BUNDLE).image, f.responses.bundles.data[0].displayIcon);
  // A public bundle name is not proof of its included items.
  assert.deepEqual(bundleContents(c, f.BUNDLE).items, []);
});
test('eight-team match result uses the actual winner and never invents a two-team score', () => {
  const raw = {
    matchInfo: {
      matchId: MATCH,
      mapId: '/Game/Maps/AbilityDraft/AbilityDraft',
      queueID: 'abilitydraftarena',
      isCompleted: true,
    },
    players: [{ subject: ID, teamId: 'Team1', stats: { kills: 3, deaths: 2, assists: 1 } }],
    teams: Array.from({ length: 8 }, (_, i) => ({
      teamId: `Team${i + 1}`,
      won: i === 7,
      roundsWon: i === 7 ? 7 : 1,
    })),
  };
  const detail = normalizeMatchDetail(raw, ID, buildCatalog(f.responses));
  assert.equal(detail.result, 'LOSS');
  assert.equal(detail.score, '-');
  assert.equal(detail.teams.length, 8);
  raw.teams.forEach((team, index) => {
    team.won = index === 0;
  });
  assert.equal(normalizeMatchDetail(raw, ID, buildCatalog(f.responses)).result, 'WIN');
  raw.teams.forEach((team) => {
    team.won = false;
  });
  assert.equal(normalizeMatchDetail(raw, ID, buildCatalog(f.responses)).result, 'UNKNOWN');
});
test('cached identity and owned new cards hydrate locally without changing freshness or prices', () => {
  const { snapshot } = makeDemo(),
    c = buildCatalog(f.responses);
  snapshot.loadout.data.card = catalogItem(buildCatalog({}), f.CARD, 'card');
  snapshot.collection.data = [snapshot.loadout.data.card];
  const old = structuredClone(snapshot);
  assert.ok(missingCatalogPaths(snapshot, buildCatalog({})).includes('playercards'));
  const next = hydrateSnapshotMetadata(c, snapshot);
  assert.equal(next.loadout.data.card.name, 'Warden Card');
  assert.equal(next.collection.data[0].name, 'Warden Card');
  assert.equal(next.loadout.fetchedAt, old.loadout.fetchedAt);
  assert.equal(next.fetchedAt, old.fetchedAt);
  assert.deepEqual(
    next.store.data.daily.map((o) => o.prices),
    old.store.data.daily.map((o) => o.prices),
  );
  assert.deepEqual(snapshot, old);
});
test('a published release refresh bypasses old category caches without any Riot credentials', async () => {
  const seen = [];
  let published = false;
  const client = new CatalogClient(
    new HttpClient(async (url, init) => {
      seen.push({ url, headers: new Headers(init.headers) });
      const path = new URL(url).pathname.split('/').pop();
      return response(published ? (f.responses[path] ?? { data: [] }) : { data: [] });
    }),
  );
  const old = await client.load(undefined, 'release-13.05-shipping-11-5350494');
  published = true;
  const next = await client.load(old, f.version, true);
  assert.equal(next.sourceVersion, f.version);
  assert.equal(next.items[f.CARD].name, 'Warden Card');
  assert.equal(next.weapons[f.WEAPON].name, 'Warden');
  assert.equal(seen.length, CATALOG_PATHS.length * 2);
  assert.ok(
    seen.every(
      (r) =>
        r.headers.get('Authorization') === null && new URL(r.url).hostname === 'valorant-api.com',
    ),
  );
});
test('a failed category retains prior items and cannot claim a completed new-release catalogue', async () => {
  const previous = {
    ...buildCatalog(f.responses, 123),
    sourceVersion: 'release-13.05-shipping-11-5350494',
  };
  const client = new CatalogClient(
    new HttpClient(async (url) => {
      const path = new URL(url).pathname.split('/').pop();
      if (path === 'playercards') return response({ error: 'offline' }, 503);
      return response(f.responses[path] ?? { data: [] });
    }),
  );
  const next = await client.load(previous, f.version, true);
  assert.ok(next.failedPaths.includes('playercards'));
  assert.equal(next.items[f.CARD].name, 'Warden Card');
  assert.equal(next.sourceVersion, previous.sourceVersion);
  assert.equal(next.availableVersion, f.version);
});
test('client headers do not retain a successful version lookup for a whole day', async () => {
  let now = 1000,
    calls = 0,
    version = 'release-13.05-shipping-11-5350494';
  const client = new CatalogClient(
    new HttpClient(async () => {
      calls++;
      return response({ data: { riotClientVersion: version } });
    }),
  );
  client.cache = new SingleFlightCache(() => now);
  assert.equal(await client.version(), version);
  version = f.version;
  now += 15 * 60000 + 1;
  assert.equal(await client.version(), f.version);
  assert.equal(calls, 2);
  await client.version();
  assert.equal(calls, 2);
  await client.version(true);
  assert.equal(calls, 3);
});
test('multi-team live rosters cannot select an arbitrary first opponent as the match score', () => {
  const { matchProgress, ownLiveProgress } = require('../.test-build/liveProgress.js');
  const Teams = Array.from({ length: 8 }, (_, i) => ({ TeamID: `Team${i}`, RoundsWon: i }));
  assert.equal(matchProgress({ Teams }, 'Team0', 'abilitydraftarena', 100), undefined);
  const players = Teams.map((t, i) => ({ subject: 'player' + i, teamId: t.TeamID, self: i === 0 }));
  assert.equal(
    ownLiveProgress(
      {
        state: 'in_game',
        players,
        progress: { allyScore: 1, enemyScore: 2, observedAt: 100, source: 'match' },
      },
      undefined,
      true,
      100,
    ),
    undefined,
  );
});

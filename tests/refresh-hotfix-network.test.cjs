const test = require('node:test'),
  assert = require('node:assert/strict');
const { RiotClient } = require('../.test-build/riot.js'),
  { HttpClient } = require('../.test-build/http.js');
const { ID, OTHER, MATCH, session, response, catalog } = require('./helpers.cjs');
const { emptySnapshot } = require('../.test-build/refreshPolicy.js');
const { encodeAimDocument } = require('../.test-build/aimCodec.js');
const { document, clone } = require('./aim-helpers.cjs');
const SEASON = '66666666-6666-4666-8666-666666666666';
function fixture() {
  let revision = 1,
    active = false;
  const calls = [],
    cat = {
      ...catalog(),
      currentSeasonId: SEASON,
      tiers: { 8: { name: 'BRONZE 3' } },
      seasons: { [SEASON]: { name: 'Fixture Act', startsAt: 1 } },
    };
  const client = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      const p = new URL(url).pathname;
      calls.push({ p, init });
      if (p.startsWith('/content-service')) return response({});
      if (p.endsWith('/competitiveupdates')) return response({ Matches: [] });
      if (p.startsWith('/mmr/'))
        return response({
          Subject: ID,
          QueueSkills: {
            competitive: {
              SeasonalInfoBySeasonID: {
                [SEASON]: {
                  CompetitiveTier: 8,
                  RankedRating: revision,
                  NumberOfGames: 2,
                  NumberOfWins: 1,
                },
              },
            },
          },
        });
      if (p.startsWith('/account-xp/'))
        return response({ Subject: ID, Progress: { Level: 50 + revision, XP: revision } });
      if (p.startsWith('/contracts/')) return response({ Contracts: [], Missions: [] });
      if (p.startsWith('/match-history/'))
        return response({
          Subject: ID,
          History: [
            {
              MatchID: revision === 1 ? MATCH : OTHER,
              GameStartTime: Date.now(),
              QueueID: 'competitive',
            },
          ],
        });
      if (p.startsWith('/personalization/'))
        return response({
          Subject: ID,
          Version: revision,
          Guns: [],
          Identity: { PlayerCardID: MATCH, PlayerTitleID: MATCH },
          Sprays: [],
        });
      if (p.endsWith('/players/' + ID) && p.startsWith('/core-game/'))
        return active ? response({ Subject: ID, MatchID: MATCH }) : response({}, 404);
      if (p.startsWith('/pregame/')) return response({}, 404);
      if (p.startsWith('/core-game/v1/matches/'))
        return response({
          MatchID: MATCH,
          MapID: 'fixture-map',
          Players: [
            { Subject: ID, TeamID: 'Blue', Stats: { Kills: revision, Deaths: 0, Assists: 0 } },
          ],
        });
      throw Error('Unexpected fixture request: ' + p);
    }),
    { version: async () => 'release-fixture' },
    cat,
  );
  return {
    client,
    calls,
    advance: () => {
      revision++;
      active = true;
    },
  };
}
test('fresh Profile transport replaces cached rank, XP, loadout and history head', async () => {
  const h = fixture(),
    plan = { store: false, account: true, collection: false, live: false };
  const first = await h.client.snapshot(emptySnapshot(ID), plan);
  assert.equal(first.xp.data.level, 51);
  assert.equal(first.matches.data[0].id, MATCH);
  h.advance();
  const fresh = await h.client.snapshot(first, { ...plan, fresh: true });
  assert.equal(fresh.xp.data.level, 52);
  assert.equal(fresh.rank.data.rr, 2);
  assert.equal(fresh.loadout.data.version, 2);
  assert.equal(fresh.matches.data[0].id, OTHER);
  const requests = h.calls.filter((c) => c.p.includes('/match-history/'));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].init.cache, 'no-store');
  assert.match(requests[1].init.headers['Cache-Control'], /no-cache/);
  assert.ok(!h.calls.some((c) => /catalog|storefront|entitlements/.test(c.p)));
});
test('fresh live lookup invalidates idle discovery and underlying five-second detail cache', async () => {
  const h = fixture();
  assert.equal((await h.client.liveGame()).state, 'idle');
  h.advance();
  const active = await h.client.liveGame(true);
  assert.equal(active.state, 'in_game');
  assert.equal(active.players[0].stats.kills, 2);
  h.advance();
  assert.equal((await h.client.liveGame(true)).players[0].stats.kills, 3);
  assert.equal(h.calls.filter((c) => c.p.includes('/core-game/v1/matches/')).length, 2);
});
test('fresh settings reads adopt changed server values and never issue a settings write', async () => {
  let doc = document();
  const methods = [],
    client = new RiotClient(
      session(),
      new HttpClient(async (url, init) => {
        methods.push(init);
        return response(encodeAimDocument(doc.data));
      }),
      { version: async () => 'release-fixture' },
      catalog(),
    );
  const first = await client.readAimDocument();
  doc = clone(doc);
  doc.data.floatSettings[0].value = 0.71;
  const second = await client.readAimDocument();
  assert.notEqual(first.data.floatSettings[0].value, second.data.floatSettings[0].value);
  assert.equal(second.data.floatSettings[0].value, 0.71);
  assert.ok(
    methods.every(
      (i) => (i.method ?? 'GET') === 'GET' && i.cache === 'no-store' && i.credentials === 'omit',
    ),
  );
});
test('fresh read flags do not bypass HttpClient origin rate limits', async () => {
  let calls = 0,
    now = 1000;
  const http = new HttpClient(
    async () => {
      calls++;
      return response({}, 429, { 'retry-after': '120' });
    },
    () => now,
  );
  const client = new RiotClient(
    session(),
    http,
    { version: async () => 'release-fixture' },
    catalog(),
  );
  await assert.rejects(client.liveGame(true), (e) => e.code === 'RATE_LIMIT');
  now += 5000;
  await assert.rejects(client.liveGame(true), (e) => e.code === 'RATE_LIMIT');
  assert.equal(calls, 1);
});
test('slow name resolution cannot hold back current-match status and counters', async () => {
  let resolveNames,
    namesFinished = false;
  const pending = new Promise((r) => (resolveNames = r));
  const client = new RiotClient(
    session(),
    new HttpClient(async (url) => {
      if (url.includes('/name-service/')) {
        await pending;
        namesFinished = true;
        return response([{ Subject: OTHER, GameName: 'Resolved', TagLine: 'TEST' }]);
      }
      if (url.includes('/players/')) return response({ Subject: ID, MatchID: MATCH });
      return response({
        MatchID: MATCH,
        MapID: 'fixture-map',
        Players: [
          { Subject: ID, TeamID: 'Blue', Stats: { Kills: 7, Deaths: 2, Assists: 1 } },
          { Subject: OTHER, TeamID: 'Red' },
        ],
      });
    }),
    { version: async () => 'release-fixture' },
    catalog(),
  );
  try {
    const game = await client.liveGame(true);
    assert.equal(namesFinished, false);
    assert.equal(game.state, 'in_game');
    assert.equal(game.players.find((p) => p.self).stats.kills, 7);
  } finally {
    resolveNames();
  }
  await new Promise((r) => setImmediate(r));
  assert.equal((await client.liveGame()).players.find((p) => p.subject === OTHER).name, 'Resolved');
});
test('live requests get the next free bounded HTTP slot without starving regular reads', async () => {
  const order = [],
    release = [];
  const client = new HttpClient(
    async (url) => {
      order.push(new URL(url).pathname);
      await new Promise((r) => release.push(r));
      return response({});
    },
    Date.now,
    1,
  );
  const a = client.json('https://example.test/busy');
  await new Promise((r) => setImmediate(r));
  const b = client.json('https://example.test/profile'),
    c = client.json('https://example.test/live', {}, { priority: 'interactive' });
  release.shift()();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['/busy', '/live']);
  release.shift()();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['/busy', '/live', '/profile']);
  release.shift()();
  await Promise.all([a, b, c]);
});

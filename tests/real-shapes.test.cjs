const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ID,
  OTHER,
  SKIN,
  LEVEL,
  MATCH,
  jwt,
  session,
  response,
  catalog,
  code,
} = require('./helpers.cjs');
const { HttpClient } = require('../.test-build/http.js');
const { parseJsonBody, readBoundedText } = require('../.test-build/responseBody.js');
const { chatRouting } = require('../.test-build/chatRouting.js');
const { parseChatBootstrap } = require('../.test-build/chatBootstrap.js');
const { RiotClient } = require('../.test-build/riot.js');
const { prepareIdentityEdit } = require('../.test-build/identity.js');
const { PlayerScope } = require('../.test-build/playerScope.js');
const { playerLabel, nameAliases } = require('../.test-build/playerNames.js');
const {
  buildCatalog,
  CatalogClient,
  catalogItem,
  hydrateItem,
} = require('../.test-build/catalog.js');
const { normalizeMatchDetail } = require('../.test-build/normalize.js');
const { artworkCandidates, priorityArtwork } = require('../.test-build/artwork.js');
const { clearDiagnostics, requestDiagnostics } = require('../.test-build/diagnostics.js');
const pub = { version: async () => 'release-fixture-1' };
const client = (fetch) => new RiotClient(session(), new HttpClient(fetch), pub, catalog());
const config = {
  'chat.affinities': { ap: 'ap1.chat.si.riotgames.com' },
  'chat.affinity_domains': { ap: 'ap1' },
};
const loadout = () => ({
  Subject: ID,
  Version: 7,
  Guns: [{ ID: SKIN, SkinLevelID: LEVEL }],
  ActiveExpressions: [
    { TypeID: 'spray', AssetID: OTHER, Future: { keep: true } },
    { TypeID: 'flex', AssetID: SKIN },
  ],
  Identity: {
    PlayerCardID: SKIN,
    PlayerTitleID: LEVEL,
    HideAccountLevel: true,
    PreferredLevelBorderID: OTHER,
  },
  Incognito: true,
});
const rawMatch = () => ({
  matchInfo: { matchId: MATCH, isCompleted: true },
  players: [
    {
      subject: ID,
      teamId: 'Blue',
      gameName: '',
      tagLine: '',
      playerCard: SKIN,
      accountLevel: 50,
      stats: {},
    },
    { subject: OTHER, teamId: 'Red', gameName: '', tagLine: '', playerCard: LEVEL, stats: {} },
  ],
  teams: [
    { teamId: 'Blue', won: true, roundsWon: 13 },
    { teamId: 'Red', won: false, roundsWon: 7 },
  ],
  roundResults: [],
});

test('Riot bare chat-domain labels receive their .pvp.net suffix and omitted port defaults to TLS', () => {
  assert.deepEqual(chatRouting(config, 'ap'), {
    host: 'ap1.chat.si.riotgames.com',
    domain: 'ap1.pvp.net',
    port: 5223,
  });
  const pas = jwt({ sub: ID, affinity: 'ap', exp: Date.now() / 1000 + 3600 });
  assert.equal(parseChatBootstrap(session(), pas, config).domain, 'ap1.pvp.net');
});
test('fully qualified chat domain and numeric-string TLS port remain compatible', () => {
  assert.equal(
    chatRouting(
      { ...config, 'chat.affinity_domains': { ap: 'ap1.pvp.net' }, 'chat.port': '5223' },
      'ap',
    ).domain,
    'ap1.pvp.net',
  );
});
test('chat routing still rejects plaintext ports, untrusted hosts, URLs and missing affinity', () => {
  for (const patch of [
    { 'chat.port': 5222 },
    { 'chat.port': null },
    { 'chat.affinities': { ap: 'evil.example' } },
    { 'chat.affinity_domains': { ap: 'https://ap1.pvp.net' } },
    { 'chat.affinity_domains': { ap: 'ap1.pvp.net.evil.example' } },
  ])
    assert.throws(() => chatRouting({ ...config, ...patch }, 'ap'), code('CHAT_CONFIG'));
  assert.throws(() => chatRouting(config, 'missing'), code('CHAT_CONFIG_MISSING'));
});
for (const mime of [
  'text/plain; charset=utf-8',
  'application/octet-stream',
  'application/json; charset=utf-8',
  '',
])
  test(`valid Riot JSON is accepted under ${mime || 'missing MIME'}`, async () => {
    const c = new HttpClient(async () =>
      response({ Subject: ID, QueueSkills: {} }, 200, { 'content-type': mime }),
    );
    assert.equal((await c.json('https://pd.ap.a.pvp.net/mmr/v1/players/' + ID)).data.Subject, ID);
  });
test('HTML challenges, malformed JSON and primitive values never become account records', () => {
  for (const value of ['<html>Challenge</html>', '{truncated', 'null', 'true', '[];fetch(1)'])
    assert.throws(() => parseJsonBody(value, 'text/plain'), code('SCHEMA'));
  assert.throws(() => parseJsonBody('{}', 'text/html'), code('SCHEMA'));
  assert.deepEqual(parseJsonBody('\uFEFF  {"ok":true} ', ''), { ok: true });
});
test('actual streamed byte size is bounded without trusting Content-Length', async () => {
  await assert.rejects(readBoundedText(new Response('x'.repeat(100)), 20), code('RESPONSE_SIZE'));
});
test('rank endpoint text/plain response is parsed before rank normalization', async () => {
  const c = client(async (url) =>
    url.includes('content-service')
      ? response({ Seasons: [{ ID: SKIN, Type: 'act', IsActive: true }] })
      : response(
          {
            Subject: ID,
            QueueSkills: {},
            LatestCompetitiveUpdate: {
              SeasonID: SKIN,
              TierAfterUpdate: 8,
              RankedRatingAfterUpdate: 55,
            },
          },
          200,
          { 'content-type': 'text/plain' },
        ),
  );
  const rank = await c.rank();
  assert.equal(rank.name, 'Bronze 3');
  assert.equal(rank.rr, 55);
});
test('v3 equipped loadout is fetched first and its identity is returned', async () => {
  const urls = [],
    c = client(async (url) => {
      urls.push(url);
      return response(loadout());
    });
  const equipped = await c.loadout();
  assert.match(urls[0], /personalization\/v3\//);
  assert.equal(urls.length, 1);
  assert.equal(equipped.card.id, SKIN);
  assert.equal(equipped.endpoint, 'v3');
});
test('only a missing v3 GET endpoint may negotiate v2', async () => {
  const urls = [],
    c = client(async (url) => {
      urls.push(url);
      return url.includes('/v3/') ? response({}, 404) : response({ ...loadout(), Sprays: [] });
    });
  assert.equal((await c.loadout()).endpoint, 'v2');
  assert.equal(urls.length, 2);
});
for (const status of [401, 403, 429, 500])
  test(`v3 loadout ${status} cannot trigger version or permission workarounds`, async () => {
    let calls = 0;
    const c = client(async () => {
      calls++;
      return response({}, status);
    });
    await assert.rejects(c.loadout());
    assert.equal(calls, 1);
  });
test('v3 identity save preserves all ActiveExpressions, guns, title and privacy', () => {
  const raw = loadout(),
    updated = prepareIdentityEdit(
      raw,
      { cardId: OTHER, expectedVersion: 7 },
      new Set([OTHER]),
      new Set(),
    );
  assert.deepEqual(updated.ActiveExpressions, raw.ActiveExpressions);
  assert.deepEqual(updated.Guns, raw.Guns);
  assert.equal(updated.Sprays, undefined);
  assert.equal(updated.Identity.PlayerTitleID, LEVEL);
  assert.equal(updated.Identity.HideAccountLevel, true);
  assert.equal(updated.Incognito, true);
  assert.equal(raw.Identity.PlayerCardID, SKIN);
});
test('v3 identity PUT uses the negotiated read route exactly once and verifies readback', async () => {
  let state = loadout(),
    puts = 0;
  const c = client(async (url, init) => {
    if (url.includes('/entitlements/')) return response({ Entitlements: [{ ItemID: OTHER }] });
    assert.match(url, /personalization\/v3\//);
    if (init.method === 'PUT') {
      puts++;
      state = { ...state, ...JSON.parse(init.body), Version: 8 };
    }
    return response(state);
  });
  assert.equal((await c.saveIdentity({ cardId: OTHER, expectedVersion: 7 })).card.id, OTHER);
  assert.equal(puts, 1);
  assert.equal(state.ActiveExpressions.length, 2);
});
test('failed identity PUT is not retried at v2 or replayed', async () => {
  let puts = 0;
  const c = client(async (url, init) =>
    url.includes('/entitlements/')
      ? response({ Entitlements: [{ ItemID: OTHER }] })
      : init.method === 'PUT'
        ? (puts++, response({}, 404))
        : response(loadout()),
  );
  await assert.rejects(c.saveIdentity({ cardId: OTHER, expectedVersion: 7 }));
  assert.equal(puts, 1);
});
test('a placeholder match name cannot replace a known account identity', () => {
  const scope = new PlayerScope(ID, 'Void', '00099');
  scope.remember({ subject: ID, name: 'Player', tag: '', card: { id: SKIN } });
  assert.equal(scope.player(ID).player.name, 'Void');
  assert.equal(scope.player(ID).player.tag, '00099');
});
test('only authenticated self is labelled You, independent of report perspective', () => {
  assert.equal(playerLabel({ subject: ID, name: 'Void', tag: '00099' }, ID), 'You');
  assert.equal(playerLabel({ subject: OTHER, name: 'Rival', tag: '' }, ID), 'Rival');
  assert.equal(playerLabel({ subject: OTHER, name: 'Player', tag: '' }, ID), 'Name unavailable');
});
test('empty match names resolve through the documented v2 name-service array response', async () => {
  let nameCalls = 0;
  const c = client(async (url, init) => {
    if (url.includes('name-service')) {
      nameCalls++;
      assert.deepEqual(JSON.parse(init.body), [OTHER]);
      return response([{ Subject: OTHER, GameName: 'Rival', TagLine: 'ABCD' }], 200, {
        'content-type': 'text/plain',
      });
    }
    return response(rawMatch());
  });
  c.scope.allowMatch(ID, MATCH);
  const detail = await c.matchDetail(MATCH);
  assert.equal(detail.players.find((p) => p.subject === ID).name, 'Fixture');
  assert.equal(detail.players.find((p) => p.subject === OTHER).name, 'Rival');
  await c.matchDetail(MATCH);
  assert.equal(nameCalls, 1);
});
test('opening a foreign perspective does not reveal its hidden identity or level', () => {
  const raw = rawMatch();
  raw.players[1].incognito = true;
  raw.players[1].hideAccountLevel = true;
  raw.players[1].gameName = 'Hidden';
  raw.players[1].accountLevel = 200;
  const d = normalizeMatchDetail(raw, OTHER, catalog(), ID),
    p = d.players.find((p) => p.subject === OTHER);
  assert.equal(p.hidden, true);
  assert.equal(p.name, 'Hidden player');
  assert.equal(p.level, null);
});
test('name-service responses cannot inject aliases for unrequested subjects', () => {
  assert.equal(nameAliases([{ Subject: OTHER, GameName: 'Injected' }], [ID]).size, 0);
});
test('battle-pass Radianite resolves immediately, even before refreshed currency metadata', () => {
  const item = catalogItem(catalog(), 'e59aa87c-4cbf-517a-5983-6e81511be9b7');
  assert.equal(item.kind, 'currency');
  assert.match(item.name, /Radianite/);
  assert.match(item.image, /currencies/);
});
test('sprays retain transparent/full fallback artwork and parent image for level IDs', () => {
  const c = buildCatalog({
    sprays: {
      data: [
        {
          uuid: SKIN,
          displayName: 'Spray',
          displayIcon: 'https://media.valorant-api.com/a.png',
          fullTransparentIcon: 'https://media.valorant-api.com/b.png',
          levels: [{ uuid: LEVEL, displayIcon: 'https://media.valorant-api.com/c.png' }],
        },
      ],
    },
  });
  assert.deepEqual(artworkCandidates(c.items[LEVEL]), [
    'https://media.valorant-api.com/a.png',
    'https://media.valorant-api.com/c.png',
    'https://media.valorant-api.com/b.png',
  ]);
});
test('stale store items are rehydrated from repaired metadata', () => {
  const c = catalog();
  c.items[SKIN].image = 'https://media.valorant-api.com/a.png';
  assert.equal(
    hydrateItem(c, { id: SKIN, canonicalId: SKIN, kind: 'unknown', name: 'Unresolved item' }).image,
    c.items[SKIN].image,
  );
});
test('metadata failures are recorded and a subsequent refresh preserves previous useful entries', async () => {
  const c = new CatalogClient(
    new HttpClient(async (url) =>
      url.includes('/sprays') ? response({}, 500) : response({ data: [] }),
    ),
  );
  const old = catalog(),
    result = await c.load(old);
  assert.ok(result.failedPaths.includes('sprays'));
  assert.ok(result.items[SKIN]);
  assert.equal(result.schemaVersion, 6);
});
test('artwork warmup does not preload the whole collection', () => {
  const item = {
    id: SKIN,
    canonicalId: SKIN,
    kind: 'spray',
    name: 'Spray',
    image: 'https://media.valorant-api.com/a.png',
  };
  const snapshot = {
    loadout: { status: 'error' },
    store: {
      status: 'ready',
      data: { accessories: Array.from({ length: 100 }, () => ({ item })), daily: [] },
    },
  };
  assert.deepEqual(priorityArtwork(snapshot, catalog()), ['https://media.valorant-api.com/a.png']);
});
test('diagnostics record only route categories and format metadata, never IDs or bodies', async () => {
  clearDiagnostics();
  const c = new HttpClient(async () =>
    response({ private: 'sensitive-payload' }, 200, { 'content-type': 'text/plain; secret=value' }),
  );
  await c.json('https://pd.ap.a.pvp.net/mmr/v1/players/' + ID, {
    headers: { Authorization: 'Bearer secret-token' },
  });
  const data = JSON.stringify(requestDiagnostics());
  assert.equal(data.includes(ID), false);
  assert.equal(data.includes('secret'), false);
  assert.equal(data.includes('sensitive'), false);
  assert.equal(requestDiagnostics()[0].service, 'Rank');
  assert.equal(requestDiagnostics()[0].mime, 'plain');
});

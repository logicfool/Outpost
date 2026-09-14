const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ID,
  OTHER,
  MATCH,
  SKIN,
  LEVEL,
  session,
  response,
  catalog,
  code,
} = require('./helpers.cjs');
const { RiotClient } = require('../.test-build/riot.js');
const { HttpClient } = require('../.test-build/http.js');
const { resolveRank, catalogWithContent } = require('../.test-build/rank.js');
const { normalizeLive, glzOrigin } = require('../.test-build/live.js');
const { prepareIdentityEdit, verifyIdentity } = require('../.test-build/identity.js');
const { PlayerScope } = require('../.test-build/playerScope.js');
const {
  walletOverview,
  normalizeWallet,
  CURRENCIES,
  AGENT_TOKEN_ID,
  normalizeLoadout,
} = require('../.test-build/normalize.js');
const { buildCatalog } = require('../.test-build/catalog.js');
const active = '66666666-6666-4666-8666-666666666666';
const old = '77777777-7777-4777-8777-777777777777';
const pub = { version: async () => 'release-fixture-1' };
const client = (fetch) => new RiotClient(session(), new HttpClient(fetch), pub, catalog());
const roster = () => ({
  MatchID: MATCH,
  MapID: 'ascent',
  Players: [
    {
      Subject: ID,
      TeamID: 'Blue',
      CharacterID: SKIN,
      PlayerIdentity: { AccountLevel: 50, PlayerCardID: LEVEL },
    },
    {
      Subject: OTHER,
      TeamID: 'Red',
      PlayerIdentity: { AccountLevel: 100, Incognito: true, HideAccountLevel: true },
    },
  ],
});
const loadout = () => ({
  Subject: ID,
  Version: 4,
  Identity: {
    PlayerCardID: SKIN,
    PlayerTitleID: LEVEL,
    HideAccountLevel: true,
    AccountLevel: 60,
    PreferredLevelBorderID: '',
  },
  Incognito: true,
  Guns: [{ ID: 'weapon', SkinID: SKIN, unknownFutureField: 1 }],
  Sprays: [{ SprayID: OTHER }],
});

test('wallet shows only VP, RP and KC; agent token is not a fourth money balance', () => {
  const raw = normalizeWallet({
    Balances: {
      [CURRENCIES.VP.toUpperCase()]: 100,
      [CURRENCIES.RP]: 75,
      [CURRENCIES.KC]: 2722,
      [AGENT_TOKEN_ID]: 1,
    },
  });
  assert.equal(raw.find((x) => x.currencyId === AGENT_TOKEN_ID).symbol, 'Agent token');
  assert.deepEqual(
    walletOverview(raw).map((x) => [x.symbol, x.amount]),
    [
      ['VP', 100],
      ['RP', 75],
      ['KC', 2722],
    ],
  );
});
test('missing wallet balance stays unknown; zero stays zero', () =>
  assert.deepEqual(
    walletOverview([{ currencyId: CURRENCIES.VP, symbol: 'Currency', amount: 0 }]).map(
      (x) => x.amount,
    ),
    [0, null, null],
  ));
test('equipped card retains wide and tall artwork, titles use readable titleText', () => {
  const cat = buildCatalog({
    playercards: {
      data: [
        {
          uuid: SKIN,
          displayName: 'Card',
          wideArt: 'https://media.valorant-api.com/wide.png',
          largeArt: 'https://media.valorant-api.com/tall.png',
        },
      ],
    },
    playertitles: {
      data: [{ uuid: LEVEL, displayName: 'Internal title label', titleText: 'In Control' }],
    },
  });
  const data = normalizeLoadout(loadout(), cat);
  assert.equal(data.version, 4);
  assert.match(data.card.wideArt, /wide/);
  assert.match(data.card.wallpaper, /tall/);
  assert.equal(data.title.name, 'In Control');
});
test('server content overrides stale public active act without dropping dates', () => {
  const cat = {
    ...catalog(),
    currentSeasonId: old,
    seasons: { [active]: { name: 'Current', startsAt: 42 } },
  };
  const next = catalogWithContent(cat, { Seasons: [{ ID: active, Type: 'act', IsActive: true }] });
  assert.equal(next.currentSeasonId, active);
  assert.equal(next.seasons[active].startsAt, 42);
});
test('rank falls back to the matching latest competitive update', () => {
  const result = resolveRank(
    {
      QueueSkills: {},
      LatestCompetitiveUpdate: {
        SeasonID: active,
        TierAfterUpdate: 8,
        RankedRatingAfterUpdate: 55,
      },
    },
    { ...catalog(), currentSeasonId: active },
  );
  assert.equal(result.name, 'Bronze 3');
  assert.equal(result.rr, 55);
  assert.equal(result.currentSeason, true);
});
test('old rank is labelled last reported rather than falsely current', () => {
  const result = resolveRank(
    {
      QueueSkills: {},
      LatestCompetitiveUpdate: { SeasonID: old, TierAfterUpdate: 9, RankedRatingAfterUpdate: 50 },
    },
    { ...catalog(), currentSeasonId: active },
  );
  assert.equal(result.name, 'Silver 1');
  assert.equal(result.currentSeason, false);
  assert.match(result.note, /Last reported/);
});
test('explicit active tier zero is not replaced by a historical rank', () => {
  const result = resolveRank(
    {
      QueueSkills: {
        competitive: {
          SeasonalInfoBySeasonID: {
            [active]: { CompetitiveTier: 0, RankedRating: 0 },
            [old]: { CompetitiveTier: 20 },
          },
        },
      },
      LatestCompetitiveUpdate: { SeasonID: old, TierAfterUpdate: 20 },
    },
    { ...catalog(), currentSeasonId: active },
  );
  assert.equal(result.tier, 0);
  assert.equal(result.rr, null);
  assert.equal(result.currentSeason, true);
});
test('missing rank payload is an error, not an invented unranked player', () =>
  assert.throws(() => resolveRank({}, catalog()), code('SCHEMA')));
test('rank selection uses dates rather than UUID lexical ordering', () => {
  const cat = { ...catalog(), seasons: { [active]: { startsAt: 20 }, [old]: { startsAt: 10 } } };
  const result = resolveRank(
    {
      QueueSkills: {
        competitive: {
          SeasonalInfoBySeasonID: {
            [old]: { CompetitiveTier: 20 },
            [active]: { CompetitiveTier: 8 },
          },
        },
      },
    },
    cat,
  );
  assert.equal(result.tier, 8);
  assert.equal(result.source, 'latest-played');
});
test('corrupt rank tier does not render a fabricated label or RR', () => {
  const result = resolveRank(
    {
      QueueSkills: {
        competitive: {
          SeasonalInfoBySeasonID: { [active]: { CompetitiveTier: 999, RankedRating: 90 } },
        },
      },
    },
    { ...catalog(), currentSeasonId: active },
  );
  assert.equal(result.tier, null);
  assert.equal(result.rr, null);
});
test('PBE uses NA GLZ region, AP uses AP, invalid hosts rejected', () => {
  assert.equal(glzOrigin('pbe', 'pbe'), 'https://glz-na-1.pbe.a.pvp.net');
  assert.equal(glzOrigin('ap', 'ap'), 'https://glz-ap-1.ap.a.pvp.net');
  assert.throws(() => glzOrigin('attacker.test', 'ap'), code('REGION'));
});
test('live roster respects hidden identities and levels', () => {
  const game = normalizeLive(roster(), 'in_game', MATCH, ID, catalog());
  assert.equal(game.players.length, 2);
  const other = game.players.find((p) => p.subject === OTHER);
  assert.equal(other.name, 'Hidden player');
  assert.equal(other.level, null);
  assert.equal(other.hidden, true);
});
test('agent select parses AllyTeam player roster', () => {
  const raw = roster();
  const game = normalizeLive(
    { MatchID: MATCH, AllyTeam: { TeamID: 'Blue', Players: raw.Players.slice(0, 1) } },
    'agent_select',
    MATCH,
    ID,
    catalog(),
  );
  assert.equal(game.players[0].teamId, 'Blue');
  assert.equal(game.state, 'agent_select');
});
test('live roster must contain the signed-in account', () => {
  const raw = roster();
  raw.Players.shift();
  assert.throws(
    () => normalizeLive(raw, 'in_game', MATCH, ID, catalog()),
    code('ACCOUNT_MISMATCH'),
  );
});
for (const status of [401, 403, 429, 500])
  test(`live ${status} never becomes idle`, async () => {
    let requests = 0;
    const c = client(async () => {
      requests++;
      return response({}, status);
    });
    await assert.rejects(c.liveGame());
    assert.equal(requests, 1);
  });
test('network failure never becomes offline', async () =>
  await assert.rejects(
    client(async () => {
      throw Error('network');
    }).liveGame(),
    code('NETWORK'),
  ));
test('unknown 400 is not treated as player absent', async () =>
  await assert.rejects(
    client(async () => response({ errorCode: 'BAD_REQUEST' }, 400)).liveGame(),
    code('ENDPOINT_UNAVAILABLE'),
  ));
test('known absent-player errors allow pregame then idle', async () => {
  const urls = [];
  const game = await client(async (url) => {
    urls.push(url);
    return response({ errorCode: 'PLAYER_DOES_NOT_EXIST' }, 400);
  }).liveGame();
  assert.equal(game.state, 'idle');
  assert.equal(urls.length, 2);
});
test('404 in current game proceeds to agent select', async () => {
  const c = client(async (url) =>
    url.includes('/core-game/')
      ? response({}, 404)
      : url.includes('/pregame/v1/players/')
        ? response({ Subject: ID, MatchID: MATCH })
        : url.includes('/name-service/')
          ? response([])
          : response({
              MatchID: MATCH,
              AllyTeam: { TeamID: 'Blue', Players: roster().Players.slice(0, 1) },
            }),
  );
  const result = await c.liveGame();
  assert.equal(result.state, 'agent_select');
  assert.equal(result.players[0].subject, ID);
});
test('match detail failure retains found live state plus explicit error', async () => {
  const c = client(async (url) =>
    url.includes('/players/') ? response({ Subject: ID, MatchID: MATCH }) : response({}, 500),
  );
  const result = await c.liveGame();
  assert.equal(result.state, 'in_game');
  assert.equal(result.detailError.code, 'SERVICE_UNAVAILABLE');
});
test('hidden player is not registered for profile browsing', () => {
  const scope = new PlayerScope(ID);
  scope.remember({ subject: OTHER, name: 'Hidden', tag: '', hidden: true });
  assert.throws(() => scope.player(OTHER), code('PROFILE_SCOPE'));
});
test('observed player and matches are isolated from other account scopes', () => {
  const a = new PlayerScope(ID),
    b = new PlayerScope(SKIN);
  a.remember({ subject: OTHER, name: 'Friend', tag: 'TEST' }, 'friend');
  a.allowMatch(OTHER, MATCH);
  assert.equal(a.allowsMatch(OTHER, MATCH), true);
  assert.throws(() => b.player(OTHER), code('PROFILE_SCOPE'));
});
test('other-player rank request expects target Subject, not own account', async () => {
  const c = client(async (url) =>
    url.includes('/content-service/')
      ? response({ Seasons: [] })
      : response({
          Subject: OTHER,
          QueueSkills: {},
          LatestCompetitiveUpdate: {
            SeasonID: active,
            TierAfterUpdate: 8,
            RankedRatingAfterUpdate: 50,
          },
        }),
  );
  c.scope.remember({ subject: OTHER, name: 'Other', tag: 'TEST' });
  const rank = await c.rank(OTHER);
  assert.equal(rank.tier, 8);
});
test('other-player profile never fetches inventory, wallet or private account details', async () => {
  const calls = [];
  const c = client(async (url) => {
    calls.push(url);
    return response(
      url.includes('/history/')
        ? { Subject: OTHER, History: [] }
        : url.includes('/competitiveupdates')
          ? { Subject: OTHER, Matches: [] }
          : url.includes('/content-service/')
            ? { Seasons: [] }
            : { Subject: OTHER, QueueSkills: {} },
    );
  });
  c.scope.remember({ subject: OTHER, name: 'Friend', tag: 'X' });
  await c.playerProfile(OTHER);
  assert.equal(
    calls.some((url) => /wallet|entitlements|userinfo|personalization|account-xp/.test(url)),
    false,
  );
});
test('identity save preserves weapons, sprays and privacy values', () => {
  const raw = loadout(),
    result = prepareIdentityEdit(
      raw,
      { cardId: OTHER, expectedVersion: 4 },
      new Set([OTHER]),
      new Set(),
    );
  assert.equal(result.Identity.PlayerCardID, OTHER);
  assert.equal(raw.Identity.PlayerCardID, SKIN);
  assert.deepEqual(result.Guns, raw.Guns);
  assert.deepEqual(result.Sprays, raw.Sprays);
  assert.equal(result.Identity.HideAccountLevel, true);
  assert.equal(result.Incognito, true);
});
test('unowned card cannot be equipped', () =>
  assert.throws(
    () =>
      prepareIdentityEdit(loadout(), { cardId: OTHER, expectedVersion: 4 }, new Set(), new Set()),
    code('ITEM_NOT_OWNED'),
  ));
test('concurrent loadout change is rejected before write', () =>
  assert.throws(
    () =>
      prepareIdentityEdit(
        loadout(),
        { cardId: OTHER, expectedVersion: 3 },
        new Set([OTHER]),
        new Set(),
      ),
    code('LOADOUT_CONFLICT'),
  ));
test('missing loadout precondition is rejected', () =>
  assert.throws(
    () => prepareIdentityEdit(loadout(), { cardId: OTHER }, new Set([OTHER]), new Set()),
    code('LOADOUT_CONFLICT'),
  ));
test('readback mismatch is unconfirmed, not a false success', () => {
  const expected = prepareIdentityEdit(
    loadout(),
    { cardId: OTHER, expectedVersion: 4 },
    new Set([OTHER]),
    new Set(),
  );
  assert.throws(() => verifyIdentity(loadout(), expected), code('SAVE_UNCONFIRMED'));
});
const { mergeSnapshot } = require('../.test-build/snapshot.js');
const { makeDemo } = require('../.test-build/demo.js');
test('newer independently refreshed sections survive an older full snapshot', () => {
  const previous = makeDemo(2000).snapshot,
    next = makeDemo(1000).snapshot;
  assert.equal(mergeSnapshot(previous, next).loadout.fetchedAt, 2000);
  assert.equal(mergeSnapshot(previous, next).liveGame.fetchedAt, 2000);
});
test('snapshot merge never crosses accounts or demo/live boundaries', () => {
  const previous = makeDemo(2000).snapshot,
    next = { ...makeDemo(1000).snapshot, accountId: OTHER };
  assert.equal(mergeSnapshot(previous, next), next);
  const live = { ...next, accountId: previous.accountId, demo: false };
  assert.equal(mergeSnapshot(previous, live), live);
});
test('new errors are not concealed behind old successful cached data', () => {
  const previous = makeDemo(2000).snapshot,
    next = {
      ...makeDemo(3000).snapshot,
      liveGame: { status: 'error', code: 'NETWORK', message: 'offline' },
    };
  assert.equal(mergeSnapshot(previous, next).liveGame.status, 'error');
});

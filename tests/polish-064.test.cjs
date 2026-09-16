const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, SKIN, LEVEL, session, code, catalog } = require('./helpers.cjs');
const { friendPresence } = require('../.test-build/chatPresence.js');
const { valorantActivity } = require('../.test-build/presenceState.js');
const {
  friendStatus,
  squareCardCandidates,
  DEFAULT_CARD_ART,
} = require('../.test-build/friends.js');
const { preferences } = require('../.test-build/preferences.js');
const { buildCatalog } = require('../.test-build/catalog.js');
const { bundleContents, rememberBundles } = require('../.test-build/bundles.js');
const {
  weaponSkins,
  unlockedLevels,
  unlockedChromas,
  chooseSkin,
} = require('../.test-build/loadoutOptions.js');
const { logoutRiotSession } = require('../.test-build/logout.js');
const node = (name, text = '', children = [], attrs = {}) => ({
  name,
  text,
  children,
  attrs,
  ns: '',
});
const stanza = (data) =>
  node('presence', '', [
    node('games', '', [
      node('valorant', '', [
        node('st', 'chat'),
        node('p', Buffer.from(JSON.stringify(data)).toString('base64')),
      ]),
    ]),
  ]);
function modern(state = 'PREGAME') {
  return {
    isValid: true,
    partySize: 3,
    maxPartySize: 5,
    sessionLoopState: 'MENUS',
    matchPresenceData: {
      sessionLoopState: state,
      queueId: 'competitive',
      matchMap: '/Game/Maps/Test',
    },
    partyPresenceData: {
      partySize: 2,
      maxPartySize: 5,
      isPartyOwner: false,
      partyOwnerSessionLoopState: 'INGAME',
    },
    playerPresenceData: {
      playerCardId: SKIN,
      playerTitleId: LEVEL,
      accountLevel: 42,
      competitiveTier: 8,
      hideAccountLevel: false,
    },
  };
}
test('nested player/match/party presence resolves card, rank and agent select', () => {
  const c = catalog();
  c.items[SKIN] = {
    id: SKIN,
    canonicalId: SKIN,
    name: 'Real card',
    kind: 'card',
    image: `https://media.valorant-api.com/playercards/${SKIN}/displayicon.png`,
  };
  c.maps['/Game/Maps/Test'] = { name: 'Fixture map' };
  const f = friendPresence(stanza(modern()), c);
  assert.equal(f.presence, 'agent_select');
  assert.equal(f.card.id, SKIN);
  assert.equal(f.level, 42);
  assert.equal(f.tier, 8);
  assert.equal(f.partySize, 2);
  assert.equal(f.map, 'Fixture map');
  assert.match(friendStatus(f), /Agent select.*Competitive.*Party 2\/5/);
});
test('nested active match takes precedence over stale root menu state', () => {
  assert.equal(friendPresence(stanza(modern('INGAME')), catalog()).presence, 'in_game');
});
test('nested privacy is respected even if the old root exposes a level', () => {
  const d = modern();
  d.accountLevel = 99;
  d.playerPresenceData.hideAccountLevel = true;
  const f = friendPresence(stanza(d), catalog());
  assert.equal(f.level, null);
  assert.equal(f.hideLevel, true);
});
test('party members do not inherit a leaders state when own nested state is missing', () => {
  const d = modern();
  delete d.matchPresenceData.sessionLoopState;
  delete d.sessionLoopState;
  assert.equal(valorantActivity(d).presence, 'online');
});
test('legacy flat presence still resolves state and portrait', () => {
  const f = friendPresence(
    stanza({ sessionLoopState: 'INGAME', playerCardId: SKIN, competitiveTier: 7 }),
    catalog(),
  );
  assert.equal(f.presence, 'in_game');
  assert.equal(f.card.id, SKIN);
});
test('missing card uses an actual default square card, never a tall cover', () => {
  assert.deepEqual(squareCardCandidates(undefined), [DEFAULT_CARD_ART]);
  assert.ok(DEFAULT_CARD_ART.endsWith('/displayicon.png'));
});
test('new settings and requested one-time migration enable all non-purchase booleans', () => {
  for (const raw of [null, {}, { chatAlerts: false, allowPurchases: true }]) {
    const p = preferences(raw);
    for (const k of [
      'reminders',
      'wishlistAlerts',
      'chatAlerts',
      'backgroundSync',
      'notificationPreviews',
      'autoChatHistory',
      'autoplayVideos',
    ])
      assert.equal(p[k], true, k);
    assert.equal(p.allowPurchases, false);
  }
});
test('future user opt-outs and theme survive restarts', () => {
  const p = preferences({
    defaultsVersion: 2,
    chatAlerts: false,
    autoplayVideos: false,
    allowPurchases: true,
    theme: 'light',
  });
  assert.equal(p.chatAlerts, false);
  assert.equal(p.autoplayVideos, false);
  assert.equal(p.allowPurchases, true);
  assert.equal(p.theme, 'light');
});
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function options() {
  const weapon = U(1),
    a = {
      id: U(2),
      canonicalId: U(2),
      name: 'A Vandal',
      kind: 'skin',
      weaponId: weapon,
      levels: [
        { id: U(3), name: 'Base' },
        { id: U(4), name: 'Upgrade' },
      ],
      chromas: [
        { id: U(5), name: 'Original' },
        { id: U(6), name: 'Red' },
      ],
    },
    b = {
      ...a,
      id: U(7),
      canonicalId: U(7),
      name: 'B Vandal',
      levels: [{ id: U(8), name: 'Base' }],
      chromas: [{ id: U(9), name: 'Original' }],
    };
  return {
    a,
    b,
    weapon,
    c: { ...catalog(), items: { [U(3)]: { ...a, id: U(3) }, [U(8)]: { ...b, id: U(8) } } },
    e: {
      current: [{ weaponId: weapon, skinId: a.id, levelId: U(3), chromaId: U(5) }],
      ownedLevels: [U(3), U(8)],
      ownedChromas: [],
    },
  };
}
test('owned-skin browser includes alias-only catalog records and alternate skins', () => {
  const h = options(),
    list = weaponSkins(h.c, h.e, h.weapon);
  assert.equal(list.length, 2);
  assert.equal(chooseSkin(list[1], h.e).skinId, h.b.id);
});
test('canonical ownership exposes the included base level without inventing upgrades', () => {
  const h = options();
  h.e.ownedLevels = [h.b.id];
  assert.equal(weaponSkins(h.c, h.e, h.weapon).length, 2);
  assert.equal(unlockedLevels(h.b, h.e)[0].id, U(8));
  assert.equal(unlockedLevels(h.a, h.e).length, 1);
});
test('locked chromas and levels are not selectable', () => {
  const h = options();
  assert.equal(unlockedChromas(h.a, h.e).length, 1);
  assert.equal(unlockedLevels(h.a, h.e).length, 1);
  h.e.ownedChromas.push(U(6));
  assert.equal(unlockedChromas(h.a, h.e).length, 2);
});
test('another weapon is not included just because its skin is owned', () => {
  const h = options();
  h.c.items[U(8)].weaponId = U(100);
  assert.equal(weaponSkins(h.c, h.e, h.weapon).length, 1);
});
test('bundle catalog associations distinguish duplicate generations by exact asset key', () => {
  const data = buildCatalog({
    weapons: {
      data: [
        {
          uuid: ID,
          displayName: 'Vandal',
          skins: [
            {
              uuid: SKIN,
              displayName: 'Theme Vandal',
              assetPath: 'ShooterGame/Guns/Vandal/Theme2/Asset',
              levels: [],
              chromas: [],
            },
          ],
        },
      ],
    },
    bundles: {
      data: [
        {
          uuid: OTHER,
          displayName: 'Theme',
          assetPath: 'StorefrontItem_Theme_ThemeBundle_DataAsset',
        },
        {
          uuid: LEVEL,
          displayName: 'Theme',
          assetPath: 'StorefrontItem_Theme2_ThemeBundle_DataAsset',
        },
      ],
    },
  });
  assert.deepEqual(data.bundles[OTHER].itemIds, []);
  assert.deepEqual(data.bundles[LEVEL].itemIds, [SKIN]);
  assert.equal(bundleContents(data, LEVEL).source, 'catalog-theme');
});
test('observed storefront membership takes precedence over archive associations', () => {
  const c = catalog();
  c.bundles[OTHER] = { name: 'Fixture', itemIds: [SKIN], membershipSource: 'catalog-theme' };
  const b = {
    id: U(99),
    catalogId: OTHER,
    name: 'Fixture',
    offers: [{ id: LEVEL, item: c.items[LEVEL], prices: [] }],
    prices: [],
    expiresAt: Date.now() + 1000,
  };
  const next = rememberBundles(c, [b]);
  assert.equal(next.bundles[OTHER].membershipSource, 'store');
  assert.equal(bundleContents(next, OTHER, { bundles: [b] }).source, 'store');
  assert.equal(bundleContents(next, OTHER, { bundles: [b] }).items.length, 1);
});
test('unknown archive entries open without fabricated weapons', () => {
  assert.deepEqual(bundleContents(catalog(), OTHER).items, []);
});
test('remote sign-out uses only the selected session and does not follow redirects', async () => {
  const s = session();
  s.reauth = { cookies: { ssid: 'fixture-only', sub: ID }, capturedAt: 1 };
  let calls = 0;
  await logoutRiotSession(s, async (url, init) => {
    calls++;
    assert.equal(url, 'https://auth.riotgames.com/logout');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'manual');
    assert.match(init.headers.Cookie, /ssid=fixture-only/);
    assert.ok(!init.headers.Authorization);
    return new Response("<html>You've been signed out</html>", { status: 200 });
  });
  assert.equal(calls, 1);
});
test('wrong-account or missing cookies cannot reach the logout endpoint', async () => {
  const s = session();
  let calls = 0;
  const fake = async () => {
    calls++;
    return new Response('');
  };
  await assert.rejects(logoutRiotSession(s, fake), code('LOGOUT_NO_COOKIE'));
  s.reauth = { cookies: { ssid: 'fixture', sub: OTHER } };
  await assert.rejects(logoutRiotSession(s, fake), code('REAUTH_ACCOUNT_MISMATCH'));
  assert.equal(calls, 0);
});
test('failed and ambiguous sign-out replies preserve a retryable failure', async () => {
  const s = session();
  s.reauth = { cookies: { ssid: 'fixture', sub: ID } };
  await assert.rejects(
    logoutRiotSession(s, async () => new Response('Maintenance', { status: 503 })),
    code('LOGOUT_FAILED'),
  );
  await assert.rejects(
    logoutRiotSession(s, async () => new Response('Sign in', { status: 200 })),
    code('LOGOUT_UNCONFIRMED'),
  );
});

test('published defaultSkinUuid makes the standard skin selectable without paid entitlements', () => {
  const h = options();
  h.b.isDefault = true;
  h.e.ownedLevels = [];
  const list = weaponSkins(h.c, h.e, h.weapon);

  h.c.items[U(8)].isDefault = true;
  assert.ok(weaponSkins(h.c, h.e, h.weapon).some((s) => s.canonicalId === h.b.id));
  assert.equal(unlockedLevels(h.b, h.e)[0].id, U(8));
  assert.equal(chooseSkin(h.b, h.e).chromaId, U(9));
});
test('catalog marks only the exact published default skin, not a similar display name', () => {
  const c = buildCatalog({
    weapons: {
      data: [
        {
          uuid: ID,
          displayName: 'Vandal',
          defaultSkinUuid: SKIN,
          skins: [
            { uuid: SKIN, displayName: 'Standard Vandal', levels: [], chromas: [] },
            { uuid: OTHER, displayName: 'Standard Impostor', levels: [], chromas: [] },
          ],
        },
      ],
    },
  });
  assert.equal(c.items[SKIN].isDefault, true);
  assert.equal(c.items[OTHER].isDefault, false);
});
test('alias-only owned skin can be selected and applied with unrelated fields preserved', () => {
  const { preparePreset } = require('../.test-build/presets.js'),
    h = options();
  const raw = {
    Guns: [
      {
        ID: h.weapon,
        SkinID: h.a.id,
        SkinLevelID: U(3),
        ChromaID: U(5),
        CharmID: U(20),
        extra: 42,
      },
    ],
    Identity: { HideAccountLevel: true },
    Incognito: true,
    ActiveExpressions: [],
  };
  const desired = chooseSkin(h.b, h.e),
    preset = { id: U(22), accountId: ID, name: 'Alias', weapons: [desired], updatedAt: 1 };
  const result = preparePreset(raw, preset, ID, new Set(h.e.ownedLevels), new Set(), h.c);
  assert.equal(result.Guns[0].SkinID, h.b.id);
  assert.equal(result.Guns[0].extra, 42);
  assert.equal(result.Guns[0].CharmID, U(20));
});
test('duplicate weapon IDs with different case are rejected', () => {
  const { validatePreset } = require('../.test-build/presets.js'),
    h = options(),
    id = 'aabbccdd-0000-4000-8000-000000000001',
    w = { weaponId: id, skinId: h.a.id, levelId: U(3), chromaId: U(5) };
  assert.throws(
    () =>
      validatePreset(
        {
          id: U(50),
          accountId: ID,
          name: 'Case',
          updatedAt: 1,
          weapons: [w, { ...w, weaponId: id.toUpperCase() }],
        },
        ID,
      ),
    code('PRESET_INVALID'),
  );
});

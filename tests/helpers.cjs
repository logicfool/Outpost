const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SKIN = '33333333-3333-4333-8333-333333333333';
const LEVEL = '44444444-4444-4444-8444-444444444444';
const MATCH = '55555555-5555-4555-8555-555555555555';
const jwt = (claims) =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture-not-a-real-signature`;
const session = (id = ID) => ({
  version: 1,
  account: {
    puuid: id,
    gameName: 'Fixture',
    tagLine: 'TEST',
    region: 'ap',
    shard: 'ap',
    addedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  },
  accessToken: jwt({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 }),
  entitlementsToken: 'fixture-entitlements-not-a-real-token',
});
const response = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const catalog = () => {
  const item = {
    id: SKIN,
    canonicalId: SKIN,
    name: 'Fixture Vandal',
    kind: 'skin',
    weapon: 'Vandal',
  };
  return {
    items: { [SKIN]: item, [LEVEL]: { ...item, id: LEVEL } },
    bundles: {},
    maps: {},
    tiers: {},
    contracts: {},
    fetchedAt: Date.now(),
  };
};
const storefront = () => ({
  SkinsPanelLayout: {
    SingleItemOffers: [LEVEL],
    SingleItemOffersRemainingDurationInSeconds: 3600,
    SingleItemStoreOffers: [
      {
        OfferID: LEVEL,
        Rewards: [{ ItemID: LEVEL }],
        Cost: { '85ad13f7-3d1b-5128-9eb2-7cd8a8e4d0b0': 1775 },
      },
    ],
  },
});
const code = (expected) => (error) => error?.code === expected;
module.exports = {
  ID,
  OTHER,
  SKIN,
  LEVEL,
  MATCH,
  jwt,
  session,
  response,
  catalog,
  storefront,
  code,
};

const { ID, OTHER } = require('./helpers.cjs');
const { ITEM_TYPES, CURRENCIES, normalizeStore } = require('../.test-build/normalize.js');
const { bundleMetadata } = require('../.test-build/bundleMetadata.js');
const uid = (n) => `00000000-0000-4000-8008-${String(n).padStart(12, '0')}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
function bundleFixture(now = Date.now()) {
  const kinds = ['buddy', 'card', 'spray'],
    base = [675, 575, 325],
    discounted = [507, 432, 221];
  const catalog = { items: {}, bundles: {}, maps: {}, tiers: {}, contracts: {}, fetchedAt: now };
  const raw = {
    ID: uid(100),
    DataAssetID: uid(101),
    CurrencyID: CURRENCIES.VP,
    WholesaleOnly: true,
    DurationRemainingInSeconds: 3600,
    TotalDiscountedCost: { [CURRENCIES.VP]: 1160 },
    TotalBaseCost: { [CURRENCIES.VP]: 1575 },
    ItemOffers: [],
    Items: [],
  };
  kinds.forEach((kind, index) => {
    const id = uid(index + 1),
      canonicalId = kind === 'buddy' ? uid(10) : id,
      name = `Fixture ${kind}`;
    catalog.items[id] = { id, canonicalId, name, kind };
    catalog.items[canonicalId] = { ...catalog.items[id], id: canonicalId };
    const quantity = kind === 'buddy' ? 2 : 1;
    raw.ItemOffers.push({
      BundleItemOfferID: id,
      Offer: {
        OfferID: id,
        IsDirectPurchase: true,
        Cost: { [CURRENCIES.VP]: base[index] },
        Rewards: [{ ItemID: id, ItemTypeID: ITEM_TYPES[kind], Quantity: quantity }],
      },
      DiscountedCost: { [CURRENCIES.VP]: discounted[index] },
    });
    raw.Items.push({
      Item: { ItemID: id, ItemTypeID: ITEM_TYPES[kind], Amount: quantity },
      CurrencyID: CURRENCIES.VP,
      DiscountedPrice: discounted[index],
      BasePrice: base[index],
    });
  });
  catalog.bundles[raw.DataAssetID] = { name: 'Fixture Bundle' };
  const checkout = bundleMetadata(raw, catalog, CURRENCIES.VP, ITEM_TYPES);
  const bundle = {
    id: raw.ID,
    catalogId: raw.DataAssetID,
    name: 'Fixture Bundle',
    prices: [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: 1160 }],
    expiresAt: now + 3600000,
    offers: [],
    checkout,
  };
  const store = {
    daily: [],
    dailyExpiresAt: now + 3600000,
    bundles: [bundle],
    nightMarket: null,
    accessories: [],
    fetchedAt: now,
    clockOffsetMs: 0,
    endpoint: 'v3',
  };
  const wallet = [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: 2000 }];
  const owned = new Map(kinds.map((k) => [ITEM_TYPES[k], new Map()]));
  return { raw, catalog, store, bundle, wallet, owned };
}
module.exports = { ID, OTHER, uid, clone, bundleFixture, ITEM_TYPES, CURRENCIES };

import type { BundleLine, Catalog, Money, Store } from './types';
import type { PurchaseQuote } from './purchases';
import { CURRENCIES, ITEM_TYPES } from './normalize';
import { AppError, uuid } from './validation';
export type BundleOwnership = Map<string, Map<string, number>>;
export function validateBundleLines(lines: readonly BundleLine[]): void {
  if (!Array.isArray(lines) || !lines.length || lines.length > 50)
    throw new AppError('BUNDLE_OFFERS', 'This bundle has no complete purchase quote.');
  const offers = new Set<string>(),
    items = new Set<string>(),
    types = [
      ITEM_TYPES.skin,
      ITEM_TYPES.buddy,
      ITEM_TYPES.card,
      ITEM_TYPES.spray,
      ITEM_TYPES.title,
    ];
  let sum = 0;
  for (const line of lines) {
    uuid(line.offerId);
    uuid(line.itemId);
    uuid(line.canonicalItemId);
    if (
      typeof line.name !== 'string' ||
      !line.name.trim() ||
      line.name.length > 200 ||
      !types.includes(line.itemTypeId) ||
      offers.has(line.offerId) ||
      items.has(line.itemId) ||
      !Number.isSafeInteger(line.price) ||
      line.price < 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > (line.itemTypeId === ITEM_TYPES.buddy ? 2 : 1)
    )
      throw new AppError('BUNDLE_OFFERS', 'Bundle purchase details are incomplete.');
    offers.add(line.offerId);
    items.add(line.itemId);
    sum += line.price;
  }
  if (!Number.isSafeInteger(sum))
    throw new AppError('BUNDLE_PRICE', 'The bundle price is invalid.');
}
export function bundleOwnedQuantity(
  line: BundleLine,
  owned: BundleOwnership,
  catalog: Catalog,
): number {
  const inventory = owned.get(line.itemTypeId);
  if (!inventory)
    throw new AppError('BUNDLE_OWNERSHIP', 'A bundle inventory category could not be checked.');
  const item = catalog.items[line.itemId] ?? catalog.items[line.canonicalItemId];
  return Math.max(
    0,
    ...[line.itemId, line.canonicalItemId, ...(item?.levels ?? []).map((l) => l.id)].map(
      (id) => inventory.get(id) ?? 0,
    ),
  );
}
export function quoteBundlePurchase(
  store: Store,
  wallet: Money[],
  requested: string,
  accountId: string,
  id: string,
  owned: BundleOwnership,
  catalog: Catalog,
  now = Date.now(),
): PurchaseQuote {
  uuid(accountId);
  uuid(id);
  requested = uuid(requested);
  if (
    store.endpoint !== 'demo' &&
    (!Number.isFinite(store.fetchedAt) || Math.abs(now - store.fetchedAt) > 60000)
  )
    throw new AppError(
      'BUNDLE_STALE',
      'Refresh the live bundle offer before reviewing a purchase.',
    );
  const found = store.bundles.filter((b) => b.id === requested || b.catalogId === requested),
    bundle = found[0];
  if (found.length !== 1 || !bundle)
    throw new AppError('BUNDLE_UNAVAILABLE', 'This bundle is no longer in the current store.');
  const checkout = bundle.checkout;
  if (!checkout)
    throw new AppError(
      'BUNDLE_OFFERS',
      'Riot did not return complete bundle purchase offers. Buy this bundle in VALORANT.',
    );
  validateBundleLines(checkout.lines);
  if (checkout.total !== checkout.lines.reduce((sum, l) => sum + l.price, 0))
    throw new AppError('BUNDLE_PRICE', 'Bundle prices changed. Refresh the store.');
  const lines = checkout.lines
    .filter((line) => {
      const quantity = bundleOwnedQuantity(line, owned, catalog);
      if (quantity > 0 && quantity < line.quantity)
        throw new AppError('BUNDLE_OWNERSHIP', 'Partial buddy ownership needs review in VALORANT.');
      return quantity < line.quantity;
    })
    .map((line) => ({ ...line }));
  if (!lines.length)
    throw new AppError('ALREADY_OWNED', 'All items in this bundle are already owned.');
  if (checkout.wholesaleOnly && lines.length !== checkout.lines.length)
    throw new AppError(
      'BUNDLE_OFFERS',
      'This whole-bundle offer needs review in VALORANT because some items are already owned.',
    );
  const price = lines.reduce((sum, line) => sum + line.price, 0),
    balance = wallet.find((v) => v.currencyId === CURRENCIES.VP)?.amount,
    expiry = bundle.expiresAt - store.clockOffsetMs;
  if (!Number.isSafeInteger(price) || price <= 0)
    throw new AppError(
      'BUNDLE_PRICE',
      'This bundle has no payable VP offer. Check it in VALORANT.',
    );
  if (balance === undefined || !Number.isSafeInteger(balance) || balance < price)
    throw new AppError('INSUFFICIENT_VP', 'Not enough VP for this bundle.');
  if (!Number.isFinite(expiry) || expiry <= now + 15000)
    throw new AppError('BUNDLE_EXPIRED', 'This bundle is about to expire. Refresh the store.');
  return {
    id,
    accountId,
    bundle: { id: bundle.id, lines, ownedCount: checkout.lines.length - lines.length },
    offer: {
      id: bundle.id,
      item: {
        id: bundle.id,
        canonicalId: bundle.catalogId ?? bundle.id,
        name: bundle.name,
        kind: 'unknown',
        image: bundle.image,
      },
      prices: [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: price }],
    },
    price,
    balanceBefore: balance,
    createdAt: now,
    expiresAt: Math.min(now + 45000, expiry - 10000),
  };
}
export function bundleQuoteKey(quote: PurchaseQuote): string {
  if (!quote.bundle) return '';
  validateBundleLines(quote.bundle.lines);
  return JSON.stringify([
    uuid(quote.bundle.id),
    ...quote.bundle.lines
      .map((l) =>
        [l.offerId, l.itemId, l.canonicalItemId, l.itemTypeId, l.quantity, l.price].join(':'),
      )
      .sort(),
  ]);
}

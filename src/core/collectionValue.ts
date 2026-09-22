import type { CatalogItem, HistoryEntry, Store, StoreOffer } from './types';
import { CURRENCIES } from './normalize';

const skinPrice = (offer: StoreOffer) => {
  const prices = offer.originalPrices?.length ? offer.originalPrices : offer.prices;
  if (prices.length !== 1 || prices[0]?.currencyId.toLowerCase() !== CURRENCIES.VP)
    return undefined;
  return prices[0].amount;
};

export function collectionValue(owned: CatalogItem[], store?: Store, history: HistoryEntry[] = []) {
  const known = new Map<string, number>();
  const offers = [
    ...(store?.daily ?? []),
    ...(store?.nightMarket?.offers ?? []),
    ...(store?.bundles.flatMap((bundle) => bundle.offers) ?? []),
    ...history.flatMap((entry) => entry.offers),
  ];
  for (const offer of offers) {
    const price = skinPrice(offer);
    if (price === undefined || offer.item.kind !== 'skin') continue;
    const key = offer.item.canonicalId.toLowerCase();
    known.set(key, Math.max(price, known.get(key) ?? 0));
  }
  const ownedSkins = new Set(
    owned.filter((item) => item.kind === 'skin').map((item) => item.canonicalId.toLowerCase()),
  );
  let value = 0;
  let priced = 0;
  for (const id of ownedSkins) {
    const price = known.get(id);
    if (price === undefined) continue;
    value += price;
    priced++;
  }
  return { value, priced, owned: ownedSkins.size };
}

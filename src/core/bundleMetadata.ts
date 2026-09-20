import type { BundleCheckout, BundleLine, Catalog } from './types';
import { catalogItem } from './catalog';
import { array, object, uuid } from './validation';

export function bundleMetadata(
  raw: unknown,
  catalog: Catalog,
  vp: string,
  types: Record<string, string>,
): BundleCheckout | undefined {
  try {
    const b = object(raw),
      offers = array(b.ItemOffers),
      total = object(b.TotalDiscountedCost);
    const validPrice = (v: unknown): v is number =>
      typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
    const vpCost = (raw: unknown): number | undefined => {
      const value = object(raw);
      return Object.keys(value).length === 1 && Object.hasOwn(value, vp) && validPrice(value[vp])
        ? value[vp]
        : undefined;
    };
    const amount = vpCost(total);
    if (
      !offers.length ||
      offers.length > 50 ||
      amount === undefined ||
      typeof b.WholesaleOnly !== 'boolean' ||
      uuid(b.CurrencyID) !== vp
    )
      return;
    const allowed = ['skin', 'buddy', 'spray', 'card', 'title'],
      lines: BundleLine[] = [],
      seen = new Set<string>(),
      items = new Map<string, BundleLine>();
    for (const rawOffer of offers) {
      const o = object(rawOffer),
        offer = object(o.Offer),
        price = vpCost(o.DiscountedCost),
        base = vpCost(offer.Cost),
        rewards = array(offer.Rewards);
      if (
        rewards.length !== 1 ||
        price === undefined ||
        base === undefined ||
        price > base ||
        offer.IsDirectPurchase !== true
      )
        return;
      const reward = object(rewards[0]),
        itemId = uuid(reward.ItemID),
        itemTypeId = uuid(reward.ItemTypeID),
        offerId = uuid(o.BundleItemOfferID);

      if (uuid(offer.OfferID) !== offerId) return;
      const kind = allowed.find((k) => types[k] === itemTypeId),
        quantity = reward.Quantity;
      if (
        !kind ||
        typeof quantity !== 'number' ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > (kind === 'buddy' ? 2 : 1) ||
        seen.has(offerId) ||
        items.has(itemId)
      )
        return;
      const item = catalogItem(
        catalog,
        itemId,
        kind as 'skin' | 'buddy' | 'spray' | 'card' | 'title',
      );
      if (item.name.startsWith('Unresolved') || item.kind !== kind) return;
      const line: BundleLine = {
        offerId,
        itemId,
        canonicalItemId: uuid(item.canonicalId),
        name: item.name.slice(0, 200),
        itemTypeId,
        quantity,
        price,
      };
      seen.add(offerId);
      items.set(itemId, line);
      lines.push(line);
    }
    const sum = lines.reduce((n, line) => n + line.price, 0);
    if (!Number.isSafeInteger(sum) || sum !== amount) return;

    if (b.Items !== undefined) {
      if (!Array.isArray(b.Items) || b.Items.length !== lines.length) return;
      const checked = new Set<string>();
      for (const value of b.Items) {
        const row = object(value),
          item = object(row.Item),
          id = uuid(item.ItemID),
          line = items.get(id);
        if (
          !line ||
          checked.has(id) ||
          uuid(item.ItemTypeID) !== line.itemTypeId ||
          item.Amount !== line.quantity ||
          uuid(row.CurrencyID) !== vp ||
          row.DiscountedPrice !== line.price
        )
          return;
        checked.add(id);
      }
    }
    return { lines, total: amount, wholesaleOnly: b.WholesaleOnly };
  } catch {
    return;
  }
}

import type { Store, StoreOffer, Money } from './types';
import { CURRENCIES } from './normalize';
import { AppError, object, text, uuid } from './validation';
export interface PurchaseQuote {
  id: string;
  accountId: string;
  offer: StoreOffer;
  price: number;
  expiresAt: number;
  createdAt: number;
}
export interface PurchaseRecord {
  id: string;
  accountId: string;
  offerId: string;
  itemId: string;
  name: string;
  price: number;
  at: number;
  state: 'submitting' | 'accepted' | 'complete' | 'failed' | 'unknown';
  orderId?: string;
  message?: string;
}
export function quotePurchase(
  store: Store,
  wallet: Money[],
  itemId: string,
  accountId: string,
  id: string,
  now = Date.now(),
): PurchaseQuote {
  uuid(accountId);
  uuid(id);
  uuid(itemId);
  const offer = store.daily.find((o) => o.item.canonicalId === itemId || o.item.id === itemId);
  if (!offer || offer.item.kind !== 'skin' || offer.item.name.startsWith('Unresolved'))
    throw new AppError(
      'PURCHASE_UNAVAILABLE',
      'Only a currently offered, resolved daily weapon skin can be purchased here.',
    );
  uuid(offer.id);
  if (
    offer.prices.length !== 1 ||
    offer.prices[0]?.currencyId !== CURRENCIES.VP ||
    !Number.isSafeInteger(offer.prices[0].amount) ||
    offer.prices[0].amount <= 0
  )
    throw new AppError('PURCHASE_PRICE', 'Riot did not return a valid VP price.');
  const price = offer.prices[0].amount,
    balance = wallet.find((m) => m.currencyId === CURRENCIES.VP)?.amount;
  if (balance === undefined || balance < price)
    throw new AppError(
      'INSUFFICIENT_VP',
      'This account does not have enough VP. No top-up or purchase was made.',
    );
  const expiry = store.dailyExpiresAt - store.clockOffsetMs;
  if (expiry <= now + 15000)
    throw new AppError('PURCHASE_EXPIRED', 'This rotation is ending. Wait for the next store.');
  return {
    id,
    accountId,
    offer,
    price,
    createdAt: now,
    expiresAt: Math.min(now + 45000, expiry - 10000),
  };
}
export function validatePurchaseQuote(
  quote: PurchaseQuote,
  fresh: PurchaseQuote,
  now = Date.now(),
) {
  if (now >= quote.expiresAt)
    throw new AppError(
      'PURCHASE_EXPIRED',
      'The confirmation expired. Review the current price again.',
    );
  if (
    quote.accountId !== fresh.accountId ||
    quote.offer.id !== fresh.offer.id ||
    quote.offer.item.id !== fresh.offer.item.id ||
    quote.price !== fresh.price
  )
    throw new AppError(
      'PURCHASE_CHANGED',
      'The account, offer or price changed. Nothing was purchased.',
    );
}
export function orderResult(
  raw: unknown,
  expected?: string,
): { orderId: string; state: 'accepted' | 'complete' | 'failed' } {
  const r = object(raw),
    orderId = uuid(r.OrderID),
    status = text(r.Status);
  if (expected && orderId !== expected)
    throw new AppError('ORDER_SCOPE', 'Riot returned another order.');
  if (!['ACCEPTED', 'COMPLETE', 'FAILED'].includes(status))
    throw new AppError('ORDER_UNKNOWN', 'Riot did not return a confirmed order status.');
  return { orderId, state: status.toLowerCase() as 'accepted' | 'complete' | 'failed' };
}

import type { Store, StoreOffer, Money } from './types';
import { CURRENCIES } from './normalize';
import { AppError, object, text, uuid } from './validation';
import { bundleQuoteKey } from './bundlePurchase';
import { purchaseRejection } from './purchaseErrors';

export interface PurchaseQuote {
  bundle?: { id: string; lines: import('./types').BundleLine[]; ownedCount: number };
  id: string;
  accountId: string;
  offer: StoreOffer;
  price: number;
  balanceBefore?: number;
  expiresAt: number;
  createdAt: number;
}
export type PurchaseState =
  'not-submitted' | 'submitting' | 'accepted' | 'complete' | 'failed' | 'unknown';
export interface PurchaseRecord {
  bundle?: { id: string; lines: import('./types').BundleLine[]; delivered?: string[] };
  id: string;
  accountId: string;
  offerId: string;
  itemId: string;
  canonicalItemId?: string;
  name: string;
  price: number;
  at: number;
  state: PurchaseState;
  orderId?: string;
  message?: string;
  protocol?: 'direct-v2' | 'order-v1';
  phase?: 'prepared' | 'dispatching' | 'verification';
  errorCode?: string;
  httpStatus?: number;
  retryAt?: number;
  lastCheckedAt?: number;
  ownershipVerified?: boolean;
  balanceBefore?: number;
  balanceAfter?: number;
}
export function quotePurchase(
  store: Store,
  wallet: Money[],
  requested: string,
  accountId: string,
  id: string,
  now = Date.now(),
): PurchaseQuote {
  accountId = uuid(accountId);
  id = uuid(id);
  const itemId = uuid(requested);
  const matches = store.daily.filter((o) =>
    [o.item.canonicalId, o.item.id, ...(o.item.levels ?? []).map((l) => l.id)].some(
      (v) => v?.toLowerCase() === itemId,
    ),
  );
  const offer = matches[0];
  if (
    matches.length !== 1 ||
    !offer ||
    offer.item.kind !== 'skin' ||
    offer.item.name.startsWith('Unresolved')
  )
    throw new AppError(
      'PURCHASE_UNAVAILABLE',
      'Choose one currently available daily weapon skin. Refresh the store if its details are missing.',
    );
  uuid(offer.id);
  uuid(offer.item.id);
  if (
    offer.prices.length !== 1 ||
    offer.prices[0]?.currencyId.toLowerCase() !== CURRENCIES.VP ||
    !Number.isSafeInteger(offer.prices[0].amount) ||
    offer.prices[0].amount <= 0
  )
    throw new AppError('PURCHASE_PRICE', 'Riot did not return a valid VP price.');
  const price = offer.prices[0].amount,
    balance = wallet.find((m) => m.currencyId.toLowerCase() === CURRENCIES.VP)?.amount;
  if (balance === undefined || !Number.isSafeInteger(balance) || balance < price)
    throw new AppError(
      'INSUFFICIENT_VP',
      'This account does not have enough confirmed VP. No top-up or purchase was made.',
    );
  const expiry = store.dailyExpiresAt - store.clockOffsetMs;
  if (!Number.isFinite(expiry) || expiry <= now + 15000)
    throw new AppError('PURCHASE_EXPIRED', 'This rotation is ending. Wait for the next store.');
  return {
    id,
    accountId,
    offer,
    price,
    balanceBefore: balance,
    createdAt: now,
    expiresAt: Math.min(now + 45000, expiry - 10000),
  };
}
export function validatePurchaseQuote(
  quote: PurchaseQuote,
  fresh: PurchaseQuote,
  now = Date.now(),
) {
  if (now >= quote.expiresAt || now < quote.createdAt - 1000)
    throw new AppError(
      'PURCHASE_EXPIRED',
      'The confirmation expired. Review the current price again.',
    );
  if (
    quote.accountId !== fresh.accountId ||
    quote.offer.id.toLowerCase() !== fresh.offer.id.toLowerCase() ||
    quote.offer.item.id.toLowerCase() !== fresh.offer.item.id.toLowerCase() ||
    quote.price !== fresh.price ||
    bundleQuoteKey(quote) !== bundleQuoteKey(fresh)
  )
    throw new AppError(
      'PURCHASE_CHANGED',
      'The account, offer or price changed. Nothing was purchased.',
    );
}
export function ownsOffer(owned: Set<string>, offer: StoreOffer): boolean {
  return [
    offer.item.id,
    offer.item.canonicalId,
    ...(offer.item.levels ?? []).map((l) => l.id),
  ].some((id) => owned.has(id.toLowerCase()));
}
export function unresolvedForItem(
  record: PurchaseRecord,
  itemId: string,
  canonicalId?: string,
): boolean {
  return (
    ['submitting', 'accepted', 'unknown'].includes(record.state) &&
    [
      record.itemId,
      record.canonicalItemId,
      ...(record.bundle?.lines ?? []).flatMap((l) => [l.itemId, l.canonicalItemId]),
    ].some(
      (id) =>
        id && [itemId, canonicalId].some((value) => value?.toLowerCase() === id.toLowerCase()),
    )
  );
}
export function directPurchaseBody(offerId: string, price: number) {
  if (!Number.isSafeInteger(price) || price <= 0)
    throw new AppError('PURCHASE_PRICE', 'A valid VP price is required.');
  return [{ OfferID: uuid(offerId), CurrencyID: CURRENCIES.VP, Price: price }];
}

export function directPurchaseReply(raw: unknown): {
  orderId?: string;
  state: 'accepted' | 'failed';
  errorCode?: string;
} {
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length > 1)
    throw new AppError(
      'ORDER_UNKNOWN',
      'Riot returned an ambiguous purchase result. Check ownership before retrying.',
    );
  const result = object(list[0]),
    rejection = purchaseRejection(result);
  if (rejection) return { state: 'failed', errorCode: rejection.code };
  if (
    result.errorCode ||
    result.ErrorCode ||
    result.error ||
    result.Success === false ||
    result.success === false
  )
    throw new AppError(
      'ORDER_UNKNOWN',
      'Riot returned an unrecognized purchase result. Check ownership before retrying.',
    );
  const status = text(result.Status).toUpperCase();
  if (status && !['ACCEPTED', 'COMPLETE', 'FAILED'].includes(status))
    throw new AppError('ORDER_UNKNOWN', 'Riot returned an unknown purchase state.');
  return {
    state: status === 'FAILED' ? 'failed' : 'accepted',
    ...(result.OrderID ? { orderId: uuid(result.OrderID) } : {}),
  };
}
export function orderResult(
  raw: unknown,
  expected?: string,
): { orderId: string; state: 'accepted' | 'complete' | 'failed' } {
  const r = object(raw),
    orderId = uuid(r.OrderID),
    status = text(r.Status).toUpperCase();
  if (expected && orderId !== uuid(expected))
    throw new AppError('ORDER_SCOPE', 'Riot returned another order.');
  if (!['ACCEPTED', 'COMPLETE', 'FAILED'].includes(status))
    throw new AppError('ORDER_UNKNOWN', 'Riot did not return a confirmed order status.');
  return { orderId, state: status.toLowerCase() as 'accepted' | 'complete' | 'failed' };
}

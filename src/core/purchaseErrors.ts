import { AppError, object, text } from './validation';

const reasons: Record<string, [string, string]> = {
  INSUFFICIENT_FUNDS: [
    'INSUFFICIENT_VP',
    'Riot reports insufficient VP. Refresh the wallet before reviewing another purchase.',
  ],
  INSUFFICIENT_CURRENCY: [
    'INSUFFICIENT_VP',
    'Riot reports insufficient VP. Refresh the wallet before reviewing another purchase.',
  ],
  INSUFFICIENT_BALANCE: [
    'INSUFFICIENT_VP',
    'Riot reports insufficient VP. Refresh the wallet before reviewing another purchase.',
  ],
  ITEM_ALREADY_OWNED: [
    'ALREADY_OWNED',
    'Riot reports that this skin is already owned. Refresh the collection.',
  ],
  ALREADY_OWNED: [
    'ALREADY_OWNED',
    'Riot reports that this skin is already owned. Refresh the collection.',
  ],
  OFFER_NOT_FOUND: [
    'PURCHASE_UNAVAILABLE',
    'Riot no longer offers this item. Refresh the daily store.',
  ],
  INVALID_OFFER: [
    'PURCHASE_UNAVAILABLE',
    'Riot no longer accepts this offer. Refresh the daily store.',
  ],
  OFFER_EXPIRED: ['PURCHASE_EXPIRED', 'This offer expired. Refresh the daily store.'],
  PRICE_MISMATCH: ['PURCHASE_CHANGED', 'The price changed. Review a new quote before spending VP.'],
  INVALID_PRICE: [
    'PURCHASE_CHANGED',
    'Riot rejected the quoted price. Review the current offer again.',
  ],
  INVALID_CURRENCY: [
    'PURCHASE_CURRENCY',
    'Riot did not accept VP for this offer. No alternative currency is spent.',
  ],
  PURCHASE_DISABLED: [
    'PURCHASE_RESTRICTED',
    'Riot has disabled purchasing for this account or offer. Use the official client.',
  ],
};
export function purchaseRejection(raw: unknown, status?: number): AppError | undefined {
  const r = object(raw);
  const code = text(r.errorCode ?? r.ErrorCode ?? r.error ?? r.code)
    .trim()
    .toUpperCase();
  const mapped = reasons[code];
  return mapped ? new AppError(mapped[0], mapped[1], undefined, status) : undefined;
}
export function purchaseHttpError(status: number): AppError {
  if ([404, 405, 410].includes(status))
    return new AppError(
      'PURCHASE_ENDPOINT',
      'Riot did not accept the purchase route. No alternate request was sent. Use the official client and share the diagnostic code.',
      undefined,
      status,
    );
  if (status === 400 || status === 422)
    return new AppError(
      'PURCHASE_REQUEST',
      'Riot rejected the purchase details. Review the latest daily offer and check the purchase diagnostics.',
      undefined,
      status,
    );
  if (status === 409)
    return new AppError(
      'PURCHASE_CONFLICT',
      'Riot reported a purchase conflict. Check ownership and the saved order before trying again.',
      undefined,
      status,
    );
  return new AppError(
    status >= 500 ? 'SERVICE_UNAVAILABLE' : 'PURCHASE_REJECTED',
    status >= 500
      ? 'Riot did not finish the request reliably. Check ownership before any retry.'
      : 'Riot rejected this purchase. Check the saved diagnostic status.',
    undefined,
    status,
  );
}

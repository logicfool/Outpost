import { AppError } from './validation';
import { bundlePurchaseBody } from './bundlePurchase';
import type { JsonResponse, RequestPolicy } from './http';
import { directPurchaseBody, directPurchaseReply } from './purchases';

export type ConfirmedPurchaseTransport = (
  path: string,
  body: unknown,
  policy: RequestPolicy,
) => Promise<JsonResponse>;

export async function submitConfirmedOffer(
  transport: ConfirmedPurchaseTransport,
  offerId: string,
  vpPrice: number,
  validateImmediatelyBeforeSending: () => Promise<void>,
) {
  const result = await transport('/store/v2/purchase', directPurchaseBody(offerId, vpPrice), {
    purchase: true,
    allowEmptyJson: true,
    beforeDispatch: validateImmediatelyBeforeSending,
  });
  return { ...directPurchaseReply(result.data), httpStatus: result.status };
}

export async function submitConfirmedBundle(
  transport: ConfirmedPurchaseTransport,
  lines: import('./types').BundleLine[],
  total: number,
  guard: () => Promise<void>,
) {
  const result = await transport('/store/v2/purchase', bundlePurchaseBody(lines, total), {
    purchase: true,
    allowEmptyJson: true,
    beforeDispatch: guard,
  });
  const entries = Array.isArray(result.data) ? result.data : [result.data];
  if (entries.length > lines.length)
    throw new AppError(
      'ORDER_UNKNOWN',
      'Riot returned an unexpected bundle response. Check ownership before any new purchase.',
    );
  const replies = entries.map(directPurchaseReply);
  return {
    state: replies.some((r) => r.state === 'failed') ? ('unknown' as const) : ('accepted' as const),
    httpStatus: result.status,
    errorCode: replies.find((r) => r.errorCode)?.errorCode,
  };
}

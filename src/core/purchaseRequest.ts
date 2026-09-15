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

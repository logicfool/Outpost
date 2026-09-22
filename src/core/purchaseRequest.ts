import type { JsonResponse, RequestPolicy } from './http';
import { createOrderBody, createOrderReply } from './purchases';

export type ConfirmedPurchaseTransport = (
  path: string,
  body: unknown,
  policy: RequestPolicy,
) => Promise<JsonResponse>;

export async function submitConfirmedOffer(
  transport: ConfirmedPurchaseTransport,
  orderKey: string,
  offerId: string,
  validateImmediatelyBeforeSending: () => Promise<void>,
) {
  const result = await transport('/store/v1/order/', createOrderBody(orderKey, offerId), {
    purchase: true,
    allowEmptyJson: true,
    beforeDispatch: validateImmediatelyBeforeSending,
  });
  return { ...createOrderReply(result.data), httpStatus: result.status };
}

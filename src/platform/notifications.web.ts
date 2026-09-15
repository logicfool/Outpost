import type { Account, Store } from '../core/types';
import type { Repository } from './storage.types';
import { AppError } from '../core/validation';
export async function enableNotifications(): Promise<void> {
  throw new AppError(
    'NATIVE_REQUIRED',
    'Notifications require a native development or release build.',
  );
}
export async function cancelAccountNotifications(_id: string): Promise<void> {}
export async function cancelAllNotifications(): Promise<void> {}
export async function updateStoreNotifications(
  _account: Account,
  _store: Store,
  _wishlist: string[],
  _repository: Repository,
): Promise<void> {}

export async function notifyChat(..._args: unknown[]): Promise<void> {}
export function listenNotificationTaps(
  _action: (target: NonNullable<ReturnType<typeof import('../core/alerts').alertTarget>>) => void,
): () => void {
  return () => {};
}

export async function cancelResetNotifications(): Promise<void> {}

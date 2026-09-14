import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Account, Store } from '../core/types';
import { AppError } from '../core/validation';
import { wishlistHits } from '../core/normalize';
import type { Repository } from './storage.types';
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
export async function enableNotifications(): Promise<void> {
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('store', {
      name: 'Store reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new AppError(
      'NOTIFICATIONS_DENIED',
      'Notifications are disabled. Enable them in your device settings to use reminders.',
    );
}
export async function cancelAccountNotifications(
  id: string,
  dismissDelivered = true,
): Promise<void> {
  for (const n of await Notifications.getAllScheduledNotificationsAsync())
    if (n.content.data.accountId === id)
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
  if (dismissDelivered)
    for (const n of await Notifications.getPresentedNotificationsAsync())
      if (n.request.content.data.accountId === id)
        await Notifications.dismissNotificationAsync(n.request.identifier);
}
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.dismissAllNotificationsAsync();
}
export async function updateStoreNotifications(
  account: Account,
  store: Store,
  wishlist: string[],
  repository: Repository,
): Promise<void> {
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await cancelAccountNotifications(account.puuid, false);
  const reset = store.dailyExpiresAt - store.clockOffsetMs;
  if (reset > Date.now() + 1000)
    await Notifications.scheduleNotificationAsync({
      identifier: `outpost.reset.${account.puuid}`,
      content: {
        title: 'Your store rotation has ended',
        body: 'Open Outpost and reconnect if needed to check the next offers.',
        data: { accountId: account.puuid },
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reset),
        ...(Platform.OS === 'android' ? { channelId: 'store' } : {}),
      },
    });
  const hits = wishlistHits(store, wishlist),
    signature =
      hits
        .map((h) => h.id)
        .sort()
        .join('|') + `:${Math.round(reset / 60000)}`;
  const key = `notice.${account.puuid}.wishlist`;
  if (hits.length && (await repository.notificationStamp(key)) !== signature) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'A wishlist item is available',
        body: 'Open Outpost to see the offers found during the latest successful sync.',
        data: { accountId: account.puuid },
        sound: false,
      },
      trigger: null,
    });
    await repository.setNotificationStamp(key, signature);
  }
}

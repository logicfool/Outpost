import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import type { Account, Store, Settings } from '../core/types';
import type { ChatMessage } from '../core/chatTypes';
import { AppError } from '../core/validation';
import { wishlistAlerts, chatAlertEligible, alertTarget } from '../core/alerts';
import type { Repository } from './storage.types';
Notifications.setNotificationHandler({
  handleNotification: async (n) => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: n.request.content.data?.kind === 'chat',
    shouldSetBadge: false,
  }),
});
const lanes = new Map<string, Promise<unknown>>();
const hash = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);
function serial(key: string, work: () => Promise<void>) {
  const p = (lanes.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  lanes.set(key, p);
  return p.finally(() => {
    if (lanes.get(key) === p) lanes.delete(key);
  });
}
export async function enableNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('store', {
      name: 'Wishlist and store',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync('chat', {
      name: 'Chat messages',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new AppError(
      'NOTIFICATIONS_DENIED',
      'Enable notifications in device settings to receive alerts.',
    );
}
export async function cancelAccountNotifications(
  id: string,
  dismissDelivered = true,
): Promise<void> {
  await Promise.allSettled(
    [lanes.get(`store:${id}`), lanes.get(`chat:${id}`)].filter((p): p is Promise<unknown> => !!p),
  );
  for (const n of await Notifications.getAllScheduledNotificationsAsync())
    if (n.content.data?.accountId === id)
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
  if (dismissDelivered)
    for (const n of await Notifications.getPresentedNotificationsAsync())
      if (n.request.content.data?.accountId === id)
        await Notifications.dismissNotificationAsync(n.request.identifier);
}
export async function cancelResetNotifications(): Promise<void> {
  for (const n of await Notifications.getAllScheduledNotificationsAsync())
    if (n.content.data?.kind === 'reset' || n.identifier.startsWith('outpost.reset.'))
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
}
export async function cancelAllNotifications(): Promise<void> {
  await Promise.allSettled([...lanes.values()]);
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.dismissAllNotificationsAsync();
}
export async function updateStoreNotifications(
  account: Account,
  store: Store,
  wishlist: string[],
  repository: Repository,
): Promise<void> {
  if (account.demo) return;
  return serial(`store:${account.puuid}`, async () => {
    const prefs = await repository.settings(),
      reset = store.dailyExpiresAt - store.clockOffsetMs;
    await Notifications.cancelScheduledNotificationAsync(`outpost.reset.${account.puuid}`);
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    if (!(await repository.accounts()).some((a) => a.puuid === account.puuid)) return;
    if (prefs.reminders && reset > Date.now() + 1000)
      await Notifications.scheduleNotificationAsync({
        identifier: `outpost.reset.${account.puuid}`,
        content: {
          title: 'Your store rotation has ended',
          body: 'Open Outpost to check new offers.',
          data: { kind: 'reset', accountId: account.puuid },
          sound: false,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(reset),
          ...(Platform.OS === 'android' ? { channelId: 'store' } : {}),
        },
      });
    if (!prefs.wishlistAlerts) return;
    const key = `notice.${account.puuid}.wishlist.v2`;
    let receipts: Record<string, number> = {};
    try {
      receipts = JSON.parse((await repository.notificationStamp(key)) ?? '{}');
    } catch {}
    if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts)) receipts = {};
    const hits = wishlistAlerts(store, wishlist).filter((h) => !receipts[h.key]);
    if (!hits.length) return;
    const sources = [
      ...new Set(
        hits.map(
          (h) => ({ daily: 'daily store', night: 'Night Market', bundle: 'bundle' })[h.source],
        ),
      ),
    ].join(', ');
    const identifier =
      'outpost.wishlist.' +
      (await hash(
        account.puuid +
          hits
            .map((h) => h.key)
            .sort()
            .join('|'),
      ));
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title:
          hits.length === 1
            ? 'A wishlist item is available'
            : `${hits.length} wishlist offers are available`,
        body: prefs.notificationPreviews
          ? `${[...new Set(hits.map((h) => h.name))].join(', ').slice(0, 180)} · ${sources}`
          : `Check your ${sources} in Outpost.`,
        data: { kind: 'wishlist', accountId: account.puuid },
        sound: false,
      },
      trigger: Platform.OS === 'android' ? { channelId: 'store' } : null,
    });
    for (const h of hits) receipts[h.key] = h.expiresAt;
    receipts = Object.fromEntries(
      Object.entries(receipts)
        .filter(([, t]) => t > Date.now())
        .slice(-500),
    );
    await repository.setNotificationStamp(key, JSON.stringify(receipts));
  });
}
export async function notifyChat(
  accountId: string,
  message: ChatMessage,
  openPeer: string | undefined,
  foreground: boolean,
  repository: Repository,
): Promise<void> {
  return serial(`chat:${accountId}`, async () => {
    const prefs = await repository.settings();
    if (
      !chatAlertEligible(message, accountId, openPeer, foreground, prefs) ||
      !(await Notifications.getPermissionsAsync()).granted
    )
      return;
    if (!(await repository.accounts()).some((a) => a.puuid === accountId)) return;
    const key = `notice.${accountId}.chat.v1`,
      id = await hash(`${message.subject}:${message.direction}:${message.id}`);
    let state: { seen: string[]; peers: Record<string, number> } = { seen: [], peers: {} };
    try {
      state = JSON.parse((await repository.notificationStamp(key)) ?? JSON.stringify(state));
    } catch {}
    if (!state || !Array.isArray(state.seen) || !state.peers || typeof state.peers !== 'object')
      state = { seen: [], peers: {} };
    if (state.seen.includes(id)) return;
    state.seen = [...state.seen, id].slice(-500);
    const now = Date.now(),
      due = (state.peers[message.subject] ?? 0) + 30000 <= now;
    if (due) {
      state.peers[message.subject] = now;
      await Notifications.scheduleNotificationAsync({
        identifier: 'outpost.chat.' + (await hash(accountId + message.subject)),
        content: {
          title: 'New Riot message',
          body: prefs.notificationPreviews
            ? message.body.slice(0, 160)
            : 'Open Outpost to read your conversation.',
          sound: 'default',
          data: { kind: 'chat', accountId, peer: message.subject },
        },
        trigger: Platform.OS === 'android' ? { channelId: 'chat' } : null,
      });
    }
    state.peers = Object.fromEntries(
      Object.entries(state.peers).filter(([, at]) => now - at < 86400000),
    );
    await repository.setNotificationStamp(key, JSON.stringify(state));
  });
}
export function listenNotificationTaps(
  action: (target: NonNullable<ReturnType<typeof alertTarget>>) => void,
): () => void {
  let alive = true;
  const seen = new Set<string>();
  const receive = (r: Notifications.NotificationResponse | null) => {
    if (!r || !alive || seen.has(r.notification.request.identifier + ':' + r.notification.date))
      return;
    seen.add(r.notification.request.identifier + ':' + r.notification.date);
    if (seen.size > 128) seen.delete(seen.values().next().value!);
    const target = alertTarget(r.notification.request.content.data);
    if (target) action(target);
    void Notifications.clearLastNotificationResponseAsync();
  };
  void Notifications.getLastNotificationResponseAsync().then(receive);
  const subscription = Notifications.addNotificationResponseReceivedListener(receive);
  return () => {
    alive = false;
    subscription.remove();
  };
}

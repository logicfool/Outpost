import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import type { Account, Settings, Snapshot } from '../core/types';
import { recordLogin } from '../core/diagnostics';
import { safeError } from '../core/validation';
import { getRuntime } from '../platform/runtime';
import { enableNotifications } from '../platform/notifications';

const PROMPT_STAMP = 'notification.permission.prompted.v1';
interface Options {
  account: Account | null;
  snapshot: Snapshot | null;
  booting: boolean;
  loading: boolean;
  settings: Settings;
  settled(accountId: string, granted: boolean): Promise<void>;
  failed(message: string): void;
}

export function useNotificationSetup(options: Options): void {
  const latest = useRef(options);
  latest.current = options;
  const alive = useRef(true),
    focused = useRef(true),
    checking = useRef(false),
    attempted = useRef(false);
  const runRef = useRef<() => Promise<void>>(async () => {});
  const eligible = () => {
    const o = latest.current;
    return (
      alive.current &&
      Platform.OS !== 'web' &&
      AppState.currentState === 'active' &&
      focused.current &&
      !o.booting &&
      !o.loading &&
      !!o.account &&
      !o.account.demo &&
      o.snapshot?.accountId === o.account.puuid &&
      o.snapshot.store.status === 'ready' &&
      o.snapshot.wallet.status === 'ready' &&
      (o.settings.reminders || o.settings.wishlistAlerts || o.settings.chatAlerts)
    );
  };
  const run = useCallback(async () => {
    if (checking.current || attempted.current || !eligible()) return;
    checking.current = true;
    const accountId = latest.current.account!.puuid;
    let retryContext = false;
    try {
      const runtime = await getRuntime();
      const stamp = await runtime.repository.notificationStamp(PROMPT_STAMP);
      if (stamp) {
        attempted.current = true;
        return;
      }

      if (!eligible() || latest.current.account?.puuid !== accountId) {
        retryContext = true;
        return;
      }
      attempted.current = true;
      let granted = false;
      recordLogin('notifications', 'PERMISSION_AFTER_ACCOUNT_READY');
      try {
        await enableNotifications();
        granted = true;
        recordLogin('notifications', 'PERMISSION_GRANTED');
      } catch (reason) {
        const error = safeError(reason);
        recordLogin('notifications', error.code);
        if (alive.current && latest.current.account?.puuid === accountId)
          latest.current.failed(
            error.code === 'NOTIFICATIONS_DENIED'
              ? 'Notifications are off. Your account still works.'
              : 'Notification setup failed. Your account still works.',
          );
      } finally {
        await runtime.repository.setNotificationStamp(PROMPT_STAMP, 'true').catch(() => {
          recordLogin('notifications', 'PERMISSION_STAMP_SAVE_FAILED');
        });
        if (alive.current && latest.current.account?.puuid === accountId) {
          await latest.current
            .settled(accountId, granted)
            .catch(() => recordLogin('notifications', 'PERMISSION_RECONCILE_FAILED'));
        }
      }
    } catch {
      attempted.current = true;
      recordLogin('notifications', 'NOTIFICATION_SETUP_FAILED');
    } finally {
      checking.current = false;
      if (retryContext && eligible()) void runRef.current();
    }
  }, []);
  runRef.current = run;
  useEffect(() => {
    alive.current = true;
    const state = AppState.addEventListener('change', (value) => {
      if (Platform.OS !== 'android') focused.current = value === 'active';
      if (value === 'active') void runRef.current();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
            focused.current = false;
          })
        : undefined;
    const focus =
      Platform.OS === 'android'
        ? AppState.addEventListener('focus', () => {
            focused.current = true;
            void runRef.current();
          })
        : undefined;
    return () => {
      alive.current = false;
      state.remove();
      blur?.remove();
      focus?.remove();
    };
  }, []);
  useEffect(() => {
    void run();
  }, [
    run,
    options.booting,
    options.loading,
    options.account?.puuid,
    options.snapshot?.accountId,
    options.snapshot?.store.status,
    options.snapshot?.wallet.status,
    options.settings.reminders,
    options.settings.wishlistAlerts,
    options.settings.chatAlerts,
  ]);
}

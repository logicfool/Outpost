import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import type { AppModel } from '../state/useApp';
import { getRuntime } from './runtime';
import { sessionHealth } from '../core/sessionRenewal';
import { preferencesVault } from './secure';
import { safeError } from '../core/validation';
export async function diagnosticContext(model: AppModel, guard: () => void): Promise<unknown> {
  guard();
  const account = model.active;
  const context: Record<string, unknown> = {
    application: {
      name: 'Outpost',
      javascriptVersion: Constants.expoConfig?.version,
      nativeVersion: Constants.nativeAppVersion,
      nativeBuild: Constants.nativeBuildVersion,
      executionEnvironment: Constants.executionEnvironment,
    },
    device: { platform: Platform.OS, version: Platform.Version, constants: Platform.constants },
    selectedAccount: account,
    linkedAccounts: model.accounts,
    settings: model.settings,
    loadedSnapshot: model.snapshot,
    loadedStoreHistory: model.history,
    wishlist: model.wishlist,
    loadedChat: model.chat,
    aim: model.aimState,
    chat: {
      status: model.chat.status,
      errorCode: model.chat.errorCode,
      error: model.chat.error,
      friends: model.chat.friends.length,
      unread: model.chat.unread,
      selfPresence: model.chat.selfPresence,
    },
    cache: {
      accountId: model.snapshot?.accountId,
      fetchedAt: model.snapshot?.fetchedAt,
      nextAutoRefreshAt: model.snapshot?.nextAutoRefreshAt,
      refreshIssue: model.snapshot?.refreshIssue,
      catalogFetchedAt: model.catalog.fetchedAt,
      catalogSchema: model.catalog.schemaVersion,
      catalogSourceVersion: model.catalog.sourceVersion,
      catalogAvailableVersion: model.catalog.availableVersion,
      catalogVersionCheckedAt: model.catalog.versionCheckedAt,
      catalogRefreshAfter: model.catalog.refreshAfter,
      catalogFailures: model.catalog.failedPaths,
      catalogItemCount: Object.keys(model.catalog.items).length,
      sections: Object.fromEntries(
        Object.entries(model.snapshot ?? {})
          .filter(([, v]) => v && typeof v === 'object' && 'status' in v)
          .map(([key, v]) => {
            const section = v as {
              status: string;
              fetchedAt?: number;
              warning?: unknown;
              code?: string;
              message?: string;
            };
            return [
              key,
              {
                status: section.status,
                fetchedAt: section.fetchedAt,
                warning: section.warning,
                code: section.code,
                message: section.message,
              },
            ];
          }),
      ),
    },
  };
  if (Platform.OS !== 'web' && !account?.demo) {
    try {
      context.notificationPermission = await Notifications.getPermissionsAsync();
    } catch (e) {
      context.notificationPermission = { error: safeError(e).code };
    }
    if (account)
      try {
        const runtime = await getRuntime();
        guard();
        const [main, scoped, sync, live, aimAuth] = await Promise.all([
          runtime.sessionHealth(account.puuid),
          preferencesVault.read(account.puuid).then(sessionHealth),
          runtime.repository.refreshGate(account.puuid, 'sync'),
          runtime.repository.refreshGate(account.puuid, 'live'),
          runtime.repository.refreshGate(account.puuid, 'aimAuth'),
        ]);
        guard();
        const health = (v: ReturnType<typeof sessionHealth>) => {
          const { token, ...other } = v;
          return { ...other, tokenState: token };
        };
        context.sessions = { main: health(main), aim: health(scoped) };
        context.refreshGates = { sync, live, aimAuth };
      } catch (e) {
        context.localContextError = { code: safeError(e).code, message: safeError(e).message };
      }
  }
  guard();
  return context;
}

import { AppRegistry, AppState, NativeModules, DeviceEventEmitter, Platform } from 'react-native';
import type { HistorySyncProgress } from '../core/rosterHistorySync';
import { AppError } from '../core/validation';
import { enableNotifications } from './notifications';
import { randomHex } from './secure';
import { recordRequest } from '../core/diagnostics';
export interface HistoryBackgroundLease {
  supported: boolean;
  note?: string;
  active(): boolean;
  update(progress: HistorySyncProgress): void;
  check(): Promise<void>;
  finish(outcome: HistorySyncProgress['status']): Promise<void>;
}
type NativeSync = {
  start(id: string): Promise<boolean>;
  runnerReady(id: string): void;
  pulse(
    id: string,
    checked: number,
    total: number,
    conversations: number,
    failed: number,
  ): Promise<boolean>;
  finish(id: string, status: string): Promise<void>;
};
const native: NativeSync | undefined =
  Platform.OS === 'android' ? NativeModules.OutpostHistorySync : undefined;
const runners = new Map<string, { done: Promise<void>; finish(): void }>();
let closing: Promise<unknown> = Promise.resolve();
if (Platform.OS === 'android')
  AppRegistry.registerHeadlessTask(
    'OutpostChatHistorySync',
    () => async (data: { runId?: string }) => {
      const runner = data.runId ? runners.get(data.runId) : undefined;
      if (!native || !runner || !data.runId) {
        if (native && data.runId) await native.finish(data.runId, 'paused');
        return;
      }
      native.runnerReady(data.runId);
      await runner.done;
    },
  );
const foreground = (note?: string): HistoryBackgroundLease => ({
  supported: false,
  note,
  active: () => false,
  update: () => {},
  check: async () => {},
  finish: async () => {},
});
export async function startHistoryBackground(
  guard: () => void,
  stop: (reason: string) => void,
  enabled = true,
): Promise<HistoryBackgroundLease> {
  guard();
  if (!enabled) return foreground('Background sync is off.');
  if (Platform.OS !== 'android')
    return foreground(
      Platform.OS === 'ios' ? 'On iPhone, sync resumes when you return to Outpost.' : undefined,
    );
  if (!native)
    return foreground('Install the background-sync Android build to continue outside Outpost.');
  try {
    await enableNotifications();
  } catch {
    guard();
    return foreground('Enable notifications to sync outside Outpost.');
  }
  guard();
  await closing;
  guard();
  if (AppState.currentState !== 'active')
    throw new AppError('SYNC_NOT_VISIBLE', 'Start history sync with Outpost open.');
  const id = randomHex();
  let ended = false,
    available = false,
    nativeCancelled = false,
    resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  runners.set(id, { done, finish: resolve });
  let progress: HistorySyncProgress = {
    status: 'idle',
    total: 0,
    checked: 0,
    conversations: 0,
    messages: 0,
    empty: 0,
    failed: 0,
    skipped: 0,
  };
  let heartbeat: ReturnType<typeof setInterval> | undefined, pulsing: Promise<void> | undefined;
  const stopped = (reason: string) => {
    if (ended) return;
    available = false;
    if (reason === 'CANCELLED') nativeCancelled = true;
    const message =
      reason === 'CANCELLED'
        ? 'Sync stopped from the notification.'
        : reason === 'TIME_LIMIT' || reason === 'OS_TIMEOUT'
          ? 'Background sync reached its time limit. Resume to continue.'
          : reason === 'NOTIFICATIONS_DISABLED'
            ? 'Sync paused because its notifications were disabled.'
            : 'Background sync stopped. Resume to continue.';
    stop(message);
  };
  const subscription = DeviceEventEmitter.addListener(
    'OutpostHistorySyncStopped',
    (event: { runId?: string; reason?: string }) => {
      if (event.runId === id) stopped(event.reason ?? 'STOPPED');
    },
  );
  const finish = (outcome: HistorySyncProgress['status']) => {
    if (ended) return Promise.resolve();
    ended = true;
    available = false;
    clearInterval(heartbeat);
    subscription.remove();
    runners.delete(id);

    const work = Promise.resolve(pulsing)
      .catch(() => {})
      .then(() =>
        native.pulse(id, progress.checked, progress.total, progress.conversations, progress.failed),
      )
      .catch(() => {})
      .then(() => native.finish(id, outcome))
      .catch(() => {})
      .finally(resolve);
    closing = work;
    return work;
  };
  const pulse = (): Promise<void> => {
    if (ended || !available) return Promise.resolve();
    if (pulsing) return pulsing;
    const work = native
      .pulse(id, progress.checked, progress.total, progress.conversations, progress.failed)
      .then((ok) => {
        if (!ok && !ended) {
          stopped('STOPPED');
          throw new AppError('SYNC_STOPPED', 'The background sync was stopped.');
        }
      })
      .catch(() => {
        if (!ended) stopped('STOPPED');
        throw new AppError('SYNC_STOPPED', 'The background sync was stopped.');
      })
      .finally(() => {
        if (pulsing === work) pulsing = undefined;
      });
    pulsing = work;
    return work;
  };
  try {
    available = await native.start(id);
    guard();
    if (nativeCancelled) throw new AppError('SYNC_STOPPED', 'Sync stopped from the notification.');
    if (!available) throw new AppError('SYNC_START_FAILED', 'Background sync was not started.');
  } catch (reason) {
    await finish(nativeCancelled ? 'cancelled' : 'paused');
    guard();
    if (nativeCancelled) throw new AppError('SYNC_STOPPED', 'Sync stopped from the notification.');
    recordRequest({
      at: Date.now(),
      service: 'Chat history background',
      method: 'NATIVE',
      code: 'FOREGROUND_ONLY',
      durationMs: 0,
    });
    return foreground('Background sync could not start. Keep Outpost open.');
  }
  heartbeat = setInterval(() => {
    void pulse().catch(() => stopped('STOPPED'));
  }, 15000);
  recordRequest({
    at: Date.now(),
    service: 'Chat history background',
    method: 'NATIVE',
    code: 'SERVICE_STARTED',
    durationMs: 0,
  });
  return {
    supported: true,
    active: () => available && !ended,
    update: (value) => {
      progress = value;
      void pulse().catch(() => stopped('STOPPED'));
    },
    check: async () => {
      if (ended || !available) throw new AppError('SYNC_STOPPED', 'History sync was stopped.');
      await pulse();
    },
    finish,
  };
}

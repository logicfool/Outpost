import type { Friend } from './chatTypes';
import { AppError, safeError, uuid } from './validation';
export const HISTORY_FRIEND_GAP_MS = 2000;
export interface HistorySyncProgress {
  status: 'idle' | 'running' | 'paused' | 'cancelled' | 'complete';
  total: number;
  checked: number;
  conversations: number;
  messages: number;
  empty: number;
  failed: number;
  skipped: number;
  current?: string;
  message?: string;
  retryAt?: number;
}
export const EMPTY_HISTORY_SYNC: HistorySyncProgress = {
  status: 'idle',
  total: 0,
  checked: 0,
  conversations: 0,
  messages: 0,
  empty: 0,
  failed: 0,
  skipped: 0,
};
export interface HistorySyncOptions {
  check(): void;
  isFriend(friend: Friend): boolean;
  sync(friend: Friend, signal: AbortSignal): Promise<number>;
}
export function waitForHistory(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      reject(new AppError('CHAT_HISTORY_CANCELLED', 'History sync stopped.'));
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', stop);
        resolve();
      },
      Math.max(0, ms),
    );
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}

export class RosterHistorySync {
  private state: HistorySyncProgress = { ...EMPTY_HISTORY_SYNC };
  private targets: Friend[] = [];
  private controller?: AbortController;
  private flight?: Promise<HistorySyncProgress>;
  constructor(
    private publish: (state: HistorySyncProgress) => void,
    private now = Date.now,
    private wait = waitForHistory,
    private gap = HISTORY_FRIEND_GAP_MS,
  ) {}
  get progress() {
    return this.state;
  }
  private update(next: Partial<HistorySyncProgress>) {
    this.state = { ...this.state, ...next };
    this.publish(this.state);
  }
  start(friends: readonly Friend[], options: HistorySyncOptions): Promise<HistorySyncProgress> {
    if (this.flight) throw new AppError('CHAT_HISTORY_BUSY', 'A history sync is already running.');
    options.check();
    if (friends.length > 1000)
      throw new AppError('CHAT_ROSTER_SIZE', 'Too many friends were returned to scan safely.');
    this.targets = [
      ...new Map(friends.map((friend) => [uuid(friend.subject), { ...friend }])).values(),
    ];
    this.state = { ...EMPTY_HISTORY_SYNC, total: this.targets.length };
    return this.run(options);
  }
  resume(options: HistorySyncOptions): Promise<HistorySyncProgress> {
    if (this.flight)
      throw new AppError('CHAT_HISTORY_BUSY', 'The previous history request is still stopping.');
    if (!['paused', 'cancelled'].includes(this.state.status))
      throw new AppError('CHAT_HISTORY_STATE', 'Start a new history sync.');
    options.check();
    return this.run(options);
  }
  stop(reason = 'History sync stopped.', paused = false) {
    if (this.state.status !== 'running') return;
    this.update({ status: paused ? 'paused' : 'cancelled', message: reason, current: undefined });
    this.controller?.abort();
  }
  private run(options: HistorySyncOptions): Promise<HistorySyncProgress> {
    const controller = new AbortController(),
      signal = controller.signal;
    this.controller = controller;
    const check = () => {
      if (signal.aborted) throw new AppError('CHAT_HISTORY_CANCELLED', 'History sync stopped.');
      options.check();
    };
    this.update({ status: 'running', message: undefined, current: undefined });
    const work = Promise.resolve()
      .then(async () => {
        let needsGap = false;
        try {
          if ((this.state.retryAt ?? 0) > this.now())
            await this.wait(this.state.retryAt! - this.now(), signal);
          while (this.state.checked < this.targets.length) {
            check();
            if (needsGap) await this.wait(this.gap, signal);
            check();
            const friend = this.targets[this.state.checked]!;
            this.update({ current: friend.name, retryAt: undefined });
            if (!options.isFriend(friend)) {
              this.update({ checked: this.state.checked + 1, skipped: this.state.skipped + 1 });
              await this.wait(0, signal);
              continue;
            }
            const localDeadline = this.now() + 30000;
            for (;;) {
              check();
              try {
                const count = await options.sync(friend, signal);
                check();
                this.update({
                  checked: this.state.checked + 1,
                  messages: this.state.messages + count,
                  conversations: this.state.conversations + Number(count > 0),
                  empty: this.state.empty + Number(count === 0),
                });
                break;
              } catch (reason) {
                if (signal.aborted) throw reason;
                const error = safeError(reason);
                check();
                if (['CHAT_COOLDOWN', 'CHAT_HISTORY_BUSY'].includes(error.code)) {
                  const at = Math.max(this.now() + this.gap, error.retryAt ?? 0);
                  if (at > localDeadline) throw error;
                  this.update({ retryAt: at });
                  await this.wait(at - this.now(), signal);
                  check();
                  if (!options.isFriend(friend)) {
                    this.update({
                      checked: this.state.checked + 1,
                      skipped: this.state.skipped + 1,
                    });
                    break;
                  }
                  continue;
                }
                if (
                  [
                    'CHAT_OFFLINE',
                    'ACCOUNT_CHANGED',
                    'SESSION_EXPIRED',
                    'CHAT_STORAGE',
                    'CHAT_HISTORY_UNSUPPORTED',
                    'CHAT_HISTORY_RATE_LIMIT',
                  ].includes(error.code)
                )
                  throw error;
                this.update({ checked: this.state.checked + 1, failed: this.state.failed + 1 });
                break;
              }
            }
            needsGap = true;
          }
          check();
          this.update({ status: 'complete', current: undefined, retryAt: undefined });
        } catch (reason) {
          if (!signal.aborted) {
            const error = safeError(reason);
            this.update({
              status: 'paused',
              current: undefined,
              message: error.message,
              retryAt: error.retryAt,
            });
          }
        }
        return this.state;
      })
      .finally(() => {
        if (this.flight === work) {
          this.flight = undefined;
          this.controller = undefined;
        }
      });
    this.flight = work;
    return work;
  }
}

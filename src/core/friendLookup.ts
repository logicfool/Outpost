import type { PlayerRef } from './playerTypes';
import { AppError, safeError, uuid } from './validation';
import { FRIEND_IDENTITY_TTL } from './friendIdentity';
export interface IdentityObservation {
  player?: PlayerRef;
  observedAt: number;
}
interface Store {
  notificationStamp(key: string): Promise<string | null>;
  setNotificationStamp(key: string, value: string): Promise<void>;
}

export class FriendLookupGate {
  private flights = new Map<string, Promise<IdentityObservation | null>>();
  constructor(
    private store: Store,
    private now: () => number = Date.now,
  ) {}
  async run(
    account: string,
    peer: string,
    work: () => Promise<IdentityObservation>,
  ): Promise<IdentityObservation | null> {
    uuid(account);
    uuid(peer);
    if (this.flights.has(account)) return null;
    const run = async () => {
      const prefix = `notice.${account}.portrait`,
        key = `${prefix}.${peer}`;
      const now = this.now(),
        [global, previous] = await Promise.all([
          this.store.notificationStamp(prefix),
          this.store.notificationStamp(key),
        ]);
      if ((Number(global) || 0) > now || (Number(previous) || 0) > now) return null;
      await this.store.setNotificationStamp(prefix, String(now + 60000));
      await this.store.setNotificationStamp(key, String(now + FRIEND_IDENTITY_TTL));
      try {
        return await work();
      } catch (reason) {
        const e = safeError(reason),
          until = Math.max(now + 300000, e.retryAt ?? 0);
        await this.store.setNotificationStamp(prefix, String(until));
        await this.store.setNotificationStamp(key, String(until));
        throw e;
      }
    };
    const job = run();
    this.flights.set(account, job);
    try {
      return await job;
    } finally {
      if (this.flights.get(account) === job) this.flights.delete(account);
    }
  }
}

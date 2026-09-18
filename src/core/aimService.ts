import { AppError, safeError, uuid } from './validation';
import { aimSnapshot, prepareAimDocument, validateAimEdit, aimEditMatches } from './aimSettings';
import {
  AIM_READ_INTERVAL,
  type AimDocument,
  type AimEdit,
  type AimState,
  type AimStore,
} from './aimTypes';
export function aimOrigin(region: string): string {
  const clusters: Record<string, string> = {
    na: 'usw2',
    br: 'usw2',
    latam: 'usw2',
    eu: 'euc1',
    ap: 'apse1',
    kr: 'apne1',
  };
  const key = typeof region === 'string' ? region.toLowerCase() : '';
  const cluster = Object.hasOwn(clusters, key) ? clusters[key] : undefined;
  if (!cluster)
    throw new AppError('AIM_REGION', 'This region is not supported by the settings service.');
  return `https://player-preferences-${cluster}.pp.sgp.pvp.net`;
}
export interface AimApi {
  readAimDocument(): Promise<AimDocument>;
  writeAimDocument(data: Record<string, unknown>, guard: () => void): Promise<void>;
}
export interface AimConsent {
  gameClosed: boolean;
  confirmedAt: number;
}

export class AimService {
  private reads = new Map<string, Promise<AimState>>();
  private writes = new Map<string, Promise<AimState>>();
  constructor(
    private store: AimStore,
    private api: (id: string) => Promise<AimApi>,
    private now: () => number = Date.now,
    private newId: () => string = () => String(Date.now()),
  ) {}
  async sync(
    id: string,
    reason: 'auto' | 'manual' = 'manual',
    guard: () => void = () => {},
  ): Promise<AimState> {
    id = uuid(id);
    const writing = this.writes.get(id);
    if (writing) return writing;
    const old = this.reads.get(id);
    if (old) return old;
    const work = (async () => {
      guard();
      let state = (await this.store.aimState(id)) ?? {};
      guard();
      if (state.nextReadAt && state.nextReadAt > this.now()) return state;
      if (reason === 'auto' && state.snapshot && !state.pending && !state.needsSync) return state;
      state = { ...state, attemptedAt: this.now(), nextReadAt: this.now() + AIM_READ_INTERVAL };
      await this.store.saveAimState(id, state);
      guard();
      try {
        const doc = await (await this.api(id)).readAimDocument();
        guard();
        const snapshot = aimSnapshot(doc, id, this.now());
        const pending = state.pending;
        const matched = pending && aimEditMatches(snapshot, pending.desired);
        const next: AimState = {
          ...state,
          snapshot,
          needsSync: false,
          pending: undefined,
          error: undefined,
          attemptedAt: state.attemptedAt,
          nextReadAt: state.nextReadAt,
          ...(pending && !matched
            ? {
                pending,
                error: {
                  code: 'AIM_UNCONFIRMED',
                  message:
                    'The last settings change is not confirmed. Review it before applying again.',
                },
              }
            : {}),
        };
        await this.store.saveAimState(id, next);
        guard();
        return next;
      } catch (reason) {
        guard();
        const e = safeError(reason),
          next = {
            ...state,
            nextReadAt: Math.max(this.now() + AIM_READ_INTERVAL, e.retryAt ?? 0),
            error: { code: e.code, message: e.message, retryAt: e.retryAt },
          };
        await this.store.saveAimState(id, next);
        return next;
      }
    })();
    this.reads.set(id, work);
    try {
      return await work;
    } finally {
      if (this.reads.get(id) === work) this.reads.delete(id);
    }
  }
  async apply(
    id: string,
    input: AimEdit,
    consent: AimConsent,
    guard: () => void,
  ): Promise<AimState> {
    id = uuid(id);
    const edit = validateAimEdit(input);
    if (this.writes.has(id))
      throw new AppError('AIM_BUSY', 'A settings change is already running.');
    const check = () => {
      guard();
      if (
        !consent.gameClosed ||
        !Number.isFinite(consent.confirmedAt) ||
        consent.confirmedAt > this.now() + 1000 ||
        this.now() - consent.confirmedAt > 45000
      )
        throw new AppError('AIM_CONFIRM', 'Confirm the change again with VALORANT closed.');
    };
    check();
    const work = (async () => {
      await this.reads.get(id);
      check();
      const saved = (await this.store.aimState(id)) ?? {};
      check();
      if (saved.pending)
        throw new AppError(
          'AIM_PENDING',
          'Check the previous settings change before applying another.',
        );
      if (saved.error?.code === 'RATE_LIMIT' && (saved.nextReadAt ?? 0) > this.now())
        throw new AppError('RATE_LIMIT', 'Riot asked us to wait.', saved.nextReadAt, 429);
      if (saved.lastApplyAt && this.now() - saved.lastApplyAt < AIM_READ_INTERVAL)
        throw new AppError(
          'AIM_WAIT',
          'Wait a minute between settings changes.',
          saved.lastApplyAt + AIM_READ_INTERVAL,
        );
      await this.store.saveAimState(id, {
        ...saved,
        lastApplyAt: this.now(),
        nextReadAt: Math.max(saved.nextReadAt ?? 0, this.now() + AIM_READ_INTERVAL),
      });
      check();
      const api = await this.api(id),
        before = await api.readAimDocument();
      check();
      const prepared = prepareAimDocument(before, id, edit),
        second = await api.readAimDocument();
      check();
      if (
        JSON.stringify(before.data) !== JSON.stringify(second.data) ||
        before.modified !== second.modified
      )
        throw new AppError(
          'AIM_CONFLICT',
          'Riot settings changed during review. Nothing was saved.',
        );
      const at = this.now(),
        pending = { id: this.newId(), at, desired: edit };
      let dispatched = false,
        accepted = false;
      const state: AimState = {
        ...saved,
        pending,
        lastApplyAt: at,
        nextReadAt: at + AIM_READ_INTERVAL,
        error: undefined,
      };
      await this.store.saveAimState(id, state);
      try {
        await api.writeAimDocument(prepared.data, () => {
          check();
          dispatched = true;
        });
        accepted = true;
        guard();
        const doc = await api.readAimDocument();
        guard();
        const snapshot = aimSnapshot(doc, id, this.now());
        if (!aimEditMatches(snapshot, edit))
          throw new AppError(
            'AIM_UNCONFIRMED',
            'Riot has not confirmed the requested settings. Check again before retrying.',
          );
        const next: AimState = {
          snapshot,
          lastApplyAt: at,
          attemptedAt: at,
          nextReadAt: this.now() + AIM_READ_INTERVAL,
        };
        await this.store.saveAimState(id, next);
        return next;
      } catch (reason) {
        const e = safeError(reason);
        guard();
        const uncertain =
          dispatched && (accepted || !e.status || e.status >= 500 || e.code === 'AIM_UNCONFIRMED');
        const next: AimState = {
          ...state,
          ...(!uncertain ? { pending: undefined } : {}),
          nextReadAt: Math.max(this.now() + AIM_READ_INTERVAL, e.retryAt ?? 0),
          error: {
            code: uncertain ? 'AIM_UNCONFIRMED' : e.code,
            message: uncertain
              ? 'The outcome is uncertain. Pull down to check; the change will not be resent.'
              : e.message,
            retryAt: e.retryAt,
          },
        };
        await this.store.saveAimState(id, next);
        return next;
      }
    })().catch(async (reason) => {
      guard();
      const e = safeError(reason),
        latest = (await this.store.aimState(id)) ?? {};
      guard();
      await this.store.saveAimState(id, {
        ...latest,
        nextReadAt: Math.max(
          latest.nextReadAt ?? 0,
          this.now() + AIM_READ_INTERVAL,
          e.retryAt ?? 0,
        ),
        error: { code: e.code, message: e.message, retryAt: e.retryAt },
      });
      throw e;
    });
    this.writes.set(id, work);
    try {
      return await work;
    } finally {
      if (this.writes.get(id) === work) this.writes.delete(id);
    }
  }
  async markLogin(id: string): Promise<void> {
    const state = (await this.store.aimState(uuid(id))) ?? {};
    await this.store.saveAimState(id, { ...state, needsSync: true });
  }
  async acceptServerState(id: string, guard: () => void): Promise<AimState> {
    id = uuid(id);
    guard();
    if (this.writes.has(id) || this.reads.has(id))
      throw new AppError('AIM_BUSY', 'Wait for the current check to finish.');
    const state = await this.store.aimState(id);
    guard();
    if (
      !state?.pending ||
      !state.snapshot ||
      state.snapshot.fetchedAt <= state.pending.at ||
      this.now() - state.pending.at < AIM_READ_INTERVAL
    )
      throw new AppError(
        'AIM_PENDING',
        'Pull down after a minute to read the current Riot settings first.',
      );
    const next = { ...state, pending: undefined, error: undefined };
    await this.store.saveAimState(id, next);
    return next;
  }
  async drain(id: string): Promise<void> {
    await Promise.allSettled([this.reads.get(id), this.writes.get(id)].filter(Boolean));
  }
}

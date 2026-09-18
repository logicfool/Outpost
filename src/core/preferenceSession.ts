import type { Session, LoginAttempt } from './types';
import type { HttpClient, Fetcher } from './http';
import { connectAccount } from './riot';
import { sessionActive } from './auth';
import { checkpointCookies, sessionCheckpointMatches } from './sessionRenewal';
import { authorizePreferences } from './preferenceAuthorization';
import type { RenewalTransport } from './authResponseEnvelope';
import { AppError, safeError, uuid } from './validation';
import { recordRequest } from './diagnostics';
import type { RefreshGateState } from './refreshPolicy';
interface Vault {
  read(id: string): Promise<Session | null>;
  write(value: Session): Promise<void>;
}
interface GateStore {
  read(id: string): Promise<RefreshGateState | null>;
  save(id: string, value: RefreshGateState): Promise<void>;
}

export class PreferenceSession {
  constructor(
    private main: Vault,
    private scoped: Vault,
    private gates: GateStore,
    private http: HttpClient,
    private fetcher: Fetcher,
    private attempt: () => LoginAttempt,
    private transport: RenewalTransport,
    private now: () => number = Date.now,
  ) {}
  async get(id: string, guard: () => void): Promise<Session> {
    id = uuid(id);
    guard();
    let previous: Session | null;
    try {
      previous = await this.scoped.read(id);
    } catch {
      throw new AppError(
        'AIM_AUTH_STORAGE',
        'The separate Aim authorization cache could not be read. Your main account is still saved. Export diagnostics before reconnecting.',
      );
    }
    guard();
    if (previous && sessionActive(previous, this.now())) return previous;
    const gate = await this.gates.read(id);
    guard();
    if ((gate?.notBefore ?? 0) > this.now())
      throw new AppError(
        'AIM_AUTH_WAIT',
        'Settings authorization is waiting for its retry deadline.',
        gate!.notBefore,
      );
    const original = await this.main.read(id);
    guard();
    if (!original) throw new AppError('NO_ACCOUNT', 'Select a linked account.');
    const report = (code: string) =>
      recordRequest({
        at: this.now(),
        service: 'Aim authorization',
        method: 'STATE',
        code,
        durationMs: 0,
      });
    const reservation = {
      attemptedAt: this.now(),
      notBefore: this.now() + 60000,
      failures: gate?.failures ?? 0,
    };
    await this.gates.save(id, reservation);
    guard();
    report('AIM_CLIENT_AUTH_START');
    try {
      const tokens = await authorizePreferences(
        original.reauth?.cookies ?? {},
        id,
        this.attempt(),
        this.fetcher,
        async (cookies) => {
          guard();
          const latest = await this.main.read(id);
          guard();
          if (!latest) throw new AppError('SESSION_REMOVED', 'The account was removed.');
          const checkpoint = checkpointCookies(latest, cookies, this.now());
          await this.main.write(checkpoint);
          guard();
          if (!sessionCheckpointMatches(await this.main.read(id), checkpoint))
            throw new AppError('SESSION_SAVE', 'The rotated cookie could not be verified.');
          report('AIM_COOKIE_ROTATION_SAVED');
        },
        this.transport,
      );
      guard();

      const verified = await connectAccount(
        this.http,
        { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt },
        original.account.region,
      );
      guard();
      if (verified.account.puuid !== id)
        throw new AppError(
          'ACCOUNT_MISMATCH',
          'Riot settings authorization returned another account.',
        );
      verified.account.addedAt = original.account.addedAt;

      await this.scoped.write(verified);
      guard();
      if (!sessionCheckpointMatches(await this.scoped.read(id), verified))
        throw new AppError('AIM_AUTH_SAVE', 'Settings credentials could not be saved securely.');
      await this.gates.save(id, { ...reservation, failures: 0 });
      report('AIM_CLIENT_AUTH_SAVED');
      return verified;
    } catch (reason) {
      guard();
      const error = safeError(reason),
        notBefore = Math.max(this.now() + 60000, error.retryAt ?? 0);
      await this.gates.save(id, { ...reservation, notBefore, failures: (gate?.failures ?? 0) + 1 });
      report(error.code);
      throw new AppError(error.code, error.message, notBefore, error.status);
    }
  }
}

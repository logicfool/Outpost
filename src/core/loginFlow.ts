import type { Account, LoginAttempt, LoginTokens } from './types';
import {
  authorizationUrl,
  decodeJwtClaimsUnverified,
  isCallback,
  isLoginNavigationAllowed,
  parseCallback,
} from './auth';
import { AppError, safeError, text } from './validation';
import { assertCookieSubject, cleanSessionCookies } from './sessionCookies';

export type LoginPhase = 'start' | 'preparing' | 'browser' | 'exchange' | 'success';
export interface LoginState {
  phase: LoginPhase;
  url?: string;
  error?: string;
  code?: string;
  account?: Account;
}
export interface LoginDependencies {
  attempt(): LoginAttempt;
  clearBrowser(): Promise<void>;
  captureCookies(expectedSubject?: string): Promise<Record<string, string>>;
  save(tokens: LoginTokens): Promise<Account>;
  emit(state: LoginState): void;
  diagnostic?(stage: string, code: string): void;
}
export async function bounded<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError('LOGIN_TIMEOUT', message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class LoginFlow {
  private serial = 0;
  private attempt?: LoginAttempt;
  private state: LoginState = { phase: 'start' };
  constructor(private deps: LoginDependencies) {}
  get snapshot() {
    return this.state;
  }
  private set(state: LoginState) {
    this.state = state;
    this.deps.emit(state);
    this.deps.diagnostic?.(state.phase, state.code ?? 'OK');
  }
  async begin() {
    if (['preparing', 'exchange'].includes(this.state.phase)) return;
    const generation = ++this.serial;
    this.set({ phase: 'preparing' });
    try {
      await bounded(
        this.deps.clearBrowser(),
        10000,
        'Riot browser session reset timed out. Try again.',
      );
      if (generation !== this.serial) return;
      this.attempt = this.deps.attempt();
      const url = new URL(authorizationUrl(this.attempt));
      url.searchParams.set('prompt', 'login');
      this.set({ phase: 'browser', url: url.toString() });
    } catch (e) {
      if (generation === this.serial) this.fail(e);
    }
  }
  navigate(url: string): boolean {
    if (this.state.phase !== 'browser') return false;
    if (!isCallback(url)) return isLoginNavigationAllowed(url);
    try {
      if (!this.attempt) throw new AppError('AUTH_STATE', 'Open a new sign-in window.');
      const tokens = parseCallback(url, this.attempt);
      this.set({ phase: 'exchange', url: this.state.url });
      void this.complete(tokens, this.serial, true);
    } catch (e) {
      this.fail(e);
    }
    return false;
  }
  async manual(tokens: LoginTokens) {
    if (this.state.phase !== 'start') return;
    const generation = ++this.serial;
    this.set({ phase: 'exchange' });
    await this.complete(tokens, generation, false);
  }
  private async complete(tokens: LoginTokens, generation: number, cookies: boolean) {
    if (cookies) {
      try {
        const expected =
          text(decodeJwtClaimsUnverified(tokens.idToken ?? tokens.accessToken).sub) || undefined;
        const savedCookies = cleanSessionCookies(
          await bounded(
            this.deps.captureCookies(expected),
            7000,
            'Reusable Riot session capture timed out. Retry sign-in.',
          ),
        );
        if (!savedCookies.ssid)
          throw new AppError(
            'REAUTH_COOKIE',
            'A reusable Riot session was not returned. Retry with Stay signed in enabled.',
          );
        assertCookieSubject(savedCookies, expected);
        tokens = { ...tokens, reauthCookies: savedCookies };
        this.deps.diagnostic?.('cookies', 'REUSABLE_COOKIE_CAPTURED');
      } catch (reason) {
        this.deps.diagnostic?.(
          'cookies',
          reason instanceof AppError ? reason.code : 'REAUTH_COOKIE',
        );
        if (generation === this.serial)
          this.fail(
            reason instanceof AppError
              ? reason
              : new AppError(
                  'REAUTH_COOKIE',
                  'The reusable Riot session could not be captured. Retry sign-in; no saved account was replaced.',
                ),
          );
        return;
      }
    }
    if (generation !== this.serial) return;
    try {
      const account = await this.deps.save(tokens);
      if (generation === this.serial) this.set({ phase: 'success', account });
    } catch (e) {
      if (generation === this.serial) this.fail(e);
    }
  }
  browserError(message: string) {
    if (this.state.phase === 'browser') this.fail(new AppError('LOGIN_BROWSER', message));
  }
  private fail(reason: unknown) {
    const e = safeError(reason);
    this.set({ phase: 'start', error: e.message, code: e.code });
  }
  dispose() {
    this.serial++;
    this.attempt = undefined;
  }
}

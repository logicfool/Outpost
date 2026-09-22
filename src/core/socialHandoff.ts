import { bounded } from './loginFlow';
import {
  loginDocument,
  socialAuthorization,
  riotSocialCompletion,
  type SocialProvider,
} from './socialLogin';
export interface SocialState {
  provider?: SocialProvider;
  status: 'idle' | 'opening' | 'waiting' | 'checking' | 'continuing' | 'error';
  message?: string;
  code?: string;
  retryAt?: number;
}
export interface SocialDependencies {
  current(): boolean;
  openBrowser(url: string): Promise<unknown>;
  probe(id: string): void;
  continueRiot(url: string): void;
  resumeRiot?(): void;
  emit(state: SocialState): void;
  diagnostic(code: string): void;
  now?(): number;
}
/** Browser launch is not login success. Only the original Riot flow verifies/saves an account. */
export class SocialHandoff {
  private serial = 0;
  private deadline = 0;
  private expected?: string;
  private checks = 0;
  private blockedUntil = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private state: SocialState = { status: 'idle' };
  constructor(private deps: SocialDependencies) {}
  get snapshot() {
    return this.state;
  }
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  private set(state: SocialState) {
    this.state = state;
    this.deps.emit(state);
    if (state.code) this.deps.diagnostic(state.code);
  }
  async open(url: string, source: string): Promise<void> {
    if (!this.deps.current() || !loginDocument(source)) return;
    if (['opening', 'waiting', 'checking', 'continuing'].includes(this.state.status)) return;
    if (this.blockedUntil > this.now()) {
      this.set({
        ...this.state,
        status: 'error',
        code: 'SOCIAL_RATE_LIMIT',
        retryAt: this.blockedUntil,
        message: 'Riot asked us to wait before checking another browser sign-in.',
      });
      return;
    }
    const target = socialAuthorization(url);
    if (!target) {
      this.set({
        status: 'error',
        code: 'SOCIAL_DESTINATION',
        message:
          'This sign-in link is not a supported Riot social authorization request. Choose another sign-in option.',
      });
      return;
    }
    const stamp = ++this.serial;
    this.deadline = this.now() + 10 * 60000;
    this.checks = 0;
    this.expected = undefined;
    this.set({ status: 'opening', provider: target.provider, code: 'SOCIAL_BROWSER_OPENING' });
    try {
      await bounded(
        Promise.resolve(this.deps.openBrowser(target.url)),
        10000,
        'The system browser did not respond.',
      );
      if (stamp !== this.serial || !this.deps.current()) return;
      this.set({
        status: 'waiting',
        provider: target.provider,
        code: 'SOCIAL_BROWSER_OPENED',
        message: `Finish ${target.provider} sign-in in your browser, then return to Outpost.`,
      });
    } catch {
      if (stamp === this.serial && this.deps.current())
        this.set({
          status: 'error',
          provider: target.provider,
          code: 'SOCIAL_BROWSER_UNAVAILABLE',
          message:
            'The system browser could not open. Check that a browser is installed, then retry the sign-in button.',
        });
    }
  }
  check(): void {
    if (
      !this.deps.current() ||
      !this.state.provider ||
      this.expected ||
      ['idle', 'opening', 'continuing'].includes(this.state.status)
    )
      return;
    if (this.now() > this.deadline || this.checks >= 12) {
      this.set({
        ...this.state,
        status: 'error',
        code: 'SOCIAL_EXPIRED',
        message:
          'This browser handoff has expired. Close sign-in and start a fresh attempt; saved accounts are unchanged.',
      });
      return;
    }
    if ((this.state.retryAt ?? 0) > this.now()) return;
    const id = `${this.serial}:${++this.checks}`;
    this.expected = id;
    this.set({
      ...this.state,
      status: 'checking',
      code: 'SOCIAL_RESUME_CHECK',
      message: 'Checking the original Riot sign-in session...',
      retryAt: this.now() + 3000,
    });
    this.timer = setTimeout(() => this.result({ id, status: 'unavailable' }), 9000);
    try {
      this.deps.probe(id);
    } catch {
      this.result({ id, status: 'unavailable' });
    }
  }
  result(message: {
    id: string;
    status: string;
    url?: string;
    http?: number;
    retrySeconds?: number;
  }): void {
    if (!this.deps.current() || !this.expected || message.id !== this.expected) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.expected = undefined;
    if (this.now() > this.deadline) {
      this.set({
        ...this.state,
        status: 'error',
        code: 'SOCIAL_EXPIRED',
        message: 'This sign-in attempt expired. Start again; saved accounts are unchanged.',
      });
      return;
    }
    if (Number.isInteger(message.http) && message.http! >= 100 && message.http! <= 599)
      this.deps.diagnostic('SOCIAL_CHECK_HTTP_' + message.http);
    const successfulHttp =
      message.http === undefined ||
      (Number.isInteger(message.http) && message.http >= 200 && message.http < 300);
    if (message.status === 'interaction' && successfulHttp) {
      this.set({
        ...this.state,
        status: 'continuing',
        code: 'SOCIAL_RIOT_VERIFICATION',
        message: 'Complete the remaining verification on the Riot page.',
      });
      try {
        if (!this.deps.resumeRiot) throw Error('No original page');
        this.deps.resumeRiot();
      } catch {
        this.set({
          ...this.state,
          status: 'error',
          code: 'SOCIAL_CONTINUE_UNAVAILABLE',
          message: 'Reopen Riot sign-in to finish verification.',
        });
      }
      return;
    }
    if (
      message.status === 'success' &&
      successfulHttp &&
      message.url &&
      riotSocialCompletion(message.url)
    ) {
      this.set({
        ...this.state,
        status: 'continuing',
        code: 'SOCIAL_RIOT_COMPLETION',
        message: 'Completing Riot sign-in...',
      });
      try {
        this.deps.continueRiot(message.url);
      } catch {
        this.set({
          ...this.state,
          status: 'error',
          code: 'SOCIAL_CONTINUE_UNAVAILABLE',
          message: 'The original Riot page is no longer available. Start a fresh sign-in.',
        });
      }
      return;
    }
    if (message.status === 'pending' && successfulHttp) {
      this.set({
        ...this.state,
        status: 'waiting',
        code: 'SOCIAL_RIOT_PENDING',
        message:
          'Riot has not confirmed this browser sign-in yet. Finish in your browser, then check again.',
      });
      return;
    }
    const wait = Number.isFinite(message.retrySeconds)
      ? Math.min(86400, Math.max(3, message.retrySeconds!))
      : 3;
    if (message.http === 429)
      this.blockedUntil = Math.max(this.blockedUntil, this.now() + wait * 1000);
    this.set({
      ...this.state,
      status: 'error',
      code:
        message.http === 429
          ? 'SOCIAL_RATE_LIMIT'
          : message.status === 'success'
            ? 'SOCIAL_RETURN_REJECTED'
            : 'SOCIAL_RESUME_UNAVAILABLE',
      retryAt: this.now() + wait * 1000,
      message:
        message.http === 429
          ? 'Riot asked us to wait before checking again.'
          : 'Riot could not resume this browser session. No account was added. You can check again or use Riot username/password sign-in.',
    });
  }
  cancel(): void {
    this.serial++;
    clearTimeout(this.timer);
    this.expected = undefined;
    this.set({ status: 'idle' });
  }
  dispose(): void {
    this.serial++;
    clearTimeout(this.timer);
    this.expected = undefined;
    this.state = { status: 'idle' };
  }
}

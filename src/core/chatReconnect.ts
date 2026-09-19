import type { ChatState } from './chatTypes';
const HARD_FAILURES = new Set([
  'ACCOUNT_MISMATCH',
  'SESSION_REMOVED',
  'NO_ACCOUNT',
  'NATIVE_REQUIRED',
  'CHAT_CONFIG',
  'CHAT_XML',
  'CHAT_SIZE',
  'CHAT_ROSTER_SIZE',
  'CHAT_PROTOCOL',
  'CHAT_IDENTITY',
  'AUTH_REDIRECT',
  'REAUTH_REQUIRED',
]);

export class ChatReconnect {
  notBefore = 0;
  blocked = false;
  private failures = 0;
  private authFailures = 0;
  private readySince?: number;
  private credentialExpiry?: number;
  private blockReason?: string;
  constructor(
    private now = Date.now,
    private random = Math.random,
  ) {}
  reset() {
    this.notBefore = 0;
    this.blocked = false;
    this.failures = 0;
    this.authFailures = 0;
    this.readySince = undefined;
    this.credentialExpiry = undefined;
    this.blockReason = undefined;
  }
  credentials(expiresAt?: number) {
    const changed = this.credentialExpiry !== undefined && this.credentialExpiry !== expiresAt;
    this.credentialExpiry = expiresAt;
    if (
      changed &&
      (this.authFailures ||
        ['AUTH_REDIRECT', 'REAUTH_REQUIRED', 'SESSION_REMOVED'].includes(this.blockReason ?? ''))
    ) {
      this.blocked = false;
      this.authFailures = 0;
      this.blockReason = undefined;
      this.notBefore = 0;
    }
  }
  ready() {
    if (this.readySince === undefined) this.readySince = this.now();
    this.notBefore = 0;
  }
  suspend() {
    this.readySince = undefined;
  }
  failed(code?: string, retryAt?: number): number | undefined {
    const now = this.now();
    if (this.readySince !== undefined && now - this.readySince >= 60000) {
      this.failures = 0;
      this.authFailures = 0;
    }
    this.readySince = undefined;
    if (code === 'CHAT_AUTH') this.authFailures++;
    if (HARD_FAILURES.has(code ?? '') || this.authFailures >= 2) {
      this.blocked = true;
      this.blockReason = code;
      return;
    }
    const base =
      code === 'CHAT_AUTH' ? 60000 : Math.min(300000, 10000 * 2 ** Math.min(5, this.failures));
    this.failures++;
    const jitter = Math.round(base * 0.15 * Math.max(0, Math.min(1, this.random())));
    this.notBefore = Math.max(now + base + jitter, Number.isFinite(retryAt) ? retryAt! : 0);
    return this.notBefore;
  }
}
export function chatConnectionLabel(chat: ChatState): string {
  if (chat.status === 'ready') return 'Connected';
  if (chat.status === 'connecting' || chat.status === 'authenticating')
    return 'Connecting automatically...';
  if (
    ['CHAT_AUTH', 'AUTH_REDIRECT', 'REAUTH_REQUIRED', 'SESSION_REMOVED'].includes(
      chat.errorCode ?? '',
    ) &&
    !chat.retryAt
  )
    return 'Sign in again in Settings to restore chat.';
  if (
    ['CHAT_PROTOCOL', 'CHAT_CONFIG', 'CHAT_IDENTITY', 'NATIVE_REQUIRED'].includes(
      chat.errorCode ?? '',
    )
  )
    return 'Chat is unavailable for this connection. Your saved messages are kept.';
  if (chat.retryAt && chat.retryAt > Date.now())
    return `Reconnecting after ${new Date(chat.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  return 'Reconnecting automatically. Saved messages are available.';
}

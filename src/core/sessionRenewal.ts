import type { LoginTokens, Session } from './types';
import { decodeJwtClaimsUnverified, validateSession } from './auth';
import { assertCookieSubject, cleanSessionCookies } from './sessionCookies';
import { AppError, text } from './validation';

export function stageSessionRenewal(
  previous: Session,
  tokens: LoginTokens,
  now = Date.now(),
): Session {
  for (const value of [tokens.accessToken, tokens.idToken]) {
    if (!value) continue;
    const hint = text(decodeJwtClaimsUnverified(value).sub);
    if (hint && hint.toLowerCase() !== previous.account.puuid)
      throw new AppError(
        'ACCOUNT_MISMATCH',
        'Renewal returned another account. Existing account storage was not replaced.',
      );
  }
  if (!Number.isFinite(tokens.expiresAt) || tokens.expiresAt <= now + 30000)
    throw new AppError('SESSION_EXPIRED', 'The renewed token has expired.');
  const cookies = cleanSessionCookies(tokens.reauthCookies ?? previous.reauth?.cookies);
  assertCookieSubject(cookies, previous.account.puuid);
  const { reauth: oldCookies, renewalFailure, accessRejected, ...old } = previous;
  return validateSession({
    ...old,
    version: 2,
    account: { ...previous.account, expiresAt: tokens.expiresAt, canReauth: !!cookies.ssid },
    accessToken: tokens.accessToken,
    renewalPending: true,
    ...(cookies.ssid ? { reauth: { cookies, capturedAt: now } } : {}),
  });
}

export function checkpointCookies(
  previous: Session,
  raw: Record<string, string>,
  now = Date.now(),
): Session {
  const cookies = cleanSessionCookies(raw);
  assertCookieSubject(cookies, previous.account.puuid);
  const { reauth, ...rest } = previous;
  return validateSession({
    ...rest,
    account: { ...previous.account, canReauth: !!cookies.ssid },
    ...(cookies.ssid ? { reauth: { cookies, capturedAt: now } } : {}),
  });
}
export function sessionCheckpointMatches(saved: Session | null, expected: Session): boolean {
  if (
    !saved ||
    saved.account.puuid !== expected.account.puuid ||
    saved.accessToken !== expected.accessToken ||
    saved.entitlementsToken !== expected.entitlementsToken ||
    saved.account.expiresAt !== expected.account.expiresAt ||
    !!saved.renewalPending !== !!expected.renewalPending ||
    !!saved.accessRejected !== !!expected.accessRejected ||
    saved.renewalFailure?.retryAt !== expected.renewalFailure?.retryAt ||
    saved.renewalFailure?.code !== expected.renewalFailure?.code
  )
    return false;
  const a = cleanSessionCookies(saved.reauth?.cookies),
    b = cleanSessionCookies(expected.reauth?.cookies);
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(b).every(([name, value]) => a[name] === value)
  );
}
export interface SessionHealth {
  storage: 'saved' | 'missing';
  token: 'active' | 'expired' | 'pending' | 'renewal-needed';
  reusable: boolean;
  lastCookieSave?: number;
  lastRenewalCode?: string;
  retryAt?: number;
}
export function sessionHealth(session: Session | null, now = Date.now()): SessionHealth {
  return {
    storage: session ? 'saved' : 'missing',
    token: session?.renewalPending
      ? 'pending'
      : session?.accessRejected
        ? 'renewal-needed'
        : session && session.account.expiresAt > now + 30000
          ? 'active'
          : 'expired',
    reusable: !!session?.reauth?.cookies.ssid,
    lastCookieSave: session?.reauth?.capturedAt,
    lastRenewalCode: session?.renewalFailure?.code,
    retryAt: session?.renewalFailure?.retryAt,
  };
}

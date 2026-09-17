import { AppError } from './validation';

export type RenewalTransport = 'fetch-standard' | 'expo-android';
export interface RenewalEnvelope {
  readonly status: number;
  readonly url: string;
  readonly redirected: boolean;
}
export interface ManualAuthorizationRequest {
  readonly url: string;
  readonly method: 'GET';
  readonly redirect: 'manual';
  readonly credentials: 'omit';
}
const AUTH_ORIGIN = 'https://auth.riotgames.com';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}
function blocked(): never {
  throw new AppError('AUTH_REDIRECT', 'An unexpected authentication response was blocked.');
}

export function validateManualAuthorizationEnvelope(
  request: ManualAuthorizationRequest,
  response: RenewalEnvelope,
  transport: RenewalTransport = 'fetch-standard',
): 'standard' | 'expo-android-unfollowed-redirect' {
  const expected = parseUrl(request.url);
  if (
    request.method !== 'GET' ||
    request.redirect !== 'manual' ||
    request.credentials !== 'omit' ||
    !expected ||
    expected.origin !== AUTH_ORIGIN ||
    expected.pathname !== '/authorize' ||
    expected.username ||
    expected.password ||
    expected.hash
  )
    blocked();
  const returned = response.url ? parseUrl(response.url) : undefined;

  if (response.url && (!returned || returned.href !== expected.href)) blocked();
  if (!response.redirected) return 'standard';

  if (
    transport === 'expo-android' &&
    REDIRECT_STATUSES.has(response.status) &&
    returned?.href === expected.href
  )
    return 'expo-android-unfollowed-redirect';
  return blocked();
}

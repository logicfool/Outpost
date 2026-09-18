import type { LoginAttempt, LoginTokens } from './types';
import { authorizationUrl, decodeJwtClaimsUnverified, rotatedCookies } from './auth';
import { validateManualAuthorizationEnvelope, type RenewalTransport } from './authResponseEnvelope';
import { cleanSessionCookies, assertCookieSubject } from './sessionCookies';
import { AppError, token, uuid } from './validation';
import type { Fetcher } from './http';
export const PREFERENCE_CLIENT_ID = 'riot-client';
export const PREFERENCE_CALLBACK = 'http://localhost/redirect';

export function preferenceAuthorizationUrl(attempt: LoginAttempt): string {
  const url = new URL(authorizationUrl(attempt));
  url.searchParams.set('client_id', PREFERENCE_CLIENT_ID);
  url.searchParams.set('redirect_uri', PREFERENCE_CALLBACK);
  url.searchParams.set('scope', 'openid account');
  url.searchParams.set('prompt', 'none');
  return url.toString();
}
export function parsePreferenceCallback(
  location: string,
  attempt: LoginAttempt,
  expectedId: string,
  now = Date.now(),
): LoginTokens {
  if (location.length > 56000)
    throw new AppError('AIM_AUTH_REDIRECT', 'Settings callback is too large.');
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    throw new AppError('AIM_AUTH_REDIRECT', 'Riot did not return the settings callback.');
  }
  if (
    url.origin !== 'http://localhost' ||
    url.pathname !== '/redirect' ||
    url.search ||
    url.username ||
    url.password ||
    url.port
  )
    throw new AppError('AIM_AUTH_REDIRECT', 'An unexpected settings callback was blocked.');
  if (now < attempt.createdAt - 30000 || now - attempt.createdAt > 600000)
    throw new AppError('AIM_AUTH_TIMEOUT', 'The settings authorization expired.');
  const params = new URLSearchParams(url.hash.slice(1));
  for (const key of ['state', 'access_token', 'id_token', 'expires_in', 'token_type', 'error'])
    if (params.getAll(key).length > 1)
      throw new AppError('AIM_AUTH_REDIRECT', 'Riot returned ambiguous settings credentials.');
  if (params.get('state') !== attempt.state)
    throw new AppError('AIM_AUTH_STATE', 'The settings authorization state did not match.');
  if (params.has('error'))
    throw new AppError(
      'AIM_AUTH_REQUIRED',
      'Riot requires authorization for Aim settings. Store and chat remain connected.',
    );
  if (params.get('token_type')?.toLowerCase() !== 'bearer')
    throw new AppError('AIM_AUTH_TOKEN', 'Unsupported settings authorization type.');
  const accessToken = token(params.get('access_token')),
    idToken = token(params.get('id_token'));
  const identity = decodeJwtClaimsUnverified(idToken),
    access = decodeJwtClaimsUnverified(accessToken);
  const aud = Array.isArray(identity.aud) ? identity.aud : [identity.aud];
  if (
    identity.nonce !== attempt.nonce ||
    !aud.includes(PREFERENCE_CLIENT_ID) ||
    identity.sub !== uuid(expectedId)
  )
    throw new AppError('AIM_AUTH_IDENTITY', 'Riot returned a different settings authorization.');
  if (
    (access.sub && access.sub !== expectedId) ||
    (access.client_id && access.client_id !== PREFERENCE_CLIENT_ID)
  )
    throw new AppError('AIM_AUTH_IDENTITY', 'The settings token identity did not match.');
  const seconds = Number(params.get('expires_in'));
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new AppError('AIM_AUTH_EXPIRY', 'The settings authorization has no valid expiry.');
  const expiresAt = Math.min(
    now + Math.min(seconds, 3600) * 1000,
    typeof access.exp === 'number' ? access.exp * 1000 : Infinity,
    typeof identity.exp === 'number' ? identity.exp * 1000 : Infinity,
  );
  if (expiresAt <= now + 30000)
    throw new AppError('AIM_AUTH_EXPIRY', 'The settings authorization has expired.');

  return { accessToken, idToken, expiresAt };
}
export async function authorizePreferences(
  rawCookies: Record<string, string>,
  expectedId: string,
  attempt: LoginAttempt,
  fetcher: Fetcher,
  saveCookies: (cookies: Record<string, string>) => Promise<void>,
  transport: RenewalTransport,
): Promise<LoginTokens> {
  const cookies = cleanSessionCookies(rawCookies);
  assertCookieSubject(cookies, expectedId);
  if (!cookies.ssid)
    throw new AppError(
      'AIM_AUTH_REQUIRED',
      'Aim settings require a saved Riot browser session. Reconnect this account once without removing it.',
    );
  const request = {
    url: preferenceAuthorizationUrl(attempt),
    method: 'GET',
    credentials: 'omit',
    redirect: 'manual',
  } as const;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    let response: Response;
    try {
      response = await fetcher(request.url, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/json',
          Cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; '),
        },
      });
    } catch {
      throw new AppError(
        controller.signal.aborted ? 'TIMEOUT' : 'NETWORK',
        'Riot settings authorization could not be reached.',
      );
    }
    validateManualAuthorizationEnvelope(request, response, transport);
    const next = rotatedCookies(cookies, response.headers);
    assertCookieSubject(next, expectedId);
    if (JSON.stringify(next) !== JSON.stringify(cookies)) await saveCookies(next);
    if (response.status === 429) {
      const value = response.headers.get('retry-after') ?? '',
        seconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN,
        absolute = Date.parse(value);
      throw new AppError(
        'RATE_LIMIT',
        'Riot asked us to wait before authorizing settings.',
        Date.now() +
          Math.max(
            60000,
            Number.isFinite(seconds)
              ? seconds * 1000
              : Number.isFinite(absolute)
                ? absolute - Date.now()
                : 60000,
          ),
        429,
      );
    }
    if (response.status === 403)
      throw new AppError(
        'AIM_AUTH_ACCESS',
        'Riot denied the optional settings authorization. Export detailed diagnostics; do not repeatedly reconnect.',
        undefined,
        403,
      );
    if (response.status >= 500)
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Riot settings authorization is temporarily unavailable.',
        undefined,
        response.status,
      );
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location)
      throw new AppError(
        'AIM_AUTH_REQUIRED',
        'Riot did not grant silent Aim settings authorization. Store and chat remain connected.',
      );
    return parsePreferenceCallback(location, attempt, expectedId);
  } finally {
    clearTimeout(timer);
  }
}

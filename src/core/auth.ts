import type { Account, LoginAttempt, LoginTokens, Region, Session, Shard } from './types';
import { AppError, number, object, text, token, uuid } from './validation';
export const AUTH_ORIGIN = 'https://auth.riotgames.com';
export const REDIRECT_URI = 'https://playvalorant.com/opt_in';
export const RIOT_CLIENT_ID = 'play-valorant-web-prod';
export const REGIONS: Region[] = ['ap', 'eu', 'na', 'br', 'latam', 'kr', 'pbe'];
export function shardFor(region: string): Shard {
  if (region === 'br' || region === 'latam' || region === 'na') return 'na';
  if (region === 'ap' || region === 'eu' || region === 'kr' || region === 'pbe') return region;
  throw new AppError(
    'REGION',
    'Choose the account region. Region detection did not return a supported shard.',
  );
}
export function authorizationUrl(attempt: LoginAttempt): string {
  if (!/^[a-f0-9]{32,128}$/i.test(attempt.state) || !/^[a-f0-9]{32,128}$/i.test(attempt.nonce))
    throw new AppError('AUTH_STATE', 'A secure sign-in attempt could not be created.');
  const url = new URL('/authorize', AUTH_ORIGIN);
  const params = {
    client_id: RIOT_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'token id_token',
    scope: 'account openid',
    state: attempt.state,
    nonce: attempt.nonce,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
export function isLoginNavigationAllowed(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (url.origin === new URL(REDIRECT_URI).origin)
      return url.pathname === '/opt_in' && !url.search;
    return ['auth.riotgames.com', 'authenticate.riotgames.com', 'login.riotgames.com'].includes(
      url.hostname,
    );
  } catch {
    return false;
  }
}
export function isCallback(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.origin === 'https://playvalorant.com' && u.pathname === '/opt_in';
  } catch {
    return false;
  }
}
export function decodeJwtClaimsUnverified(jwt: string): Record<string, unknown> {
  try {
    const part = jwt.split('.')[1];
    if (!part || part.length > 24000) return {};
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const json = decodeURIComponent(
      Array.from(bytes, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    return object(JSON.parse(json));
  } catch {
    return {};
  }
}
export function parseCallback(
  rawUrl: string,
  attempt: LoginAttempt,
  now = Date.now(),
): LoginTokens {
  if (!isLoginNavigationAllowed(rawUrl) || !isCallback(rawUrl))
    throw new AppError(
      'AUTH_REDIRECT',
      'The sign-in redirect was not from the expected Riot flow.',
    );
  if (now < attempt.createdAt - 30000 || now - attempt.createdAt > 10 * 60 * 1000)
    throw new AppError('AUTH_TIMEOUT', 'Sign-in expired. Open a new sign-in window.');
  const params = new URLSearchParams(new URL(rawUrl).hash.slice(1));
  for (const key of ['state', 'access_token', 'id_token', 'expires_in', 'token_type', 'error']) {
    if (params.getAll(key).length > 1)
      throw new AppError('AUTH_REDIRECT', 'The sign-in response is ambiguous.');
  }
  if (params.get('state') !== attempt.state)
    throw new AppError('AUTH_STATE', 'The sign-in state did not match. Start sign-in again.');
  if (params.has('error'))
    throw new AppError('AUTH_DENIED', 'Riot did not authorize this sign-in. No session was saved.');
  if (params.get('token_type')?.toLowerCase() !== 'bearer')
    throw new AppError('AUTH_TOKEN', 'Riot returned an unsupported token type.');
  const accessToken = token(params.get('access_token'));
  const idToken = token(params.get('id_token'));
  const claims = decodeJwtClaimsUnverified(idToken);
  if (text(claims.nonce) !== attempt.nonce)
    throw new AppError('AUTH_NONCE', 'The sign-in nonce did not match. Start sign-in again.');
  const seconds = Number(params.get('expires_in'));
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new AppError('AUTH_EXPIRY', 'Riot did not return a valid session expiry.');
  const hintedExpiry = number(decodeJwtClaimsUnverified(accessToken).exp) * 1000;
  const expiresAt = Math.min(
    now + Math.min(seconds, 3600) * 1000,
    hintedExpiry > 0 ? hintedExpiry : Infinity,
  );
  if (expiresAt <= now + 30000)
    throw new AppError('SESSION_EXPIRED', 'This session has expired. Sign in again.');
  return { accessToken, idToken, expiresAt };
}
export function accountFromUserInfo(
  raw: unknown,
  region: Region,
  expiresAt: number,
  now = Date.now(),
): Account {
  const info = object(raw),
    acct = object(info.acct);
  return {
    puuid: uuid(info.sub),
    gameName: text(acct.game_name, 'Riot player'),
    tagLine: text(acct.tag_line),
    region,
    shard: shardFor(region),
    expiresAt,
    addedAt: now,
    country: typeof info.country === 'string' ? info.country : undefined,
    createdAt: typeof acct.created_at === 'number' ? acct.created_at : undefined,
    emailVerified: typeof info.email_verified === 'boolean' ? info.email_verified : undefined,
    phoneVerified:
      typeof info.phone_number_verified === 'boolean' ? info.phone_number_verified : undefined,
  };
}
export function validateSession(raw: unknown): Session {
  const s = object(raw),
    a = object(s.account);
  if (
    (s.version !== 1 && s.version !== 2) ||
    a.demo ||
    !REGIONS.includes(a.region as Region) ||
    a.shard !== shardFor(text(a.region)) ||
    !Number.isFinite(a.expiresAt)
  )
    throw new AppError('SESSION_INVALID', 'The saved session is invalid. Sign in again.');
  let reauth: Session['reauth'];
  if (s.reauth) {
    const r = object(s.reauth),
      rawCookies = object(r.cookies),
      cookies: Record<string, string> = {};
    for (const [name, value] of Object.entries(rawCookies))
      if (
        /^[a-z0-9_-]{1,32}$/i.test(name) &&
        typeof value === 'string' &&
        value.length > 0 &&
        value.length < 8192
      )
        cookies[name] = value;
    if (cookies.ssid) reauth = { cookies, capturedAt: Number(r.capturedAt) || Date.now() };
  }
  return {
    version: s.version as 1 | 2,
    account: { ...a, puuid: uuid(a.puuid) } as unknown as Account,
    accessToken: token(s.accessToken),
    entitlementsToken: token(s.entitlementsToken),
    ...(reauth ? { reauth } : {}),
  };
}
export function sessionActive(session: Session, now = Date.now()): boolean {
  return session.account.expiresAt > now + 30000;
}

const COOKIE_NAMES = new Set(['ssid', 'tdid', 'sub', 'csid', 'clid', 'did', 'asid']);
export function rotatedCookies(
  previous: Record<string, string>,
  headers: Headers,
): Record<string, string> {
  const result = { ...previous };
  const native = headers as Headers & { getSetCookie?: () => string[] };
  const rawValues = native.getSetCookie?.() ?? [headers.get('set-cookie') ?? ''];
  const values = rawValues.flatMap((value) => value.split(/,(?=\s*[a-z0-9_-]+=)/i));
  for (const line of values) {
    const pieces = line.split(';'),
      pair = pieces.shift()?.trim() ?? '',
      separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator),
      value = pair.slice(separator + 1);
    if (!COOKIE_NAMES.has(name)) continue;
    const expired = pieces.some(
      (part) => /^\s*max-age=0\s*$/i.test(part) || /^\s*max-age=-/i.test(part),
    );
    if (!value || expired) delete result[name];
    else if (value.length <= 8192 && !/[\r\n;]/.test(value)) result[name] = value;
  }
  return result;
}

export async function reauthenticateWithCookies(
  cookies: Record<string, string>,
  attempt: LoginAttempt,
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
): Promise<LoginTokens> {
  if (!cookies.ssid || cookies.ssid.length > 8192 || /[\r\n;]/.test(cookies.ssid))
    throw new AppError('REAUTH_UNAVAILABLE', 'This account has no reusable Riot session cookie.');
  const cookie = Object.entries(cookies)
    .filter(([k, v]) => COOKIE_NAMES.has(k) && v && v.length <= 8192 && !/[\r\n;]/.test(v))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let response: Response;
    try {
      response = await fetcher(authorizationUrl(attempt), {
        method: 'GET',
        headers: { Accept: 'text/html,*/*', Cookie: cookie },
        credentials: 'omit',
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      throw new AppError(
        controller.signal.aborted ? 'TIMEOUT' : 'NETWORK',
        'Riot silent reauthentication could not be reached.',
      );
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== AUTH_ORIGIN))
      throw new AppError('AUTH_REDIRECT', 'An unexpected authentication redirect was blocked.');
    if (response.status === 429) {
      const delay = Number(response.headers.get('retry-after'));
      throw new AppError(
        'RATE_LIMIT',
        'Riot asked this app to wait before renewing the session.',
        Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60) * 1000,
        429,
      );
    }
    if (response.status >= 500)
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Riot sign-in is temporarily unavailable.',
        undefined,
        response.status,
      );
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location || !isCallback(location))
      throw new AppError('REAUTH_REQUIRED', 'Riot requires interactive sign-in again.');
    const tokens = parseCallback(location, attempt);
    return { ...tokens, reauthCookies: rotatedCookies(cookies, response.headers) };
  } finally {
    clearTimeout(timeout);
  }
}

import { AppError, object, text } from './validation';

export const SESSION_COOKIE_NAMES = new Set(['ssid', 'tdid', 'sub', 'csid', 'clid', 'did', 'asid']);
export const MAX_COOKIE_BYTES = 8192;
export function safeCookieValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_COOKIE_BYTES &&
    !/[\u0000-\u0020\u007f;,]/.test(value)
  );
}
export function cleanSessionCookies(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(object(raw)))
    if (SESSION_COOKIE_NAMES.has(name) && safeCookieValue(value)) out[name] = value;
  return out;
}

export function assertCookieSubject(cookies: Record<string, string>, expected?: string): void {
  if (!expected || !cookies.sub) return;
  let subject = cookies.sub;
  try {
    subject = decodeURIComponent(subject);
  } catch {
    return;
  }
  if (
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subject) &&
    subject.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new AppError(
      'REAUTH_ACCOUNT_MISMATCH',
      'The browser returned a session for a different Riot account. Start a fresh sign-in; existing accounts were not changed.',
    );
  }
}

export function selectRiotCookies(
  raw: unknown,
  requireDomain: boolean,
  expected?: string,
  now = Date.now(),
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(object(raw))) {
    if (!SESSION_COOKIE_NAMES.has(name)) continue;
    const cookie = object(value);
    if ((cookie.name !== undefined && cookie.name !== name) || !safeCookieValue(cookie.value))
      continue;
    const domain = text(cookie.domain).toLowerCase().replace(/^\./, '');
    if (domain ? !['auth.riotgames.com', 'riotgames.com'].includes(domain) : requireDomain)
      continue;
    const path = text(cookie.path, '/');
    if (path !== '/' && path !== '/authorize') continue;
    const expiry = cookie.expires === undefined ? undefined : Date.parse(text(cookie.expires));
    if (expiry !== undefined && (!Number.isFinite(expiry) || expiry <= now)) continue;
    out[name] = cookie.value;
  }
  if (!out.ssid)
    throw new AppError(
      'REAUTH_COOKIE',
      'Riot login succeeded, but its reusable session cookie was not available. Try again and enable Stay signed in on Riot’s page. Existing accounts were not changed.',
    );
  assertCookieSubject(out, expected);
  return out;
}

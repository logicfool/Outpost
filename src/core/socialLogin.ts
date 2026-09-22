import { isLoginNavigationAllowed, isCallback } from './auth';

export type SocialProvider = 'Google' | 'Apple' | 'Facebook' | 'Microsoft / Xbox' | 'PlayStation';
const PROVIDERS: Record<string, SocialProvider> = {
  'accounts.google.com': 'Google',
  'appleid.apple.com': 'Apple',
  'www.facebook.com': 'Facebook',
  'm.facebook.com': 'Facebook',
  'facebook.com': 'Facebook',
  'login.live.com': 'Microsoft / Xbox',
  'login.microsoftonline.com': 'Microsoft / Xbox',
  'ca.account.sony.com': 'PlayStation',
  'auth.api.sonyentertainmentnetwork.com': 'PlayStation',
};
const RIOT_HOSTS = ['auth.riotgames.com', 'authenticate.riotgames.com', 'login.riotgames.com'];
export function loginDocument(url: string): boolean {
  try {
    return RIOT_HOSTS.includes(new URL(url).hostname) && isLoginNavigationAllowed(url);
  } catch {
    return false;
  }
}
function httpsUrl(raw: string): URL | undefined {
  if (typeof raw !== 'string' || raw.length > 32768 || /[\u0000-\u0020\u007f\\]/.test(raw)) return;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return;
    return url;
  } catch {
    return;
  }
}
/** Only an OAuth authorization request which returns to Riot may leave the app.
 * Provider pages never join the embedded browser's navigation allowlist. */
export function socialAuthorization(
  raw: string,
  depth = 0,
): { url: string; provider: SocialProvider } | undefined {
  const url = httpsUrl(raw);
  if (!url || depth > 2) return;
  const provider = PROVIDERS[url.hostname];
  if (!provider) return;
  const path = url.pathname;
  const authorizationPath =
    provider === 'Google'
      ? /^\/(?:o\/oauth2(?:\/v2)?\/auth|v3\/signin\/(?:accountchooser|identifier)|AccountChooser)$/.test(
          path,
        )
      : provider === 'Apple'
        ? path === '/auth/authorize'
        : provider === 'Facebook'
          ? /^\/(?:v[0-9.]+\/)?dialog\/oauth$/.test(path)
          : provider === 'Microsoft / Xbox'
            ? path === '/oauth20_authorize.srf' ||
              /^\/[^/]+\/oauth2(?:\/v2.0)?\/authorize$/.test(path)
            : /^\/(?:api\/authz\/v[0-9]+|2.0)\/oauth\/authorize$/.test(path);
  if (!authorizationPath) return;
  const keys = new Set<string>();
  for (const [key] of url.searchParams) {
    if (keys.has(key.toLowerCase())) return;
    keys.add(key.toLowerCase());
    if (
      /^(?:access_token|id_token|refresh_token|login_token|password|cookie|authorization)$/i.test(
        key,
      )
    )
      return;
    if (url.searchParams.getAll(key).length !== 1) return;
  }
  if (provider === 'Google')
    for (const name of ['continue', 'followup']) {
      const value = url.searchParams.get(name);
      if (value) {
        const next = httpsUrl(value);
        if (!next || next.hostname !== url.hostname) return;
      }
    }
  const redirect = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  const client = url.searchParams.get('client_id');
  if (
    redirect &&
    state &&
    client &&
    state.length >= 8 &&
    state.length <= 8192 &&
    client.length <= 1024
  ) {
    const callback = httpsUrl(redirect);
    if (
      callback &&
      RIOT_HOSTS.includes(callback.hostname) &&
      /^\/(?:redirects|social|oauth)(?:\/|$)/.test(callback.pathname)
    )
      return { url: url.toString(), provider };
  }
  // A valid nested URL cannot excuse conflicting or malformed outer OAuth parameters.
  if (redirect !== null || state !== null || client !== null) return;
  // Google may wrap its original OAuth URL in a same-provider account chooser.
  for (const key of ['continue', 'followup']) {
    const nested = url.searchParams.get(key);
    if (!nested) continue;
    const checked = socialAuthorization(nested, depth + 1);
    if (checked && new URL(checked.url).hostname === url.hostname)
      return { url: url.toString(), provider };
  }
}
export function riotSocialCompletion(raw: string): boolean {
  if (isCallback(raw)) return isLoginNavigationAllowed(raw);
  const url = httpsUrl(raw);
  return (
    !!url &&
    url.hostname === 'auth.riotgames.com' &&
    url.pathname === '/login-token' &&
    url.searchParams.getAll('login_token').length === 1 &&
    !!url.searchParams.get('login_token') &&
    [...url.searchParams.keys()].every((key) => ['login_token', 'state'].includes(key)) &&
    url.searchParams.getAll('state').length <= 1
  );
}

export function socialResumeDocument(raw: string): boolean {
  const url = httpsUrl(raw);
  return !!url && url.hostname === 'authenticate.riotgames.com' && url.pathname === '/';
}

import CookieManager from '@react-native-cookies/cookies';
import { AppError } from '../core/validation';

const ALLOWED = new Set(['ssid', 'tdid', 'sub', 'csid', 'clid', 'did', 'asid']);
export async function captureRiotReauthCookies(): Promise<Record<string, string>> {
  const raw = await CookieManager.get('https://auth.riotgames.com', true);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!ALLOWED.has(name) || !value?.value) continue;
    out[name] = value.value;
  }
  if (!out.ssid)
    throw new AppError(
      'REAUTH_COOKIE',
      'Riot did not provide a reusable session cookie. You can still use the current login, but unattended refresh will be unavailable.',
    );
  return out;
}
export async function clearRiotWebCookies(): Promise<void> {
  await CookieManager.clearAll(true).catch(() => false);
}

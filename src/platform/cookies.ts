import CookieManager from '@react-native-cookies/cookies';
import { Platform } from 'react-native';
import { AppError } from '../core/validation';

const ALLOWED = new Set(['ssid', 'tdid', 'sub', 'csid', 'clid', 'did', 'asid']);
export async function captureRiotReauthCookies(): Promise<Record<string, string>> {
  const raw = await CookieManager.get('https://auth.riotgames.com', Platform.OS === 'ios');
  const out: Record<string, string> = {};
  for (const [name, cookie] of Object.entries(raw)) {
    if (
      ALLOWED.has(name) &&
      cookie?.value &&
      cookie.value.length <= 8192 &&
      !/[\r\n;]/.test(cookie.value)
    )
      out[name] = cookie.value;
  }
  if (!out.ssid)
    throw new AppError(
      'REAUTH_COOKIE',
      'Riot did not return a reusable session cookie. This account may need sign-in again after expiry.',
    );
  return out;
}
export async function clearRiotWebCookies(): Promise<void> {
  if (!(await CookieManager.clearAll(false)))
    throw new AppError(
      'COOKIE_RESET',
      'The previous Riot browser session could not be cleared. Try again.',
    );
  if (Platform.OS === 'ios') {
    if (!(await CookieManager.clearAll(true)))
      throw new AppError('COOKIE_RESET', 'The Riot sign-in window could not be reset. Try again.');
  } else await CookieManager.flush();
}

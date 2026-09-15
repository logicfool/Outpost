import CookieManager from '@react-native-cookies/cookies';
import { Platform } from 'react-native';
import { AppError } from '../core/validation';
import { selectRiotCookies } from '../core/sessionCookies';
import { bounded } from '../core/loginFlow';

export async function captureRiotReauthCookies(
  expectedSubject?: string,
): Promise<Record<string, string>> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      const webkit = Platform.OS === 'ios';
      const raw = await bounded(
        webkit
          ? CookieManager.getAll(true)
          : CookieManager.get('https://auth.riotgames.com/authorize', false),
        1500,
        'Riot session-cookie read timed out.',
      );
      return selectRiotCookies(raw, webkit, expectedSubject);
    } catch (error) {
      last = error;
      if (error instanceof AppError && error.code === 'REAUTH_ACCOUNT_MISMATCH') throw error;
    }
  }
  if (last instanceof AppError && last.code === 'REAUTH_COOKIE') throw last;
  throw new AppError(
    'REAUTH_COOKIE',
    'The reusable Riot session could not be captured. Retry sign-in; no saved account was replaced.',
  );
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

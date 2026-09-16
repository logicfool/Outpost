import CookieManager from '@react-native-cookies/cookies';
import { Platform } from 'react-native';
import { AppError } from '../core/validation';
import { selectRiotCookies } from '../core/sessionCookies';
import { bounded } from '../core/loginFlow';
import { recordLogin } from '../core/diagnostics';

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

let resetFlight: Promise<void> | undefined;
export function clearRiotWebCookies(): Promise<void> {
  if (resetFlight) return resetFlight;
  const work = resetBrowserCookies();
  resetFlight = work;
  const done = () => {
    if (resetFlight === work) resetFlight = undefined;
  };
  void work.then(done, done);
  return work;
}
async function resetBrowserCookies(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      const removed = await CookieManager.clearAll(false);
      if (typeof removed !== 'boolean')
        throw new AppError(
          'COOKIE_RESET',
          'The login browser returned an invalid reset result. Retry sign-in.',
        );
      await CookieManager.flush();

      for (const url of [
        'https://auth.riotgames.com/authorize',
        'https://authenticate.riotgames.com/api/v1/login',
        'https://login.riotgames.com/',
      ]) {
        const cookies = await CookieManager.get(url, false);
        if (
          !cookies ||
          typeof cookies !== 'object' ||
          Array.isArray(cookies) ||
          Object.keys(cookies).length !== 0
        ) {
          throw new AppError(
            'COOKIE_RESET',
            'The login browser still has cookies. Close sign-in and retry.',
          );
        }
      }
      recordLogin(
        'browser-reset',
        removed ? 'ANDROID_COOKIE_JAR_CLEARED' : 'ANDROID_COOKIE_JAR_ALREADY_EMPTY',
      );
      recordLogin('browser-reset', 'ANDROID_COOKIE_RESET_VERIFIED');
    } catch (reason) {
      recordLogin('browser-reset', 'ANDROID_COOKIE_RESET_FAILED');
      throw reason instanceof AppError
        ? reason
        : new AppError(
            'COOKIE_RESET',
            'The login browser could not be reset. Close sign-in and retry.',
          );
    }
    return;
  }

  if (Platform.OS === 'ios') {
    if (!(await CookieManager.clearAll(false)))
      throw new AppError(
        'COOKIE_RESET',
        'The previous Riot browser session could not be cleared. Try again.',
      );
    if (!(await CookieManager.clearAll(true)))
      throw new AppError('COOKIE_RESET', 'The Riot sign-in window could not be reset. Try again.');
    return;
  }
  throw new AppError('NATIVE_REQUIRED', 'Riot sign-in requires the native app.');
}

import { AppError } from './validation';
import { cleanSessionCookies, assertCookieSubject } from './sessionCookies';
import type { Session } from './types';
import type { Fetcher } from './http';
import { readBoundedText } from './responseBody';
import { recordRequest } from './diagnostics';

export async function logoutRiotSession(session: Session, fetcher: Fetcher): Promise<void> {
  const cookies = cleanSessionCookies(session.reauth?.cookies);
  assertCookieSubject(cookies, session.account.puuid);
  if (!cookies.ssid)
    throw new AppError(
      'LOGOUT_NO_COOKIE',
      'No Riot web session is saved. Use Remove locally instead.',
    );
  const controller = new AbortController(),
    started = Date.now();
  const timer = setTimeout(() => controller.abort(), 15000);
  let status: number | undefined,
    code = 'OK';
  try {
    const response = await fetcher('https://auth.riotgames.com/logout', {
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
        'Accept-Language': 'en-US',
        Accept: 'text/html',
      },
    });
    status = response.status;
    if (
      response.redirected ||
      (response.url && new URL(response.url).origin !== 'https://auth.riotgames.com')
    )
      throw new AppError(
        'LOGOUT_REDIRECT',
        'Unexpected logout response. This account is still saved.',
      );
    if (status === 429) {
      const header = response.headers.get('retry-after'),
        seconds = header && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : NaN,
        absolute = header ? Date.parse(header) : NaN;
      const retryAt =
        Date.now() +
        Math.max(
          1000,
          Number.isFinite(seconds)
            ? seconds
            : Number.isFinite(absolute)
              ? absolute - Date.now()
              : 60000,
        );
      throw new AppError('RATE_LIMIT', 'Riot asked you to wait before signing out.', retryAt, 429);
    }
    if (!response.ok)
      throw new AppError(
        'LOGOUT_FAILED',
        'Riot sign-out failed. This account is still saved.',
        undefined,
        status,
      );
    const body = await readBoundedText(response, 256000);
    if (
      !/you(?:&#39;|&apos;|’|')ve been signed out|you (?:have been|are) signed out|successfully (?:signed|logged) out/i.test(
        body,
      )
    )
      throw new AppError(
        'LOGOUT_UNCONFIRMED',
        'Riot did not confirm sign-out. This account is still saved.',
      );
  } catch (error) {
    code =
      error instanceof AppError ? error.code : controller.signal.aborted ? 'TIMEOUT' : 'NETWORK';
    throw error instanceof AppError
      ? error
      : new AppError(code, 'Riot sign-out could not finish. Retry or remove this account locally.');
  } finally {
    clearTimeout(timer);
    recordRequest({
      at: Date.now(),
      service: 'Riot sign-out',
      method: 'GET',
      status,
      code,
      durationMs: Date.now() - started,
    });
  }
}

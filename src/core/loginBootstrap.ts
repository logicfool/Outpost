import { isCallback, isLoginNavigationAllowed } from './auth';
import { AppError } from './validation';

const BLANK_DOCUMENT =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="outpost-login-bootstrap" content="v1"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';
export function loginWebSource(url?: string): { html: string } | { uri: string } {
  if (!url) return { html: BLANK_DOCUMENT };
  if (!isLoginNavigationAllowed(url) || isCallback(url))
    throw new AppError(
      'AUTH_REDIRECT',
      'The sign-in window can only open the expected Riot login page.',
    );
  return { uri: url };
}

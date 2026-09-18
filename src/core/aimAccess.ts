import { AppError } from './validation';

export function aimAccessError(headers: Headers, body: string): AppError {
  if (headers.get('cf-mitigated')?.toLowerCase() === 'challenge')
    return new AppError(
      'AIM_CHALLENGE',
      'Riot requires an interactive security check for settings. No retry loop was started. Export diagnostics.',
      undefined,
      403,
    );
  if (/\bRBAC:\s*access denied\b/i.test(body))
    return new AppError(
      'AIM_RBAC',
      'Riot rejected this settings authorization. Store and chat are unaffected. Export diagnostics to inspect the client permissions.',
      undefined,
      403,
    );
  return new AppError(
    'AIM_ACCESS',
    'Riot denied Aim settings access. Export detailed diagnostics before reconnecting again.',
    undefined,
    403,
  );
}

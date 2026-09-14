import type { JsonObject } from './types';
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAt?: number,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
export function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function requiredArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value))
    throw new AppError('SCHEMA', `Riot's ${field} response changed or is unavailable.`);
  return value;
}
export function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new AppError('SCHEMA', `Riot's ${field} value is unavailable.`);
  return value;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
  )
    throw new AppError('INVALID_ID', 'A valid account or item identifier is required.');
  return value.toLowerCase();
}
export function token(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 20 ||
    value.length > 24000 ||
    !/^[A-Za-z0-9._~+\/-]+=*$/.test(value)
  )
    throw new AppError('INVALID_TOKEN', 'The session token is invalid. Sign in again.');
  return value;
}
export function safeError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError('UNEXPECTED', 'This request could not be completed. Try again.');
}
export function safeImage(value: unknown): string | undefined {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' &&
      url.hostname === 'media.valorant-api.com' &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

const MEDIA_HOSTS = new Set(['media.valorant-api.com', 'valorant.dyn.riotcdn.net']);
export function safeMedia(value: unknown): string | undefined {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' &&
      MEDIA_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
export function timestamp(value: unknown): number | undefined {
  const result = typeof value === 'string' ? Date.parse(value) : value;
  return typeof result === 'number' && Number.isFinite(result) && result > 0 ? result : undefined;
}
export function sameSubject(raw: JsonObject, puuid: string): void {
  if (raw.Subject !== undefined && text(raw.Subject).toLowerCase() !== puuid)
    throw new AppError('ACCOUNT_MISMATCH', 'Riot returned data for a different account.');
}

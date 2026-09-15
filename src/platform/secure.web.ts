import { SessionVault } from '../core/vault';
import { AppError } from '../core/validation';
const unavailable = async (): Promise<never> => {
  throw new AppError('NATIVE_REQUIRED', 'Web mode never accepts or stores Riot session tokens.');
};
export const vault = new SessionVault(
  { get: unavailable, set: unavailable, remove: unavailable },
  () => '',
);
export function randomHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}

export function randomId(): string {
  return crypto.randomUUID();
}

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { SessionVault } from '../core/vault';
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const vault = new SessionVault(
  {
    get: (key) => SecureStore.getItemAsync(key, options),
    set: (key, value) => SecureStore.setItemAsync(key, value, options),
    remove: (key) => SecureStore.deleteItemAsync(key, options),
  },
  () => Crypto.randomUUID(),
);
export function randomHex(): string {
  return Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function randomId(): string {
  return Crypto.randomUUID();
}

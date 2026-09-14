import type { Repository } from './storage.types';
import type { Settings, Catalog } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { AppError } from '../core/validation';
let settings: Settings = { ...DEFAULT_SETTINGS },
  catalog: Catalog | null = null;
const unavailable = async (): Promise<never> => {
  throw new AppError('NATIVE_REQUIRED', 'Real account access is available only in the native app.');
};
const repository: Repository = {
  accounts: async () => [],
  saveAccount: unavailable,
  removeAccount: unavailable,
  snapshot: async () => null,
  saveSnapshot: unavailable,
  history: async () => [],
  wishlist: async () => [],
  toggleWish: unavailable,
  settings: async () => settings,
  saveSettings: async (s) => {
    settings = s;
  },
  catalog: async () => catalog,
  saveCatalog: async (c) => {
    catalog = c;
  },
  notificationStamp: async () => null,
  setNotificationStamp: async () => {},
  clearCache: async () => {
    catalog = null;
  },
};
export async function openRepository(): Promise<Repository> {
  return repository;
}

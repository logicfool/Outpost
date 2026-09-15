import type { Repository } from './storage.types';
import type { Settings, Catalog } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { themePreference } from '../core/theme';
import { AppError } from '../core/validation';
let settings: Settings = { ...DEFAULT_SETTINGS },
  catalog: Catalog | null = null;
try {
  if (typeof localStorage !== 'undefined') {
    settings.theme = themePreference(localStorage.getItem('outpost.theme'));
    settings.autoChatHistory = localStorage.getItem('outpost.autoChatHistory') !== 'false';
  }
} catch {}
const unavailable = async (): Promise<never> => {
  throw new AppError('NATIVE_REQUIRED', 'Real account access is available only in the native app.');
};
const repository: Repository = {
  refreshGate: async () => null,
  saveRefreshGate: async () => {},
  selectedAccount: async () => null,
  selectAccount: async () => {},
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
    settings = { ...s, theme: themePreference(s.theme) };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('outpost.theme', settings.theme!);
        localStorage.setItem('outpost.autoChatHistory', String(settings.autoChatHistory !== false));
      }
    } catch {}
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

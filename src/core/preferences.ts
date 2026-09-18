import type { Settings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { object } from './validation';
import { themePreference } from './theme';
export const PREFERENCE_VERSION = 2;

export function preferences(raw: unknown): Settings {
  const value = object(raw);
  const migrated = value.defaultsVersion === PREFERENCE_VERSION;
  const merged = {
    ...DEFAULT_SETTINGS,
    theme: themePreference(value.theme),
    defaultsVersion: PREFERENCE_VERSION,
  };
  for (const key of [
    'reminders',
    'backgroundSync',
    'wishlistAlerts',
    'chatAlerts',
    'notificationPreviews',
    'autoChatHistory',
    'autoplayVideos',
    'allowPurchases',
  ] as const) {
    if (migrated && typeof value[key] === 'boolean') merged[key] = value[key];
  }
  merged.videoSound = typeof value.videoSound === 'boolean' ? value.videoSound : true;
  return merged;
}

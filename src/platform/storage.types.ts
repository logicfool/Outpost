import type { Account, Catalog, HistoryEntry, Settings, Snapshot } from '../core/types';
export interface Repository {
  accounts(): Promise<Account[]>;
  selectedAccount(): Promise<string | null>;
  selectAccount(id: string | null): Promise<void>;
  saveAccount(account: Account): Promise<void>;
  removeAccount(id: string): Promise<void>;
  snapshot(id: string): Promise<Snapshot | null>;
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  history(id: string): Promise<HistoryEntry[]>;
  wishlist(id: string): Promise<string[]>;
  toggleWish(id: string, itemId: string): Promise<string[]>;
  settings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  catalog(): Promise<Catalog | null>;
  saveCatalog(catalog: Catalog): Promise<void>;
  notificationStamp(key: string): Promise<string | null>;
  setNotificationStamp(key: string, value: string): Promise<void>;
  clearCache(): Promise<void>;
}

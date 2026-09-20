import type { ItemKind } from './types';
export type CollectionScope = 'owned' | 'catalog' | 'wishlist';
export type CollectionKind = ItemKind | 'all';
export interface CollectionView {
  navigationId?: number;
  scope: CollectionScope;
  kind: CollectionKind;
  query: string;
  weapon: string;
  offset: number;
}
export interface MarketView {
  navigationId?: number;
  filter: 'night-market' | 'bundle' | 'daily';
  offset: number;
}

export class BrowseMemory {
  private accountId?: string;
  private sequence = 0;
  syncAccount(accountId: string | undefined) {
    this.reset(accountId);
  }
  private entries = new WeakMap<object, CollectionView | MarketView>();
  private reset(accountId: string | undefined) {
    if (accountId !== this.accountId) {
      this.accountId = accountId;
      this.entries = new WeakMap();
    }
  }
  collection(
    accountId: string | undefined,
    route: object,
    kind: CollectionKind = 'all',
    scope: CollectionScope = 'owned',
  ): CollectionView {
    this.reset(accountId);
    let view = this.entries.get(route) as CollectionView | undefined;
    if (!view) {
      view = { navigationId: ++this.sequence, kind, scope, query: '', weapon: 'all', offset: 0 };
      this.entries.set(route, view);
    }
    return view;
  }
  markets(accountId: string | undefined, route: object): MarketView {
    this.reset(accountId);
    let view = this.entries.get(route) as MarketView | undefined;
    if (!view) {
      view = { navigationId: ++this.sequence, filter: 'night-market', offset: 0 };
      this.entries.set(route, view);
    }
    return view;
  }
}

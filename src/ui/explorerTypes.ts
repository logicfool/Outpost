import type { PlayerRef } from '../core/playerTypes';
import type { Ranked } from '../core/types';
export type ExplorerRoute =
  | { type: 'bundle'; id: string }
  | { type: 'item'; item: import('../core/types').CatalogItem }
  | { type: 'player'; player: PlayerRef }
  | { type: 'match'; id: string; subject?: string }
  | { type: 'career'; rank: Ranked }
  | { type: 'live' }
  | { type: 'identity'; initialTab?: 'card' | 'title' }
  | {
      type: 'collection';
      kind: import('./CollectionHub').CollectionKind;
      scope?: import('./CollectionHub').CollectionScope;
    }
  | { type: 'equipped' }
  | { type: 'round'; detail: import('../core/types').MatchDetail; round: number; eventId?: string }
  | { type: 'live-loadout'; matchId: string; subject?: string }
  | { type: 'presets' }
  | { type: 'market-history' }
  | { type: 'buddies' }
  | { type: 'aim'; tab?: import('./AimPanel').AimTab }
  | { type: 'friends' }
  | { type: 'friend-requests' }
  | { type: 'chat-settings'; subject?: string }
  | { type: 'chat'; subject: string };
export type Navigate = (route: ExplorerRoute) => void;

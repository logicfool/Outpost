import type { PlayerRef } from '../core/playerTypes';
import type { Ranked } from '../core/types';
export type ExplorerRoute =
  | { type: 'bundle'; id: string }
  | { type: 'item'; item: import('../core/types').CatalogItem }
  | { type: 'player'; player: PlayerRef }
  | { type: 'match'; id: string; subject?: string }
  | { type: 'career'; rank: Ranked }
  | { type: 'live' }
  | { type: 'identity' }
  | { type: 'presets' }
  | { type: 'friends' }
  | { type: 'chat-settings'; subject?: string }
  | { type: 'chat'; subject: string };
export type Navigate = (route: ExplorerRoute) => void;

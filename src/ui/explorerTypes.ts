import type { PlayerRef } from '../core/playerTypes';
import type { Ranked } from '../core/types';
export type ExplorerRoute =
  | { type: 'player'; player: PlayerRef }
  | { type: 'match'; id: string; subject?: string }
  | { type: 'career'; rank: Ranked }
  | { type: 'live' }
  | { type: 'identity' }
  | { type: 'friends' }
  | { type: 'chat'; subject: string };
export type Navigate = (route: ExplorerRoute) => void;

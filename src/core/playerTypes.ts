import type { CatalogItem, MatchSummary, Ranked, Section } from './types';

export interface PlayerRef {
  subject: string;
  name: string;
  tag: string;
  hidden?: boolean;
  hideLevel?: boolean;
  level?: number | null;
  card?: CatalogItem;
  title?: CatalogItem;
}
export interface PlayerProfile {
  player: PlayerRef;
  rank: Section<Ranked>;
  matches: Section<MatchSummary[]>;
  fetchedAt: number;
  identitySource: 'match' | 'friend' | 'account';
  identityObservedAt?: number;
}
export interface IdentityEdit {
  cardId?: string;
  titleId?: string;
  expectedCardId?: string;
  expectedTitleId?: string;
  expectedVersion?: number;
}

export interface LivePlayer extends PlayerRef {
  stats?: import('./liveStats').LiveStats;
  self: boolean;
  teamId: string;
  agent?: string;
  agentImage?: string;
  selection?: string;
  tier?: number | null;
  tierName?: string;
  tierImage?: string;
}

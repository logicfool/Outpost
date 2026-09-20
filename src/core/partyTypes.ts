export type PartyAccessibility = 'OPEN' | 'CLOSED';
export interface PartyPing {
  gamePodId: string;
  ping: number;
}
export interface PartyMember {
  subject: string;
  name: string;
  tag: string;
  self: boolean;
  owner: boolean;
  ready: boolean;
  moderator: boolean;
  hidden: boolean;
  level: number | null;
  card?: import('./types').CatalogItem;
  title?: import('./types').CatalogItem;
  tier: number | null;
  tierName?: string;
  tierImage?: string;
  platform?: string;
  pings: PartyPing[];

  queueEligibleRemainingLevels?: number;
}
export interface PartyRequest {
  id: string;
  subject: string;
  createdAt?: number;
  expiresAt?: number;
  name?: string;
  tag?: string;
}
export interface PartyCustomGame {
  map?: string;
  mapId?: string;
  mode?: string;
  useBots: boolean;
  teamOne: number;
  teamTwo: number;
  spectators: number;
  coaches: number;
}
export interface Party {
  id: string;
  version?: number;
  state: string;
  previousState?: string;
  stateReason?: string;
  accessibility: PartyAccessibility;
  queueId?: string;
  eligibleQueues: string[];
  ineligibleQueues: { queueId: string; reason?: string }[];
  members: PartyMember[];
  maxSize?: number;
  leaderId?: string;
  selfIsLeader: boolean;
  inviteCode?: string;
  requests: PartyRequest[];
  preferredGamePods: string[];
  skillDisparityPenalty?: number;
  queueEntryAt?: number;
  inQueue: boolean;
  customGame?: PartyCustomGame;
  observedAt: number;
}

export interface NoParty {
  id: null;
  observedAt: number;
}
export type PartyState = Party | NoParty;
export const hasParty = (value: PartyState): value is Party => value.id !== null;

import type { CatalogItem } from './types';

export interface MapMetadata {
  name: string;
  image?: string;
  smallArt?: string;
  listImage?: string;
  minimap?: string;
  xMultiplier?: number;
  yMultiplier?: number;
  xScalarToAdd?: number;
  yScalarToAdd?: number;
}
export interface WeaponMetadata {
  id: string;
  name: string;
  image?: string;
  killIcon?: string;
  category?: string;
  defaultSkinId?: string;
}
export interface WorldPoint {
  x: number;
  y: number;
}
export interface PlayerPosition {
  subject: string;
  location: WorldPoint;
  viewRadians?: number;
}
export interface MatchEvent {
  id: string;
  round: number;
  kind: 'kill' | 'plant' | 'defuse';
  atMs?: number;
  gameMs?: number;
  actor?: string;
  victim?: string;
  assistants: string[];
  location?: WorldPoint;
  positions: PlayerPosition[];
  damageType?: string;
  weaponId?: string;
  weaponName?: string;
  weaponImage?: string;
  site?: string;
}
export interface RoundEconomy {
  subject: string;
  weaponId?: string;
  weaponName?: string;
  weaponImage?: string;
  loadoutValue?: number;
  remaining?: number;
  spent?: number;
}
export interface RoundDetail {
  number: number;
  events: MatchEvent[];
  economy: RoundEconomy[];
  ceremony?: string;
  telemetry: boolean;
  truncated?: boolean;
}
export interface MatchAnalysis {
  version: 1;
  minimap?: MapMetadata;
  events: MatchEvent[];
  rounds: RoundDetail[];
  available: boolean;
  truncated?: boolean;
}
export interface MatchProgress {
  allyScore?: number;
  enemyScore?: number;
  roundNumber?: number;
  completedRounds?: number;
  roundEstimated?: boolean;
  source: 'match' | 'self-presence' | 'teammate-presence' | 'friend-presence' | 'party-owner';
  scoreOnly?: boolean;
  observedAt: number;
  matchId?: string;
}
export interface LiveWeapon {
  weaponId: string;
  weapon: string;
  skin?: CatalogItem;
  levelId?: string;
  chromaId?: string;
  buddy?: CatalogItem;
}
export interface LiveEquipment {
  matchId: string;
  observedAt: number;
  players: { subject: string; weapons: LiveWeapon[] }[];
}

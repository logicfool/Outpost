export type Shard = 'ap' | 'eu' | 'na' | 'kr' | 'pbe';
export type Region = 'ap' | 'eu' | 'na' | 'br' | 'latam' | 'kr' | 'pbe';
export type JsonObject = Record<string, unknown>;
export type ItemKind =
  'skin' | 'chroma' | 'buddy' | 'spray' | 'card' | 'title' | 'agent' | 'unknown';
export interface Account {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: Region;
  shard: Shard;
  addedAt: number;
  expiresAt: number;
  country?: string;
  createdAt?: number;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  demo?: boolean;
}
export interface Session {
  version: 1 | 2;
  account: Account;
  accessToken: string;
  entitlementsToken: string;
  reauth?: { cookies: Record<string, string>; capturedAt: number };
}
export interface LoginAttempt {
  state: string;
  nonce: string;
  createdAt: number;
}
export interface LoginTokens {
  accessToken: string;
  idToken?: string;
  expiresAt: number;
  reauthCookies?: Record<string, string>;
}
export interface Money {
  currencyId: string;
  symbol: string;
  amount: number;
}
export interface CatalogMedia {
  id: string;
  name: string;
  image?: string;
  video?: string;
}
export interface CatalogItem {
  id: string;
  canonicalId: string;
  name: string;
  kind: ItemKind;
  image?: string;
  wallpaper?: string;
  wideArt?: string;
  rarity?: string;
  weapon?: string;
  video?: string;
  levels?: CatalogMedia[];
  chromas?: CatalogMedia[];
}
export interface ContractDefinition {
  id: string;
  name: string;
  relationId?: string;
  relationType?: string;
  levels: { xp: number; rewardId?: string }[];
}
export interface Catalog {
  items: Record<string, CatalogItem>;
  bundles: Record<string, { name: string; image?: string }>;
  maps: Record<string, { name: string; image?: string; listImage?: string }>;
  tiers: Record<string, { name: string; image?: string; color?: string }>;
  contracts: Record<string, ContractDefinition>;
  seasons?: Record<string, { name: string; startsAt?: number }>;
  currentSeasonId?: string;
  fetchedAt: number;
}
export interface StoreOffer {
  id: string;
  item: CatalogItem;
  prices: Money[];
  originalPrices?: Money[];
  discountPercent?: number;
  seen?: boolean;
}
export interface Bundle {
  id: string;
  name: string;
  image?: string;
  prices: Money[];
  expiresAt: number;
  offers: StoreOffer[];
}
export interface Store {
  daily: StoreOffer[];
  dailyExpiresAt: number;
  bundles: Bundle[];
  nightMarket: null | { offers: StoreOffer[]; expiresAt: number };
  accessories: StoreOffer[];
  accessoriesExpireAt?: number;
  fetchedAt: number;
  clockOffsetMs: number;
  endpoint: 'v2' | 'v3' | 'demo';
}
export interface ActStat {
  seasonId: string;
  name: string;
  startsAt?: number;
  current: boolean;
  tier: number | null;
  tierName: string;
  image?: string;
  rr: number | null;
  wins: number;
  games: number;
}
export interface QueueCareer {
  queue: string;
  acts: ActStat[];
  wins: number;
  games: number;
}
export interface Ranked {
  name: string;
  tier: number | null;
  rr: number | null;
  image?: string;
  wins: number | null;
  games: number | null;
  seasonId?: string;
  seasonName?: string;
  currentSeason: boolean;
  peak?: { tier: number; name: string; image?: string; seasonName?: string };
  career?: QueueCareer[];
}
export interface LiveGame {
  state: 'offline' | 'agent_select' | 'in_game';
  matchId?: string;
  map?: string;
  mapImage?: string;
}
export interface MatchSummary {
  id: string;
  startedAt: number;
  queue: string;
  map: string;
  mapImage?: string;
  rrChange?: number;
  tierAfter?: number;
  tierImage?: string;
}
export type RoundOutcome = 'elimination' | 'detonate' | 'defuse' | 'time' | 'surrender' | 'other';
export interface MatchPlayer {
  subject: string;
  name: string;
  tag: string;
  teamId: string;
  self: boolean;
  agent: string;
  agentImage?: string;
  level: number | null;
  tier: number | null;
  tierName?: string;
  tierImage?: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
  acs: number | null;
  headshotPct: number | null;
}
export interface MatchDetail {
  id: string;
  map: string;
  mapImage?: string;
  queue: string;
  startedAt: number;
  durationMs?: number;
  agent: string;
  agentImage?: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  acs: number | null;
  headshotPct: number | null;
  result: 'WIN' | 'LOSS' | 'DRAW' | 'UNKNOWN';
  score: string;
  teamId?: string;
  teams: { id: string; roundsWon: number | null; won: boolean }[];
  players: MatchPlayer[];
  rounds: { number: number; winningTeam: string; outcome: RoundOutcome }[];
  duels: { subject: string; name: string; agentImage?: string; kills: number; deaths: number }[];
}
export interface Progression {
  contracts: {
    id: string;
    name: string;
    level: number;
    xp: number;
    nextLevelXp?: number;
    nextReward?: CatalogItem;
    currentBattlepass: boolean;
  }[];
  missions: { id: string; complete: boolean; expiresAt?: number; objectives: number[] }[];
  weeklyRefillAt?: number;
}
export interface Loadout {
  guns: { weapon: string; skin: CatalogItem; buddy?: CatalogItem }[];
  card?: CatalogItem;
  title?: CatalogItem;
}
export type Section<T> =
  | { status: 'ready'; data: T; fetchedAt: number }
  | { status: 'error'; message: string; code: string; retryAt?: number };
export interface Snapshot {
  accountId: string;
  fetchedAt: number;
  demo: boolean;
  store: Section<Store>;
  wallet: Section<Money[]>;
  rank: Section<Ranked>;
  xp: Section<{ level: number; xp: number }>;
  progression: Section<Progression>;
  collection: Section<CatalogItem[]>;
  loadout: Section<Loadout>;
  liveGame: Section<LiveGame>;
  matches: Section<MatchSummary[]>;
}
export interface HistoryEntry {
  id: string;
  accountId: string;
  observedAt: number;
  expiresAt: number;
  offers: StoreOffer[];
}
export interface Settings {
  reminders: boolean;
  backgroundSync: boolean;
}
export const MAX_ACCOUNTS = 10;
export const XP_PER_LEVEL = 5000;
export const DEFAULT_SETTINGS: Settings = { reminders: false, backgroundSync: false };
export const EMPTY_CATALOG: Catalog = {
  items: {},
  bundles: {},
  maps: {},
  tiers: {},
  contracts: {},
  seasons: {},
  fetchedAt: 0,
};
